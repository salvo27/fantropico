// Le fonti mostrate agli utenti: solo link https verso fantacalcio.it e i suoi sottodomini

import type { Source } from "./provider";

const TRUSTED_DOMAIN = "fantacalcio.it";
const MAX_URL_LENGTH = 500;
const MAX_TITLE_LENGTH = 120;
const UNSAFE_TITLE_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/gu;

export function isTrustedHost(hostname: string): boolean {
  return hostname === TRUSTED_DOMAIN || hostname.endsWith(`.${TRUSTED_DOMAIN}`);
}

function cleanTitle(title: unknown, fallback: string): string {
  if (typeof title !== "string" || !title.isWellFormed()) return fallback;
  const cleaned = title.replace(UNSAFE_TITLE_CHARS, " ").replace(/\s+/gu, " ").trim();
  if (cleaned.length === 0) return fallback;
  const chars = [...cleaned];
  return chars.length > MAX_TITLE_LENGTH ? `${chars.slice(0, MAX_TITLE_LENGTH - 1).join("").trimEnd()}…` : cleaned;
}

export function toTrustedSource(url: unknown, title: unknown): Source | null {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) return null;
  if (!url.isWellFormed() || /[\s\u0000-\u001F\u007F]/u.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return null;
  if (!isTrustedHost(parsed.hostname)) return null;
  const href = parsed.href;
  if (href.length > MAX_URL_LENGTH) return null;
  return Object.freeze({ url: href, title: cleanTitle(title, parsed.hostname) });
}
