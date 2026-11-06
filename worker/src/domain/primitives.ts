// Primitive di dominio (lezioni 03, 05, 06): un oggetto esiste solo se è valido.
// Validazione nell'ordine: tipo, dimensione, caratteri, formato. La semantica spetta alle entità.

import { invalid, ok, type Field, type InvalidInput, type Result } from "./result";
import { codePointLength, hasForbiddenChars, hasRepeatedSpaces, isString } from "./text";

const LATIN_NAME_CHARS = /^[\p{Script=Latin}0-9][\p{Script=Latin}0-9 '’.\-_!&()]*$/u;
const MEMBER_NAME_CHARS = /^[\p{Script=Latin}0-9][\p{Script=Latin}0-9 '’.\-_]*$/u;
const PLAYER_NAME_CHARS = /^\p{Script=Latin}[\p{Script=Latin} '’.\-]*$/u;
const JOIN_CODE_FORMAT = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const API_KEY_FORMAT = /^sk-ant-[A-Za-z0-9_-]{20,250}$/;
const UUID_V4_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RULEBOOK_MIN_LENGTH = 200;
export const RULEBOOK_MAX_LENGTH = 150_000;
export const QUESTION_MAX_LENGTH = 600;
export const DAILY_LIMIT_MIN = 1;
export const DAILY_LIMIT_MAX = 100;
export const DAILY_LIMIT_DEFAULT = 20;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

interface TextRules {
  readonly field: Field;
  readonly min: number;
  readonly max: number;
  readonly normalization: "NFC" | "NFKC";
  readonly pattern?: RegExp;
  readonly singleSpaces?: boolean;
}

// Controllo economico sulla lunghezza grezza prima di normalizzare (evita input enormi)
function parseText(raw: unknown, rules: TextRules): Result<string, InvalidInput> {
  if (!isString(raw)) return invalid(rules.field);
  if (raw.length > rules.max * 4) return invalid(rules.field);
  const value = raw.normalize(rules.normalization).trim();
  const length = codePointLength(value);
  if (length < rules.min || length > rules.max) return invalid(rules.field);
  if (hasForbiddenChars(value)) return invalid(rules.field);
  if (rules.singleSpaces && hasRepeatedSpaces(value)) return invalid(rules.field);
  if (rules.pattern && !rules.pattern.test(value)) return invalid(rules.field);
  return ok(value);
}

export class LeagueName {
  private readonly kind = "LeagueName";
  private constructor(readonly value: string) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<LeagueName, InvalidInput> {
    const text = parseText(raw, { field: "leagueName", min: 3, max: 40, normalization: "NFKC", pattern: LATIN_NAME_CHARS, singleSpaces: true });
    return text.ok ? ok(new LeagueName(text.value)) : text;
  }
}

export class MemberName {
  private readonly kind = "MemberName";
  // Chiave per l'unicità nella lega: "Mario" e "mario" sono lo stesso nome
  readonly key: string;
  private constructor(readonly value: string) {
    this.key = value.toLocaleLowerCase("it-IT");
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<MemberName, InvalidInput> {
    const text = parseText(raw, { field: "memberName", min: 2, max: 24, normalization: "NFKC", pattern: MEMBER_NAME_CHARS, singleSpaces: true });
    return text.ok ? ok(new MemberName(text.value)) : text;
  }
}

export class PlayerName {
  private readonly kind = "PlayerName";
  private constructor(readonly value: string) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<PlayerName, InvalidInput> {
    const text = parseText(raw, { field: "playerName", min: 2, max: 40, normalization: "NFKC", pattern: PLAYER_NAME_CHARS, singleSpaces: true });
    return text.ok ? ok(new PlayerName(text.value)) : text;
  }
}

export class JoinCode {
  private readonly kind = "JoinCode";
  private constructor(readonly value: string) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<JoinCode, InvalidInput> {
    if (!isString(raw) || raw.length > 32) return invalid("joinCode");
    const value = raw.trim().toUpperCase();
    if (!JOIN_CODE_FORMAT.test(value)) return invalid("joinCode");
    return ok(new JoinCode(value));
  }
  // 32 simboli: ogni byte casuale modulo 32 resta uniforme (256 è multiplo di 32)
  static generate(): JoinCode {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let value = "";
    for (const byte of bytes) value += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
    return new JoinCode(value);
  }
}

export class Question {
  private readonly kind = "Question";
  private constructor(readonly value: string) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<Question, InvalidInput> {
    const text = parseText(raw, { field: "question", min: 3, max: QUESTION_MAX_LENGTH, normalization: "NFC" });
    return text.ok ? ok(new Question(text.value)) : text;
  }
}

export class RulebookText {
  private readonly kind = "RulebookText";
  private constructor(readonly value: string) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<RulebookText, InvalidInput> {
    const text = parseText(raw, { field: "rulebook", min: RULEBOOK_MIN_LENGTH, max: RULEBOOK_MAX_LENGTH, normalization: "NFC" });
    return text.ok ? ok(new RulebookText(text.value)) : text;
  }
  // Testo già validato in scrittura e protetto dal CHECK di D1: in lettura solo tipo e dimensione,
  // così un regolamento salvato resta leggibile anche se un domani le regole diventano più severe
  static fromStored(raw: unknown): Result<RulebookText, InvalidInput> {
    if (!isString(raw) || raw.length === 0 || raw.length > RULEBOOK_MAX_LENGTH * 2) return invalid("rulebook");
    return ok(new RulebookText(raw));
  }
}

export class DailyLimit {
  private readonly kind = "DailyLimit";
  private constructor(readonly value: number) {
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<DailyLimit, InvalidInput> {
    if (typeof raw !== "number" || !Number.isInteger(raw)) return invalid("dailyLimit");
    if (raw < DAILY_LIMIT_MIN || raw > DAILY_LIMIT_MAX) return invalid("dailyLimit");
    return ok(new DailyLimit(raw));
  }
  static default(): DailyLimit {
    return new DailyLimit(DAILY_LIMIT_DEFAULT);
  }
}

abstract class Uuid {
  protected constructor(readonly value: string) {}
  protected static isValid(raw: unknown): raw is string {
    return isString(raw) && raw.length === 36 && UUID_V4_FORMAT.test(raw);
  }
  equals(other: Uuid): boolean {
    return other.constructor === this.constructor && other.value === this.value;
  }
}

export class LeagueId extends Uuid {
  private readonly kind = "LeagueId";
  private constructor(value: string) {
    super(value);
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<LeagueId, InvalidInput> {
    return Uuid.isValid(raw) ? ok(new LeagueId(raw)) : invalid("id");
  }
  static generate(): LeagueId {
    return new LeagueId(crypto.randomUUID());
  }
}

export class MemberId extends Uuid {
  private readonly kind = "MemberId";
  private constructor(value: string) {
    super(value);
    Object.freeze(this);
  }
  static parse(raw: unknown): Result<MemberId, InvalidInput> {
    return Uuid.isValid(raw) ? ok(new MemberId(raw)) : invalid("id");
  }
  static generate(): MemberId {
    return new MemberId(crypto.randomUUID());
  }
}

export type Role = "admin" | "member";

export function parseRole(raw: unknown): Result<Role, InvalidInput> {
  return raw === "admin" || raw === "member" ? ok(raw) : invalid("id");
}

const REDACTED = "[REDACTED]";

// Oggetto a lettura singola (lezione 06): il valore si legge una volta e poi viene dimenticato,
// e non finisce mai in log o JSON per errore
abstract class ReadOnce {
  #value: string | null;
  protected constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    const value = this.#value;
    if (value === null) throw new Error("Sensitive value already read");
    this.#value = null;
    return value;
  }
  // Controllo interno che non consuma la lettura e non restituisce il valore
  protected check(predicate: (value: string) => boolean): boolean {
    if (this.#value === null) throw new Error("Sensitive value already read");
    return predicate(this.#value);
  }
  toString(): string {
    return REDACTED;
  }
  toJSON(): string {
    return REDACTED;
  }
}

// Confronto senza maiuscole, spazi e punteggiatura: "Lega di Prova" e "legadiprova" coincidono
function compact(value: string): string {
  return value.toLocaleLowerCase("it-IT").replace(/[^\p{L}\p{N}]/gu, "");
}

const WEAK_PASSWORD_WORDS = ["fantacalcio", "fantropico", "password", "12345678"];
const MIN_PERSONAL_WORD_LENGTH = 3;

export class AdminPassword extends ReadOnce {
  private readonly kind = "AdminPassword";
  static parse(raw: unknown): Result<AdminPassword, InvalidInput> {
    const text = parseText(raw, { field: "password", min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH, normalization: "NFKC" });
    return text.ok ? ok(new AdminPassword(text.value)) : invalid("password");
  }
  // Validazione semantica per le password nuove: niente parole ovvie o dati della lega
  isWeak(personalWords: readonly string[]): boolean {
    return this.check((value) => {
      const password = compact(value);
      if (new Set(value).size === 1) return true;
      const words = [...WEAK_PASSWORD_WORDS, ...personalWords.map(compact).filter((w) => w.length >= MIN_PERSONAL_WORD_LENGTH)];
      return words.some((word) => password.includes(word));
    });
  }
}

export class AnthropicApiKey extends ReadOnce {
  private readonly kind = "AnthropicApiKey";
  static parse(raw: unknown): Result<AnthropicApiKey, InvalidInput> {
    if (!isString(raw) || raw.length > 300) return invalid("apiKey");
    const value = raw.trim();
    if (!API_KEY_FORMAT.test(value)) return invalid("apiKey");
    return ok(new AnthropicApiKey(value));
  }
}
