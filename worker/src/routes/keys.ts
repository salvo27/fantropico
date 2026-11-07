// Chiave API della lega: cifrata subito, decifrata solo quando serve, mai restituita

import type { Ctx } from "../app";
import { getSecrets } from "../db/leagues";
import type { AnthropicApiKey, LeagueId } from "../domain/primitives";
import { Errors } from "../http/errors";
import { HttpError } from "../http/http";
import type { LlmFailure, LlmProvider } from "../llm/provider";
import { decryptApiKey, encryptApiKey, type EncryptedSecret } from "../security/crypto";

function decryptFailed(): never {
  console.error(JSON.stringify({ event: "api_key_decrypt_failed" }));
  throw new HttpError(Errors.internal);
}

// Cifra la chiave appena ricevuta, la riapre dal cifrato e la verifica con il fornitore prima di salvarla
export async function sealAndCheckApiKey(ctx: Ctx, leagueId: LeagueId, apiKey: AnthropicApiKey): Promise<EncryptedSecret> {
  const masterKey = await ctx.encryptionKey();
  const sealed = await encryptApiKey(apiKey, leagueId, masterKey);
  const reopened = await decryptApiKey(sealed, leagueId, masterKey);
  if (!reopened.ok) decryptFailed();
  const check = await ctx.deps.llm(reopened.value).validateKey();
  if (!check.ok) throw new HttpError(check.error === "invalid_key" ? Errors.invalidApiKey : Errors.keyCheckUnavailable);
  return sealed;
}

export async function providerForLeague(ctx: Ctx, leagueId: LeagueId): Promise<LlmProvider> {
  const secrets = await getSecrets(ctx.db, leagueId);
  const apiKey = await decryptApiKey(secrets.apiKey, leagueId, await ctx.encryptionKey());
  if (!apiKey.ok) decryptFailed();
  return ctx.deps.llm(apiKey.value);
}

export function llmFailureError(failure: LlmFailure): HttpError {
  switch (failure) {
    case "invalid_key":
      return new HttpError(Errors.leagueApiKeyBroken);
    case "rate_limited":
    case "overloaded":
      return new HttpError(Errors.llmBusy);
    case "refused":
      return new HttpError(Errors.llmRefused);
    case "unavailable":
    case "bad_output":
    case "incomplete":
      return new HttpError(Errors.llmUnavailable);
  }
}
