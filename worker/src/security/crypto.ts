// Cifratura della chiave API con AES-GCM: il cifrato è legato alla lega tramite AAD

import { AnthropicApiKey, type LeagueId } from "../domain/primitives";
import { err, ok, type Result } from "../domain/result";
import { ConfigError, decodeBase64Secret, fromBase64, toBase64 } from "./secrets";

export interface EncryptedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly keyVersion: number;
}

export const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12;
const KEY_BYTES = 32;
const MAX_CIPHERTEXT_B64 = 1024;

export async function loadEncryptionKey(env: { ENCRYPTION_KEY: string }): Promise<CryptoKey> {
  const raw = decodeBase64Secret(env.ENCRYPTION_KEY, "ENCRYPTION_KEY", KEY_BYTES);
  if (raw.length !== KEY_BYTES) throw new ConfigError("ENCRYPTION_KEY");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(leagueId: LeagueId, keyVersion: number): Uint8Array {
  return new TextEncoder().encode(`fantropico:anthropic-api-key:v${keyVersion}:${leagueId.value}`);
}

export async function encryptApiKey(apiKey: AnthropicApiKey, leagueId: LeagueId, masterKey: CryptoKey): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(apiKey.reveal());
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(leagueId, CURRENT_KEY_VERSION) },
    masterKey,
    plaintext,
  );
  plaintext.fill(0);
  return Object.freeze({
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    keyVersion: CURRENT_KEY_VERSION,
  });
}

export async function decryptApiKey(
  secret: EncryptedSecret,
  leagueId: LeagueId,
  masterKey: CryptoKey,
): Promise<Result<AnthropicApiKey, "decrypt_failed">> {
  if (secret.keyVersion !== CURRENT_KEY_VERSION) return err("decrypt_failed");
  if (typeof secret.ciphertext !== "string" || secret.ciphertext.length > MAX_CIPHERTEXT_B64) return err("decrypt_failed");
  if (typeof secret.iv !== "string") return err("decrypt_failed");
  const iv = fromBase64(secret.iv);
  const ciphertext = fromBase64(secret.ciphertext);
  if (iv === null || iv.length !== IV_BYTES || ciphertext === null) return err("decrypt_failed");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(leagueId, secret.keyVersion) },
      masterKey,
      ciphertext,
    );
  } catch {
    return err("decrypt_failed");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plaintext);
  } catch {
    return err("decrypt_failed");
  } finally {
    new Uint8Array(plaintext).fill(0);
  }
  const apiKey = AnthropicApiKey.parse(text);
  return apiKey.ok ? ok(apiKey.value) : err("decrypt_failed");
}
