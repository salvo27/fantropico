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

// Istante UTC della mezzanotte italiana del giorno di `now` (Roma è UTC+1 o UTC+2; i cambi d'ora non cadono a mezzanotte)
export function romeDayStart(now: Date): Date {
  const day = romeDay(now);
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  for (const offsetHours of [2, 1]) {
    const candidate = new Date(Date.UTC(year, month - 1, date) - offsetHours * 3_600_000);
    if (romeDay(candidate) === day && romeDay(new Date(candidate.getTime() - 1)) !== day) return candidate;
  }
  throw new Error("Rome midnight not found");
}

// "YYYY-MM"
export function romeMonth(now: Date): string {
  return romeDay(now).slice(0, 7);
}

// "6 novembre 2026", per i testi mostrati agli utenti e al modello
export function romeLongDate(now: Date): string {
  return ROME_LONG_DATE.format(now);
}
