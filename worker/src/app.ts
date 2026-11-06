// Contesto della richiesta, autenticazione e router

import { recordLeagueActivity } from "./db/leagues";
import { findActiveMember } from "./db/members";
import type { Member } from "./domain/league";
import { ok, type InvalidInput, type Result } from "./domain/result";
import { Errors, invalidField } from "./http/errors";
import { errorResponse, HttpError, isAllowedOrigin, parseAllowedOrigin, preflight } from "./http/http";
import type { LlmProviderFactory } from "./llm/provider";
import { loadEncryptionKey } from "./security/crypto";
import { deriveSubkey, loadSessionKey, verifySession } from "./security/token";

export interface AppDeps {
  readonly llm: LlmProviderFactory;
  readonly now: () => Date;
}

export class Ctx {
  readonly now: Date;
  readonly url: URL;
  #sessionKey?: Promise<CryptoKey>;
  #encryptionKey?: Promise<CryptoKey>;
  #ipKey?: Promise<CryptoKey>;

  constructor(
    readonly request: Request,
    readonly env: Env,
    readonly deps: AppDeps,
    readonly origin: string,
  ) {
    this.now = deps.now();
    this.url = new URL(request.url);
  }

  get db(): D1Database {
    return this.env.DB;
  }
  sessionKey(): Promise<CryptoKey> {
    return (this.#sessionKey ??= loadSessionKey(this.env));
  }
  encryptionKey(): Promise<CryptoKey> {
    return (this.#encryptionKey ??= loadEncryptionKey(this.env));
  }
  ipKey(): Promise<CryptoKey> {
    return (this.#ipKey ??= deriveSubkey(this.env, "fantropico-ip-hash-v1"));
  }
}

// Ogni richiesta autenticata ricontrolla su D1 che il membro sia attivo e che il token non sia stato revocato
export async function requireMember(ctx: Ctx): Promise<Member> {
  const header = ctx.request.headers.get("Authorization");
  if (!header || header.length > 600 || !header.startsWith("Bearer ")) throw new HttpError(Errors.unauthorized);
  const claims = await verifySession(header.slice("Bearer ".length), await ctx.sessionKey(), ctx.now);
  if (!claims.ok) throw new HttpError(Errors.unauthorized);
  const member = await findActiveMember(ctx.db, claims.value.leagueId, claims.value.memberId);
  if (!member || member.role !== claims.value.role || member.tokenVersion !== claims.value.tokenVersion) {
    throw new HttpError(Errors.unauthorized);
  }
  await recordLeagueActivity(ctx.db, member.leagueId, ctx.now);
  return member;
}

export async function requireAdmin(ctx: Ctx): Promise<Member> {
  const member = await requireMember(ctx);
  if (member.role !== "admin") throw new HttpError(Errors.forbidden);
  return member;
}

// Estrae un campo con la sua primitiva oppure interrompe con il messaggio del campo
export function field<T>(result: Result<T, InvalidInput>): T {
  if (!result.ok) throw new HttpError(invalidField(result.error.field));
  return result.value;
}

export function strictBoolean(raw: unknown): Result<boolean, InvalidInput> {
  return typeof raw === "boolean" ? ok(raw) : { ok: false, error: { kind: "invalid_input", field: "injuryCheckEnabled" } };
}

type Handler = (ctx: Ctx, params: readonly string[]) => Promise<Response>;

export interface Route {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly pattern: RegExp;
  readonly handler: Handler;
}

function logUnexpected(error: unknown): string {
  const incident = crypto.randomUUID().slice(0, 8);
  const name = error instanceof Error ? error.name : "unknown";
  console.error(JSON.stringify({ event: "unhandled_error", incident, name }));
  return incident;
}

export async function handleRequest(request: Request, env: Env, deps: AppDeps, routes: readonly Route[]): Promise<Response> {
  let origin: string;
  try {
    origin = parseAllowedOrigin(env.ALLOWED_ORIGIN);
  } catch (error) {
    return errorResponse(Errors.internal, null, logUnexpected(error));
  }

  // Prima validazione: l'origine (lezione 05). Senza origin giusto niente CORS e niente elaborazione
  if (!isAllowedOrigin(request, origin)) return errorResponse(Errors.forbidden, null);
  if (request.method === "OPTIONS") return preflight(origin);

  try {
    const ctx = new Ctx(request, env, deps, origin);
    const path = ctx.url.pathname;
    let pathMatched = false;
    for (const route of routes) {
      const match = route.pattern.exec(path);
      if (!match) continue;
      pathMatched = true;
      if (route.method === request.method) return await route.handler(ctx, match.slice(1));
    }
    return errorResponse(pathMatched ? Errors.methodNotAllowed : Errors.notFound, origin);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error.appError, origin);
    return errorResponse(Errors.internal, origin, logUnexpected(error));
  }
}
