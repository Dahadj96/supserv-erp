/**
 * What a screen shows instead of a label it cannot find, and what gets logged.
 *
 * Shared by BOTH sides on purpose. `onError` and `getMessageFallback` are
 * functions, so `NextIntlClientProvider` cannot inherit them from the server
 * request config the way it inherits messages and locale - they have to be
 * passed again on the client. Two copies of this rule would drift, and the
 * drift would show up as the same missing key rendering one way in a server
 * component and another way in the client component beside it.
 *
 * No "server-only" import here, and nothing may be added: this module is in
 * the client bundle.
 */

/**
 * The key path, in brackets. Not a blank string.
 *
 * Blank is how a missing label survives for months - a person cannot report
 * what they cannot see, and an empty table header looks like a design choice.
 * `[deals.filters.won]` on the screen is a sentence somebody can put in a
 * message, and it names the fix.
 */
export function messageFallback({ namespace, key }: { namespace?: string; key: string }): string {
  return `[${[namespace, key].filter(Boolean).join(".")}]`;
}

/** One line, with the code, because the code is what says how bad it is. */
export function logIntlError(error: { code: string; message?: string }): void {
  console.error(`[i18n] ${error.code}: ${error.message ?? ""}`);
}
