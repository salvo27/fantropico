// Accesso a D1 per i membri. Le regole che contano per la sicurezza stanno nelle query stesse,
// così restano atomiche (niente controllo e poi scrittura separati)

import { MAX_ACTIVE_MEMBERS, type Member } from "../domain/league";
import { MemberId, parseRole, type LeagueId, type MemberName, type Role } from "../domain/primitives";
import { romeDay, romeMonth } from "../domain/time";
import { auditStatement, DataIntegrityError } from "./leagues";

// Nuove identità per lega nelle ultime 24 ore: uscire e rientrare con nomi sempre diversi non aggira il limite giornaliero
export const MAX_NEW_MEMBERS_PER_DAY = MAX_ACTIVE_MEMBERS;
const DAY_MS = 86_400_000;

interface MemberRow {
  id: string;
  name: string;
  role: string;
  status: string;
  token_version: number;
}

function toMember(row: MemberRow, leagueId: LeagueId): Member {
  const id = MemberId.parse(row.id);
  const role = parseRole(row.role);
  const validStatus = row.status === "active" || row.status === "removed";
  if (!id.ok || !role.ok || !validStatus || !Number.isInteger(row.token_version) || row.token_version < 1) {
    throw new DataIntegrityError("members");
  }
  return Object.freeze({
    id: id.value,
    leagueId,
    name: row.name,
    role: role.value,
    status: row.status as Member["status"],
    tokenVersion: row.token_version,
  });
}

export async function findActiveMember(db: D1Database, leagueId: LeagueId, memberId: MemberId): Promise<Member | null> {
  const row = await db
    .prepare("SELECT id, name, role, status, token_version FROM members WHERE id = ?1 AND league_id = ?2 AND status = 'active'")
    .bind(memberId.value, leagueId.value)
    .first<MemberRow>();
  return row ? toMember(row, leagueId) : null;
}

export async function findAdmin(db: D1Database, leagueId: LeagueId): Promise<Member> {
  const row = await db
    .prepare("SELECT id, name, role, status, token_version FROM members WHERE league_id = ?1 AND role = 'admin'")
    .bind(leagueId.value)
    .first<MemberRow>();
  if (!row) throw new DataIntegrityError("members");
  return toMember(row, leagueId);
}

export type JoinOutcome =
  | { readonly kind: "joined"; readonly memberId: MemberId; readonly tokenVersion: number }
  | { readonly kind: "name_taken" | "league_full" | "too_many_joins" };

// Chi era uscito (o era stato rimosso) e rientra con lo stesso nome riprende la sua riga: stessi contatori, token nuovo.
// Tetto dei membri, unicità del nome e tetto dei nuovi ingressi sono controllati nelle stesse istruzioni di scrittura.
export async function joinMember(db: D1Database, leagueId: LeagueId, newId: MemberId, name: MemberName, now: Date): Promise<JoinOutcome> {
  const at = now.toISOString();
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const [reactivated, , inserted] = await db.batch<{ id: string; token_version: number }>([
    db
      .prepare(
        `UPDATE members SET status = 'active', removed_at = NULL, token_version = token_version + 1
         WHERE id = (SELECT id FROM members WHERE league_id = ?1 AND name_key = ?2 AND role = 'member' AND status = 'removed'
                     ORDER BY removed_at DESC LIMIT 1)
           AND NOT EXISTS (SELECT 1 FROM members WHERE league_id = ?1 AND name_key = ?2 AND status = 'active')
           AND (SELECT count(*) FROM members WHERE league_id = ?1 AND status = 'active') < ?3
         RETURNING id, token_version`,
      )
      .bind(leagueId.value, name.key, MAX_ACTIVE_MEMBERS),
    db
      .prepare(
        `INSERT INTO audit_events (league_id, actor_member_id, action, created_at)
         SELECT ?1, (SELECT id FROM members WHERE league_id = ?1 AND name_key = ?2 AND status = 'active'), 'member_joined', ?3
         WHERE changes() = 1`,
      )
      .bind(leagueId.value, name.key, at),
    db
      .prepare(
        `INSERT INTO members (id, league_id, name, name_key, role, status, token_version, joined_at)
         SELECT ?1, ?2, ?3, ?4, 'member', 'active', 1, ?5
         WHERE (SELECT count(*) FROM members WHERE league_id = ?2 AND status = 'active') < ?6
           AND (SELECT count(*) FROM members WHERE league_id = ?2 AND joined_at >= ?7) < ?8
         ON CONFLICT DO NOTHING`,
      )
      .bind(newId.value, leagueId.value, name.value, name.key, at, MAX_ACTIVE_MEMBERS, dayAgo, MAX_NEW_MEMBERS_PER_DAY),
    db
      .prepare(
        `INSERT INTO audit_events (league_id, actor_member_id, action, created_at)
         SELECT ?1, ?2, 'member_joined', ?3 WHERE changes() = 1`,
      )
      .bind(leagueId.value, newId.value, at),
  ]);

  const back = reactivated?.results[0];
  if (back) {
    const id = MemberId.parse(back.id);
    if (!id.ok || !Number.isInteger(back.token_version) || back.token_version < 1) throw new DataIntegrityError("members");
    return { kind: "joined", memberId: id.value, tokenVersion: back.token_version };
  }
  if (inserted?.meta.changes === 1) return { kind: "joined", memberId: newId, tokenVersion: 1 };

  const state = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM members WHERE league_id = ?1 AND name_key = ?2 AND status = 'active') AS taken,
              (SELECT count(*) FROM members WHERE league_id = ?1 AND status = 'active') AS active`,
    )
    .bind(leagueId.value, name.key)
    .first<{ taken: number; active: number }>();
  if (state?.taken) return { kind: "name_taken" };
  if ((state?.active ?? MAX_ACTIVE_MEMBERS) >= MAX_ACTIVE_MEMBERS) return { kind: "league_full" };
  return { kind: "too_many_joins" };
}

// Solo i partecipanti attivi si possono rimuovere, mai l'admin; la versione del token sale e le sessioni cadono subito
export async function removeMember(db: D1Database, leagueId: LeagueId, memberId: MemberId, actor: MemberId, now: Date): Promise<boolean> {
  const [removed] = await db.batch([
    db
      .prepare(
        `UPDATE members SET status = 'removed', removed_at = ?3, token_version = token_version + 1
         WHERE id = ?1 AND league_id = ?2 AND role = 'member' AND status = 'active'`,
      )
      .bind(memberId.value, leagueId.value, now.toISOString()),
    db
      .prepare(
        `INSERT INTO audit_events (league_id, actor_member_id, action, created_at)
         SELECT ?1, ?2, 'member_removed', ?3 WHERE changes() = 1`,
      )
      .bind(leagueId.value, actor.value, now.toISOString()),
  ]);
  return removed?.meta.changes === 1;
}

export interface MemberListItem {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly joinedAt: string;
  readonly questionsToday: number;
  readonly questionsThisMonth: number;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Domande per membro, verifiche comprese: oggi e nel mese in corso (ora italiana)
export async function listActiveMembers(db: D1Database, leagueId: LeagueId, now: Date): Promise<MemberListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.name, m.role, m.joined_at,
              coalesce((SELECT d.count FROM daily_usage d WHERE d.member_id = m.id AND d.day = ?2), 0) AS today,
              coalesce((SELECT sum(d.count) FROM daily_usage d WHERE d.member_id = m.id AND d.day >= ?3), 0) AS month
       FROM members m WHERE m.league_id = ?1 AND m.status = 'active' ORDER BY m.role = 'admin' DESC, m.joined_at`,
    )
    .bind(leagueId.value, romeDay(now), `${romeMonth(now)}-01`)
    .all<{ id: string; name: string; role: string; joined_at: string; today: unknown; month: unknown }>();
  return results.map((row) => {
    const role = parseRole(row.role);
    if (!role.ok || !isCount(row.today) || !isCount(row.month)) throw new DataIntegrityError("members");
    return { id: row.id, name: row.name, role: role.value, joinedAt: row.joined_at, questionsToday: row.today, questionsThisMonth: row.month };
  });
}

// Cambio password dell'admin: nuova password e invalidazione delle altre sessioni nella stessa transazione
export async function changeAdminPassword(db: D1Database, leagueId: LeagueId, adminId: MemberId, passwordHash: string, now: Date): Promise<number> {
  const at = now.toISOString();
  const [, bumped] = await db.batch<{ token_version: number }>([
    db
      .prepare("UPDATE league_secrets SET admin_password_hash = ?2, admin_password_updated_at = ?3 WHERE league_id = ?1")
      .bind(leagueId.value, passwordHash, at),
    db
      .prepare("UPDATE members SET token_version = token_version + 1 WHERE id = ?1 AND league_id = ?2 AND role = 'admin' RETURNING token_version")
      .bind(adminId.value, leagueId.value),
    auditStatement(db, leagueId, adminId, "admin_password_changed", now),
  ]);
  const version = bumped?.results[0]?.token_version;
  if (typeof version !== "number") throw new DataIntegrityError("members");
  return version;
}

export async function recordAdminLogin(db: D1Database, leagueId: LeagueId, adminId: MemberId, now: Date): Promise<void> {
  await auditStatement(db, leagueId, adminId, "admin_login", now).run();
}
