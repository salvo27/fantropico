import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { LeagueId, MemberId } from "../src/domain/primitives";
import { toBase64 } from "../src/security/secrets";
import { deriveSubkey, loadSessionKey, SESSION_TTL_SECONDS, signSession, verifySession } from "../src/security/token";

const NOW = new Date("2026-11-06T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

function claims() {
  return { leagueId: LeagueId.generate(), memberId: MemberId.generate(), role: "member" as const, tokenVersion: 1 };
}

function b64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signRaw(payload: unknown, key: CryptoKey): Promise<string> {
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${b64url(new Uint8Array(sig))}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return { v: 1, l: LeagueId.generate().value, m: MemberId.generate().value, r: "admin", t: 3, e: NOW_S + 3600, ...overrides };
}

describe("token di sessione", () => {
  it("firma e verifica un token valido", async () => {
    const key = await loadSessionKey(env);
    const input = claims();
    const token = await signSession(input, key, NOW);
    expect(token.length).toBeLessThanOrEqual(512);
    const result = await verifySession(token, key, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.leagueId.value).toBe(input.leagueId.value);
    expect(result.value.memberId.value).toBe(input.memberId.value);
    expect(result.value.role).toBe("member");
    expect(result.value.tokenVersion).toBe(1);
    expect(result.value.expiresAt).toBe(NOW_S + SESSION_TTL_SECONDS);
  });

  it("accetta un payload costruito a mano ma firmato correttamente", async () => {
    const key = await loadSessionKey(env);
    expect((await verifySession(await signRaw(validPayload(), key), key, NOW)).ok).toBe(true);
  });

  it("rifiuta un token con payload o firma alterati", async () => {
    const key = await loadSessionKey(env);
    const token = await signSession(claims(), key, NOW);
    const [payload = "", sig = ""] = token.split(".");
    const otherPayload = b64url(new TextEncoder().encode(JSON.stringify(validPayload())));
    const swapChar = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect((await verifySession(`${otherPayload}.${sig}`, key, NOW)).ok).toBe(false);
    expect((await verifySession(`${swapChar(payload, 5)}.${sig}`, key, NOW)).ok).toBe(false);
    expect((await verifySession(`${payload}.${swapChar(sig, 0)}`, key, NOW)).ok).toBe(false);
    expect((await verifySession(`${payload}.${sig.slice(0, -2)}`, key, NOW)).ok).toBe(false);
  });

  it("rifiuta un token firmato con un altro secret o un'altra sottochiave", async () => {
    const key = await loadSessionKey(env);
    const otherSecret = await loadSessionKey({ SESSION_SECRET: toBase64(crypto.getRandomValues(new Uint8Array(32))) });
    const ipKey = await deriveSubkey(env, "fantropico-ip-hash-v1");
    const token = await signSession(claims(), key, NOW);
    expect((await verifySession(token, otherSecret, NOW)).ok).toBe(false);
    expect((await verifySession(token, ipKey, NOW)).ok).toBe(false);
  });

  it("gestisce la scadenza ai limiti", async () => {
    const key = await loadSessionKey(env);
    const token = await signSession(claims(), key, NOW);
    const expiry = (NOW_S + SESSION_TTL_SECONDS) * 1000;
    expect((await verifySession(token, key, new Date(expiry - 1000))).ok).toBe(true);
    expect((await verifySession(token, key, new Date(expiry))).ok).toBe(false);
    expect((await verifySession(token, key, new Date(expiry + 86_400_000))).ok).toBe(false);
  });

  it("rifiuta una scadenza oltre la durata massima", async () => {
    const key = await loadSessionKey(env);
    const limit = NOW_S + SESSION_TTL_SECONDS + 60;
    expect((await verifySession(await signRaw(validPayload({ e: limit }), key), key, NOW)).ok).toBe(true);
    expect((await verifySession(await signRaw(validPayload({ e: limit + 1 }), key), key, NOW)).ok).toBe(false);
    expect((await verifySession(await signRaw(validPayload({ e: Number.MAX_SAFE_INTEGER }), key), key, NOW)).ok).toBe(false);
  });

  it("controlla la lunghezza massima di 512 caratteri", async () => {
    const key = await loadSessionKey(env);
    // Il payload ha campi extra ignorati: serve solo a raggiungere la lunghezza voluta
    const make = async (padLength: number) => signRaw(validPayload({ x: "a".repeat(padLength) }), key);
    let pad = 0;
    let token = await make(pad);
    while (token.length < 512) token = await make(++pad);
    expect(token.length === 512 || token.length === 513).toBe(true);
    const at512 = token.length === 512 ? token : await make(pad - 1);
    const over = await make(pad + 3);
    expect(at512.length).toBeLessThanOrEqual(512);
    expect((await verifySession(at512, key, NOW)).ok).toBe(true);
    expect(over.length).toBeGreaterThan(512);
    expect((await verifySession(over, key, NOW)).ok).toBe(false);
    expect((await verifySession("a".repeat(100_000), key, NOW)).ok).toBe(false);
  });

  it("rifiuta formati non validi", async () => {
    const key = await loadSessionKey(env);
    const token = await signSession(claims(), key, NOW);
    const cases: unknown[] = [
      undefined,
      null,
      42,
      {},
      "",
      ".",
      "abc",
      `${token}.extra`,
      token.replace(".", ".."),
      `${token} `,
      token.replace(/^./, "+"),
      token.replace(/^./, "="),
      `Bearer ${token}`,
    ];
    for (const value of cases) expect((await verifySession(value, key, NOW)).ok).toBe(false);
  });

  it("rifiuta payload firmati ma con campi mancanti o sbagliati", async () => {
    const key = await loadSessionKey(env);
    const bad: unknown[] = [
      [],
      "stringa",
      null,
      validPayload({ v: 2 }),
      validPayload({ v: "1" }),
      validPayload({ l: "non-uuid" }),
      validPayload({ l: undefined }),
      validPayload({ m: LeagueId.generate().value.toUpperCase() }),
      validPayload({ r: "superadmin" }),
      validPayload({ r: "Admin" }),
      validPayload({ t: 0 }),
      validPayload({ t: -1 }),
      validPayload({ t: 1.5 }),
      validPayload({ t: "1" }),
      validPayload({ e: NOW_S - 1 }),
      validPayload({ e: "domani" }),
    ];
    for (const payload of bad) expect((await verifySession(await signRaw(payload, key), key, NOW)).ok).toBe(false);
  });

  it("rifiuta un payload firmato che non è JSON", async () => {
    const key = await loadSessionKey(env);
    const encoded = b64url(new TextEncoder().encode("{non json"));
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
    expect((await verifySession(`${encoded}.${b64url(new Uint8Array(sig))}`, key, NOW)).ok).toBe(false);
  });

  it("si ferma se SESSION_SECRET manca o è troppo corto", async () => {
    await expect(loadSessionKey({ SESSION_SECRET: undefined as unknown as string })).rejects.toThrow();
    await expect(loadSessionKey({ SESSION_SECRET: toBase64(new Uint8Array(31)) })).rejects.toThrow();
  });
});
