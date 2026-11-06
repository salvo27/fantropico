import { describe, expect, it } from "vitest";
import { AdminPassword } from "../src/domain/primitives";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../src/security/password";
import { toBase64 } from "../src/security/secrets";

function password(text: string): AdminPassword {
  const parsed = AdminPassword.parse(text);
  if (!parsed.ok) throw new Error("fixture non valida");
  return parsed.value;
}

const GOOD = "campionato-2026!";

describe("hash della password admin", () => {
  it("verifica la password corretta", async () => {
    const stored = await hashPassword(password(GOOD));
    expect(stored.startsWith(`pbkdf2-sha256$${PBKDF2_ITERATIONS}$`)).toBe(true);
    expect(stored).not.toContain(GOOD);
    expect(await verifyPassword(password(GOOD), stored)).toBe(true);
  });

  it("rifiuta una password sbagliata, anche per un solo carattere", async () => {
    const stored = await hashPassword(password(GOOD));
    expect(await verifyPassword(password("campionato-2026?"), stored)).toBe(false);
    expect(await verifyPassword(password("Campionato-2026!"), stored)).toBe(false);
  });

  it("usa un sale diverso a ogni hash", async () => {
    const a = await hashPassword(password(GOOD));
    const b = await hashPassword(password(GOOD));
    expect(a).not.toBe(b);
  });

  it("rifiuta hash salvati malformati o con parametri diversi", async () => {
    const stored = await hashPassword(password(GOOD));
    const [, , salt, hash] = stored.split("$");
    const salt8 = toBase64(new Uint8Array(8));
    const cases = [
      "",
      "pbkdf2-sha256",
      `pbkdf2-sha256$1000$${salt}$${hash}`,
      `pbkdf2-sha256$99999$${salt}$${hash}`,
      `pbkdf2-sha256$100001$${salt}$${hash}`,
      `pbkdf2-sha1$${PBKDF2_ITERATIONS}$${salt}$${hash}`,
      `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt8}$${hash}`,
      `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt}$${toBase64(new Uint8Array(31))}`,
      `pbkdf2-sha256$${PBKDF2_ITERATIONS}$non-base64$${hash}`,
      `${stored}$extra`,
      `${stored}${"A".repeat(300)}`,
    ];
    for (const value of cases) expect(await verifyPassword(password(GOOD), value)).toBe(false);
  });

  it("accetta password ai limiti di lunghezza (12 e 128) e rifiuta fuori limite", async () => {
    expect(AdminPassword.parse("a".repeat(12)).ok).toBe(true);
    expect(AdminPassword.parse("é".repeat(128)).ok).toBe(true);
    expect(AdminPassword.parse("a".repeat(11)).ok).toBe(false);
    expect(AdminPassword.parse("a".repeat(129)).ok).toBe(false);
    expect(AdminPassword.parse("a".repeat(100_000)).ok).toBe(false);
    expect(AdminPassword.parse(12345678901234).ok).toBe(false);
    expect(AdminPassword.parse(null).ok).toBe(false);

    const longest = "é".repeat(128);
    const stored = await hashPassword(password(longest));
    expect(await verifyPassword(password(longest), stored)).toBe(true);
  });

  it("consuma la password in chiaro", async () => {
    const pwd = password(GOOD);
    await hashPassword(pwd);
    expect(() => pwd.reveal()).toThrow();
    expect(JSON.stringify({ pwd: password(GOOD) })).toBe('{"pwd":"[REDACTED]"}');
  });

  it("misura il tempo medio di hashPassword", async () => {
    const runs = 5;
    const start = performance.now();
    for (let i = 0; i < runs; i++) await hashPassword(password(GOOD));
    const elapsed = performance.now() - start;
    // In workerd il timer avanza solo dopo I/O: il valore può risultare 0, è solo indicativo
    console.log(`PBKDF2 ${PBKDF2_ITERATIONS} iterazioni: media ${(elapsed / runs).toFixed(1)} ms`);
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });
});
