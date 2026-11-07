// Rotte senza sessione: creare una lega, entrare con il codice, accesso admin con password

import { reserveLoginAttempt } from "../abuse/login-attempts";
import { ipSubject, isThrottled, recordAttempt } from "../abuse/throttle";
import { field, type Ctx, type Route } from "../app";
import { createLeague, findLeagueById, findLeagueIdByJoinCode, generateUniqueJoinCode, getSecrets } from "../db/leagues";
import { findAdmin, joinMember, recordAdminLogin } from "../db/members";
import type { League, Member } from "../domain/league";
import { AdminPassword, AnthropicApiKey, DailyLimit, JoinCode, LeagueId, LeagueName, MemberId, MemberName } from "../domain/primitives";
import { Errors } from "../http/errors";
import { HttpError, json, readJson } from "../http/http";
import { hashPassword, verifyPassword } from "../security/password";
import { signSession } from "../security/token";
import { sealAndCheckApiKey } from "./keys";

const SMALL_BODY = 4 * 1024;

export async function issueToken(ctx: Ctx, member: Pick<Member, "id" | "leagueId" | "role" | "tokenVersion">): Promise<string> {
  return signSession(
    { leagueId: member.leagueId, memberId: member.id, role: member.role, tokenVersion: member.tokenVersion },
    await ctx.sessionKey(),
    ctx.now,
  );
}

function sessionBody(token: string, league: Pick<League, "name">, member: Pick<Member, "name" | "role">, joinCode?: JoinCode) {
  return {
    token,
    league: { name: league.name, ...(joinCode ? { joinCode: joinCode.value } : {}) },
    member: { name: member.name, role: member.role },
  };
}

async function createLeagueRoute(ctx: Ctx): Promise<Response> {
  const ip = await ipSubject(ctx.request, await ctx.ipKey());
  if (await isThrottled(ctx.env.ABUSE_KV, ip, "league_create", ctx.now)) throw new HttpError(Errors.tooManyAttempts);
  await recordAttempt(ctx.env.ABUSE_KV, ip, "league_create", ctx.now);

  const body = await readJson(ctx.request, SMALL_BODY);
  const leagueName = field(LeagueName.parse(body.leagueName));
  const adminName = field(MemberName.parse(body.adminName));
  const password = field(AdminPassword.parse(body.adminPassword));
  const apiKey = field(AnthropicApiKey.parse(body.apiKey));
  if (password.isWeak([leagueName.value, adminName.value])) throw new HttpError(Errors.weakPassword);

  const leagueId = LeagueId.generate();
  const sealedKey = await sealAndCheckApiKey(ctx, leagueId, apiKey);
  const passwordHash = await hashPassword(password);
  const joinCode = await generateUniqueJoinCode(ctx.db);
  const adminId = MemberId.generate();

  await createLeague(
    ctx.db,
    {
      id: leagueId,
      name: leagueName.value,
      joinCode,
      dailyLimit: DailyLimit.default(),
      apiKey: sealedKey,
      passwordHash,
      adminId,
      adminName: adminName.value,
      adminNameKey: adminName.key,
    },
    ctx.now,
  );

  const token = await issueToken(ctx, { id: adminId, leagueId, role: "admin", tokenVersion: 1 });
  return json(sessionBody(token, { name: leagueName.value }, { name: adminName.value, role: "admin" }, joinCode), ctx.origin, 201);
}

async function joinRoute(ctx: Ctx): Promise<Response> {
  const ip = await ipSubject(ctx.request, await ctx.ipKey());
  const [failures, successes] = await Promise.all([
    isThrottled(ctx.env.ABUSE_KV, ip, "join_failure", ctx.now),
    isThrottled(ctx.env.ABUSE_KV, ip, "join_success", ctx.now),
  ]);
  if (failures || successes) throw new HttpError(Errors.tooManyAttempts);
  const fail = async (error: HttpError) => {
    await recordAttempt(ctx.env.ABUSE_KV, ip, "join_failure", ctx.now);
    return error;
  };

  const body = await readJson(ctx.request, SMALL_BODY);
  const code = JoinCode.parse(body.code);
  if (!code.ok) throw await fail(new HttpError(Errors.wrongCode));
  const name = field(MemberName.parse(body.name));

  const leagueId = await findLeagueIdByJoinCode(ctx.db, code.value);
  if (!leagueId) throw await fail(new HttpError(Errors.wrongCode));
  const league = await findLeagueById(ctx.db, leagueId);
  if (!league) throw await fail(new HttpError(Errors.wrongCode));

  // Conteggio prima della scrittura in D1: se KV fallisce (per esempio 1 scrittura al secondo per chiave) non resta un membro senza token
  await recordAttempt(ctx.env.ABUSE_KV, ip, "join_success", ctx.now);
  const outcome = await joinMember(ctx.db, leagueId, MemberId.generate(), name, ctx.now);
  if (outcome.kind !== "joined") {
    const errors = { name_taken: Errors.nameTaken, league_full: Errors.leagueFull, too_many_joins: Errors.tooManyJoins };
    throw new HttpError(errors[outcome.kind]);
  }

  const token = await issueToken(ctx, { id: outcome.memberId, leagueId, role: "member", tokenVersion: outcome.tokenVersion });
  return json(sessionBody(token, league, { name: name.value, role: "member" }), ctx.origin, 201);
}

async function adminLoginRoute(ctx: Ctx): Promise<Response> {
  const body = await readJson(ctx.request, SMALL_BODY);
  const ip = await ipSubject(ctx.request, await ctx.ipKey());
  const code = JoinCode.parse(body.code);
  const leagueId = code.ok ? await findLeagueIdByJoinCode(ctx.db, code.value) : null;

  // Il tentativo si prenota prima di qualsiasi verifica della password, anche se poi riesce
  if (!(await reserveLoginAttempt(ctx.db, ip, leagueId, ctx.now))) throw new HttpError(Errors.tooManyAttempts);

  const password = AdminPassword.parse(body.password);
  if (!password.ok || !leagueId) throw new HttpError(Errors.wrongCredentials);
  const secrets = await getSecrets(ctx.db, leagueId);
  if (!(await verifyPassword(password.value, secrets.passwordHash))) throw new HttpError(Errors.wrongCredentials);

  const [league, admin] = await Promise.all([findLeagueById(ctx.db, leagueId), findAdmin(ctx.db, leagueId)]);
  if (!league) throw new HttpError(Errors.wrongCredentials);
  await recordAdminLogin(ctx.db, leagueId, admin.id, ctx.now);
  const token = await issueToken(ctx, admin);
  return json(sessionBody(token, league, admin), ctx.origin);
}

export const publicRoutes: readonly Route[] = [
  { method: "POST", pattern: /^\/api\/leagues$/, handler: createLeagueRoute },
  { method: "POST", pattern: /^\/api\/join$/, handler: joinRoute },
  { method: "POST", pattern: /^\/api\/admin\/login$/, handler: adminLoginRoute },
];
