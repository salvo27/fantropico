// Chiamate al Worker. I messaggi d'errore arrivano già in italiano dal server.

import { clearSession, getSession } from "./session.js";

const API_BASE = import.meta.env.VITE_API_BASE.replace(/\/+$/, "");
const TIMEOUT_MS = 150_000;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NETWORK_MESSAGE = "Non riesco a contattare il server. Controlla la connessione e riprova.";

export async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const session = getSession();
  if (auth && session) headers.Authorization = `Bearer ${session.token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, "network", NETWORK_MESSAGE);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // risposta senza JSON
  }

  if (!response.ok) {
    const code = typeof data?.error?.code === "string" ? data.error.code : "unknown";
    const message = typeof data?.error?.message === "string" ? data.error.message : "Si è verificato un errore. Riprova più tardi.";
    if (code === "unauthorized" && auth && session) {
      clearSession();
      window.dispatchEvent(new CustomEvent("fantropico:logout"));
    }
    throw new ApiError(response.status, code, message);
  }
  return data;
}
