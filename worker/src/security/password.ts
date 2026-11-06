// Hash della password admin con PBKDF2-SHA256 (WebCrypto di workerd)

import type { AdminPassword } from "../domain/primitives";
import { fromBase64, toBase64 } from "./secrets";

export const PBKDF2_ITERATIONS = 100_000;

const SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MAX_STORED_LENGTH = 200;

async function derive(password: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: AdminPassword): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password.reveal(), salt);
  return `${SCHEME}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: AdminPassword, stored: string): Promise<boolean> {
  const plaintext = password.reveal();
  if (typeof stored !== "string" || stored.length > MAX_STORED_LENGTH) return false;
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [scheme, iterations, saltB64, hashB64] = parts;
  if (scheme !== SCHEME || iterations !== String(PBKDF2_ITERATIONS)) return false;
  const salt = fromBase64(saltB64 ?? "");
  const expected = fromBase64(hashB64 ?? "");
  if (salt === null || salt.length !== SALT_BYTES || expected === null || expected.length !== HASH_BYTES) return false;
  const actual = await derive(plaintext, salt);
  return crypto.subtle.timingSafeEqual(actual, expected);
}
