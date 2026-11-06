// Controlli lessicali comuni: dimensione, codifica e caratteri ammessi

// Caratteri di controllo esclusi tab e a capo, compresi i C1
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
// Caratteri che invertono la direzione del testo (possono mascherare il contenuto)
const BIDI_CHARS = /[‪-‮⁦-⁩]/u;

export function isString(raw: unknown): raw is string {
  return typeof raw === "string";
}

export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

export function hasForbiddenChars(value: string): boolean {
  return !value.isWellFormed() || CONTROL_CHARS.test(value) || BIDI_CHARS.test(value);
}

export function hasRepeatedSpaces(value: string): boolean {
  return value.includes("  ");
}
