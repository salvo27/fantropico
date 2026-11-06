import { defineConfig, loadEnv } from "vite";

// In build genera dist/_headers per Cloudflare: CSP stretta che permette di parlare solo con il Worker
function securityHeaders(apiBase) {
  return {
    name: "fantropico-security-headers",
    apply: "build",
    generateBundle() {
      const apiOrigin = new URL(apiBase).origin;
      const csp = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self'",
        "font-src 'self'",
        `connect-src 'self' ${apiOrigin}`,
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; ");
      const headers = [
        "/*",
        `  Content-Security-Policy: ${csp}`,
        "  X-Content-Type-Options: nosniff",
        "  Referrer-Policy: no-referrer",
        "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "  Cross-Origin-Opener-Policy: same-origin",
        "  Strict-Transport-Security: max-age=31536000",
        "",
      ].join("\n");
      this.emitFile({ type: "asset", fileName: "_headers", source: headers });
    },
  };
}

function requireApiBase(value, mode) {
  if (!value) throw new Error("Imposta VITE_API_BASE (vedi web/.env.example)");
  const url = new URL(value);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (mode === "production" && (url.protocol !== "https:" || isLocal)) {
    throw new Error("VITE_API_BASE in produzione deve essere un URL https pubblico");
  }
  return value;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiBase = requireApiBase(env.VITE_API_BASE, mode);
  return {
    plugins: [securityHeaders(apiBase)],
    build: {
      target: "es2022",
      sourcemap: false,
      modulePreload: { polyfill: false },
    },
    server: { port: 5173, strictPort: true },
  };
});
