// Freni anti-abuso in KV a finestra fissa. KV non è atomico: il conteggio è approssimato,
// accettabile qui. Valori illeggibili contano come limite raggiunto (fail closed).
// Il login admin, dove serve un conteggio esatto, usa D1 (login-attempts.ts).

import type { LeagueId } from "../domain/primitives";

export type ThrottleAction = "join_failure" | "join_success" | "league_create";

export const THROTTLE_RULES: Readonly<Record<ThrottleAction, { readonly limit: number; readonly windowSeconds: number }>> =
  Object.freeze({
    join_failure: Object.freeze({ limit: 10, windowSeconds: 900 }),
    // Ingressi con codice valido dallo stesso IP (contati prima della scrittura): un gruppo di amici sulla stessa rete ci sta largo
    join_success: Object.freeze({ limit: 20, windowSeconds: 3_600 }),
    league_create: Object.freeze({ limit: 3, windowSeconds: 86_400 }),
  });

const KV_MIN_TTL_SECONDS = 60;
const MAX_STORED_COUNT = 1_000_000;
const SUBJECT_FORMAT = /^(ip|league):[0-9a-z-]{1,64}$/;
const COUNT_FORMAT = /^[0-9]{1,7}$/;
const UNKNOWN_IP_SUBJECT = "ip:unknown";
const MAX_IP_LENGTH = 64;
const IP_CHARS = /^[0-9A-Fa-f:.]+$/;

function assertSubject(subject: string): void {
  if (!SUBJECT_FORMAT.test(subject)) throw new Error("Invalid throttle subject");
}

export function throttleKey(subject: string, action: ThrottleAction, now: Date): string {
  assertSubject(subject);
  const bucket = Math.floor(now.getTime() / 1000 / THROTTLE_RULES[action].windowSeconds);
  return `throttle:${action}:${subject}:${bucket}`;
}

// null se il valore in KV non è un intero valido
function parseCount(raw: string | null): number | null {
  if (raw === null) return 0;
  if (!COUNT_FORMAT.test(raw)) return null;
  return Number(raw);
}

export async function isThrottled(kv: KVNamespace, subject: string, action: ThrottleAction, now: Date): Promise<boolean> {
  const count = parseCount(await kv.get(throttleKey(subject, action, now)));
  if (count === null) return true;
  return count >= THROTTLE_RULES[action].limit;
}

export async function recordAttempt(kv: KVNamespace, subject: string, action: ThrottleAction, now: Date): Promise<void> {
  const rule = THROTTLE_RULES[action];
  const key = throttleKey(subject, action, now);
  const count = parseCount(await kv.get(key));
  // Un valore corrotto viene riportato al limite: resta bloccato fino alla fine della finestra
  const next = count === null ? rule.limit : Math.min(count + 1, MAX_STORED_COUNT);
  await kv.put(key, String(next), { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, rule.windowSeconds) });
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function ipv4Parts(ip: string): [number, number, number, number] | null {
  const match = IPV4.exec(ip);
  if (!match) return null;
  const parts = match.slice(1).map(Number) as [number, number, number, number];
  return parts.some((part) => part > 255) ? null : parts;
}

function canonicalIpv4(ip: string): string | null {
  const parts = ipv4Parts(ip);
  return parts ? `v4:${parts.join(".")}` : null;
}

function parseHextets(part: string): number[] | null {
  if (part === "") return [];
  const groups: number[] = [];
  for (const group of part.split(":")) {
    if (!HEXTET.test(group)) return null;
    groups.push(parseInt(group, 16));
  }
  return groups;
}

// Espande un IPv6 (anche con "::" o IPv4 in coda) in 8 gruppi da 16 bit
function expandIpv6(raw: string): number[] | null {
  let ip = raw.toLowerCase();
  const tail: number[] = [];
  if (ip.includes(".")) {
    const lastColon = ip.lastIndexOf(":");
    const v4 = ipv4Parts(ip.slice(lastColon + 1));
    if (!v4) return null;
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
    // "::ffff:1.2.3.4" diventa "::ffff", "1::1.2.3.4" diventa "1::"
    ip = ip.slice(0, lastColon);
    if (ip.endsWith(":")) ip += ":";
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = parseHextets(halves[0]!);
  const rest = halves.length === 2 ? parseHextets(halves[1]!) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const zeros = new Array<number>(8 - known).fill(0);
  return [...head, ...zeros, ...rest, ...tail];
}

// Forma canonica per i freni: IPv4 intero, IPv6 raggruppato per /64 (una rete domestica o un server ha un /64 intero)
export function canonicalIp(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_IP_LENGTH || !IP_CHARS.test(raw)) return null;
  if (!raw.includes(":")) return canonicalIpv4(raw);
  const groups = expandIpv6(raw);
  if (!groups) return null;
  const isMappedV4 = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (isMappedV4) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return `v4:${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `v6:${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

// L'IP non viene mai salvato in chiaro: solo un HMAC troncato della forma canonica
export async function ipSubject(request: Request, key: CryptoKey): Promise<string> {
  const ip = canonicalIp(request.headers.get("CF-Connecting-IP") ?? "");
  if (ip === null) return UNKNOWN_IP_SUBJECT;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return `ip:${toHex(new Uint8Array(mac)).slice(0, 32)}`;
}

export function leagueSubject(leagueId: LeagueId): string {
  return `league:${leagueId.value}`;
}
