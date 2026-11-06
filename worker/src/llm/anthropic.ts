// Implementazione del provider con Claude (API Messages di Anthropic)

import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicApiKey } from "../domain/primitives";
import { err, ok, type Result } from "../domain/result";
import {
  buildInjurySystem,
  buildInjuryUserMessage,
  buildRuleSystem,
  buildRuleUserMessage,
  RULE_ANSWER_SCHEMA,
} from "./prompts";
import type {
  InjuryCheckInput,
  InjuryOpinion,
  LlmFailure,
  LlmProvider,
  RuleAnswer,
  RuleQuestionInput,
  Source,
} from "./provider";
import { toTrustedSource } from "./sources";

export const ANTHROPIC_MODEL = "claude-haiku-5-5";

const RULE_MAX_TOKENS = 4000;
const INJURY_MAX_TOKENS = 8000;
// Oltre questo numero di pause la ricerca non si è conclusa; il modello ha già consumato token: bad_output
const MAX_PAUSE_CONTINUATIONS = 3;
// Durata massima complessiva delle chiamate, continuazioni comprese
export interface TimeBudgets {
  readonly validateKey: number;
  readonly question: number;
  readonly injury: number;
}
export const DEFAULT_BUDGETS_MS: TimeBudgets = Object.freeze({ validateKey: 15_000, question: 45_000, injury: 120_000 });
const MAX_TEXT_LENGTH = 4000;
const MAX_ARTICLES = 10;
const MAX_ARTICLE_LENGTH = 60;
const MAX_SOURCES = 5;

const WEB_SEARCH_TOOL: Anthropic.WebSearchTool20260318 = {
  type: "web_search_20260318",
  name: "web_search",
  allowed_domains: ["fantacalcio.it", "leghe.fantacalcio.it"],
  allowed_callers: ["direct"],
  max_uses: 5,
  user_location: { type: "approximate", country: "IT", timezone: "Europe/Rome" },
};

const UNSAFE_TEXT_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/gu;

export interface ProviderOptions {
  readonly fetch?: typeof fetch;
  readonly budgetsMs?: Partial<TimeBudgets>;
}

export function createAnthropicProvider(apiKey: AnthropicApiKey, options: ProviderOptions = {}): LlmProvider {
  const budgets = { ...DEFAULT_BUDGETS_MS, ...options.budgetsMs };
  const client = new Anthropic({
    apiKey: apiKey.reveal(),
    maxRetries: 1,
    timeout: 60_000,
    logLevel: "off",
    openTelemetry: false,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return Object.freeze({
    validateKey: () => validateKey(client, AbortSignal.timeout(budgets.validateKey)),
    answerRuleQuestion: (input: RuleQuestionInput) => answerRuleQuestion(client, input, AbortSignal.timeout(budgets.question)),
    checkInjurySubstitution: (input: InjuryCheckInput) =>
      checkInjurySubstitution(client, input, AbortSignal.timeout(budgets.injury)),
  });
}

async function validateKey(client: Anthropic, signal: AbortSignal): Promise<Result<void, LlmFailure>> {
  try {
    await client.models.retrieve(ANTHROPIC_MODEL, {}, { signal });
    return ok(undefined);
  } catch (error) {
    return fail(errorToFailure(error));
  }
}

async function answerRuleQuestion(
  client: Anthropic,
  input: RuleQuestionInput,
  signal: AbortSignal,
): Promise<Result<RuleAnswer, LlmFailure>> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: RULE_MAX_TOKENS,
      system: [{ type: "text", text: buildRuleSystem(input.rulebook.value), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildRuleUserMessage(input) }],
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: RULE_ANSWER_SCHEMA },
      },
    }, { signal });
  } catch (error) {
    return fail(errorToFailure(error));
  }

  const stop = stopFailure(message.stop_reason, false);
  if (stop) return fail({ kind: stop, status: null });

  const answer = parseRuleAnswer(joinText(message.content));
  return answer ? ok(answer) : fail({ kind: "bad_output", status: null });
}

async function checkInjurySubstitution(
  client: Anthropic,
  input: InjuryCheckInput,
  signal: AbortSignal,
): Promise<Result<InjuryOpinion, LlmFailure>> {
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildInjurySystem(input.rulebook.value), cache_control: { type: "ephemeral" } },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildInjuryUserMessage(input) }];
  const blocks: Anthropic.ContentBlock[] = [];

  for (let continuation = 0; ; continuation++) {
    let message: Anthropic.Message;
    try {
      message = await client.messages.create({
        model: ANTHROPIC_MODEL,
        max_tokens: INJURY_MAX_TOKENS,
        system,
        tools: [WEB_SEARCH_TOOL],
        messages,
        output_config: { effort: "medium" },
      }, { signal });
    } catch (error) {
      return fail(errorToFailure(error));
    }
    blocks.push(...message.content);

    if (message.stop_reason !== "pause_turn") {
      const stop = stopFailure(message.stop_reason, true);
      if (stop) return fail({ kind: stop, status: null });
      break;
    }
    if (continuation >= MAX_PAUSE_CONTINUATIONS) return fail({ kind: "bad_output", status: null });
    // La risposta in pausa va rimandata così com'è, con gli stessi tools
    messages.push({ role: "assistant", content: message.content });
  }

  const finalBlocks = blocksAfterLastSearchResult(blocks);
  const text = cleanText(joinText(finalBlocks));
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return fail({ kind: "bad_output", status: null });

  const sources = collectSources(finalBlocks);
  if (sources.length === 0) return ok(Object.freeze({ kind: "not_found" as const }));
  return ok(Object.freeze({ kind: "opinion" as const, text, sources }));
}

function stopFailure(reason: Anthropic.StopReason | null, allowSearch: boolean): LlmFailure | null {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return null;
    case "refusal":
      return "refused";
    case "pause_turn":
      return allowSearch ? null : "bad_output";
    default:
      return "bad_output";
  }
}

function joinText(blocks: readonly Anthropic.ContentBlock[]): string {
  let text = "";
  for (const block of blocks) if (block.type === "text") text += block.text;
  return text;
}

function cleanText(text: string): string {
  return text.replace(UNSAFE_TEXT_CHARS, "").trim();
}

function blocksAfterLastSearchResult(blocks: readonly Anthropic.ContentBlock[]): Anthropic.ContentBlock[] {
  const last = blocks.findLastIndex((block) => block.type === "web_search_tool_result");
  return blocks.slice(last + 1);
}

function collectSources(blocks: readonly Anthropic.ContentBlock[]): Source[] {
  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type !== "web_search_result_location") continue;
      const source = toTrustedSource(citation.url, citation.title);
      if (!source || seen.has(source.url)) continue;
      seen.add(source.url);
      sources.push(source);
      if (sources.length === MAX_SOURCES) return sources;
    }
  }
  return sources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuleAnswer(raw: string): RuleAnswer | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { coperto, risposta, articoli, controverso } = data;
  if (typeof coperto !== "boolean" || typeof risposta !== "string" || typeof controverso !== "boolean") return null;
  if (!Array.isArray(articoli) || articoli.length > MAX_ARTICLES) return null;

  const articles: string[] = [];
  for (const article of articoli) {
    if (typeof article !== "string") return null;
    const cleaned = article.trim();
    if (cleaned.length === 0 || cleaned.length > MAX_ARTICLE_LENGTH || cleaned !== cleanText(cleaned)) return null;
    articles.push(cleaned);
  }

  // Fail closed: niente regole senza un articolo citato
  if (!coperto || articles.length === 0) return Object.freeze({ kind: "not_covered" as const });

  const text = cleanText(risposta);
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) return null;
  return Object.freeze({ kind: "answered" as const, text, articles: Object.freeze(articles), controversial: controverso });
}

interface FailureInfo {
  readonly kind: LlmFailure;
  readonly status: number | null;
}

function errorToFailure(error: unknown): FailureInfo {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return { kind: "invalid_key", status: error.status };
  }
  if (error instanceof Anthropic.RateLimitError) return { kind: "rate_limited", status: 429 };
  // Tetto di tempo superato: nessuna risposta utilizzabile, la domanda si restituisce
  if (error instanceof Anthropic.APIUserAbortError) return { kind: "unavailable", status: null };
  if (error instanceof Anthropic.APIConnectionError) return { kind: "unavailable", status: null };
  if (error instanceof Anthropic.InternalServerError) return { kind: "overloaded", status: error.status };
  if (error instanceof Anthropic.APIError) return { kind: "unavailable", status: error.status ?? null };
  return { kind: "unavailable", status: null };
}

// Nel log solo lo stato HTTP e il tipo di errore: mai messaggi, domande, regolamento o chiavi
function fail(info: FailureInfo): Result<never, LlmFailure> {
  console.warn(JSON.stringify({ event: "llm_error", status: info.status, kind: info.kind }));
  return err(info.kind);
}
