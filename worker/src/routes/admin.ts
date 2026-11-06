// Rotte dell'admin: panoramica, regolamento, chiave API, impostazioni, codice, membri, password

import { reserveLoginAttempt } from "../abuse/login-attempts";
import { ipSubject } from "../abuse/throttle";
import { field, requireAdmin, strictBoolean, type Ctx, type Route } from "../app";
import {
  findLeagueById,
  generateUniqueJoinCode,
  getApiKeyUpdatedAt,
  getRulebook,
  getRulebookMeta,
  getSecrets,
  saveRulebook,
  updateApiKey,
  updateJoinCode,
  updateSettings,
  type SettingsChange,
} from "../db/leagues";
import { changeAdminPassword, listActiveMembers, removeMember } from "../db/members";
import type { League, Member } from "../domain/league";
import { AdminPassword, AnthropicApiKey, DailyLimit, MemberId, RulebookText } from "../domain/primitives";
import { Errors } from "../http/errors";
import { HttpError, json, readJson } from "../http/http";
import { hashPassword, verifyPassword } from "../security/password";
import { getMonthlyQuestions } from "../usage/monthly";
import { sealAndCheckApiKey } from "./keys";
import { issueToken } from "./public";

const SMALL_BODY = 4 * 1024;
// 150.000 caratteri fino a 4 byte l'uno in UTF-8, più l'involucro JSON con eventuali escape
const RULEBOOK_BODY = 1024 * 1024;

async function adminLeague(ctx: Ctx): Promise<{ admin: Member; league: League }> {
  const admin = await requireAdmin(ctx);
  const league = await findLeagueById(ctx.db, admin.leagueId);
  if (!league) throw new HttpError(Errors.unauthorized);
  return { admin, league };
}

async function overviewRoute(ctx: Ctx): Promise<Response> {
  const { league } = await adminLeague(ctx);
  const [rulebook, apiKeyUpdatedAt, monthlyQuestions, members] = await Promise.all([
    getRulebookMeta(ctx.db, league.id),
    getApiKeyUpdatedAt(ctx.db, league.id),
    getMonthlyQuestions(ctx.db, league.id, ctx.now),
    listActiveMembers(ctx.db, league.id),
  ]);
  return json(
    {
      league: {
        name: league.name,
        joinCode: league.joinCode.value,
        dailyLimit: league.dailyLimit.value,
        injuryCheckEnabled: league.injuryCheckEnabled,
      },
      apiKeyUpdatedAt,
      rulebook,
      monthlyQuestions,
      members,
    },
    ctx.origin,
  );
}

async function getRulebookRoute(ctx: Ctx): Promise<Response> {
  const { league } = await adminLeague(ctx);
  const rulebook = await getRulebook(ctx.db, league.id);
  return json({ text: rulebook?.value ?? null }, ctx.origin);
}

async function putRulebookRoute(ctx: Ctx): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const body = await readJson(ctx.request, RULEBOOK_BODY);
  const text = field(RulebookText.parse(body.text));
  const version = await saveRulebook(ctx.db, league.id, text, admin.id, ctx.now);
  return json({ version }, ctx.origin);
}

async function putApiKeyRoute(ctx: Ctx): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const body = await readJson(ctx.request, SMALL_BODY);
  const apiKey = field(AnthropicApiKey.parse(body.apiKey));
  const sealed = await sealAndCheckApiKey(ctx, league.id, apiKey);
  await updateApiKey(ctx.db, league.id, sealed, admin.id, ctx.now);
  return json({ apiKeyUpdatedAt: ctx.now.toISOString() }, ctx.origin);
}

async function patchSettingsRoute(ctx: Ctx): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const body = await readJson(ctx.request, SMALL_BODY);
  const change: { dailyLimit?: DailyLimit; injuryCheckEnabled?: boolean } = {};
  if (body.dailyLimit !== undefined) change.dailyLimit = field(DailyLimit.parse(body.dailyLimit));
  if (body.injuryCheckEnabled !== undefined) change.injuryCheckEnabled = field(strictBoolean(body.injuryCheckEnabled));
  if (change.dailyLimit === undefined && change.injuryCheckEnabled === undefined) throw new HttpError(Errors.badBody);
  await updateSettings(ctx.db, league.id, change as SettingsChange, admin.id, ctx.now);
  return json(
    {
      dailyLimit: change.dailyLimit?.value ?? league.dailyLimit.value,
      injuryCheckEnabled: change.injuryCheckEnabled ?? league.injuryCheckEnabled,
    },
    ctx.origin,
  );
}

async function regenerateCodeRoute(ctx: Ctx): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const code = await generateUniqueJoinCode(ctx.db);
  await updateJoinCode(ctx.db, league.id, code, admin.id, ctx.now);
  return json({ joinCode: code.value }, ctx.origin);
}

async function removeMemberRoute(ctx: Ctx, params: readonly string[]): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const memberId = MemberId.parse(params[0]);
  if (!memberId.ok) throw new HttpError(Errors.memberNotFound);
  const removed = await removeMember(ctx.db, league.id, memberId.value, admin.id, ctx.now);
  if (!removed) throw new HttpError(Errors.memberNotFound);
  return json({ removed: true }, ctx.origin);
}

async function changePasswordRoute(ctx: Ctx): Promise<Response> {
  const { admin, league } = await adminLeague(ctx);
  const body = await readJson(ctx.request, SMALL_BODY);
  const next = field(AdminPassword.parse(body.newPassword));
  if (next.isWeak([league.name, admin.name])) throw new HttpError(Errors.weakPassword);

  // La verifica della password attuale conta come un tentativo di accesso, prenotato prima di verificarla
  const ip = await ipSubject(ctx.request, await ctx.ipKey());
  if (!(await reserveLoginAttempt(ctx.db, ip, league.id, ctx.now))) throw new HttpError(Errors.tooManyAttempts);
  const current = AdminPassword.parse(body.currentPassword);
  const secrets = await getSecrets(ctx.db, league.id);
  if (!current.ok || !(await verifyPassword(current.value, secrets.passwordHash))) throw new HttpError(Errors.wrongPassword);

  const hash = await hashPassword(next);
  const tokenVersion = await changeAdminPassword(ctx.db, league.id, admin.id, hash, ctx.now);
  const token = await issueToken(ctx, { ...admin, tokenVersion });
  return json({ token }, ctx.origin);
}

export const adminRoutes: readonly Route[] = [
  { method: "GET", pattern: /^\/api\/admin\/league$/, handler: overviewRoute },
  { method: "GET", pattern: /^\/api\/admin\/rulebook$/, handler: getRulebookRoute },
  { method: "PUT", pattern: /^\/api\/admin\/rulebook$/, handler: putRulebookRoute },
  { method: "PUT", pattern: /^\/api\/admin\/api-key$/, handler: putApiKeyRoute },
  { method: "PATCH", pattern: /^\/api\/admin\/settings$/, handler: patchSettingsRoute },
  { method: "POST", pattern: /^\/api\/admin\/join-code$/, handler: regenerateCodeRoute },
  { method: "DELETE", pattern: /^\/api\/admin\/members\/([^/]{1,64})$/, handler: removeMemberRoute },
  { method: "PUT", pattern: /^\/api\/admin\/password$/, handler: changePasswordRoute },
];
