import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Valori finti, validi solo nei test
const TEST_SESSION_SECRET = "dGVzdC1zZXNzaW9uLXNlY3JldC0wMTIzNDU2Nzg5YWJjZGVm";
const TEST_ENCRYPTION_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SESSION_SECRET: TEST_SESSION_SECRET,
            ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
            ALLOWED_ORIGIN: "https://fantropico.test",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
