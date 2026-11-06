import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ADMIN_PASSWORD, createLeague, err, fakeLlm, join, makeApp, ORIGIN, VALID_API_KEY } from "./helpers";

describe("Origine e CORS", () => {
  it("rifiuta richieste senza origin o da un altro sito, senza intestazioni CORS", async () => {
    const app = makeApp(fakeLlm());
    for (const origin of [null, "https://evil.example", "https://fantropico.test.evil.example", "http://fantropico.test"]) {
      const res = await app("/api/me", { origin });
      expect(res.status).toBe(403);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  });

  it("rifiuta il preflight da un altro origin senza intestazioni CORS", async () => {
    const res = await makeApp(fakeLlm())("/api/join", { method: "OPTIONS", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("risponde al preflight solo per l'origin del sito", async () => {
    const app = makeApp(fakeLlm());
    const res = await app("/api/join", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("aggiunge le intestazioni di sicurezza e non mette in cache", async () => {
    const res = await makeApp(fakeLlm())("/api/nessuna");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("si ferma se ALLOWED_ORIGIN non è un origin https valido", async () => {
    const { handleRequest } = await import("../src/app");
    const { routes } = await import("../src/index");
    for (const bad of ["*", "https://fantropico.test/", "http://fantropico.test", "ftp://x", ""]) {
      const res = await handleRequest(
        new Request("https://api.fantropico.test/api/me", { headers: { Origin: ORIGIN } }),
        { ...env, ALLOWED_ORIGIN: bad } as unknown as Env,
        { llm: () => { throw new Error("non usato"); }, now: () => new Date() },
        routes,
      );
      expect(res.status).toBe(500);
    }
  });
});

describe("Creazione della lega", () => {
  it("crea la lega, l'admin e restituisce token e codice", async () => {
    const llm = fakeLlm();
    const app = makeApp(llm);
    const { res, body } = await createLeague(app);
    expect(res.status).toBe(201);
    expect(body.league.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(typeof body.token).toBe("string");

    // la chiave arriva al fornitore solo dopo cifratura e decifratura, e in D1 non c'è in chiaro
    expect(llm.revealedKeys).toEqual([VALID_API_KEY]);
    const dump = await env.DB.prepare("SELECT * FROM league_secrets").all();
    expect(JSON.stringify(dump.results)).not.toContain("sk-ant");
    expect(JSON.stringify(dump.results)).not.toContain(ADMIN_PASSWORD);
    expect(JSON.stringify(body)).not.toContain("sk-ant");
  });

  it("rifiuta una chiave che il fornitore dichiara non valida e non salva nulla", async () => {
    const llm = fakeLlm();
    llm.validateKey = err("invalid_key");
    const countLeagues = async () => (await env.DB.prepare("SELECT count(*) AS n FROM leagues").first<{ n: number }>())?.n;
    const before = await countLeagues();
    const { res, body } = await createLeague(makeApp(llm));
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe("invalid_api_key");
    expect(await countLeagues()).toBe(before);
  });

  it("rifiuta campi non validi con un messaggio che non ripete l'input", async () => {
    const app = makeApp(fakeLlm());
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ leagueName: "<b>x</b>" }, "<b>"],
      [{ adminName: "x" }, "\"x\""],
      [{ adminPassword: "corta" }, "corta"],
      [{ apiKey: "sk-proj-123" }, "sk-proj"],
    ];
    for (const [override, echo] of cases) {
      const { res, body } = await createLeague(app, override);
      expect(res.status).toBe(400);
      expect(JSON.stringify(body)).not.toContain(echo);
    }
  });

  it("limita le creazioni per IP", async () => {
    const app = makeApp(fakeLlm());
    for (let i = 0; i < 3; i++) expect((await createLeague(app, {}, "192.0.2.77")).res.status).toBe(201);
    expect((await createLeague(app, {}, "192.0.2.77")).res.status).toBe(429);
    expect((await createLeague(app, {}, "192.0.2.78")).res.status).toBe(201);
  });

  it("rifiuta corpi troppo grandi, non JSON o con il tipo sbagliato", async () => {
    const app = makeApp(fakeLlm());
    expect((await app("/api/leagues", { ip: "192.0.2.1", rawBody: "x".repeat(5000) })).status).toBe(413);
    expect((await app("/api/leagues", { ip: "192.0.2.2", rawBody: "{non json" })).status).toBe(400);
    expect((await app("/api/leagues", { ip: "192.0.2.3", rawBody: "[]" })).status).toBe(400);
    expect((await app("/api/leagues", { ip: "192.0.2.4", rawBody: "{}", headers: { "Content-Type": "text/plain" } })).status).toBe(400);
  });
});

describe("Ingresso con il codice", () => {
  it("entra con codice e nome, anche con il codice in minuscolo", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const { res, body } = await join(app, league.league.joinCode.toLowerCase(), "Giulia");
    expect(res.status).toBe(201);
    expect(body.token).toBeTruthy();
    const me = await app("/api/me", { token: body.token! });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { member: { name: string; role: string } }).member).toEqual({ name: "Giulia", role: "member" });
  });

  it("rifiuta un codice sbagliato o malformato con lo stesso messaggio", async () => {
    const app = makeApp(fakeLlm());
    await createLeague(app);
    const wrong = await join(app, "ZZZZZZZZ", "Giulia");
    const malformed = await join(app, "abc", "Giulia");
    expect(wrong.res.status).toBe(401);
    expect(malformed.res.status).toBe(401);
    expect(wrong.body.error?.code).toBe("wrong_code");
    expect(malformed.body.error?.code).toBe("wrong_code");
  });

  it("non permette due nomi uguali tra i membri attivi, senza distinguere maiuscole", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    expect((await join(app, league.league.joinCode, "Marco")).res.status).toBe(201);
    const dup = await join(app, league.league.joinCode, "MARCO");
    expect(dup.res.status).toBe(409);
    expect(dup.body.error?.code).toBe("name_taken");
    // anche il nome dell'admin è occupato
    expect((await join(app, league.league.joinCode, "admin")).res.status).toBe(409);
  });

  it("blocca i tentativi ripetuti con codici sbagliati dallo stesso IP", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    for (let i = 0; i < 10; i++) expect((await join(app, "ZZZZZZZZ", "Luca", "192.0.2.50")).res.status).toBe(401);
    // ora anche il codice giusto viene bloccato per quell'IP
    expect((await join(app, league.league.joinCode, "Luca", "192.0.2.50")).res.status).toBe(429);
    expect((await join(app, league.league.joinCode, "Luca", "192.0.2.51")).res.status).toBe(201);
  });

  it("rifiuta l'ingresso quando la lega è piena (40 attivi, admin compreso)", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    for (let i = 1; i < 40; i++) {
      expect((await join(app, league.league.joinCode, `Membro ${i}`, `10.0.${i}.1`)).res.status).toBe(201);
    }
    const full = await join(app, league.league.joinCode, "Ultimo", "10.0.99.1");
    expect(full.res.status).toBe(409);
    expect(full.body.error?.code).toBe("league_full");
  });

  it("dopo la rigenerazione il vecchio codice non funziona, ma chi è dentro resta dentro", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const member = await join(app, league.league.joinCode, "Sara");
    const regen = await app("/api/admin/join-code", { method: "POST", token: league.token });
    expect(regen.status).toBe(200);
    const { joinCode } = (await regen.json()) as { joinCode: string };
    expect(joinCode).not.toBe(league.league.joinCode);
    expect((await join(app, league.league.joinCode, "Pietro")).res.status).toBe(401);
    expect((await join(app, joinCode, "Pietro")).res.status).toBe(201);
    expect((await app("/api/me", { token: member.body.token! })).status).toBe(200);
  });
});

describe("Sessioni e permessi", () => {
  it("rifiuta token assenti, alterati o di un altro formato", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const [payload, sig] = league.token.split(".");
    for (const token of ["", "abc", `${payload}.${sig}x`, `${payload}x.${sig}`, "a".repeat(700)]) {
      expect((await app("/api/me", { token })).status).toBe(401);
    }
    expect((await app("/api/me", { headers: { Authorization: league.token } })).status).toBe(401);
  });

  it("un membro rimosso perde subito l'accesso e il suo nome torna libero", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const member = await join(app, league.league.joinCode, "Rita");
    const overview = (await (await app("/api/admin/league", { token: league.token })).json()) as { members: Array<{ id: string; name: string }> };
    const rita = overview.members.find((m) => m.name === "Rita")!;
    const del = await app(`/api/admin/members/${rita.id}`, { method: "DELETE", token: league.token });
    expect(del.status).toBe(200);
    expect((await app("/api/me", { token: member.body.token! })).status).toBe(401);
    expect((await app(`/api/admin/members/${rita.id}`, { method: "DELETE", token: league.token })).status).toBe(404);
    expect((await join(app, league.league.joinCode, "Rita")).res.status).toBe(201);
  });

  it("l'admin non può rimuovere sé stesso né membri di altre leghe", async () => {
    const app = makeApp(fakeLlm());
    const a = (await createLeague(app)).body;
    const b = (await createLeague(app)).body;
    const memberB = await join(app, b.league.joinCode, "Bruno");
    const overviewA = (await (await app("/api/admin/league", { token: a.token })).json()) as { members: Array<{ id: string; role: string }> };
    const adminA = overviewA.members.find((m) => m.role === "admin")!;
    expect((await app(`/api/admin/members/${adminA.id}`, { method: "DELETE", token: a.token })).status).toBe(404);
    const overviewB = (await (await app("/api/admin/league", { token: b.token })).json()) as { members: Array<{ id: string; name: string }> };
    const bruno = overviewB.members.find((m) => m.name === "Bruno")!;
    expect((await app(`/api/admin/members/${bruno.id}`, { method: "DELETE", token: a.token })).status).toBe(404);
    expect((await app("/api/me", { token: memberB.body.token! })).status).toBe(200);
  });

  it("un partecipante non accede alle rotte admin", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const member = await join(app, league.league.joinCode, "Elena");
    for (const path of ["/api/admin/league", "/api/admin/rulebook"]) {
      expect((await app(path, { token: member.body.token! })).status).toBe(403);
    }
    expect((await app("/api/admin/join-code", { method: "POST", token: member.body.token! })).status).toBe(403);
  });

  it("i dati dell'admin non mostrano mai la chiave API", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const text = await (await app("/api/admin/league", { token: league.token })).text();
    expect(text).not.toContain("sk-ant");
    expect(text).not.toContain("ciphertext");
    expect(text).toContain("apiKeyUpdatedAt");
  });
});

describe("Accesso admin con password", () => {
  it("entra con codice e password giusti", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const res = await app("/api/admin/login", { body: { code: league.league.joinCode, password: ADMIN_PASSWORD } });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect((await app("/api/admin/league", { token })).status).toBe(200);
  });

  it("dà lo stesso errore per codice sbagliato e password sbagliata", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const a = await app("/api/admin/login", { body: { code: league.league.joinCode, password: "password sbagliata!" } });
    const b = await app("/api/admin/login", { body: { code: "ZZZZZZZZ", password: ADMIN_PASSWORD } });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(await a.text()).toBe(await b.text());
  });

  it("blocca l'IP dopo 5 password sbagliate", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const attempt = (password: string) => app("/api/admin/login", { ip: "192.0.2.90", body: { code: league.league.joinCode, password } });
    for (let i = 0; i < 5; i++) expect((await attempt("password sbagliata!")).status).toBe(401);
    expect((await attempt(ADMIN_PASSWORD)).status).toBe(429);
  });

  it("blocca la lega dopo 50 tentativi da IP diversi", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    for (let i = 0; i < 50; i++) {
      const res = await app("/api/admin/login", { ip: `172.16.${i}.1`, body: { code: league.league.joinCode, password: "password sbagliata!" } });
      expect(res.status).toBe(401);
    }
    const res = await app("/api/admin/login", { ip: "172.16.200.1", body: { code: league.league.joinCode, password: ADMIN_PASSWORD } });
    expect(res.status).toBe(429);
  });

  it("20 tentativi contemporanei dallo stesso IP: al massimo 5 arrivano alla verifica della password", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => app("/api/admin/login", { ip: "192.0.2.120", body: { code: league.league.joinCode, password: "password sbagliata!" } })),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
  });

  it("anche gli accessi riusciti contano nel limite per IP", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const login = () => app("/api/admin/login", { ip: "192.0.2.130", body: { code: league.league.joinCode, password: ADMIN_PASSWORD } });
    for (let i = 0; i < 5; i++) expect((await login()).status).toBe(200);
    expect((await login()).status).toBe(429);
  });

  it("rifiuta password deboli alla creazione della lega", async () => {
    const app = makeApp(fakeLlm());
    for (const adminPassword of ["legadiprova2026!", "Lega di Prova 99", "il mio fantacalcio", "Fantropico 2026!", "lapassword12345", "0012345678900", "aaaaaaaaaaaaaa", "sono admin io!!"]) {
      const { res, body } = await createLeague(app, { adminPassword });
      expect(res.status).toBe(400);
      expect(body.error?.message).toContain("Password troppo facile");
    }
  });

  it("rifiuta password deboli nel cambio password senza contarlo come tentativo", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    for (let i = 0; i < 6; i++) {
      const res = await app("/api/admin/password", { method: "PUT", ip: "192.0.2.140", token: league.token, body: { currentPassword: ADMIN_PASSWORD, newPassword: "Lega di Prova 2027" } });
      expect(res.status).toBe(400);
    }
  });

  it("cambiare password invalida le altre sessioni admin e la vecchia password", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    const wrong = await app("/api/admin/password", { method: "PUT", token: league.token, body: { currentPassword: "non è questa!!", newPassword: "cambio di rotta 2027" } });
    expect(wrong.status).toBe(401);
    const res = await app("/api/admin/password", { method: "PUT", token: league.token, body: { currentPassword: ADMIN_PASSWORD, newPassword: "cambio di rotta 2027" } });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect((await app("/api/admin/league", { token: league.token })).status).toBe(401);
    expect((await app("/api/admin/league", { token })).status).toBe(200);
    const old = await app("/api/admin/login", { body: { code: league.league.joinCode, password: ADMIN_PASSWORD } });
    expect(old.status).toBe(401);
  });
});

describe("Registro delle azioni", () => {
  it("registra le azioni senza contenuti personali", async () => {
    const app = makeApp(fakeLlm());
    const { body: league } = await createLeague(app);
    await join(app, league.league.joinCode, "Teo");
    const regen = await app("/api/admin/join-code", { method: "POST", token: league.token });
    const { joinCode } = (await regen.json()) as { joinCode: string };
    const { results } = await env.DB.prepare(
      "SELECT a.* FROM audit_events a JOIN leagues l ON l.id = a.league_id WHERE l.join_code = ?1 ORDER BY a.id",
    )
      .bind(joinCode)
      .all<Record<string, unknown>>();
    expect(results.map((r) => r.action)).toEqual(["league_created", "member_joined", "join_code_regenerated"]);
    expect(Object.keys(results[0]!).sort()).toEqual(["action", "actor_member_id", "created_at", "id", "league_id"]);
  });
});
