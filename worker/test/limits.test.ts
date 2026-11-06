import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DailyLimit, JoinCode, LeagueId, MemberId } from "../src/domain/primitives";
import { romeDay } from "../src/domain/time";
import { LOGIN_ATTEMPT_RETENTION_SECONDS } from "../src/abuse/login-attempts";
import { AUDIT_RETENTION_DAYS, cleanupOldData, REMOVED_MEMBER_RETENTION_DAYS } from "../src/usage/cleanup";
import { getDailyUsage, releaseDailyQuestion, reserveDailyQuestion } from "../src/usage/daily-limit";
import { getMonthlyQuestions, recordAnsweredQuestion } from "../src/usage/monthly";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-11-10T12:00:00Z");

function limit(n: number): DailyLimit {
  const parsed = DailyLimit.parse(n);
  if (!parsed.ok) throw new Error("bad test limit");
  return parsed.value;
}

async function createLeague(memberCount = 1): Promise<{ leagueId: LeagueId; members: MemberId[] }> {
  const leagueId = LeagueId.generate();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO leagues (id, name, join_code, daily_limit, injury_check_enabled, created_at) VALUES (?1, ?2, ?3, 20, 0, ?4)",
  )
    .bind(leagueId.value, "Lega Test", JoinCode.generate().value, createdAt)
    .run();
  const members: MemberId[] = [];
  for (let i = 0; i < memberCount; i++) {
    const memberId = MemberId.generate();
    await env.DB.prepare(
      "INSERT INTO members (id, league_id, name, name_key, role, status, token_version, joined_at) VALUES (?1, ?2, ?3, ?4, 'member', 'active', 1, ?5)",
    )
      .bind(memberId.value, leagueId.value, `Membro ${i}`, `membro ${i}`, createdAt)
      .run();
    members.push(memberId);
  }
  return { leagueId, members };
}

async function reserveTimes(memberId: MemberId, max: DailyLimit, times: number, now = NOW) {
  const results = [];
  for (let i = 0; i < times; i++) results.push(await reserveDailyQuestion(env.DB, memberId, max, now));
  return results;
}

describe("limite giornaliero", () => {
  it("con limite 20 la 20a domanda passa e la 21a no", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    const results = await reserveTimes(member, limit(20), 21);
    expect(results.slice(0, 20).every((r) => r.ok)).toBe(true);
    const twentieth = results[19]!;
    expect(twentieth.ok && twentieth.value).toEqual({ used: 20, remaining: 0 });
    expect(results[20]).toEqual({ ok: false, error: "daily_limit_reached" });
    expect(await getDailyUsage(env.DB, member, NOW)).toBe(20);
  });

  it("calcola le domande rimaste", async () => {
    const { members } = await createLeague();
    const results = await reserveTimes(members[0]!, limit(20), 6);
    const sixth = results[5]!;
    expect(sixth.ok && sixth.value).toEqual({ used: 6, remaining: 14 });
  });

  it("limite minimo 1: una domanda e poi stop", async () => {
    const { members } = await createLeague();
    const results = await reserveTimes(members[0]!, limit(1), 2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
  });

  it("limite massimo 100: la 100a passa, la 101a no", async () => {
    const { members } = await createLeague();
    const results = await reserveTimes(members[0]!, limit(100), 101);
    expect(results.filter((r) => r.ok)).toHaveLength(100);
    expect(results[100]!.ok).toBe(false);
  });

  it("i tentativi oltre il limite non fanno crescere il contatore", async () => {
    const { members } = await createLeague();
    await reserveTimes(members[0]!, limit(3), 10);
    expect(await getDailyUsage(env.DB, members[0]!, NOW)).toBe(3);
  });

  it("senza domande l'uso del giorno è zero", async () => {
    const { members } = await createLeague();
    expect(await getDailyUsage(env.DB, members[0]!, NOW)).toBe(0);
  });

  it("a mezzanotte italiana (inverno) riparte da zero", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    const beforeMidnight = new Date("2026-12-10T22:59:00Z");
    const afterMidnight = new Date("2026-12-10T23:01:00Z");
    expect(romeDay(beforeMidnight)).toBe("2026-12-10");
    expect(romeDay(afterMidnight)).toBe("2026-12-11");
    await reserveTimes(member, limit(2), 2, beforeMidnight);
    expect((await reserveDailyQuestion(env.DB, member, limit(2), beforeMidnight)).ok).toBe(false);
    const next = await reserveDailyQuestion(env.DB, member, limit(2), afterMidnight);
    expect(next.ok && next.value).toEqual({ used: 1, remaining: 1 });
  });

  it("a mezzanotte italiana (ora legale) riparte da zero", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    const beforeMidnight = new Date("2026-07-10T21:59:00Z");
    const afterMidnight = new Date("2026-07-10T22:01:00Z");
    expect(romeDay(beforeMidnight)).toBe("2026-07-10");
    expect(romeDay(afterMidnight)).toBe("2026-07-11");
    await reserveTimes(member, limit(1), 1, beforeMidnight);
    expect((await reserveDailyQuestion(env.DB, member, limit(1), beforeMidnight)).ok).toBe(false);
    expect((await reserveDailyQuestion(env.DB, member, limit(1), afterMidnight)).ok).toBe(true);
  });

  it("abbassare il limite sotto l'uso attuale blocca", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    await reserveTimes(member, limit(20), 10);
    expect((await reserveDailyQuestion(env.DB, member, limit(5), NOW)).ok).toBe(false);
    expect((await reserveDailyQuestion(env.DB, member, limit(10), NOW)).ok).toBe(false);
    expect((await reserveDailyQuestion(env.DB, member, limit(11), NOW)).ok).toBe(true);
  });

  it("release restituisce un posto", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    await reserveTimes(member, limit(2), 2);
    expect((await reserveDailyQuestion(env.DB, member, limit(2), NOW)).ok).toBe(false);
    await releaseDailyQuestion(env.DB, member, NOW);
    expect(await getDailyUsage(env.DB, member, NOW)).toBe(1);
    expect((await reserveDailyQuestion(env.DB, member, limit(2), NOW)).ok).toBe(true);
  });

  it("release non scende sotto zero e non crea righe", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    await releaseDailyQuestion(env.DB, member, NOW);
    expect(await getDailyUsage(env.DB, member, NOW)).toBe(0);
    await reserveTimes(member, limit(5), 1);
    await releaseDailyQuestion(env.DB, member, NOW);
    await releaseDailyQuestion(env.DB, member, NOW);
    expect(await getDailyUsage(env.DB, member, NOW)).toBe(0);
  });

  it("due membri non si influenzano", async () => {
    const { members } = await createLeague(2);
    await reserveTimes(members[0]!, limit(3), 3);
    expect((await reserveDailyQuestion(env.DB, members[0]!, limit(3), NOW)).ok).toBe(false);
    const other = await reserveDailyQuestion(env.DB, members[1]!, limit(3), NOW);
    expect(other.ok && other.value).toEqual({ used: 1, remaining: 2 });
  });

  it("25 richieste contemporanee con limite 20: ne passano esattamente 20", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => reserveDailyQuestion(env.DB, member, limit(20), NOW)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(results.filter((r) => !r.ok)).toHaveLength(5);
    expect(await getDailyUsage(env.DB, member, NOW)).toBe(20);
  });

  it("rifiuta un membro inesistente (chiave esterna)", async () => {
    await expect(reserveDailyQuestion(env.DB, MemberId.generate(), limit(20), NOW)).rejects.toThrow();
  });
});

describe("contatore mensile", () => {
  it("parte da zero e si incrementa", async () => {
    const { leagueId } = await createLeague();
    expect(await getMonthlyQuestions(env.DB, leagueId, NOW)).toBe(0);
    await recordAnsweredQuestion(env.DB, leagueId, NOW);
    await recordAnsweredQuestion(env.DB, leagueId, NOW);
    await recordAnsweredQuestion(env.DB, leagueId, NOW);
    expect(await getMonthlyQuestions(env.DB, leagueId, NOW)).toBe(3);
  });

  it("cambia mese a mezzanotte italiana del primo del mese", async () => {
    const { leagueId } = await createLeague();
    const lastMinuteOfNovember = new Date("2026-11-30T22:59:00Z");
    const firstMinuteOfDecember = new Date("2026-11-30T23:01:00Z");
    await recordAnsweredQuestion(env.DB, leagueId, lastMinuteOfNovember);
    await recordAnsweredQuestion(env.DB, leagueId, firstMinuteOfDecember);
    await recordAnsweredQuestion(env.DB, leagueId, firstMinuteOfDecember);
    expect(await getMonthlyQuestions(env.DB, leagueId, lastMinuteOfNovember)).toBe(1);
    expect(await getMonthlyQuestions(env.DB, leagueId, firstMinuteOfDecember)).toBe(2);
  });

  it("leghe diverse hanno contatori separati", async () => {
    const first = await createLeague();
    const second = await createLeague();
    await recordAnsweredQuestion(env.DB, first.leagueId, NOW);
    expect(await getMonthlyQuestions(env.DB, second.leagueId, NOW)).toBe(0);
  });

  it("chiamate contemporanee non perdono incrementi", async () => {
    const { leagueId } = await createLeague();
    await Promise.all(Array.from({ length: 15 }, () => recordAnsweredQuestion(env.DB, leagueId, NOW)));
    expect(await getMonthlyQuestions(env.DB, leagueId, NOW)).toBe(15);
  });
});

describe("pulizia dei dati vecchi", () => {
  async function insertUsage(memberId: MemberId, day: string): Promise<void> {
    await env.DB.prepare("INSERT INTO daily_usage (member_id, day, count) VALUES (?1, ?2, 1)").bind(memberId.value, day).run();
  }

  async function insertAudit(leagueId: LeagueId, createdAt: Date): Promise<void> {
    await env.DB.prepare("INSERT INTO audit_events (league_id, actor_member_id, action, created_at) VALUES (?1, NULL, 'member_joined', ?2)")
      .bind(leagueId.value, createdAt.toISOString())
      .run();
  }

  async function usageDays(memberId: MemberId): Promise<string[]> {
    const rows = await env.DB.prepare("SELECT day FROM daily_usage WHERE member_id = ?1 ORDER BY day").bind(memberId.value).all<{ day: string }>();
    return rows.results.map((r) => r.day);
  }

  it("cancella i contatori più vecchi di 7 giorni e tiene gli altri", async () => {
    const { members } = await createLeague();
    const member = members[0]!;
    const day = (offset: number) => romeDay(new Date(NOW.getTime() - offset * DAY_MS));
    for (const offset of [0, 1, 7, 8, 30]) await insertUsage(member, day(offset));
    await cleanupOldData(env.DB, NOW);
    expect(await usageDays(member)).toEqual([day(7), day(1), day(0)]);
  });

  it("cancella il registro admin più vecchio di un anno", async () => {
    const { leagueId } = await createLeague();
    const recent = new Date(NOW.getTime() - 10 * DAY_MS);
    const justInside = new Date(NOW.getTime() - AUDIT_RETENTION_DAYS * DAY_MS + 1000);
    const tooOld = new Date(NOW.getTime() - (AUDIT_RETENTION_DAYS + 1) * DAY_MS);
    for (const date of [recent, justInside, tooOld]) await insertAudit(leagueId, date);
    await cleanupOldData(env.DB, NOW);
    const rows = await env.DB.prepare("SELECT created_at FROM audit_events WHERE league_id = ?1 ORDER BY created_at")
      .bind(leagueId.value)
      .all<{ created_at: string }>();
    expect(rows.results.map((r) => r.created_at)).toEqual([justInside.toISOString(), recent.toISOString()]);
  });

  it("cancella i membri rimossi da più di 30 giorni e i loro contatori", async () => {
    const { leagueId } = await createLeague(0);
    const insertRemoved = async (removedAt: Date) => {
      const id = MemberId.generate();
      await env.DB.prepare(
        "INSERT INTO members (id, league_id, name, name_key, role, status, token_version, joined_at, removed_at) VALUES (?1, ?2, ?3, ?4, 'member', 'removed', 2, ?5, ?5)",
      )
        .bind(id.value, leagueId.value, "Uscito", "uscito", removedAt.toISOString())
        .run();
      await env.DB.prepare("INSERT INTO daily_usage (member_id, day, count) VALUES (?1, ?2, 1)").bind(id.value, romeDay(NOW)).run();
      return id;
    };
    const old = await insertRemoved(new Date(NOW.getTime() - (REMOVED_MEMBER_RETENTION_DAYS + 1) * DAY_MS));
    const recent = await insertRemoved(new Date(NOW.getTime() - (REMOVED_MEMBER_RETENTION_DAYS - 1) * DAY_MS));
    await cleanupOldData(env.DB, NOW);
    const ids = await env.DB.prepare("SELECT id FROM members WHERE league_id = ?1").bind(leagueId.value).all<{ id: string }>();
    expect(ids.results.map((r) => r.id)).toEqual([recent.value]);
    const usage = await env.DB.prepare("SELECT count(*) AS n FROM daily_usage WHERE member_id = ?1").bind(old.value).first<{ n: number }>();
    expect(usage?.n).toBe(0);
  });

  it("non cancella mai i membri attivi", async () => {
    const { leagueId, members } = await createLeague(1);
    const later = new Date(NOW.getTime() + 1000 * DAY_MS);
    // la lega resta in uso, così si prova solo la regola sui membri
    await env.DB.prepare("UPDATE leagues SET last_active_at = ?2 WHERE id = ?1").bind(leagueId.value, later.toISOString()).run();
    await cleanupOldData(env.DB, later);
    const row = await env.DB.prepare("SELECT status FROM members WHERE id = ?1").bind(members[0]!.value).first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

  it("cancella i tentativi di accesso più vecchi di un giorno", async () => {
    const nowSeconds = Math.floor(NOW.getTime() / 1000);
    const subjectOld = `ip:${"a".repeat(32)}`;
    const subjectRecent = `ip:${"b".repeat(32)}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO login_attempts (subject, window_start, count) VALUES (?1, ?2, 3)").bind(subjectOld, nowSeconds - LOGIN_ATTEMPT_RETENTION_SECONDS - 900),
      env.DB.prepare("INSERT INTO login_attempts (subject, window_start, count) VALUES (?1, ?2, 3)").bind(subjectRecent, nowSeconds - 900),
    ]);
    await cleanupOldData(env.DB, NOW);
    const rows = await env.DB.prepare("SELECT subject FROM login_attempts WHERE subject IN (?1, ?2)").bind(subjectOld, subjectRecent).all<{ subject: string }>();
    expect(rows.results.map((r) => r.subject)).toEqual([subjectRecent]);
  });

  it("senza dati non fallisce", async () => {
    await expect(cleanupOldData(env.DB, NOW)).resolves.toBeUndefined();
  });
});
