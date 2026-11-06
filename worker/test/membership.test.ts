import { describe, expect, it } from "vitest";
import { MAX_NEW_MEMBERS_PER_DAY } from "../src/db/members";
import { createLeague, fakeLlm, join, makeApp, RULEBOOK, type App } from "./helpers";

const DAY_MS = 86_400_000;

function clock(start: string) {
  let now = new Date(start);
  return {
    now: () => now,
    set(iso: string) {
      now = new Date(iso);
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

async function leagueWithRulebook(app: App) {
  const { body: league } = await createLeague(app);
  await app("/api/admin/rulebook", { method: "PUT", token: league.token, body: { text: RULEBOOK } });
  return league;
}

const ask = (app: App, token: string) => app("/api/questions", { token, body: { question: "Quanti partecipanti ci sono?" } });
const leave = (app: App, token: string) => app("/api/me/leave", { method: "POST", token });

async function usedToday(app: App, token: string): Promise<number> {
  const me = (await (await app("/api/me", { token })).json()) as { usage: { usedToday: number } };
  return me.usage.usedToday;
}

// Nomi diversi fatti solo di lettere: "Giocatore AA", "Giocatore BA", ...
const playerName = (i: number) => `Giocatore ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`;

describe("Uscire dalla lega", () => {
  it("libera il nome, chiude le sessioni e permette di rientrare con lo stesso nome", async () => {
    const app = makeApp(fakeLlm());
    const league = await leagueWithRulebook(app);
    const first = await join(app, league.league.joinCode, "Nico");
    expect(first.res.status).toBe(201);

    expect((await leave(app, first.body.token!)).status).toBe(200);
    expect((await app("/api/me", { token: first.body.token! })).status).toBe(401);

    const again = await join(app, league.league.joinCode, "Nico");
    expect(again.res.status).toBe(201);
    expect((await app("/api/me", { token: again.body.token! })).status).toBe(200);
    // il token di prima dell'uscita resta invalido anche dopo il rientro
    expect((await app("/api/me", { token: first.body.token! })).status).toBe(401);
  });

  it("rientrando con lo stesso nome il conteggio delle domande di oggi continua", async () => {
    const app = makeApp(fakeLlm());
    const league = await leagueWithRulebook(app);
    const first = await join(app, league.league.joinCode, "Ivo");
    expect((await ask(app, first.body.token!)).status).toBe(200);
    expect((await ask(app, first.body.token!)).status).toBe(200);
    await leave(app, first.body.token!);

    const again = await join(app, league.league.joinCode, "Ivo");
    expect(await usedToday(app, again.body.token!)).toBe(2);
  });

  it("chi è stato rimosso dall'admin e rientra con lo stesso nome riprende i suoi contatori", async () => {
    const app = makeApp(fakeLlm());
    const league = await leagueWithRulebook(app);
    const first = await join(app, league.league.joinCode, "Rita");
    await ask(app, first.body.token!);
    const overview = (await (await app("/api/admin/league", { token: league.token })).json()) as { members: Array<{ id: string; name: string }> };
    const rita = overview.members.find((m) => m.name === "Rita")!;
    expect((await app(`/api/admin/members/${rita.id}`, { method: "DELETE", token: league.token })).status).toBe(200);

    const again = await join(app, league.league.joinCode, "Rita");
    expect(again.res.status).toBe(201);
    expect(await usedToday(app, again.body.token!)).toBe(1);
  });

  it("l'admin non può uscire in questo modo e resta dentro", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const res = await leave(app, league.token);
    expect(res.status).toBe(403);
    expect((await app("/api/admin/league", { token: league.token })).status).toBe(200);
  });

  it("senza sessione valida non si esce", async () => {
    const app = makeApp(fakeLlm());
    expect((await leave(app, "non-valido")).status).toBe(401);
  });

  it("con nomi sempre nuovi i nuovi ingressi in 24 ore hanno un tetto, il rientro con lo stesso nome no", async () => {
    const time = clock("2026-11-06T10:00:00Z");
    const app = makeApp(fakeLlm(), time.now);
    const { body: league } = await createLeague(app);
    const code = league.league.joinCode;

    // l'admin conta come primo ingresso della giornata
    for (let i = 0; i < MAX_NEW_MEMBERS_PER_DAY - 1; i++) {
      const member = await join(app, code, playerName(i));
      expect(member.res.status).toBe(201);
      expect((await leave(app, member.body.token!)).status).toBe(200);
    }
    const blocked = await join(app, code, "Ultimo Arrivato");
    expect(blocked.res.status).toBe(429);
    expect(blocked.body.error?.code).toBe("too_many_joins");

    expect((await join(app, code, playerName(0))).res.status).toBe(201);

    time.advance(DAY_MS + 1000);
    expect((await join(app, code, "Ultimo Arrivato")).res.status).toBe(201);
  });
});

describe("Domande per membro nel pannello admin", () => {
  it("mostra le domande di oggi e del mese in corso per ogni membro", async () => {
    const time = clock("2026-10-31T10:00:00Z");
    const app = makeApp(fakeLlm(), time.now);
    const league = await leagueWithRulebook(app);
    const nico = await join(app, league.league.joinCode, "Nico");
    const token = nico.body.token!;

    await ask(app, token); // ottobre: non conta nel mese
    time.set("2026-11-02T10:00:00Z");
    await ask(app, token);
    time.set("2026-11-06T10:00:00Z");
    await ask(app, token);
    await ask(app, token);

    const overview = (await (await app("/api/admin/league", { token: league.token })).json()) as {
      members: Array<{ name: string; role: string; questionsToday: number; questionsThisMonth: number }>;
    };
    expect(overview.members.find((m) => m.name === "Nico")).toMatchObject({ questionsToday: 2, questionsThisMonth: 3 });
    expect(overview.members.find((m) => m.role === "admin")).toMatchObject({ questionsToday: 0, questionsThisMonth: 0 });
  });
});
