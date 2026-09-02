import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * The response headers every page carries. The ERP is reached through a
 * Cloudflare tunnel from browsers on the open internet, and none of these
 * costs a feature: nothing here is meant to be framed by another site, sniffed
 * into a different type, or allowed a camera.
 *
 * No script-src CSP yet — Next's own inline bootstrap needs a nonce scheme to
 * live under one, and a half-done CSP is a page that loads blank on a phone.
 * `frame-ancestors` is the one CSP directive that costs nothing, so it is set.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Same origin, not none: screen 18 shows the PDF in an <object> on the page.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Ignored over plain http (the mini PC on the LAN), honoured behind the
  // tunnel where every request is already https.
  { key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },

  /**
   * `output: "standalone"` is deliberately NOT set, and must not be re-added
   * without changing how the server is launched.
   *
   * Standalone was here for a container image that was never built: the ERP
   * runs straight from this directory on the mini PC, started by the
   * "SUPSERV ERP" scheduled task, with node_modules already present. With
   * standalone set, `next start` refuses ("does not work with output:
   * standalone") and the only supported entry point becomes
   * `node .next/standalone/server.js`, which does NOT read `.env` -- so
   * DATABASE_URL, BETTER_AUTH_SECRET and MS_CLIENT_SECRET would all have to be
   * injected into SYSTEM's environment instead. See docs/SERVER.md.
   */

  // typedRoutes is off on purpose: every route is under `/[locale]/`, so almost
  // every redirect is a template string that the generated Route union cannot
  // accept. next-intl's own Link/redirect already keep the locale correct.
  typedRoutes: false,

  /**
   * The dev server refuses cross-origin requests for its own assets unless the
   * origin is named here — so reaching `next dev` through a tunnel at
   * erp.supserv-dz.com loads the page and then fails to load a single script,
   * which looks like a broken app rather than a blocked origin.
   *
   * Only ever the dev server. A production build serves its assets from the
   * same origin and does not consult this list. See docs/REMOTE-ACCESS.md.
   */
  allowedDevOrigins: ["erp.supserv-dz.com", "*.supserv-dz.com", "*.ts.net"],

  /**
   * Kept for the day someone builds a container image; inert while `output`
   * is unset, because nothing copies the traced files anywhere.
   *
   * The local storage driver reads and writes paths built at runtime, which
   * Turbopack cannot follow — so it traces the whole project "to be safe"
   * and the image doubles. The paths below are never needed at runtime.
   * `.data` in particular is the uploaded-files volume itself, which must not
   * be baked into an image.
   */
  outputFileTracingExcludes: {
    "**/*": [
      "./.data/**",
      "./docs/**",
      "./tests/**",
      "./.git/**",
      "./node_modules/@biomejs/**",
      "./node_modules/@playwright/**",
      "./node_modules/typescript/**",
    ],
  },
};

export default withNextIntl(nextConfig);
