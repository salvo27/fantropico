import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { LOGIN_ATTEMPT_RULES, reserveLoginAttempt } from "../src/abuse/login-attempts";
import { LeagueId } from "../src/domain/primitives";

// Allineato all'inizio di una finestra da 900 s e da 3600 s
const T0 = new Date(1_800_000_000_000);
let counter = 0;

function ip(): string {
  counter++;
  return `ip:${crypto.randomUUID().replaceAll("-", "").slice(0, 28)}${counter.toString(16).padStart(4, "0")}`;
}

async function attempts(subject: string, leagueId: LeagueId | null, times: number, now = T0): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let i = 0; i < times; i++) results.push(await reserveLoginAttempt(env.DB, subject, leagueId, now));
  return results;
}

describe("tentativi di accesso admin in D1", () => {
  it("per IP: passano 5 tentativi, il sesto no", async () => {
    const results = await attempts(ip(), null, 6);
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("la finestra successiva dell'IP riparte da zero", async () => {
    const subject = ip();
    await attempts(subject, null, 5);
    expect(await reserveLoginAttempt(env.DB, subject, null, new Date(T0.getTime() + 899_000))).toBe(false);
    expect(await reserveLoginAttempt(env.DB, subject, null, new Date(T0.getTime() + 900_000))).toBe(true);
  });

  it("per lega: 50 tentativi da IP diversi, il 51esimo no", async () => {
    const leagueId = LeagueId.generate();
    expect(LOGIN_ATTEMPT_RULES.league.limit).toBe(50);
    for (let i = 0; i < 50; i++) expect(await reserveLoginAttempt(env.DB, ip(), leagueId, T0)).toBe(true);
    expect(await reserveLoginAttempt(env.DB, ip(), leagueId, T0)).toBe(false);
    expect(await reserveLoginAttempt(env.DB, ip(), LeagueId.generate(), T0)).toBe(true);
  });

  it("un IP bloccato non consuma tentativi della lega", async () => {
    const leagueId = LeagueId.generate();
    const subject = ip();
    await attempts(subject, leagueId, 5);
    await attempts(subject, leagueId, 10);
    const row = await env.DB.prepare("SELECT count FROM login_attempts WHERE subject = ?1")
      .bind(`league:${leagueId.value}`)
      .first<{ count: number }>();
    expect(row?.count).toBe(5);
  });

  it("20 tentativi contemporanei dallo stesso IP: ne passano esattamente 5", async () => {
    const subject = ip();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt(env.DB, subject, null, T0)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("il secchio condiviso degli IP sconosciuti è accettato", async () => {
    expect(await reserveLoginAttempt(env.DB, "ip:unknown", null, new Date(T0.getTime() + 7 * 86_400_000))).toBe(true);
  });

  it.each(["", "league:abc", "ip:ABC", `ip:${"a".repeat(31)}`, "ip:unknown;x"])("rifiuta un soggetto non valido (%j)", async (subject) => {
    await expect(reserveLoginAttempt(env.DB, subject, null, T0)).rejects.toThrow();
  });
});
