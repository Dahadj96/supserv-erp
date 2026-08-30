import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { logIntlError, messageFallback } from "./fallback";
import { routing } from "./routing";

/**
 * A MISSING MESSAGE MUST NOT TAKE A SCREEN DOWN.
 *
 * next-intl's default is to throw MISSING_MESSAGE out of `t()`, which in a
 * server component is a 500 on the whole route. That is not a missing label,
 * it is an outage - and this project has shipped it twice, most memorably when
 * `deals.filters.${badge}` was built by hand and /deals threw for every deal
 * that had been won.
 *
 * Two tests hunt these before they ship: `messages.test.ts` resolves every
 * literal key used in the interface, and a screen that builds a key from a
 * value is meant to go through a lookup function with its own exhaustive test.
 * Neither can catch a key assembled from data at runtime, and on 297 template
 * call sites there will eventually be one.
 *
 * So this is the last line of defence, and it is deliberately NOT silent:
 *
 *   - the key path renders in place of the label, in brackets, so whoever is
 *     looking at the screen can see which key is missing and report it in
 *     words that lead straight to the fix,
 *   - the failure is logged on the server with its code,
 *   - and the rest of the page renders.
 *
 * A blank string was the other option. Blank is how a missing label survives
 * for months: nobody can describe what they are not seeing.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,

    // MISSING_MESSAGE is one label. INSUFFICIENT_PATH and INVALID_KEY are
    // structural - a namespace read as a string, a key name containing a dot -
    // and break more than the screen that tripped over them. Same log, because
    // the code is in it and the code is the difference.
    onError: logIntlError,
    getMessageFallback: messageFallback,
  };
});
