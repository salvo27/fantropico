import { describe, expect, it } from "vitest";
import { verifiedArticles } from "../src/domain/citations";
import { RulebookText } from "../src/domain/primitives";

const RULEBOOK = (() => {
  const text = [
    "Art. 1 Partecipanti",
    "La lega ha 10 partecipanti.",
    "Art. 2 Rose",
    "2.1 Ogni rosa ha 25 giocatori.",
    "2.4 Crediti minimi per completare la rosa.",
    "Art. 11 Premi",
    "Premessa: il regolamento vale per la stagione.",
    "Art.7 Formazioni",
  ].join("\n");
  const parsed = RulebookText.parse(text.padEnd(250, " .")); // oltre la lunghezza minima
  if (!parsed.ok) throw new Error("regolamento di test non valido");
  return parsed.value;
})();

describe("verifica degli articoli citati", () => {
  it("tiene gli articoli che esistono", () => {
    expect(verifiedArticles(["Art. 1", "Art. 2.1", "Art. 11", "articolo 2"], RULEBOOK)).toEqual(["Art. 1", "Art. 2.1", "Art. 11", "articolo 2"]);
  });

  it("riconosce il numero anche attaccato al punto di Art.", () => {
    expect(verifiedArticles(["Art. 7"], RULEBOOK)).toEqual(["Art. 7"]);
  });

  it("scarta gli articoli inventati", () => {
    expect(verifiedArticles(["Art. 99", "Art. 2.9", "Art. 12"], RULEBOOK)).toEqual([]);
  });

  it("un numero non combacia con una parte di un altro numero", () => {
    const parsed = RulebookText.parse("Art. 11 Premi\n2.1 Rose\n1.5 Quote\n".padEnd(250, " ."));
    if (!parsed.ok) throw new Error("regolamento di test non valido");
    // "1" compare solo dentro "11", "2.1" e "1.5"
    expect(verifiedArticles(["Art. 1"], parsed.value)).toEqual([]);
    expect(verifiedArticles(["Art. 2"], parsed.value)).toEqual([]);
    expect(verifiedArticles(["Art. 11"], parsed.value)).toEqual(["Art. 11"]);
  });

  it("con più numeri devono esistere tutti", () => {
    expect(verifiedArticles(["Art. 2, comma 2.4"], RULEBOOK)).toEqual(["Art. 2, comma 2.4"]);
    expect(verifiedArticles(["Art. 2, comma 2.8"], RULEBOOK)).toEqual([]);
  });

  it("gli articoli senza numero valgono se il testo compare, senza maiuscole", () => {
    expect(verifiedArticles(["Premessa"], RULEBOOK)).toEqual(["Premessa"]);
    expect(verifiedArticles(["PREMESSA"], RULEBOOK)).toEqual(["PREMESSA"]);
    expect(verifiedArticles(["Disposizioni finali"], RULEBOOK)).toEqual([]);
    expect(verifiedArticles(["   "], RULEBOOK)).toEqual([]);
  });

  it("i caratteri speciali nel testo citato non rompono la ricerca", () => {
    expect(verifiedArticles(["Art. (.*)"], RULEBOOK)).toEqual([]);
    expect(verifiedArticles(["[a-z]+"], RULEBOOK)).toEqual([]);
  });
});
