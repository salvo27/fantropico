// Esito di un'operazione che può fallire in modo previsto (lezione 09: i fallimenti non sono eccezioni)
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Result<never, E> {
  return Object.freeze({ ok: false as const, error });
}

export type Field =
  | "leagueName"
  | "memberName"
  | "joinCode"
  | "question"
  | "rulebook"
  | "dailyLimit"
  | "injuryCheckEnabled"
  | "playerName"
  | "password"
  | "apiKey"
  | "id"
  | "body";

export interface InvalidInput {
  readonly kind: "invalid_input";
  readonly field: Field;
}

export function invalid(field: Field): Result<never, InvalidInput> {
  return err(Object.freeze({ kind: "invalid_input" as const, field }));
}
