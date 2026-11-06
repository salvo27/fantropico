// Una risposta vale come regola solo se cita articoli che esistono davvero nel regolamento (fail closed)

import type { RulebookText } from "./primitives";

const NUMBER = /\d+(?:\.\d+)*/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "1" non deve combaciare con "11", "2.1" o "1.5": il numero non può far parte di un altro numero
function containsNumber(rulebook: string, number: string): boolean {
  return new RegExp(`(?<!\\d)(?<!\\d\\.)${escapeRegExp(number)}(?!\\d)(?!\\.\\d)`).test(rulebook);
}

function normalizeSpaces(value: string): string {
  return value.toLocaleLowerCase("it-IT").replace(/\s+/g, " ").trim();
}

export function verifiedArticles(articles: readonly string[], rulebook: RulebookText): string[] {
  const lowerRulebook = normalizeSpaces(rulebook.value);
  return articles.filter((article) => {
    const numbers = article.match(NUMBER);
    if (numbers) return numbers.every((number) => containsNumber(rulebook.value, number));
    const text = normalizeSpaces(article);
    return text.length > 0 && lowerRulebook.includes(text);
  });
}
