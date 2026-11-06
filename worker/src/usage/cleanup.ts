// Minimo dei dati: contatori, tentativi di accesso, membri rimossi e registro admin non restano per sempre

import { LOGIN_ATTEMPT_RETENTION_SECONDS } from "../abuse/login-attempts";
import { romeDay } from "../domain/time";

const DAY_MS = 86_400_000;
export const DAILY_USAGE_RETENTION_DAYS = 7;
export const REMOVED_MEMBER_RETENTION_DAYS = 30;
export const AUDIT_RETENTION_DAYS = 365;
export const INACTIVE_LEAGUE_RETENTION_DAYS = 60;

// created_at, removed_at e last_active_at sono in ISO 8601 UTC (Date.toISOString), quindi il confronto tra stringhe è cronologico
export async function cleanupOldData(db: D1Database, now: Date): Promise<void> {
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_LEAGUE_RETENTION_DAYS * DAY_MS).toISOString();
  const dailyCutoff = romeDay(new Date(now.getTime() - DAILY_USAGE_RETENTION_DAYS * DAY_MS));
  const removedCutoff = new Date(now.getTime() - REMOVED_MEMBER_RETENTION_DAYS * DAY_MS).toISOString();
  const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS).toISOString();
  const attemptsCutoff = Math.floor(now.getTime() / 1000) - LOGIN_ATTEMPT_RETENTION_SECONDS;
  await db.batch([
    // Leghe inutilizzate da 60 giorni: segreti, regolamento, membri, contatori e registro cadono in cascata
    db.prepare("DELETE FROM leagues WHERE last_active_at < ?1").bind(inactiveCutoff),
    db.prepare("DELETE FROM daily_usage WHERE day < ?1").bind(dailyCutoff),
    // le righe collegate in daily_usage cadono in cascata
    db.prepare("DELETE FROM members WHERE status = 'removed' AND removed_at < ?1").bind(removedCutoff),
    db.prepare("DELETE FROM audit_events WHERE created_at < ?1").bind(auditCutoff),
    db.prepare("DELETE FROM login_attempts WHERE window_start < ?1").bind(attemptsCutoff),
  ]);
}
