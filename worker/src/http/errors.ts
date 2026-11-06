// Errori mostrati agli utenti: codice stabile per il frontend e messaggio italiano fisso.
// Mai l'input dell'utente o dettagli tecnici nei messaggi (lezione 09).

import type { Field } from "../domain/result";

export type ErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "payload_too_large"
  | "wrong_code"
  | "wrong_credentials"
  | "name_taken"
  | "league_full"
  | "too_many_attempts"
  | "daily_limit_reached"
  | "no_rulebook"
  | "injury_check_disabled"
  | "invalid_api_key"
  | "league_api_key_broken"
  | "llm_busy"
  | "llm_refused"
  | "llm_unavailable"
  | "same_player"
  | "member_not_found"
  | "internal";

export interface AppError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
}

const FIELD_MESSAGES: Readonly<Record<Field, string>> = {
  leagueName: "Nome della lega non valido: usa da 3 a 40 caratteri tra lettere, numeri e spazi.",
  memberName: "Nome non valido: usa da 2 a 24 caratteri tra lettere, numeri, spazi, apostrofi, punti e trattini.",
  joinCode: "Il codice lega ha 8 caratteri tra lettere e numeri.",
  question: "La domanda deve avere da 3 a 600 caratteri.",
  rulebook: "Il regolamento deve avere da 200 a 150.000 caratteri, senza caratteri di controllo.",
  dailyLimit: "Il limite giornaliero deve essere un numero intero da 1 a 100.",
  injuryCheckEnabled: "Valore non valido per la verifica infortuni.",
  playerName: "Nome del giocatore non valido: usa da 2 a 40 lettere.",
  password: "La password deve avere da 12 a 128 caratteri.",
  apiKey: "La chiave API non ha il formato giusto: deve iniziare con sk-ant-.",
  id: "Richiesta non valida.",
  body: "Richiesta non valida.",
};

export function invalidField(field: Field): AppError {
  return { status: 400, code: "invalid_input", message: FIELD_MESSAGES[field] };
}

export const Errors = {
  unauthorized: { status: 401, code: "unauthorized", message: "Sessione non valida o scaduta. Entra di nuovo." },
  forbidden: { status: 403, code: "forbidden", message: "Non hai i permessi per questa operazione." },
  notFound: { status: 404, code: "not_found", message: "Risorsa non trovata." },
  methodNotAllowed: { status: 405, code: "method_not_allowed", message: "Operazione non consentita." },
  payloadTooLarge: { status: 413, code: "payload_too_large", message: "Richiesta troppo grande." },
  badBody: { status: 400, code: "invalid_input", message: "Richiesta non valida." },
  wrongCode: { status: 401, code: "wrong_code", message: "Codice lega non valido." },
  wrongCredentials: { status: 401, code: "wrong_credentials", message: "Codice lega o password non corretti." },
  wrongPassword: { status: 401, code: "wrong_credentials", message: "La password attuale non è corretta." },
  weakPassword: {
    status: 400,
    code: "invalid_input",
    message: "Password troppo facile: non usare il nome della lega, il tuo nome o parole come password e fantacalcio.",
  },
  nameTaken: { status: 409, code: "name_taken", message: "Questo nome è già usato nella lega. Scegline un altro." },
  leagueFull: { status: 409, code: "league_full", message: "La lega ha raggiunto il numero massimo di partecipanti." },
  tooManyAttempts: { status: 429, code: "too_many_attempts", message: "Troppi tentativi. Riprova tra qualche minuto." },
  dailyLimitReached: { status: 429, code: "daily_limit_reached", message: "Hai finito le domande di oggi. Riprova domani." },
  noRulebook: { status: 409, code: "no_rulebook", message: "L'admin non ha ancora caricato il regolamento." },
  injuryCheckDisabled: { status: 403, code: "injury_check_disabled", message: "La verifica infortuni non è attiva in questa lega." },
  invalidApiKey: { status: 400, code: "invalid_api_key", message: "La chiave API non è valida o non ha accesso al modello." },
  keyCheckUnavailable: { status: 502, code: "llm_unavailable", message: "Non riesco a verificare la chiave adesso. Riprova tra poco." },
  leagueApiKeyBroken: { status: 502, code: "league_api_key_broken", message: "La chiave API della lega non funziona: avvisa l'admin." },
  llmBusy: { status: 503, code: "llm_busy", message: "Il servizio è molto richiesto in questo momento. Riprova tra poco." },
  llmRefused: { status: 422, code: "llm_refused", message: "Il modello non ha potuto rispondere. Prova a riformulare la domanda." },
  llmUnavailable: { status: 502, code: "llm_unavailable", message: "Non sono riuscito a ottenere una risposta. Riprova tra poco." },
  samePlayer: { status: 400, code: "same_player", message: "I due giocatori devono essere diversi." },
  memberNotFound: { status: 404, code: "member_not_found", message: "Partecipante non trovato." },
  internal: { status: 500, code: "internal", message: "Si è verificato un errore. Riprova più tardi." },
} as const satisfies Record<string, AppError>;
