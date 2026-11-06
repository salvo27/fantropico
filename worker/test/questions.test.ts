import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createLeague, err, fakeLlm, join, makeApp, ok, RULEBOOK, type App, type FakeLlm } from "./helpers";

interface AnswerBody {
  answer?: { status: string; text: string; articles?: string[]; sources?: Array<{ url: string }>; note: string | null; checkedOn?: string };
  remainingToday?: number;
  error?: { code: string };
}

async function setup(llm: FakeLlm = fakeLlm(), withRulebook = true) {
  const app = makeApp(llm);
  const { body: league } = await createLeague(app);
  if (withRulebook) {
    const res = await app("/api/admin/rulebook", { method: "PUT", token: league.token, body: { text: RULEBOOK } });
    expect(res.status).toBe(200);
  }
  const member = await join(app, league.league.joinCode, "Paolo");
  return { app, llm, admin: league.token, member: member.body.token!, joinCode: league.league.joinCode };
}

async function ask(app: App, token: string, question: unknown = "Posso schierare il 3-4-3?") {
  const res = await app("/api/questions", { token, body: { question } });
  return { status: res.status, body: (await res.json()) as AnswerBody };
}

async function monthly(app: App, adminToken: string): Promise<number> {
  return ((await (await app("/api/admin/league", { token: adminToken })).json()) as { monthlyQuestions: number }).monthlyQuestions;
}

async function remaining(app: App, token: string): Promise<number> {
  const me = (await (await app("/api/me", { token })).json()) as { usage: { remainingToday: number } };
  return me.usage.remainingToday;
}

describe("Domande sul regolamento", () => {
  it("risponde citando gli articoli e scala una domanda", async () => {
    const { app, member, admin } = await setup();
    const { status, body } = await ask(app, member);
    expect(status).toBe(200);
    expect(body.answer).toEqual({ status: "answered", text: "Sì, lo prevede l'articolo 1.", articles: ["Art. 1"], note: null });
    expect(body.remainingToday).toBe(19);
    const overview = (await (await app("/api/admin/league", { token: admin })).json()) as { monthlyQuestions: number };
    expect(overview.monthlyQuestions).toBe(1);
  });

  it("usa la frase fissa quando il regolamento non copre il caso", async () => {
    const llm = fakeLlm();
    llm.ruleAnswer = ok({ kind: "not_covered" });
    const { app, member } = await setup(llm);
    const { body } = await ask(app, member);
    expect(body.answer?.status).toBe("not_covered");
    expect(body.answer?.text).toBe("Il regolamento non lo prevede, chiedi all'admin.");
  });

  it("sui casi controversi aggiunge che decide l'admin", async () => {
    const llm = fakeLlm();
    llm.ruleAnswer = ok({ kind: "answered", text: "Dipende dalla lettura dell'Art. 1.", articles: ["Art. 1"], controversial: true });
    const { app, member } = await setup(llm);
    const { body } = await ask(app, member);
    expect(body.answer?.note).toContain("admin");
  });

  it("senza regolamento non chiama il modello e non scala domande", async () => {
    const { app, member, llm } = await setup(fakeLlm(), false);
    const { status, body } = await ask(app, member);
    expect(status).toBe(409);
    expect(body.error?.code).toBe("no_rulebook");
    expect(llm.calls).toBe(0);
    expect(await remaining(app, member)).toBe(20);
  });

  it("rifiuta domande non valide senza scalare il contatore", async () => {
    const { app, member, llm } = await setup();
    for (const q of ["", "ok", "a".repeat(601), 42, null]) expect((await ask(app, member, q)).status).toBe(400);
    expect(llm.calls).toBe(0);
    expect(await remaining(app, member)).toBe(20);
  });

  it("restituisce la domanda se il modello non risponde per motivi tecnici", async () => {
    const llm = fakeLlm();
    llm.ruleAnswer = err("unavailable");
    const { app, member } = await setup(llm);
    expect((await ask(app, member)).status).toBe(502);
    llm.ruleAnswer = err("overloaded");
    expect((await ask(app, member)).status).toBe(503);
    llm.ruleAnswer = err("invalid_key");
    const broken = await ask(app, member);
    expect(broken.status).toBe(502);
    expect(broken.body.error?.code).toBe("league_api_key_broken");
    expect(await remaining(app, member)).toBe(20);
  });

  it("un rifiuto o una risposta inutilizzabile contano come domanda e nel contatore del mese", async () => {
    const llm = fakeLlm();
    llm.ruleAnswer = err("refused");
    const { app, member, admin } = await setup(llm);
    expect((await ask(app, member)).status).toBe(422);
    llm.ruleAnswer = err("bad_output");
    expect((await ask(app, member)).status).toBe(502);
    expect(await remaining(app, member)).toBe(18);
    expect(await monthly(app, admin)).toBe(2);
  });

  it("i fallimenti senza token prodotti non contano nemmeno nel mese", async () => {
    const llm = fakeLlm();
    const { app, member, admin } = await setup(llm);
    for (const failure of ["unavailable", "overloaded", "rate_limited", "invalid_key"] as const) {
      llm.ruleAnswer = err(failure);
      expect((await ask(app, member)).status).toBeGreaterThanOrEqual(500);
    }
    expect(await remaining(app, member)).toBe(20);
    expect(await monthly(app, admin)).toBe(0);
  });

  it("scarta gli articoli che non esistono nel regolamento", async () => {
    const llm = fakeLlm();
    llm.ruleAnswer = ok({ kind: "answered", text: "Lo dice l'articolo 99.", articles: ["Art. 99"], controversial: false });
    const { app, member } = await setup(llm);
    const { body } = await ask(app, member);
    expect(body.answer).toEqual({ status: "not_covered", text: "Il regolamento non lo prevede, chiedi all'admin.", articles: [], note: null });
    llm.ruleAnswer = ok({ kind: "answered", text: "Lo dicono gli articoli 1 e 99.", articles: ["Art. 1", "Art. 99"], controversial: false });
    expect((await ask(app, member)).body.answer?.articles).toEqual(["Art. 1"]);
  });

  it("se la chiave salvata non si decifra: errore generico, domanda restituita e log senza dati", async () => {
    const llm = fakeLlm();
    const { app, member, joinCode } = await setup(llm);
    const updated = await env.DB.prepare(
      "UPDATE league_secrets SET api_key_ciphertext = 'AAAA' WHERE league_id = (SELECT id FROM leagues WHERE join_code = ?1)",
    )
      .bind(joinCode)
      .run();
    expect(updated.meta.changes).toBe(1);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
    try {
      const { status, body } = await ask(app, member);
      expect(status).toBe(500);
      expect(body.error?.code).toBe("internal");
    } finally {
      spy.mockRestore();
    }
    expect(llm.calls).toBe(0);
    expect(await remaining(app, member)).toBe(20);
    expect(logs).toEqual([JSON.stringify({ event: "api_key_decrypt_failed" })]);
  });

  it("applica il limite giornaliero impostato dall'admin", async () => {
    const { app, member, admin } = await setup();
    expect((await app("/api/admin/settings", { method: "PATCH", token: admin, body: { dailyLimit: 2 } })).status).toBe(200);
    expect((await ask(app, member)).status).toBe(200);
    const second = await ask(app, member);
    expect(second.body.remainingToday).toBe(0);
    const third = await ask(app, member);
    expect(third.status).toBe(429);
    expect(third.body.error?.code).toBe("daily_limit_reached");
  });

  it("il limite vale anche per l'admin e il giorno dopo riparte", async () => {
    let now = new Date("2026-11-06T22:00:00Z");
    const llm = fakeLlm();
    const app = makeApp(llm, () => now);
    const { body: league } = await createLeague(app);
    await app("/api/admin/rulebook", { method: "PUT", token: league.token, body: { text: RULEBOOK } });
    await app("/api/admin/settings", { method: "PATCH", token: league.token, body: { dailyLimit: 1 } });
    expect((await ask(app, league.token)).status).toBe(200);
    expect((await ask(app, league.token)).status).toBe(429);
    now = new Date("2026-11-06T23:30:00Z");
    expect((await ask(app, league.token)).status).toBe(200);
  });
});

describe("Verifica sostituzione", () => {
  async function check(app: App, token: string, injured: unknown = "Zaniolo", replacement: unknown = "Thuram") {
    const res = await app("/api/injury-checks", { token, body: { injured, replacement } });
    return { status: res.status, body: (await res.json()) as AnswerBody };
  }

  it("è disattivata finché l'admin non la attiva", async () => {
    const { app, member, admin, llm } = await setup();
    expect((await check(app, member)).status).toBe(403);
    expect(llm.calls).toBe(0);
    await app("/api/admin/settings", { method: "PATCH", token: admin, body: { injuryCheckEnabled: true } });
    expect((await check(app, member)).status).toBe(200);
  });

  it("restituisce parere, fonti, data del controllo e conferma dell'admin", async () => {
    const llm = fakeLlm();
    llm.injuryOpinion = ok({
      kind: "opinion",
      text: "Sì: è fuori circa tre mesi e il sostituto vale 12 contro 15, quindi puoi farlo.",
      sources: [{ url: "https://www.fantacalcio.it/squadre/roma", title: "Roma" }],
    });
    const { app, member, admin } = await setup(llm);
    await app("/api/admin/settings", { method: "PATCH", token: admin, body: { injuryCheckEnabled: true } });
    const { status, body } = await check(app, member);
    expect(status).toBe(200);
    expect(body.answer?.status).toBe("opinion");
    expect(body.answer?.sources?.[0]?.url).toBe("https://www.fantacalcio.it/squadre/roma");
    expect(body.answer?.checkedOn).toBe("6 novembre 2026");
    expect(body.answer?.note).toBe("La conferma finale spetta all'admin.");
  });

  it("senza informazioni affidabili rimanda all'admin", async () => {
    const { app, member, admin } = await setup();
    await app("/api/admin/settings", { method: "PATCH", token: admin, body: { injuryCheckEnabled: true } });
    const { body } = await check(app, member);
    expect(body.answer?.status).toBe("not_found");
    expect(body.answer?.text).toContain("chiedi all'admin");
  });

  it("rifiuta nomi non validi o lo stesso giocatore due volte", async () => {
    const { app, member, admin, llm } = await setup();
    await app("/api/admin/settings", { method: "PATCH", token: admin, body: { injuryCheckEnabled: true } });
    expect((await check(app, member, "Zaniolo", "zaniolo")).status).toBe(400);
    expect((await check(app, member, "Zaniolo10", "Thuram")).status).toBe(400);
    expect((await check(app, member, "Zaniolo", "<script>")).status).toBe(400);
    expect(llm.calls).toBe(0);
  });
});

describe("Pannello admin", () => {
  it("salva il regolamento con versione crescente e lo restituisce", async () => {
    const { app, admin } = await setup();
    const res = await app("/api/admin/rulebook", { method: "PUT", token: admin, body: { text: RULEBOOK + "Art. 2 - Altro\n" } });
    expect(((await res.json()) as { version: number }).version).toBe(2);
    const got = (await (await app("/api/admin/rulebook", { token: admin })).json()) as { text: string };
    expect(got.text).toContain("Art. 2 - Altro");
  });

  it("rifiuta regolamenti troppo corti o troppo lunghi", async () => {
    const { app, admin } = await setup();
    expect((await app("/api/admin/rulebook", { method: "PUT", token: admin, body: { text: "breve" } })).status).toBe(400);
    expect((await app("/api/admin/rulebook", { method: "PUT", token: admin, body: { text: "a".repeat(150_001) } })).status).toBe(400);
    expect((await app("/api/admin/rulebook", { method: "PUT", token: admin, body: { text: "a".repeat(150_000) } })).status).toBe(200);
  });

  it("valida le impostazioni in modo rigoroso", async () => {
    const { app, admin } = await setup();
    const patch = (body: unknown) => app("/api/admin/settings", { method: "PATCH", token: admin, body });
    expect((await patch({ dailyLimit: 0 })).status).toBe(400);
    expect((await patch({ dailyLimit: 101 })).status).toBe(400);
    expect((await patch({ dailyLimit: "20" })).status).toBe(400);
    expect((await patch({ injuryCheckEnabled: "true" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ dailyLimit: 100, injuryCheckEnabled: true })).status).toBe(200);
  });

  it("sostituisce la chiave API solo se il fornitore la accetta", async () => {
    const llm = fakeLlm();
    const { app, admin } = await setup(llm);
    const newKey = "sk-ant-api03-" + "n".repeat(40);
    llm.validateKey = err("invalid_key");
    expect((await app("/api/admin/api-key", { method: "PUT", token: admin, body: { apiKey: newKey } })).status).toBe(400);
    llm.validateKey = ok(undefined);
    const res = await app("/api/admin/api-key", { method: "PUT", token: admin, body: { apiKey: newKey } });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("sk-ant");
    // la nuova chiave è quella usata per le domande successive
    await ask(app, admin);
    expect(llm.revealedKeys.at(-1)).toBe(newKey);
  });

  it("un partecipante vede il limite e lo stato della lega", async () => {
    const { app, member } = await setup();
    const me = (await (await app("/api/me", { token: member })).json()) as Record<string, unknown>;
    expect(me).toEqual({
      member: { name: "Paolo", role: "member" },
      league: { name: "Lega di Prova", injuryCheckEnabled: false, hasRulebook: true },
      usage: { usedToday: 0, dailyLimit: 20, remainingToday: 20 },
    });
  });
});
