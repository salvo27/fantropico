// Il giorno e il mese delle leghe seguono l'ora italiana, non UTC

const ROME_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const ROME_LONG_DATE = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "numeric",
  month: "long",
  year: "numeric",
});

// "YYYY-MM-DD"
export function romeDay(now: Date): string {
  return ROME_DATE.format(now);
}

// "YYYY-MM"
export function romeMonth(now: Date): string {
  return romeDay(now).slice(0, 7);
}

// "6 novembre 2026", per i testi mostrati agli utenti e al modello
export function romeLongDate(now: Date): string {
  return ROME_LONG_DATE.format(now);
}
