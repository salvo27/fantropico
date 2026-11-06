import { describe, expect, it } from "vitest";
import { isTrustedHost, toTrustedSource } from "../src/llm/sources";

describe("toTrustedSource", () => {
  it("accetta https su fantacalcio.it e sui sottodomini", () => {
    expect(toTrustedSource("https://www.fantacalcio.it/probabili-formazioni-serie-a", "Probabili formazioni")).toEqual({
      url: "https://www.fantacalcio.it/probabili-formazioni-serie-a",
      title: "Probabili formazioni",
    });
    expect(toTrustedSource("https://fantacalcio.it/quotazioni", "Quotazioni")?.url).toBe("https://fantacalcio.it/quotazioni");
    expect(toTrustedSource("https://leghe.fantacalcio.it/lega/rose", "Rose")?.url).toBe("https://leghe.fantacalcio.it/lega/rose");
  });

  it("normalizza host maiuscolo e porta 443 implicita", () => {
    expect(toTrustedSource("https://WWW.FANTACALCIO.IT/x", "t")?.url).toBe("https://www.fantacalcio.it/x");
    expect(toTrustedSource("https://www.fantacalcio.it:443/x", "t")?.url).toBe("https://www.fantacalcio.it/x");
  });

  it("rifiuta schemi, domini simili, porte e credenziali", () => {
    const rejected = [
      "http://www.fantacalcio.it/x",
      "https://fantacalcio.it.evil.com/x",
      "https://notfantacalcio.it/x",
      "https://fantacalcio.itx/x",
      "https://www.fantacalcio.it:8443/x",
      "https://user:pw@www.fantacalcio.it/x",
      "https://user@www.fantacalcio.it/x",
      "https://fantacalcio.it./x",
      "javascript:alert(1)//fantacalcio.it",
      "data:text/html,fantacalcio.it",
      "ftp://fantacalcio.it/x",
      "//fantacalcio.it/x",
      "fantacalcio.it/x",
      "https://xn--fantacalco-c1a.it/x",
    ];
    for (const url of rejected) expect(toTrustedSource(url, "t"), url).toBeNull();
  });

  it("rifiuta valori non stringa, vuoti, con spazi o caratteri di controllo", () => {
    for (const url of [undefined, null, 42, {}, [], "", " https://fantacalcio.it/x", "https://fantacalcio.it/a b", "https://fantacalcio.it/\u0000"]) {
      expect(toTrustedSource(url, "t")).toBeNull();
    }
  });

  it("rispetta il limite di 500 caratteri", () => {
    const base = "https://www.fantacalcio.it/";
    expect(toTrustedSource(base + "a".repeat(500 - base.length), "t")).not.toBeNull();
    expect(toTrustedSource(base + "a".repeat(501 - base.length), "t")).toBeNull();
    expect(toTrustedSource(base + "a".repeat(100_000), "t")).toBeNull();
  });

  it("ripulisce e tronca il titolo, con il dominio come ripiego", () => {
    expect(toTrustedSource("https://www.fantacalcio.it/x", null)?.title).toBe("www.fantacalcio.it");
    expect(toTrustedSource("https://www.fantacalcio.it/x", "   ")?.title).toBe("www.fantacalcio.it");
    expect(toTrustedSource("https://www.fantacalcio.it/x", "Riga\nnuova‮abc")?.title).toBe("Riga nuova abc");
    const title = toTrustedSource("https://www.fantacalcio.it/x", "t".repeat(300))?.title ?? "";
    expect([...title].length).toBe(120);
    expect(title.endsWith("…")).toBe(true);
    expect(toTrustedSource("https://www.fantacalcio.it/x", "t".repeat(120))?.title).toBe("t".repeat(120));
  });
});

describe("isTrustedHost", () => {
  it("confronta il dominio esatto o i sottodomini", () => {
    expect(isTrustedHost("fantacalcio.it")).toBe(true);
    expect(isTrustedHost("a.b.fantacalcio.it")).toBe(true);
    expect(isTrustedHost("evilfantacalcio.it")).toBe(false);
    expect(isTrustedHost("fantacalcio.it.evil.com")).toBe(false);
  });
});
