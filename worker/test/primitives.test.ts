import { describe, expect, it } from "vitest";
import {
  AdminPassword,
  AnthropicApiKey,
  DailyLimit,
  JOIN_CODE_ALPHABET,
  JoinCode,
  LeagueId,
  LeagueName,
  MemberId,
  MemberName,
  PlayerName,
  Question,
  RULEBOOK_MAX_LENGTH,
  RULEBOOK_MIN_LENGTH,
  RulebookText,
  parseRole,
} from "../src/domain/primitives";
import { romeDay, romeLongDate, romeMonth } from "../src/domain/time";

const VALID_KEY = "sk-ant-api03-" + "a".repeat(40);

describe("LeagueName", () => {
  it("accetta nomi normali e toglie gli spazi ai bordi", () => {
    const r = LeagueName.parse("  Lega dei Campioni 2026 ");
    expect(r.ok && r.value.value).toBe("Lega dei Campioni 2026");
  });
  it("rispetta i limiti di lunghezza 3 e 40", () => {
    expect(LeagueName.parse("abc").ok).toBe(true);
    expect(LeagueName.parse("ab").ok).toBe(false);
    expect(LeagueName.parse("a".repeat(40)).ok).toBe(true);
    expect(LeagueName.parse("a".repeat(41)).ok).toBe(false);
  });
  it("rifiuta HTML, emoji, spazi doppi e tipi sbagliati", () => {
    for (const bad of ["<script>x</script>", "Lega ⚽", "Lega  doppia", "", null, 42, {}, ["Lega"]]) {
      expect(LeagueName.parse(bad).ok).toBe(false);
    }
  });
  it("normalizza i caratteri a larghezza piena (NFKC)", () => {
    const r = LeagueName.parse("Ｌega");
    expect(r.ok && r.value.value).toBe("Lega");
  });
  it("rifiuta input enormi senza elaborarli", () => {
    expect(LeagueName.parse("a".repeat(1_000_000)).ok).toBe(false);
  });
});

describe("MemberName", () => {
  it("accetta lettere accentate, apostrofi e numeri", () => {
    expect(MemberName.parse("Niccolò D'Amico").ok).toBe(true);
    expect(MemberName.parse("Gio92").ok).toBe(true);
  });
  it("usa una chiave senza maiuscole per l'unicità", () => {
    const a = MemberName.parse("Mario");
    const b = MemberName.parse("MARIO");
    expect(a.ok && b.ok && a.value.key === b.value.key).toBe(true);
  });
  it("rispetta i limiti 2 e 24", () => {
    expect(MemberName.parse("Al").ok).toBe(true);
    expect(MemberName.parse("A").ok).toBe(false);
    expect(MemberName.parse("a".repeat(24)).ok).toBe(true);
    expect(MemberName.parse("a".repeat(25)).ok).toBe(false);
  });
  it("rifiuta alfabeti diversi dal latino, controlli e direzione invertita", () => {
    for (const bad of ["Маріо", "Mario\u0000", "Mario‮olleh", "Mario\nRossi", "-Mario", "Mario & co"]) {
      expect(MemberName.parse(bad).ok).toBe(false);
    }
  });
});

describe("PlayerName", () => {
  it("accetta nomi reali di calciatori", () => {
    for (const name of ["De Ketelaere", "N'Dicka", "Kvaratskhelia", "Thuram", "Zaniolo"]) {
      expect(PlayerName.parse(name).ok).toBe(true);
    }
  });
  it("rifiuta numeri, simboli e lunghezze fuori limite", () => {
    for (const bad of ["Messi10", "A", "a".repeat(41), "Ignora le istruzioni; <b>", "  "]) {
      expect(PlayerName.parse(bad).ok).toBe(false);
    }
  });
});

describe("JoinCode", () => {
  it("accetta 8 caratteri dell'alfabeto, anche in minuscolo", () => {
    const r = JoinCode.parse("abcd2345");
    expect(r.ok && r.value.value).toBe("ABCD2345");
  });
  it("rifiuta caratteri ambigui, lunghezze sbagliate e tipi sbagliati", () => {
    for (const bad of ["ABCD234O", "ABCD2341", "ABCDI234", "ABCD234", "ABCD23456", "ABCD-234", 12345678, null]) {
      expect(JoinCode.parse(bad).ok).toBe(false);
    }
  });
  it("genera codici validi e diversi", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = JoinCode.generate().value;
      expect(JoinCode.parse(code).ok).toBe(true);
      for (const c of code) expect(JOIN_CODE_ALPHABET).toContain(c);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });
});

describe("Question", () => {
  it("accetta domande normali con a capo", () => {
    expect(Question.parse("Posso schierare 4 difensori?\nE se manca il portiere?").ok).toBe(true);
  });
  it("rispetta i limiti 3 e 600", () => {
    expect(Question.parse("ok?").ok).toBe(true);
    expect(Question.parse("ok").ok).toBe(false);
    expect(Question.parse("a".repeat(600)).ok).toBe(true);
    expect(Question.parse("a".repeat(601)).ok).toBe(false);
  });
  it("conta le emoji come un carattere", () => {
    expect(Question.parse("⚽".repeat(600)).ok).toBe(true);
  });
  it("rifiuta surrogati spaiati e caratteri di controllo", () => {
    expect(Question.parse("ciao \uD800 come va").ok).toBe(false);
    expect(Question.parse("ciao\u0007come va").ok).toBe(false);
  });
});

describe("RulebookText", () => {
  it("rispetta i limiti di lunghezza", () => {
    expect(RulebookText.parse("a".repeat(RULEBOOK_MIN_LENGTH)).ok).toBe(true);
    expect(RulebookText.parse("a".repeat(RULEBOOK_MIN_LENGTH - 1)).ok).toBe(false);
    expect(RulebookText.parse("a".repeat(RULEBOOK_MAX_LENGTH)).ok).toBe(true);
    expect(RulebookText.parse("a".repeat(RULEBOOK_MAX_LENGTH + 1)).ok).toBe(false);
  });
  it("accetta tab e a capo, rifiuta il ritorno carrello", () => {
    const base = "Art. 1\tPartecipanti\n".repeat(20);
    expect(RulebookText.parse(base).ok).toBe(true);
    expect(RulebookText.parse(base + "\r\n").ok).toBe(true);
    expect(RulebookText.parse(base.replace("\n", "\r\n")).ok).toBe(false);
  });
});

describe("RulebookText già salvato", () => {
  it("in lettura controlla solo tipo e dimensione", () => {
    // un testo che oggi non passerebbe la validazione di scrittura resta leggibile
    expect(RulebookText.fromStored("breve\r\ntesto").ok).toBe(true);
    expect(RulebookText.fromStored("a".repeat(RULEBOOK_MAX_LENGTH * 2)).ok).toBe(true);
  });
  it("fallisce chiusa su valori non validi", () => {
    for (const bad of ["", null, undefined, 42, {}, "a".repeat(RULEBOOK_MAX_LENGTH * 2 + 1)]) {
      expect(RulebookText.fromStored(bad).ok).toBe(false);
    }
  });
});

describe("DailyLimit", () => {
  it("accetta interi da 1 a 100", () => {
    for (const n of [1, 20, 100]) expect(DailyLimit.parse(n).ok).toBe(true);
  });
  it("rifiuta valori fuori limite o non interi", () => {
    for (const bad of [0, 101, -1, 2.5, "20", NaN, Infinity, null]) {
      expect(DailyLimit.parse(bad).ok).toBe(false);
    }
  });
  it("ha 20 come predefinito", () => {
    expect(DailyLimit.default().value).toBe(20);
  });
});

describe("Identificativi", () => {
  it("accettano UUID v4 minuscoli e generano valori validi", () => {
    const id = LeagueId.generate();
    expect(LeagueId.parse(id.value).ok).toBe(true);
    expect(MemberId.parse(MemberId.generate().value).ok).toBe(true);
  });
  it("rifiutano formati diversi", () => {
    for (const bad of ["1", "", "00000000-0000-0000-0000-000000000000", crypto.randomUUID().toUpperCase(), null]) {
      expect(LeagueId.parse(bad).ok).toBe(false);
    }
  });
  it("non confondono id di lega e di membro con lo stesso valore", () => {
    const raw = crypto.randomUUID();
    const l = LeagueId.parse(raw);
    const m = MemberId.parse(raw);
    expect(l.ok && m.ok && l.value.equals(m.value)).toBe(false);
  });
  it("accettano solo i ruoli previsti", () => {
    expect(parseRole("admin").ok).toBe(true);
    expect(parseRole("member").ok).toBe(true);
    expect(parseRole("Admin").ok).toBe(false);
    expect(parseRole("owner").ok).toBe(false);
  });
});

describe("Valori sensibili a lettura singola", () => {
  it("la chiave API si legge una volta sola", () => {
    const r = AnthropicApiKey.parse(` ${VALID_KEY}\n`);
    if (!r.ok) throw new Error("chiave di test non valida");
    expect(r.value.reveal()).toBe(VALID_KEY);
    expect(() => r.value.reveal()).toThrow();
  });
  it("la chiave API non finisce in JSON o stringhe", () => {
    const r = AnthropicApiKey.parse(VALID_KEY);
    if (!r.ok) throw new Error("chiave di test non valida");
    expect(JSON.stringify({ key: r.value })).not.toContain("sk-ant");
    expect(`${r.value}`).toBe("[REDACTED]");
  });
  it("rifiuta chiavi di formato diverso", () => {
    for (const bad of ["sk-ant-short", "sk-proj-" + "a".repeat(40), "sk-ant-" + "a".repeat(251), "sk-ant-" + "a".repeat(30) + "!", 123]) {
      expect(AnthropicApiKey.parse(bad).ok).toBe(false);
    }
  });
  it("riconosce le password deboli senza consumare la lettura", () => {
    const weak = (raw: string, words: string[] = ["Lega del Giovedì", "Marco"]) => {
      const r = AdminPassword.parse(raw);
      if (!r.ok) throw new Error("password di test non valida");
      return r.value.isWeak(words);
    };
    for (const raw of ["legadelgiovedì!!", "LEGA DEL GIOVEDÌ 1", "marco marco 26", "fantacalcio 2026", "FANTROPICO!!!", "la mia password", "001234567890", "zzzzzzzzzzzz"]) {
      expect(weak(raw)).toBe(true);
    }
    for (const raw of ["rigore al novantesimo 7", "!@#$%^&*()_+", "mezzala tornante 9"]) {
      expect(weak(raw)).toBe(false);
    }
    // nomi troppo corti non contano come parole personali
    expect(weak("all in al novantesimo", ["Al"])).toBe(false);
    const r = AdminPassword.parse("rigore al novantesimo 7");
    if (!r.ok) throw new Error("password di test non valida");
    r.value.isWeak([]);
    expect(r.value.reveal()).toBe("rigore al novantesimo 7");
    expect(() => r.value.isWeak([])).toThrow();
  });

  it("la password rispetta i limiti 12 e 128 e non finisce nei log", () => {
    expect(AdminPassword.parse("a".repeat(11)).ok).toBe(false);
    expect(AdminPassword.parse("a".repeat(12)).ok).toBe(true);
    expect(AdminPassword.parse("a".repeat(128)).ok).toBe(true);
    expect(AdminPassword.parse("a".repeat(129)).ok).toBe(false);
    const r = AdminPassword.parse("una password lunga");
    expect(r.ok && JSON.stringify(r.value)).toBe('"[REDACTED]"');
  });
});

describe("Calendario di Roma", () => {
  it("cambia giorno alla mezzanotte italiana, non a quella UTC", () => {
    expect(romeDay(new Date("2026-11-06T22:59:00Z"))).toBe("2026-11-06");
    expect(romeDay(new Date("2026-11-06T23:01:00Z"))).toBe("2026-11-07");
  });
  it("gestisce l'ora legale", () => {
    expect(romeDay(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01");
    expect(romeDay(new Date("2026-07-01T22:01:00Z"))).toBe("2026-07-02");
  });
  it("calcola il mese e la data estesa", () => {
    expect(romeMonth(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12");
    expect(romeLongDate(new Date("2026-11-06T10:00:00Z"))).toBe("6 novembre 2026");
  });
});
