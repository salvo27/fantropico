// Accesso a D1 per i membri. Le regole che contano per la sicurezza stanno nelle query stesse,
// così restano atomiche (niente controllo e poi scrittura separati)

import { MAX_ACTIVE_MEMBERS, type Member } from "../domain/league";
import { MemberId, parseRole, type LeagueId, type MemberName, type Role } from "../domain/primitives";
import { auditStatement, DataIntegrityError } from "./leagues";

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

export type JoinOutcome = "joined" | "name_taken" | "league_full";

// Il tetto dei membri e l'unicità del nome sono controllati nella stessa istruzione di inserimento
export async function insertMember(db: D1Database, leagueId: LeagueId, memberId: MemberId, name: MemberName, now: Date): Promise<JoinOutcome> {
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO members (id, league_id, name, name_key, role, status, token_version, joined_at)
         SELECT ?1, ?2, ?3, ?4, 'member', 'active', 1, ?5
         WHERE (SELECT count(*) FROM members WHERE league_id = ?2 AND status = 'active') < ?6
         ON CONFLICT DO NOTHING`,
      )
      .bind(memberId.value, leagueId.value, name.value, name.key, now.toISOString(), MAX_ACTIVE_MEMBERS),
    db
      .prepare(
        `INSERT INTO audit_events (league_id, actor_member_id, action, created_at)
         SELECT ?1, ?2, 'member_joined', ?3 WHERE changes() = 1`,
      )
      .bind(leagueId.value, memberId.value, now.toISOString()),
  ]);
  if (inserted?.meta.changes === 1) return "joined";

  const taken = await db
    .prepare("SELECT 1 AS taken FROM members WHERE league_id = ?1 AND name_key = ?2 AND status = 'active'")
    .bind(leagueId.value, name.key)
    .first();
  return taken ? "name_taken" : "league_full";
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
}

export async function listActiveMembers(db: D1Database, leagueId: LeagueId): Promise<MemberListItem[]> {
  const { results } = await db
    .prepare("SELECT id, name, role, joined_at FROM members WHERE league_id = ?1 AND status = 'active' ORDER BY role = 'admin' DESC, joined_at")
    .bind(leagueId.value)
    .all<{ id: string; name: string; role: string; joined_at: string }>();
  return results.map((row) => {
    const role = parseRole(row.role);
    if (!role.ok) throw new DataIntegrityError("members");
    return { id: row.id, name: row.name, role: role.value, joinedAt: row.joined_at };
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
