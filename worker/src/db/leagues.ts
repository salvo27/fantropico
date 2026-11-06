// Accesso a D1 per la lega: ogni query legge solo le colonne che servono

import type { AuditAction, League } from "../domain/league";
import { DailyLimit, JoinCode, LeagueId, RulebookText, type MemberId } from "../domain/primitives";
import type { EncryptedSecret } from "../security/crypto";

// Dato in D1 che non rispetta il modello: errore tecnico, non si prosegue (fail closed)
export class DataIntegrityError extends Error {
  constructor(readonly table: string) {
    super(`Integrity check failed: ${table}`);
    this.name = "DataIntegrityError";
  }
}

interface LeagueRow {
  id: string;
  name: string;
  join_code: string;
  daily_limit: number;
  injury_check_enabled: number;
}

function toLeague(row: LeagueRow): League {
  const id = LeagueId.parse(row.id);
  const joinCode = JoinCode.parse(row.join_code);
  const dailyLimit = DailyLimit.parse(row.daily_limit);
  if (!id.ok || !joinCode.ok || !dailyLimit.ok || (row.injury_check_enabled !== 0 && row.injury_check_enabled !== 1)) {
    throw new DataIntegrityError("leagues");
  }
  return Object.freeze({
    id: id.value,
    name: row.name,
    joinCode: joinCode.value,
    dailyLimit: dailyLimit.value,
    injuryCheckEnabled: row.injury_check_enabled === 1,
  });
}

export async function findLeagueById(db: D1Database, id: LeagueId): Promise<League | null> {
  const row = await db
    .prepare("SELECT id, name, join_code, daily_limit, injury_check_enabled FROM leagues WHERE id = ?1")
    .bind(id.value)
    .first<LeagueRow>();
  return row ? toLeague(row) : null;
}

// Segna la lega come usata, al massimo una scrittura al giorno per lega
export const ACTIVITY_WRITE_INTERVAL_MS = 86_400_000;

export async function recordLeagueActivity(db: D1Database, leagueId: LeagueId, now: Date): Promise<void> {
  const staleBefore = new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS).toISOString();
  await db
    .prepare("UPDATE leagues SET last_active_at = ?2 WHERE id = ?1 AND last_active_at < ?3")
    .bind(leagueId.value, now.toISOString(), staleBefore)
    .run();
}

export async function findLeagueIdByJoinCode(db: D1Database, code: JoinCode): Promise<LeagueId | null> {
  const row = await db.prepare("SELECT id FROM leagues WHERE join_code = ?1").bind(code.value).first<{ id: string }>();
  if (!row) return null;
  const id = LeagueId.parse(row.id);
  if (!id.ok) throw new DataIntegrityError("leagues");
  return id.value;
}

// Genera un codice non ancora usato; con 32^8 combinazioni le collisioni sono rarissime
export async function generateUniqueJoinCode(db: D1Database): Promise<JoinCode> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = JoinCode.generate();
    const taken = await db.prepare("SELECT 1 AS taken FROM leagues WHERE join_code = ?1").bind(code.value).first();
    if (!taken) return code;
  }
  throw new Error("Could not generate a unique join code");
}

export function auditStatement(
  db: D1Database,
  leagueId: LeagueId,
  actor: MemberId | null,
  action: AuditAction,
  now: Date,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_events (league_id, actor_member_id, action, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(leagueId.value, actor?.value ?? null, action, now.toISOString());
}

export interface NewLeague {
  readonly id: LeagueId;
  readonly name: string;
  readonly joinCode: JoinCode;
  readonly dailyLimit: DailyLimit;
  readonly apiKey: EncryptedSecret;
  readonly passwordHash: string;
  readonly adminId: MemberId;
  readonly adminName: string;
  readonly adminNameKey: string;
}

// Lega, segreti, admin e registro in un'unica transazione
export async function createLeague(db: D1Database, league: NewLeague, now: Date): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO leagues (id, name, join_code, daily_limit, injury_check_enabled, created_at, last_active_at) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)")
      .bind(league.id.value, league.name, league.joinCode.value, league.dailyLimit.value, at),
    db
      .prepare(
        `INSERT INTO league_secrets (league_id, api_key_ciphertext, api_key_iv, api_key_key_version, api_key_updated_at, admin_password_hash, admin_password_updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)`,
      )
      .bind(league.id.value, league.apiKey.ciphertext, league.apiKey.iv, league.apiKey.keyVersion, at, league.passwordHash),
    db
      .prepare(
        "INSERT INTO members (id, league_id, name, name_key, role, status, token_version, joined_at) VALUES (?1, ?2, ?3, ?4, 'admin', 'active', 1, ?5)",
      )
      .bind(league.adminId.value, league.id.value, league.adminName, league.adminNameKey, at),
    auditStatement(db, league.id, league.adminId, "league_created", now),
  ]);
}

export async function updateJoinCode(db: D1Database, leagueId: LeagueId, code: JoinCode, actor: MemberId, now: Date): Promise<void> {
  await db.batch([
    db.prepare("UPDATE leagues SET join_code = ?2 WHERE id = ?1").bind(leagueId.value, code.value),
    auditStatement(db, leagueId, actor, "join_code_regenerated", now),
  ]);
}

export interface SettingsChange {
  readonly dailyLimit?: DailyLimit;
  readonly injuryCheckEnabled?: boolean;
}

export async function updateSettings(db: D1Database, leagueId: LeagueId, change: SettingsChange, actor: MemberId, now: Date): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE leagues SET
           daily_limit = coalesce(?2, daily_limit),
           injury_check_enabled = coalesce(?3, injury_check_enabled)
         WHERE id = ?1`,
      )
      .bind(
        leagueId.value,
        change.dailyLimit?.value ?? null,
        change.injuryCheckEnabled === undefined ? null : change.injuryCheckEnabled ? 1 : 0,
      ),
    auditStatement(db, leagueId, actor, "settings_updated", now),
  ]);
}

export interface RulebookMeta {
  readonly version: number;
  readonly updatedAt: string;
  readonly length: number;
}

export async function getRulebookMeta(db: D1Database, leagueId: LeagueId): Promise<RulebookMeta | null> {
  const row = await db
    .prepare("SELECT version, updated_at, length(content) AS length FROM rulebooks WHERE league_id = ?1")
    .bind(leagueId.value)
    .first<{ version: number; updated_at: string; length: number }>();
  return row ? { version: row.version, updatedAt: row.updated_at, length: row.length } : null;
}

export async function getRulebook(db: D1Database, leagueId: LeagueId): Promise<RulebookText | null> {
  const row = await db.prepare("SELECT content FROM rulebooks WHERE league_id = ?1").bind(leagueId.value).first<{ content: string }>();
  if (!row) return null;
  const text = RulebookText.fromStored(row.content);
  if (!text.ok) throw new DataIntegrityError("rulebooks");
  return text.value;
}

export async function saveRulebook(db: D1Database, leagueId: LeagueId, text: RulebookText, actor: MemberId, now: Date): Promise<number> {
  const at = now.toISOString();
  const [saved] = await db.batch<{ version: number }>([
    db
      .prepare(
        `INSERT INTO rulebooks (league_id, content, version, updated_at) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT (league_id) DO UPDATE SET content = excluded.content, version = version + 1, updated_at = excluded.updated_at
         RETURNING version`,
      )
      .bind(leagueId.value, text.value, at),
    auditStatement(db, leagueId, actor, "rulebook_updated", now),
  ]);
  const version = saved?.results[0]?.version;
  if (typeof version !== "number") throw new DataIntegrityError("rulebooks");
  return version;
}

export interface LeagueSecrets {
  readonly apiKey: EncryptedSecret;
  readonly apiKeyUpdatedAt: string;
  readonly passwordHash: string;
}

export async function getSecrets(db: D1Database, leagueId: LeagueId): Promise<LeagueSecrets> {
  const row = await db
    .prepare(
      "SELECT api_key_ciphertext, api_key_iv, api_key_key_version, api_key_updated_at, admin_password_hash FROM league_secrets WHERE league_id = ?1",
    )
    .bind(leagueId.value)
    .first<{
      api_key_ciphertext: string;
      api_key_iv: string;
      api_key_key_version: number;
      api_key_updated_at: string;
      admin_password_hash: string;
    }>();
  if (!row) throw new DataIntegrityError("league_secrets");
  return {
    apiKey: { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv, keyVersion: row.api_key_key_version },
    apiKeyUpdatedAt: row.api_key_updated_at,
    passwordHash: row.admin_password_hash,
  };
}

export async function getApiKeyUpdatedAt(db: D1Database, leagueId: LeagueId): Promise<string> {
  const row = await db
    .prepare("SELECT api_key_updated_at FROM league_secrets WHERE league_id = ?1")
    .bind(leagueId.value)
    .first<{ api_key_updated_at: string }>();
  if (!row) throw new DataIntegrityError("league_secrets");
  return row.api_key_updated_at;
}

export async function updateApiKey(db: D1Database, leagueId: LeagueId, secret: EncryptedSecret, actor: MemberId, now: Date): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE league_secrets SET api_key_ciphertext = ?2, api_key_iv = ?3, api_key_key_version = ?4, api_key_updated_at = ?5 WHERE league_id = ?1")
      .bind(leagueId.value, secret.ciphertext, secret.iv, secret.keyVersion, now.toISOString()),
    auditStatement(db, leagueId, actor, "api_key_updated", now),
  ]);
}
