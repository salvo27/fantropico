// Strumenti comuni ai test HTTP: app con modello finto, richieste con origin giusto

import { env } from "cloudflare:test";
import { handleRequest, type AppDeps } from "../src/app";
import { ok, err, type Result } from "../src/domain/result";
import type { AnthropicApiKey } from "../src/domain/primitives";
import type { InjuryOpinion, LlmFailure, LlmProvider, RuleAnswer } from "../src/llm/provider";
import { routes } from "../src/index";

export const ORIGIN = "https://fantropico.test";
export const VALID_API_KEY = "sk-ant-api03-" + "k".repeat(40);
export const ADMIN_PASSWORD = "rigore al novantesimo 7";
export const RULEBOOK = "Art. 1 - Partecipanti\nLa lega ha otto partecipanti.\n".repeat(10);

export interface FakeLlm {
  validateKey: Result<void, LlmFailure>;
  ruleAnswer: Result<RuleAnswer, LlmFailure>;
  injuryOpinion: Result<InjuryOpinion, LlmFailure>;
  revealedKeys: string[];
  calls: number;
}

export function fakeLlm(): FakeLlm {
  return {
    validateKey: ok(undefined),
    ruleAnswer: ok({ kind: "answered", text: "Sì, lo prevede l'articolo 1.", articles: ["Art. 1"], controversial: false }),
    injuryOpinion: ok({ kind: "not_found" }),
    revealedKeys: [],
    calls: 0,
  };
}

// Ogni richiesta senza IP esplicito ne riceve uno nuovo: i test non dipendono dall'ordine
let ipCounter = 0;
export function uniqueIp(): string {
  ipCounter++;
  return `100.${64 + ((ipCounter >> 16) & 63)}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function makeApp(llm: FakeLlm, now: () => Date = () => new Date("2026-11-06T10:00:00Z")) {
  const deps: AppDeps = {
    now,
    llm: (apiKey: AnthropicApiKey): LlmProvider => {
      llm.revealedKeys.push(apiKey.reveal());
      return {
        validateKey: async () => llm.validateKey,
        answerRuleQuestion: async () => {
          llm.calls++;
          return llm.ruleAnswer;
        },
        checkInjurySubstitution: async () => {
          llm.calls++;
          return llm.injuryOpinion;
        },
      };
    },
  };
  return (path: string, init: { method?: string; body?: unknown; token?: string; origin?: string | null; ip?: string; rawBody?: string; headers?: Record<string, string> } = {}) => {
    const headers = new Headers(init.headers);
    if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
    headers.set("CF-Connecting-IP", init.ip ?? uniqueIp());
    if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
    let body: string | undefined;
    if (init.rawBody !== undefined) body = init.rawBody;
    else if (init.body !== undefined) body = JSON.stringify(init.body);
    if (body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const request = new Request(`https://api.fantropico.test${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body: body ?? null });
    return handleRequest(request, env, deps, routes);
  };
}

export type App = ReturnType<typeof makeApp>;

export async function createLeague(app: App, overrides: Record<string, unknown> = {}, ip?: string) {
  const res = await app("/api/leagues", {
    ip: ip ?? uniqueIp(),
    body: { leagueName: "Lega di Prova", adminName: "Admin", adminPassword: ADMIN_PASSWORD, apiKey: VALID_API_KEY, ...overrides },
  });
  const body = (await res.json()) as { token: string; league: { name: string; joinCode: string }; error?: { code: string; message: string } };
  return { res, body };
}

export async function join(app: App, code: string, name: string, ip?: string) {
  const res = await app("/api/join", { body: { code, name }, ...(ip ? { ip } : {}) });
  return { res, body: (await res.json()) as { token?: string; error?: { code: string } } };
}

export { ok, err };
