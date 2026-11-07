// Limite giornaliero per membro: un'unica istruzione atomica in D1, niente TOCTOU (lezione 08)

import { MAX_ACTIVE_MEMBERS } from "../domain/league";
import type { DailyLimit, MemberId } from "../domain/primitives";
import { err, ok, type Result } from "../domain/result";
import { romeDay, romeDayStart } from "../domain/time";

// Spesa massima di una lega in un giorno, comunque si usino uscite e rientri: quella di una lega piena (40 x limite).
// Chi era attivo già prima della mezzanotte italiana ("residente") ha sempre il suo limite e nessuno può toglierglielo;
// tutti gli altri (entrati o rientrati oggi, usciti) si dividono i posti rimasti: (40 - residenti) x limite.

export interface DailyUsage {
  readonly used: number;
  readonly remaining: number;
}

function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Invalid daily usage value");
  }
  return value;
}

export type DailyLimitError = "daily_limit_reached" | "league_daily_limit_reached";

// Prenota una domanda: nessuna riga restituita significa limite raggiunto (del membro o della lega).
// Entrambi i tetti stanno nella stessa istruzione.
export async function reserveDailyQuestion(
  db: D1Database,
  memberId: MemberId,
  limit: DailyLimit,
  now: Date,
): Promise<Result<DailyUsage, DailyLimitError>> {
  const day = romeDay(now);
  const row = await db
    .prepare(
      `WITH me AS (SELECT league_id FROM members WHERE id = ?1)
       INSERT INTO daily_usage (member_id, day, count)
       SELECT ?1, ?2, 1
       WHERE EXISTS (SELECT 1 FROM members WHERE id = ?1 AND status = 'active' AND joined_at < ?5)
          OR (SELECT coalesce(sum(d.count), 0) FROM daily_usage d JOIN members m ON m.id = d.member_id
              WHERE m.league_id = (SELECT league_id FROM me) AND d.day = ?2
                AND NOT (m.status = 'active' AND m.joined_at < ?5))
             < (?4 - (SELECT count(*) FROM members WHERE league_id = (SELECT league_id FROM me) AND status = 'active' AND joined_at < ?5)) * ?3
       ON CONFLICT (member_id, day) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(memberId.value, day, limit.value, MAX_ACTIVE_MEMBERS, romeDayStart(now).toISOString())
    .first<{ count: unknown }>();
  if (row === null) {
    const own = await getDailyUsage(db, memberId, now);
    return err(own >= limit.value ? "daily_limit_reached" : "league_daily_limit_reached");
  }
  const used = readCount(row.count);
  return ok(Object.freeze({ used, remaining: Math.max(0, limit.value - used) }));
}

// Restituisce il posto se la chiamata al modello fallisce per motivi tecnici.
// Va chiamata con lo stesso `now` usato per la prenotazione.
export async function releaseDailyQuestion(db: D1Database, memberId: MemberId, now: Date): Promise<void> {
  await db
    .prepare("UPDATE daily_usage SET count = count - 1 WHERE member_id = ?1 AND day = ?2 AND count > 0")
    .bind(memberId.value, romeDay(now))
    .run();
}

export async function getDailyUsage(db: D1Database, memberId: MemberId, now: Date): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM daily_usage WHERE member_id = ?1 AND day = ?2")
    .bind(memberId.value, romeDay(now))
    .first<{ count: unknown }>();
  return row === null ? 0 : readCount(row.count);
}
