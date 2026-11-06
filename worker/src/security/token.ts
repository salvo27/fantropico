// Token di sessione firmati con HMAC-SHA256: payload.firma, entrambi in base64url

import { LeagueId, MemberId, parseRole, type Role } from "../domain/primitives";
import { err, ok, type Result } from "../domain/result";
import { decodeBase64Secret } from "./secrets";

export const SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface SessionClaims {
  readonly leagueId: LeagueId;
  readonly memberId: MemberId;
  readonly role: Role;
  readonly tokenVersion: number;
  readonly expiresAt: number;
}

const TOKEN_VERSION = 1;
const MAX_TOKEN_LENGTH = 512;
const CLOCK_SKEW_SECONDS = 60;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(value) || value.length % 4 === 1) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function deriveSubkey(env: { SESSION_SECRET: string }, info: string): Promise<CryptoKey> {
  const secret = decodeBase64Secret(env.SESSION_SECRET, "SESSION_SECRET", 32);
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
    base,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

export async function loadSessionKey(env: { SESSION_SECRET: string }): Promise<CryptoKey> {
  return deriveSubkey(env, "fantropico-session-v1");
}

export async function signSession(claims: Omit<SessionClaims, "expiresAt">, key: CryptoKey, now: Date): Promise<string> {
  const payload = {
    v: TOKEN_VERSION,
    l: claims.leagueId.value,
    m: claims.memberId.value,
    r: claims.role,
    t: claims.tokenVersion,
    e: Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${toBase64Url(new Uint8Array(signature))}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function verifySession(token: unknown, key: CryptoKey, now: Date): Promise<Result<SessionClaims, "invalid_token">> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return err("invalid_token");
  if (!TOKEN_FORMAT.test(token)) return err("invalid_token");
  const [encoded = "", signatureB64 = ""] = token.split(".");
  const signature = fromBase64Url(signatureB64);
  if (signature === null) return err("invalid_token");

  // La firma si controlla prima di interpretare il contenuto
  const valid = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(encoded));
  if (!valid) return err("invalid_token");

  const payloadBytes = fromBase64Url(encoded);
  if (payloadBytes === null) return err("invalid_token");
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(payloadBytes));
  } catch {
    return err("invalid_token");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return err("invalid_token");
  const fields = payload as Record<string, unknown>;

  if (fields["v"] !== TOKEN_VERSION) return err("invalid_token");
  const leagueId = LeagueId.parse(fields["l"]);
  const memberId = MemberId.parse(fields["m"]);
  const role = parseRole(fields["r"]);
  const tokenVersion = fields["t"];
  const expiresAt = fields["e"];
  if (!leagueId.ok || !memberId.ok || !role.ok) return err("invalid_token");
  if (!isPositiveInteger(tokenVersion) || !isPositiveInteger(expiresAt)) return err("invalid_token");

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (expiresAt <= nowSeconds) return err("invalid_token");
  if (expiresAt > nowSeconds + SESSION_TTL_SECONDS + CLOCK_SKEW_SECONDS) return err("invalid_token");

  return ok(
    Object.freeze({
      leagueId: leagueId.value,
      memberId: memberId.value,
      role: role.value,
      tokenVersion,
      expiresAt,
    }),
  );
}
