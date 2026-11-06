import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cleanupOldData, INACTIVE_LEAGUE_RETENTION_DAYS } from "../src/usage/cleanup";
import { createLeague, fakeLlm, join, makeApp, RULEBOOK } from "./helpers";

const DAY_MS = 86_400_000;
const START = new Date("2026-11-06T10:00:00Z");

function clock(start: Date) {
  let now = start;
  return {
    now: () => now,
    advance(days: number, extraMs = 0) {
      now = new Date(now.getTime() + days * DAY_MS + extraMs);
      return now;
    },
  };
}

async function lastActive(joinCode: string): Promise<string | undefined> {
  const row = await env.DB.prepare("SELECT last_active_at FROM leagues WHERE join_code = ?1").bind(joinCode).first<{ last_active_at: string }>();
  return row?.last_active_at;
}

async function countFor(table: string, leagueId: string): Promise<number> {
  const column = table === "leagues" ? "id" : "league_id";
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?1`).bind(leagueId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Prepara una lega completa: regolamento, un membro, una domanda fatta
async function fullLeague(time: ReturnType<typeof clock>) {
  const app = makeApp(fakeLlm(), time.now);
  const { body: league } = await createLeague(app);
  await app("/api/admin/rulebook", { method: "PUT", token: league.token, body: { text: RULEBOOK } });
  const member = await join(app, league.league.joinCode, "Nico");
  await app("/api/questions", { token: member.body.token!, body: { question: "Quanti partecipanti ci sono?" } });
  const row = await env.DB.prepare("SELECT id FROM leagues WHERE join_code = ?1").bind(league.league.joinCode).first<{ id: string }>();
  return { app, league, member: member.body.token!, leagueId: row!.id };
}

describe("Ultimo utilizzo della lega", () => {
  it("parte dalla creazione", async () => {
    const time = clock(START);
    const { body: league } = await createLeague(makeApp(fakeLlm(), time.now));
    expect(await lastActive(league.league.joinCode)).toBe(START.toISOString());
  });

  it("si aggiorna con qualsiasi accesso, al massimo una volta al giorno", async () => {
    const time = clock(START);
    const app = makeApp(fakeLlm(), time.now);
    const { body: league } = await createLeague(app);
    const member = await join(app, league.league.joinCode, "Ivo");

    time.advance(0, 23 * 60 * 60 * 1000);
    await app("/api/me", { token: member.body.token! });
    expect(await lastActive(league.league.joinCode)).toBe(START.toISOString());

    const later = time.advance(0, 2 * 60 * 60 * 1000);
    await app("/api/me", { token: member.body.token! });
    expect(await lastActive(league.league.joinCode)).toBe(later.toISOString());
  });

  it("un token non valido non conta come utilizzo", async () => {
    const time = clock(START);
    const app = makeApp(fakeLlm(), time.now);
    const { body: league } = await createLeague(app);
    time.advance(10);
    expect((await app("/api/me", { token: "non-valido" })).status).toBe(401);
    expect(await lastActive(league.league.joinCode)).toBe(START.toISOString());
  });
});

describe("Cancellazione delle leghe inutilizzate", () => {
  it("cancella la lega dopo 60 giorni senza utilizzo, con tutti i suoi dati", async () => {
    const time = clock(START);
    const { app, member, leagueId } = await fullLeague(time);
    for (const table of ["leagues", "league_secrets", "rulebooks", "members", "monthly_usage", "audit_events"]) {
      expect(await countFor(table, leagueId)).toBeGreaterThan(0);
    }

    await cleanupOldData(env.DB, time.advance(INACTIVE_LEAGUE_RETENTION_DAYS, 60_000));

    for (const table of ["leagues", "league_secrets", "rulebooks", "members", "monthly_usage", "audit_events"]) {
      expect(await countFor(table, leagueId)).toBe(0);
    }
    const usage = await env.DB.prepare(
      "SELECT count(*) AS n FROM daily_usage WHERE member_id NOT IN (SELECT id FROM members)",
    ).first<{ n: number }>();
    expect(usage?.n).toBe(0);
    // la sessione del membro non vale più
    expect((await app("/api/me", { token: member })).status).toBe(401);
  });

  it("tiene la lega se l'ultimo utilizzo è entro i 60 giorni", async () => {
    const time = clock(START);
    const { leagueId } = await fullLeague(time);
    await cleanupOldData(env.DB, time.advance(INACTIVE_LEAGUE_RETENTION_DAYS, -60_000));
    expect(await countFor("leagues", leagueId)).toBe(1);
  });

  it("un accesso prima della scadenza fa ripartire i 60 giorni", async () => {
    const time = clock(START);
    const { app, member, leagueId } = await fullLeague(time);
    time.advance(59);
    expect((await app("/api/me", { token: member })).status).toBe(200);
    await cleanupOldData(env.DB, time.advance(30));
    expect(await countFor("leagues", leagueId)).toBe(1);
    await cleanupOldData(env.DB, time.advance(31));
    expect(await countFor("leagues", leagueId)).toBe(0);
  });

  it("non tocca le altre leghe", async () => {
    const time = clock(START);
    const old = await fullLeague(time);
    time.advance(50);
    const active = await fullLeague(time);
    await cleanupOldData(env.DB, time.advance(20));
    expect(await countFor("leagues", old.leagueId)).toBe(0);
    expect(await countFor("leagues", active.leagueId)).toBe(1);
  });
});
