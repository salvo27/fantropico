import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AnthropicApiKey, LeagueId } from "../src/domain/primitives";
import { CURRENT_KEY_VERSION, decryptApiKey, encryptApiKey, loadEncryptionKey, type EncryptedSecret } from "../src/security/crypto";
import { ConfigError, fromBase64, toBase64 } from "../src/security/secrets";

const KEY_TEXT = `sk-ant-api03-${"A1b2_C3d4-".repeat(8)}`;

function apiKey(text = KEY_TEXT): AnthropicApiKey {
  const parsed = AnthropicApiKey.parse(text);
  if (!parsed.ok) throw new Error("fixture non valida");
  return parsed.value;
}

function randomKeyB64(bytes: number): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)));
}

function flipByte(b64: string, index: number): string {
  const bytes = fromBase64(b64);
  if (bytes === null) throw new Error("base64 non valido");
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return toBase64(bytes);
}

describe("cifratura della chiave API", () => {
  it("cifra e decifra la stessa chiave", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    expect(secret.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(secret.ciphertext).not.toContain("sk-ant");

    const decrypted = await decryptApiKey(secret, league, master);
    expect(decrypted.ok).toBe(true);
    if (decrypted.ok) expect(decrypted.value.reveal()).toBe(KEY_TEXT);
  });

  it("usa un IV diverso a ogni cifratura dello stesso testo", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const a = await encryptApiKey(apiKey(), league, master);
    const b = await encryptApiKey(apiKey(), league, master);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(fromBase64(a.iv)?.length).toBe(12);
  });

  it("rifiuta un cifrato alterato di un solo byte", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    const first = await decryptApiKey({ ...secret, ciphertext: flipByte(secret.ciphertext, 0) }, league, master);
    const last = await decryptApiKey({ ...secret, ciphertext: flipByte(secret.ciphertext, (fromBase64(secret.ciphertext)?.length ?? 1) - 1) }, league, master);
    expect(first).toEqual({ ok: false, error: "decrypt_failed" });
    expect(last).toEqual({ ok: false, error: "decrypt_failed" });
  });

  it("rifiuta un IV alterato o di lunghezza sbagliata", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    expect((await decryptApiKey({ ...secret, iv: flipByte(secret.iv, 3) }, league, master)).ok).toBe(false);
    expect((await decryptApiKey({ ...secret, iv: randomKeyB64(11) }, league, master)).ok).toBe(false);
    expect((await decryptApiKey({ ...secret, iv: randomKeyB64(16) }, league, master)).ok).toBe(false);
  });

  it("non decifra con l'id di un'altra lega (AAD)", async () => {
    const master = await loadEncryptionKey(env);
    const secret = await encryptApiKey(apiKey(), LeagueId.generate(), master);
    const result = await decryptApiKey(secret, LeagueId.generate(), master);
    expect(result).toEqual({ ok: false, error: "decrypt_failed" });
  });

  it("non decifra con una chiave master diversa", async () => {
    const master = await loadEncryptionKey(env);
    const other = await loadEncryptionKey({ ENCRYPTION_KEY: randomKeyB64(32) });
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    expect((await decryptApiKey(secret, league, other)).ok).toBe(false);
  });

  it("rifiuta versioni di chiave sconosciute", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    for (const keyVersion of [0, 2, -1, Number.MAX_SAFE_INTEGER]) {
      expect((await decryptApiKey({ ...secret, keyVersion }, league, master)).ok).toBe(false);
    }
  });

  it("rifiuta base64 malformato e valori estremi", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const secret = await encryptApiKey(apiKey(), league, master);
    const cases: EncryptedSecret[] = [
      { ...secret, ciphertext: "non base64!" },
      { ...secret, ciphertext: "" },
      { ...secret, ciphertext: "A".repeat(2000) },
      { ...secret, iv: "%%%%" },
      { ...secret, iv: "" },
    ];
    for (const c of cases) expect((await decryptApiKey(c, league, master)).ok).toBe(false);
  });

  it("rifiuta un testo decifrato che non è una chiave valida", async () => {
    const master = await loadEncryptionKey(env);
    const league = LeagueId.generate();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = new TextEncoder().encode(`fantropico:anthropic-api-key:v1:${league.value}`);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, master, new TextEncoder().encode("non-una-chiave"));
    const secret = { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv), keyVersion: 1 };
    expect((await decryptApiKey(secret, league, master)).ok).toBe(false);
  });

  it("si ferma se ENCRYPTION_KEY manca o non è di 32 byte", async () => {
    const bad = [undefined, "", randomKeyB64(31), randomKeyB64(33), randomKeyB64(64), "non-base64-ma-lunga-abbastanza-per-passare!!", " "];
    for (const value of bad) {
      await expect(loadEncryptionKey({ ENCRYPTION_KEY: value as unknown as string })).rejects.toBeInstanceOf(ConfigError);
    }
    await expect(loadEncryptionKey({ ENCRYPTION_KEY: randomKeyB64(32) })).resolves.toBeDefined();
  });

  it("consuma la chiave in chiaro: una seconda lettura lancia", async () => {
    const master = await loadEncryptionKey(env);
    const key = apiKey();
    await encryptApiKey(key, LeagueId.generate(), master);
    expect(() => key.reveal()).toThrow();
  });

  it("non mostra mai la chiave in JSON o come stringa", () => {
    const key = apiKey();
    expect(JSON.stringify({ key })).toBe('{"key":"[REDACTED]"}');
    expect(String(key)).toBe("[REDACTED]");
    expect(`${key}`).toBe("[REDACTED]");
    expect(key.reveal()).toBe(KEY_TEXT);
  });
});
