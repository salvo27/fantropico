// Tentativi di accesso admin in D1: prenotazione atomica PRIMA di verificare la password,
// così anche cento richieste in parallelo non superano la soglia (niente TOCTOU, lezione 08)

import type { LeagueId } from "../domain/primitives";

export const LOGIN_ATTEMPT_RULES = Object.freeze({
  ip: Object.freeze({ limit: 5, windowSeconds: 900 }),
  league: Object.freeze({ limit: 50, windowSeconds: 3600 }),
});

export const LOGIN_ATTEMPT_RETENTION_SECONDS = 86_400;

const IP_SUBJECT = /^ip:(unknown|[0-9a-f]{32})$/;

function windowStart(now: Date, windowSeconds: number): number {
  const seconds = Math.floor(now.getTime() / 1000);
  return seconds - (seconds % windowSeconds);
}

async function reserve(db: D1Database, subject: string, rule: { limit: number; windowSeconds: number }, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO login_attempts (subject, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (subject, window_start) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(subject, windowStart(now, rule.windowSeconds), rule.limit)
    .first<{ count: unknown }>();
  if (row === null) return false;
  if (typeof row.count !== "number" || !Number.isInteger(row.count) || row.count < 1) throw new Error("Invalid login attempt count");
  return true;
}

// Ogni tentativo conta, anche quelli riusciti. Prima l'IP, poi la lega se è nota.
export async function reserveLoginAttempt(db: D1Database, ipSubject: string, leagueId: LeagueId | null, now: Date): Promise<boolean> {
  if (!IP_SUBJECT.test(ipSubject)) throw new Error("Invalid login attempt subject");
  if (!(await reserve(db, ipSubject, LOGIN_ATTEMPT_RULES.ip, now))) return false;
  if (leagueId === null) return true;
  return reserve(db, `league:${leagueId.value}`, LOGIN_ATTEMPT_RULES.league, now);
}
