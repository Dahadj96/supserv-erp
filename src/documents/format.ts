/**
 * Screen 70 — "Formats: numbers, dates and amount-in-words in the DOCUMENT
 * language."
 *
 * Not the user's language. LAW 4: the interface follows the person, documents
 * follow the counterparty. A French invoice to SADEG reads 1 250 000,00 whether
 * the person who pressed the button was working in English or not.
 */

/** 1 250 000,00 in French; 1,250,000.00 in English. */
export function money(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-DZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** 02/09/2026 in French; 02 Sep 2026 in English. */
export function shortDate(value: Date | string, locale: string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-DZ", {
    day: "2-digit",
    month: locale === "en" ? "short" : "2-digit",
    year: "numeric",
  }).format(date);
}

/** "Adrar, le 21 août 2026" — the dateline an Algerian document opens with. */
export function dateline(place: string | null, value: Date, locale: string): string {
  const long = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-DZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
  if (!place) return locale === "en" ? long : long;
  return locale === "en" ? `${place}, ${long}` : `${place}, le ${long}`;
}

/** 19 % in French (with the space French typography requires), 19% in English. */
export function percent(rate: number, locale: string): string {
  const n = new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-DZ", {
    maximumFractionDigits: 3,
  }).format(rate);
  return locale === "en" ? `${n}%` : `${n} %`;
}
