/**
 * Screen 59 — the closed vocabulary a template may use.
 *
 * A placeholder is `{group.field}` and nothing else. There is no expression, no
 * condition, no loop and no function call, for the same reason `routing_rule`
 * stores structured JSON rather than a string to evaluate: this text is edited
 * from a settings screen, and a template language with an evaluator is a way to
 * run code by saving a form.
 *
 * `resolvable` is the honest half. `us.*` and `me.*` come from data the system
 * already holds, so they fill in. Everything else needs a record the template is
 * being written FOR — a client, a deal, an invoice — and there is no such
 * record while somebody is editing wording in Settings. Those stay visible as
 * placeholders rather than resolving to an empty string, because a preview that
 * silently drops the client's name teaches you the template is fine.
 */

export type PlaceholderGroup = "us" | "me" | "client" | "deal" | "offer" | "invoice";

export type Placeholder = {
  /** The token, without braces. */
  name: string;
  group: PlaceholderGroup;
  /** Whether Settings can fill it in with no record in hand. */
  resolvable: boolean;
};

export const PLACEHOLDERS: Placeholder[] = [
  { name: "us.name", group: "us", resolvable: true },
  { name: "us.phone", group: "us", resolvable: true },
  { name: "us.email", group: "us", resolvable: true },
  { name: "us.website", group: "us", resolvable: true },
  { name: "us.address", group: "us", resolvable: true },
  { name: "us.rc", group: "us", resolvable: true },
  { name: "us.nif", group: "us", resolvable: true },

  { name: "me.name", group: "me", resolvable: true },
  { name: "me.email", group: "me", resolvable: true },

  { name: "client.name", group: "client", resolvable: false },
  { name: "client.contact", group: "client", resolvable: false },

  { name: "deal.reference", group: "deal", resolvable: false },
  { name: "deal.subject", group: "deal", resolvable: false },
  { name: "deal.deadline", group: "deal", resolvable: false },

  { name: "offer.number", group: "offer", resolvable: false },
  { name: "offer.total", group: "offer", resolvable: false },
  { name: "offer.validUntil", group: "offer", resolvable: false },

  { name: "invoice.number", group: "invoice", resolvable: false },
  { name: "invoice.total", group: "invoice", resolvable: false },
  { name: "invoice.dueDate", group: "invoice", resolvable: false },
  { name: "invoice.daysOverdue", group: "invoice", resolvable: false },
];

const KNOWN = new Set(PLACEHOLDERS.map((p) => p.name));

/**
 * `{` and `}` around a dotted name, nothing exotic. Anything that does not
 * match this is ordinary text and is left exactly as typed — a template that
 * mentions `{` in prose must not become a parse error.
 */
const TOKEN = /\{([a-z][a-zA-Z]*\.[a-z][a-zA-Z]*)\}/g;

export type Scan = {
  /** Every placeholder used, in order, without duplicates. */
  used: string[];
  /** Used and in the vocabulary. */
  known: string[];
  /** Used and NOT in the vocabulary — a typo, or a field nobody has added. */
  unknown: string[];
};

export function scan(text: string): Scan {
  const used: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const name = match[1] as string;
    if (!used.includes(name)) used.push(name);
  }
  return {
    used,
    known: used.filter((n) => KNOWN.has(n)),
    unknown: used.filter((n) => !KNOWN.has(n)),
  };
}

export type Values = Partial<Record<string, string | null>>;

export type Rendered = {
  text: string;
  /** Placeholders left standing, and why. Drives the preview's warning line. */
  left: { name: string; reason: "noRecord" | "unknown" | "empty" }[];
};

/**
 * Substitute what is known; leave the rest visible.
 *
 * Three ways a placeholder survives rendering, and the caller is told which:
 *   unknown   not in the vocabulary at all — almost always a typo
 *   noRecord  a real field, but this render had no record to read it from
 *   empty     a real field on a real record that is blank (no RC recorded yet)
 *
 * None of them becomes an empty string. A relance that silently loses the
 * invoice number is worse than one that visibly still says `{invoice.number}`,
 * because the second one gets fixed before it is sent.
 */
export function render(text: string, values: Values): Rendered {
  const left: Rendered["left"] = [];

  const out = text.replace(TOKEN, (whole, rawName) => {
    const name = rawName as string;

    if (!KNOWN.has(name)) {
      left.push({ name, reason: "unknown" });
      return whole;
    }
    if (!(name in values)) {
      left.push({ name, reason: "noRecord" });
      return whole;
    }
    const value = values[name];
    if (value === null || value === undefined || value === "") {
      left.push({ name, reason: "empty" });
      return whole;
    }
    return value;
  });

  return { text: out, left };
}
