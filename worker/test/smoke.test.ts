import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("ambiente di test", () => {
  it("applica le migrazioni D1", async () => {
    const row = await env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'leagues'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("ha accesso al KV", async () => {
    await env.ABUSE_KV.put("k", "v");
    expect(await env.ABUSE_KV.get("k")).toBe("v");
  });
});
