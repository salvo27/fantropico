// Rotte dei partecipanti: profilo, domande sul regolamento, verifica sostituzione

import { field, requireMember, type Ctx, type Route } from "../app";
import { findLeagueById, getRulebook, getRulebookMeta } from "../db/leagues";
import {
  ADMIN_CONFIRMS_TEXT,
  ADMIN_DECIDES_TEXT,
  INJURY_NOT_FOUND_TEXT,
  NOT_COVERED_TEXT,
  type League,
  type Member,
} from "../domain/league";
import { verifiedArticles } from "../domain/citations";
import { PlayerName, Question, type RulebookText } from "../domain/primitives";
import { romeLongDate } from "../domain/time";
import { Errors } from "../http/errors";
import { HttpError, json, readJson } from "../http/http";
import type { InjuryOpinion, LlmFailure, LlmProvider, RuleAnswer } from "../llm/provider";
import type { Result } from "../domain/result";
import { getDailyUsage, releaseDailyQuestion, reserveDailyQuestion } from "../usage/daily-limit";
import { recordAnsweredQuestion } from "../usage/monthly";
import { llmFailureError, providerForLeague } from "./keys";

const QUESTION_BODY = 8 * 1024;
const REFUNDABLE: ReadonlySet<LlmFailure> = new Set<LlmFailure>(["invalid_key", "rate_limited", "overloaded", "unavailable"]);

async function loadLeague(ctx: Ctx, member: Member): Promise<League> {
  const league = await findLeagueById(ctx.db, member.leagueId);
  if (!league) throw new HttpError(Errors.unauthorized);
  return league;
}

async function meRoute(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx);
  const league = await loadLeague(ctx, member);
  const [rulebook, usedToday] = await Promise.all([
    getRulebookMeta(ctx.db, league.id),
    getDailyUsage(ctx.db, member.id, ctx.now),
  ]);
  const limit = league.dailyLimit.value;
  return json(
    {
      member: { name: member.name, role: member.role },
      league: { name: league.name, injuryCheckEnabled: league.injuryCheckEnabled, hasRulebook: rulebook !== null },
      usage: { usedToday, dailyLimit: limit, remainingToday: Math.max(0, limit - usedToday) },
    },
    ctx.origin,
  );
}

// Prenota una domanda, chiama il modello e restituisce il posto se la chiamata fallisce per motivi tecnici
async function withDailyQuestion<T>(
  ctx: Ctx,
  member: Member,
  league: League,
  call: (provider: LlmProvider) => Promise<Result<T, LlmFailure>>,
): Promise<{ value: T; remaining: number }> {
  const reserved = await reserveDailyQuestion(ctx.db, member.id, league.dailyLimit, ctx.now);
  if (!reserved.ok) throw new HttpError(Errors.dailyLimitReached);

  let result: Result<T, LlmFailure>;
  try {
    result = await call(await providerForLeague(ctx, league.id));
  } catch (error) {
    await releaseDailyQuestion(ctx.db, member.id, ctx.now);
    throw error;
  }
  if (!result.ok) {
    // Si restituisce la domanda solo se il modello non ha prodotto token; rifiuti e risposte inutilizzabili costano e contano
    if (REFUNDABLE.has(result.error)) await releaseDailyQuestion(ctx.db, member.id, ctx.now);
    else await recordAnsweredQuestion(ctx.db, league.id, ctx.now);
    throw llmFailureError(result.error);
  }
  await recordAnsweredQuestion(ctx.db, league.id, ctx.now);
  return { value: result.value, remaining: reserved.value.remaining };
}

async function requireRulebook(ctx: Ctx, league: League): Promise<RulebookText> {
  const rulebook = await getRulebook(ctx.db, league.id);
  if (!rulebook) throw new HttpError(Errors.noRulebook);
  return rulebook;
}

function ruleAnswerBody(answer: RuleAnswer, rulebook: RulebookText) {
  // Una regola senza un articolo che esista davvero nel regolamento non vale (fail closed)
  const articles = answer.kind === "answered" ? verifiedArticles(answer.articles, rulebook) : [];
  if (answer.kind === "not_covered" || articles.length === 0) {
    return { status: "not_covered", text: NOT_COVERED_TEXT, articles: [], note: null };
  }
  return {
    status: "answered",
    text: answer.text,
    articles,
    note: answer.controversial ? ADMIN_DECIDES_TEXT : null,
  };
}

async function questionRoute(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx);
  const body = await readJson(ctx.request, QUESTION_BODY);
  const question = field(Question.parse(body.question));
  const league = await loadLeague(ctx, member);
  const rulebook = await requireRulebook(ctx, league);

  const { value, remaining } = await withDailyQuestion(ctx, member, league, (provider) =>
    provider.answerRuleQuestion({
      rulebook,
      question,
      today: romeLongDate(ctx.now),
      injuryCheckEnabled: league.injuryCheckEnabled,
    }),
  );
  return json({ answer: ruleAnswerBody(value, rulebook), remainingToday: remaining }, ctx.origin);
}

function injuryBody(opinion: InjuryOpinion, checkedOn: string) {
  if (opinion.kind === "not_found") {
    return { status: "not_found", text: INJURY_NOT_FOUND_TEXT, sources: [], checkedOn, note: ADMIN_CONFIRMS_TEXT };
  }
  return { status: "opinion", text: opinion.text, sources: opinion.sources, checkedOn, note: ADMIN_CONFIRMS_TEXT };
}

async function injuryCheckRoute(ctx: Ctx): Promise<Response> {
  const member = await requireMember(ctx);
  const league = await loadLeague(ctx, member);
  if (!league.injuryCheckEnabled) throw new HttpError(Errors.injuryCheckDisabled);

  const body = await readJson(ctx.request, QUESTION_BODY);
  const injured = field(PlayerName.parse(body.injured));
  const replacement = field(PlayerName.parse(body.replacement));
  if (injured.value.toLocaleLowerCase("it-IT") === replacement.value.toLocaleLowerCase("it-IT")) {
    throw new HttpError(Errors.samePlayer);
  }
  const rulebook = await requireRulebook(ctx, league);
  const today = romeLongDate(ctx.now);

  const { value, remaining } = await withDailyQuestion(ctx, member, league, (provider) =>
    provider.checkInjurySubstitution({ rulebook, injured, replacement, today }),
  );
  return json({ answer: injuryBody(value, today), remainingToday: remaining }, ctx.origin);
}

export const memberRoutes: readonly Route[] = [
  { method: "GET", pattern: /^\/api\/me$/, handler: meRoute },
  { method: "POST", pattern: /^\/api\/questions$/, handler: questionRoute },
  { method: "POST", pattern: /^\/api\/injury-checks$/, handler: injuryCheckRoute },
];
