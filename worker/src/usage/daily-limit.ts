// Limite giornaliero per membro: un'unica istruzione atomica in D1, niente TOCTOU (lezione 08)

import type { DailyLimit, MemberId } from "../domain/primitives";
import { err, ok, type Result } from "../domain/result";
import { romeDay } from "../domain/time";

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

// Prenota una domanda: nessuna riga restituita significa limite raggiunto
export async function reserveDailyQuestion(
  db: D1Database,
  memberId: MemberId,
  limit: DailyLimit,
  now: Date,
): Promise<Result<DailyUsage, "daily_limit_reached">> {
  const row = await db
    .prepare(
      `INSERT INTO daily_usage (member_id, day, count) VALUES (?1, ?2, 1)
       ON CONFLICT (member_id, day) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(memberId.value, romeDay(now), limit.value)
    .first<{ count: unknown }>();
  if (row === null) return err("daily_limit_reached");
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
