import type { D1Migration } from "cloudflare:test";

// Secret del Worker: non stanno in wrangler.jsonc, si impostano con `wrangler secret put`
interface Secrets {
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
}

declare global {
  interface Env extends Secrets {}
  namespace Cloudflare {
    interface Env extends Secrets {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
