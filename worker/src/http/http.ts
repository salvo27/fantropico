// Origine, CORS, lettura del corpo e risposte JSON

import { ConfigError } from "../security/secrets";
import { Errors, type AppError } from "./errors";

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";
const ALLOWED_HEADERS = "authorization, content-type";

// L'origin configurato deve essere un origin puro: https, oppure http solo su localhost per lo sviluppo
export function parseAllowedOrigin(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 200) throw new ConfigError("ALLOWED_ORIGIN");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("ALLOWED_ORIGIN");
  }
  const isLocal = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocal) throw new ConfigError("ALLOWED_ORIGIN");
  if (url.origin !== raw) throw new ConfigError("ALLOWED_ORIGIN");
  return url.origin;
}

export function isAllowedOrigin(request: Request, allowedOrigin: string): boolean {
  return request.headers.get("Origin") === allowedOrigin;
}

function baseHeaders(allowedOrigin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function preflight(allowedOrigin: string): Response {
  const headers = baseHeaders(allowedOrigin);
  headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  headers.set("Access-Control-Max-Age", "600");
  return new Response(null, { status: 204, headers });
}

export function json(body: unknown, allowedOrigin: string | null, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: baseHeaders(allowedOrigin) });
}

export function errorResponse(error: AppError, allowedOrigin: string | null, incident?: string): Response {
  const body = { error: { code: error.code, message: error.message, ...(incident ? { incident } : {}) } };
  return json(body, allowedOrigin, error.status);
}

export class HttpError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.code);
    this.name = "HttpError";
  }
}

// Legge il corpo JSON con un tetto di byte: controlla prima il tipo, poi la dimensione, poi la sintassi
export async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(\s*;\s*charset=utf-8)?$/i.test(contentType.trim())) throw new HttpError(Errors.badBody);
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > maxBytes)) {
    throw new HttpError(Errors.payloadTooLarge);
  }
  if (!request.body) throw new HttpError(Errors.badBody);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(Errors.payloadTooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    throw new HttpError(Errors.badBody);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(Errors.badBody);
  return parsed as Record<string, unknown>;
}
