/**
 * An email body, turned into text that is safe to put on a page.
 *
 * WHY NOT RENDER THE HTML. Because the HTML in this column was written by
 * whoever sent the email, and this application has no idea who that is. Half
 * the inbox is unsolicited: spam, blasts, and cold approaches from addresses
 * nobody has ever dealt with. Rendering that with `dangerouslySetInnerHTML`
 * hands a stranger a script tag inside a session belonging to the Gérant.
 *
 * Sanitising it instead — allowing "safe" tags — is the other common answer and
 * it is a losing game: the allow-list has to be right about every attribute,
 * every URL scheme, every nesting trick, forever. Text cannot execute. The
 * original message is still in Outlook, one click away, formatting intact, and
 * `webLink` on every row goes straight to it.
 *
 * So this is deliberately lossy. It is not a mail client and should not try.
 */

/** Entities common enough in real mail that leaving them raw looks broken. */
const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&rdquo;": "”",
  "&ldquo;": "“",
  "&eacute;": "é",
  "&egrave;": "è",
  "&agrave;": "à",
  "&ccedil;": "ç",
  "&euro;": "€",
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * Whether a body is HTML rather than the plain text some senders still use.
 *
 * A tag, not merely an angle bracket: plain-text mail is full of `<address@…>`
 * and `-->` in signatures, and treating those as markup mangles a message that
 * was perfectly readable to begin with.
 */
const HTML_TAGS =
  "html|head|body|div|p|br|hr|span|a|img|table|tbody|thead|tr|td|th|ul|ol|li|" +
  "h[1-6]|strong|b|em|i|u|font|center|blockquote|pre|style|script|meta|link";

export function looksLikeHtml(body: string): boolean {
  return new RegExp(`<(?:${HTML_TAGS})\\b[^>]*>`, "i").test(body);
}

/**
 * Stands in for a line break that came from a TAG.
 *
 * In HTML a newline in the source is whitespace, not a line break — a paragraph
 * wrapped at column 78 by a mail client is still one paragraph. Only `<br>` and
 * the end of a block element actually break a line.
 *
 * Once the tags are gone there is no way left to tell the two apart, so the
 * real breaks are marked first, all whitespace is collapsed, and the marks
 * become newlines last. Doing it the other way round printed template mail
 * one word per line.
 */
const BREAK = "\u0001";

export function plainText(body: string | null): string {
  if (!body) return "";
  // Plain text was already laid out by whoever typed it. Leave it exactly so.
  if (!looksLikeHtml(body)) return body.trim();

  const marked = body
    // Script and style carry content that is not prose. Dropping the tags alone
    // would paste CSS into the middle of the message.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // The only breaks that are real. Marked now, restored last.
    .replace(/<br\s*\/?>/gi, BREAK)
    // `li` is deliberately absent: `<li>` already opens with a break, and
    // breaking on the close too put a blank line between every bullet.
    .replace(/<\/(p|div|tr|h[1-6]|blockquote|table|ul|ol)>/gi, BREAK)
    .replace(/<li\b[^>]*>/gi, `${BREAK}• `)
    .replace(/<\/td>\s*<td\b[^>]*>/gi, " • ")
    .replace(/<[^>]+>/g, "");

  return decode(marked)
    .replace(/\s+/g, " ")
    .replace(new RegExp(`\\s*${BREAK}\\s*`, "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The first line or so, for a list. Never the whole body: the point of a
 * preview is that it is shorter than opening the thing.
 */
export function preview(body: string | null, max = 180): string {
  const text = plainText(body).replace(/\n+/g, " ");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
