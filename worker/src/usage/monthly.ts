// Contatore delle domande del mese per lega (ora di Roma), mostrato nel pannello admin

import type { LeagueId } from "../domain/primitives";
import { romeMonth } from "../domain/time";

export async function recordAnsweredQuestion(db: D1Database, leagueId: LeagueId, now: Date): Promise<void> {
  await db
    .prepare(
      `INSERT INTO monthly_usage (league_id, month, questions) VALUES (?1, ?2, 1)
       ON CONFLICT (league_id, month) DO UPDATE SET questions = questions + 1`,
    )
    .bind(leagueId.value, romeMonth(now))
    .run();
}

export async function getMonthlyQuestions(db: D1Database, leagueId: LeagueId, now: Date): Promise<number> {
  const row = await db
    .prepare("SELECT questions FROM monthly_usage WHERE league_id = ?1 AND month = ?2")
    .bind(leagueId.value, romeMonth(now))
    .first<{ questions: unknown }>();
  if (row === null) return 0;
  const value = row.questions;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Invalid monthly usage value");
  }
  return value;
}
