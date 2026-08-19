import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Next 16 renamed the `middleware` file convention to `proxy`. This is what
 * puts every route under `/[locale]/` and redirects `/` to `/fr`.
 */
export default createMiddleware(routing);

export const config = {
  // Everything except Next internals, the API, and anything with a file
  // extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
