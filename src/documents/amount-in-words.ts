/**
 * Screen 70 — "Amount in words" is something THE ENGINE owns.
 *
 * An Algerian invoice carries the line
 *
 *   « Arrêtée la présente facture à la somme de : quatre-vingt-quatre mille
 *     deux cents dinars algériens et zéro centime »
 *
 * and it is the line a client reads when the figures are disputed. French
 * number agreement is genuinely fiddly — `quatre-vingts` takes an s alone but
 * not in `quatre-vingt-quatre`, `cent` takes one in `deux cents` but not in
 * `deux cent cinquante`, `mille` never takes one at all — so this file exists
 * on its own, with its own tests, rather than inside a template where a wrong
 * plural would go out on paper for a year before anybody noticed.
 */

const FR_UNITS = [
  "zéro",
  "un",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "treize",
  "quatorze",
  "quinze",
  "seize",
  "dix-sept",
  "dix-huit",
  "dix-neuf",
];

const FR_TENS = [
  "",
  "",
  "vingt",
  "trente",
  "quarante",
  "cinquante",
  "soixante",
  "soixante",
  "quatre-vingt",
  "quatre-vingt",
];

/**
 * 0–99, where French stops being arithmetic and starts being history.
 *
 * `terminal` is whether this group ENDS the whole number. It has to be threaded
 * through, because `quatre-vingts` keeps its s in "quatre-vingts dinars" and
 * loses it in "quatre-vingt mille" — the s survives only when no word follows.
 */
function frUnder100(n: number, terminal: boolean): string {
  if (n < 20) return FR_UNITS[n] as string;

  const tens = Math.floor(n / 10);
  const unit = n % 10;

  // 70–79 and 90–99 are counted in twenties: soixante-dix, quatre-vingt-dix.
  if (tens === 7 || tens === 9) {
    const base = FR_TENS[tens] as string;
    const rest = FR_UNITS[10 + unit] as string;
    // soixante et onze — but quatre-vingt-onze, never "quatre-vingt et onze".
    const joiner = tens === 7 && unit === 1 ? " et " : "-";
    return `${base}${joiner}${rest}`;
  }

  const base = FR_TENS[tens] as string;
  if (unit === 0) {
    // quatre-vingts takes its s only when nothing follows it at all —
    // "quatre-vingts dinars", but "quatre-vingt mille".
    return tens === 8 && terminal ? "quatre-vingts" : base;
  }
  // vingt et un, trente et un … but quatre-vingt-un, without "et".
  const joiner = unit === 1 && tens !== 8 ? " et " : "-";
  return `${base}${joiner}${FR_UNITS[unit]}`;
}

/** 0–999. `terminal` carries the same meaning as in `frUnder100`. */
function frUnder1000(n: number, terminal: boolean): string {
  if (n < 100) return frUnder100(n, terminal);

  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  // "cent" alone; "deux cents" with an s; "deux cent cinquante" without, and
  // "deux cent mille" without — the s survives only when the hundred is the
  // last word of the entire number.
  const plural = rest === 0 && terminal ? "s" : "";
  const head = hundreds === 1 ? "cent" : `${FR_UNITS[hundreds]} cent${plural}`;

  return rest === 0 ? head : `${head} ${frUnder100(rest, terminal)}`;
}

export function frenchNumberInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error("amountOutOfRange");
  if (n === 0) return "zéro";
  if (n >= 1_000_000_000_000) throw new Error("amountOutOfRange");

  const parts: string[] = [];

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  // milliard and million are nouns and take an s. mille is an adverb and never
  // does. And each group is terminal only if nothing comes after it — which is
  // what keeps "quatre-vingt mille" and "deux cent mille" free of their s.
  if (billions > 0) {
    const terminal = millions === 0 && thousands === 0 && rest === 0;
    parts.push(`${frUnder1000(billions, terminal)} milliard${billions > 1 ? "s" : ""}`);
  }
  if (millions > 0) {
    const terminal = thousands === 0 && rest === 0;
    parts.push(`${frUnder1000(millions, terminal)} million${millions > 1 ? "s" : ""}`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? "mille" : `${frUnder1000(thousands, false)} mille`);
  }
  if (rest > 0) parts.push(frUnder1000(rest, true));

  return parts.join(" ");
}

const EN_UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function enUnder1000(n: number): string {
  if (n < 20) return EN_UNITS[n] as string;
  if (n < 100) {
    const tens = EN_TENS[Math.floor(n / 10)] as string;
    const unit = n % 10;
    return unit === 0 ? tens : `${tens}-${EN_UNITS[unit]}`;
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${EN_UNITS[hundreds]} hundred`;
  return rest === 0 ? head : `${head} and ${enUnder1000(rest)}`;
}

export function englishNumberInWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error("amountOutOfRange");
  if (n === 0) return "zero";
  if (n >= 1_000_000_000_000) throw new Error("amountOutOfRange");

  const parts: string[] = [];
  const scales: [number, string][] = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1000, "thousand"],
  ];

  let left = n;
  for (const [size, name] of scales) {
    const count = Math.floor(left / size);
    if (count > 0) {
      parts.push(`${enUnder1000(count)} ${name}`);
      left -= count * size;
    }
  }
  if (left > 0) parts.push(enUnder1000(left));

  return parts.join(" ");
}

/**
 * The whole line, as it prints.
 *
 * Centimes are always stated, including when they are zero — an invoice that
 * says "et zéro centime" cannot be read as one where the centimes were left
 * off, and that difference matters when somebody is arguing about it.
 */
export function amountInWords(amount: number, locale: string, currency = "DZD"): string {
  const rounded = Math.round(amount * 100) / 100;
  const whole = Math.floor(rounded);
  const cents = Math.round((rounded - whole) * 100);

  if (locale === "en") {
    const unit = currency === "DZD" ? "Algerian dinar" : currency;
    const sub = currency === "DZD" ? "centime" : "cent";
    return `${englishNumberInWords(whole)} ${unit}${whole === 1 ? "" : "s"} and ${englishNumberInWords(
      cents,
    )} ${sub}${cents === 1 ? "" : "s"}`;
  }

  const unit = currency === "DZD" ? "dinar" : currency.toLowerCase();
  const qualifier = currency === "DZD" ? " algérien" : "";
  const plural = whole > 1 ? "s" : "";
  return `${frenchNumberInWords(whole)} ${unit}${plural}${qualifier}${plural} et ${frenchNumberInWords(
    cents,
  )} centime${cents > 1 ? "s" : ""}`;
}
