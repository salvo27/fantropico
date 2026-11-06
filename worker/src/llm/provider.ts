// Interfaccia neutra verso il fornitore del modello: il resto del Worker non vede i tipi dell'SDK

import type { AnthropicApiKey, PlayerName, Question, RulebookText } from "../domain/primitives";
import type { Result } from "../domain/result";

export type RuleAnswer =
  | { readonly kind: "answered"; readonly text: string; readonly articles: readonly string[]; readonly controversial: boolean }
  | { readonly kind: "not_covered" };

export interface Source {
  readonly url: string;
  readonly title: string;
}

export type InjuryOpinion =
  | { readonly kind: "opinion"; readonly text: string; readonly sources: readonly Source[] }
  | { readonly kind: "not_found" };

export type LlmFailure = "invalid_key" | "rate_limited" | "overloaded" | "refused" | "unavailable" | "bad_output";

export interface RuleQuestionInput {
  readonly rulebook: RulebookText;
  readonly question: Question;
  readonly today: string;
  readonly injuryCheckEnabled: boolean;
}

export interface InjuryCheckInput {
  readonly rulebook: RulebookText;
  readonly injured: PlayerName;
  readonly replacement: PlayerName;
  readonly today: string;
}

export interface LlmProvider {
  validateKey(): Promise<Result<void, LlmFailure>>;
  answerRuleQuestion(input: RuleQuestionInput): Promise<Result<RuleAnswer, LlmFailure>>;
  checkInjurySubstitution(input: InjuryCheckInput): Promise<Result<InjuryOpinion, LlmFailure>>;
}

export type LlmProviderFactory = (apiKey: AnthropicApiKey) => LlmProvider;
