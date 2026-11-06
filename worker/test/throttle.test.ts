import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  canonicalIp,
  ipSubject,
  isThrottled,
  leagueSubject,
  recordAttempt,
  THROTTLE_RULES,
  throttleKey,
  type ThrottleAction,
} from "../src/abuse/throttle";
import { LeagueId } from "../src/domain/primitives";

// Allineato all'inizio di una finestra da 900 s e da 3600 s
const T0 = new Date(1_800_000_000_000);
let counter = 0;

function freshSubject(): string {
  counter++;
  return `ip:${crypto.randomUUID().replaceAll("-", "").slice(0, 28)}${counter.toString(16).padStart(4, "0")}`;
}

async function recordTimes(subject: string, action: ThrottleAction, times: number, now = T0): Promise<void> {
  for (let i = 0; i < times; i++) await recordAttempt(env.ABUSE_KV, subject, action, now);
}

async function hmacKey(): Promise<CryptoKey> {
  return (await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"])) as CryptoKey;
}

function requestWithIp(ip?: string): Request {
  const headers = new Headers();
  if (ip !== undefined) headers.set("CF-Connecting-IP", ip);
  return new Request("https://api.fantropico.test/", { headers });
}

describe("freni anti-abuso", () => {
  it("le regole hanno finestre di almeno 60 secondi e limiti positivi", () => {
    for (const rule of Object.values(THROTTLE_RULES)) {
      expect(rule.windowSeconds).toBeGreaterThanOrEqual(60);
      expect(rule.limit).toBeGreaterThan(0);
    }
  });

  it("senza tentativi non blocca", async () => {
    expect(await isThrottled(env.ABUSE_KV, freshSubject(), "join_failure", T0)).toBe(false);
  });

  it("sotto la soglia non blocca, alla soglia blocca (accesso con codice: 10)", async () => {
    const subject = freshSubject();
    await recordTimes(subject, "join_failure", 9);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).toBe(false);
    await recordTimes(subject, "join_failure", 1);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).toBe(true);
  });

  it("creazione leghe: 3 al giorno", async () => {
    const subject = freshSubject();
    await recordTimes(subject, "league_create", 2);
    expect(await isThrottled(env.ABUSE_KV, subject, "league_create", T0)).toBe(false);
    await recordTimes(subject, "league_create", 1);
    expect(await isThrottled(env.ABUSE_KV, subject, "league_create", T0)).toBe(true);
  });

  it("oltre la soglia resta bloccato", async () => {
    const subject = freshSubject();
    await recordTimes(subject, "league_create", 8);
    expect(await isThrottled(env.ABUSE_KV, subject, "league_create", T0)).toBe(true);
  });

  it("la finestra successiva riparte da zero", async () => {
    const subject = freshSubject();
    await recordTimes(subject, "join_failure", 10);
    const lastSecond = new Date(T0.getTime() + 899_000);
    const nextWindow = new Date(T0.getTime() + 900_000);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", lastSecond)).toBe(true);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", nextWindow)).toBe(false);
  });

  it("azioni diverse sono indipendenti", async () => {
    const subject = freshSubject();
    await recordTimes(subject, "join_failure", 10);
    expect(await isThrottled(env.ABUSE_KV, subject, "league_create", T0)).toBe(false);
  });

  it("soggetti diversi sono indipendenti", async () => {
    const blocked = freshSubject();
    await recordTimes(blocked, "join_failure", 10);
    expect(await isThrottled(env.ABUSE_KV, freshSubject(), "join_failure", T0)).toBe(false);
  });

  it.each(["abc", "-1", "1.5", "", " 3", "99999999"])("un valore corrotto in KV (%j) blocca", async (corrupt) => {
    const subject = freshSubject();
    await env.ABUSE_KV.put(throttleKey(subject, "join_failure", T0), corrupt);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).toBe(true);
  });

  it("un tentativo su valore corrotto lo riporta al limite e resta bloccato", async () => {
    const subject = freshSubject();
    const key = throttleKey(subject, "join_failure", T0);
    await env.ABUSE_KV.put(key, "garbage");
    await recordAttempt(env.ABUSE_KV, subject, "join_failure", T0);
    expect(await env.ABUSE_KV.get(key)).toBe(String(THROTTLE_RULES.join_failure.limit));
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).toBe(true);
  });

  it("i contatori hanno una scadenza in KV", async () => {
    const subject = freshSubject();
    await recordAttempt(env.ABUSE_KV, subject, "join_failure", T0);
    const listed = await env.ABUSE_KV.list({ prefix: `throttle:join_failure:${subject}:` });
    expect(listed.keys).toHaveLength(1);
    expect(listed.keys[0]!.expiration).toBeTypeOf("number");
  });

  it.each(["", "user:abc", "ip:ABC", "ip:a b", `ip:${"a".repeat(65)}`, "league:x;y"])(
    "rifiuta un soggetto non valido (%j)",
    async (subject) => {
      await expect(isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).rejects.toThrow();
      await expect(recordAttempt(env.ABUSE_KV, subject, "join_failure", T0)).rejects.toThrow();
    },
  );

  it("leagueSubject usa l'id della lega", () => {
    const leagueId = LeagueId.generate();
    expect(leagueSubject(leagueId)).toBe(`league:${leagueId.value}`);
  });
});

describe("soggetto IP", () => {
  it("è stabile per lo stesso IP e non contiene l'IP", async () => {
    const key = await hmacKey();
    const first = await ipSubject(requestWithIp("203.0.113.7"), key);
    const second = await ipSubject(requestWithIp("203.0.113.7"), key);
    expect(first).toBe(second);
    expect(first).toMatch(/^ip:[0-9a-f]{32}$/);
    expect(first).not.toContain("203.0.113.7");
    expect(first).not.toContain("203");
  });

  it("cambia per IP diversi", async () => {
    const key = await hmacKey();
    const a = await ipSubject(requestWithIp("203.0.113.7"), key);
    const b = await ipSubject(requestWithIp("203.0.113.8"), key);
    expect(a).not.toBe(b);
  });

  it("supporta IPv6", async () => {
    const subject = await ipSubject(requestWithIp("2001:db8::1"), await hmacKey());
    expect(subject).toMatch(/^ip:[0-9a-f]{32}$/);
  });

  it("cambia con la chiave", async () => {
    const a = await ipSubject(requestWithIp("203.0.113.7"), await hmacKey());
    const b = await ipSubject(requestWithIp("203.0.113.7"), await hmacKey());
    expect(a).not.toBe(b);
  });

  it("senza header usa il secchio condiviso", async () => {
    expect(await ipSubject(requestWithIp(), await hmacKey())).toBe("ip:unknown");
  });

  it("header vuoto, troppo lungo o con caratteri non ammessi usa il secchio condiviso", async () => {
    const key = await hmacKey();
    expect(await ipSubject(requestWithIp(""), key)).toBe("ip:unknown");
    expect(await ipSubject(requestWithIp("1".repeat(65)), key)).toBe("ip:unknown");
    expect(await ipSubject(requestWithIp("1.2.3.4, 5.6.7.8"), key)).toBe("ip:unknown");
    expect(await ipSubject(requestWithIp("<script>"), key)).toBe("ip:unknown");
  });

  it("un header che non è un IP usa il secchio condiviso", async () => {
    const key = await hmacKey();
    for (const bad of ["a".repeat(64), "256.1.1.1", "1.2.3", "1.2.3.4.5", "1::2::3", "12345::1", "1:2:3:4:5:6:7:8:9", "::ffff:1.2.3.256", ":::"]) {
      expect(await ipSubject(requestWithIp(bad), key)).toBe("ip:unknown");
    }
  });

  it("il soggetto prodotto è accettato dai freni", async () => {
    const subject = await ipSubject(requestWithIp("198.51.100.20"), await hmacKey());
    await recordAttempt(env.ABUSE_KV, subject, "join_failure", T0);
    expect(await isThrottled(env.ABUSE_KV, subject, "join_failure", T0)).toBe(false);
  });
});

describe("forma canonica degli IP", () => {
  it("IPv4 resta intero", () => {
    expect(canonicalIp("203.0.113.7")).toBe("v4:203.0.113.7");
    expect(canonicalIp("203.0.113.8")).not.toBe(canonicalIp("203.0.113.7"));
  });

  it("IPv6 nello stesso /64 ha la stessa forma, anche compresso o in maiuscolo", () => {
    const expected = "v6:2001:db8:abcd:12::/64";
    for (const ip of ["2001:db8:abcd:12::1", "2001:DB8:ABCD:0012:ffff:ffff:ffff:ffff", "2001:0db8:abcd:0012:0:0:0:0", "2001:db8:abcd:12:1:2:3:4"]) {
      expect(canonicalIp(ip)).toBe(expected);
    }
  });

  it("IPv6 in /64 diversi hanno forme diverse", () => {
    expect(canonicalIp("2001:db8:abcd:12::1")).not.toBe(canonicalIp("2001:db8:abcd:13::1"));
    expect(canonicalIp("::1")).toBe("v6:0:0:0:0::/64");
    expect(canonicalIp("fe80::1")).toBe("v6:fe80:0:0:0::/64");
  });

  it("IPv4 mappato in IPv6 si tratta come IPv4", () => {
    expect(canonicalIp("::ffff:203.0.113.7")).toBe("v4:203.0.113.7");
    expect(canonicalIp("::FFFF:cb00:7107")).toBe("v4:203.0.113.7");
  });

  it("lo stesso /64 dà lo stesso soggetto, un /64 diverso no", async () => {
    const key = await hmacKey();
    const a = await ipSubject(requestWithIp("2001:db8:1:2::10"), key);
    const b = await ipSubject(requestWithIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), key);
    const c = await ipSubject(requestWithIp("2001:db8:1:3::10"), key);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
