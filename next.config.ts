import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The server runs in a container on a mini PC with no public IP; output
  // tracing keeps the production image small. See docs/SERVER.md.
  output: "standalone",
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
   * The local storage driver reads and writes paths built at runtime, which
   * Turbopack cannot follow — so it traces the whole project into the
   * standalone output "to be safe" and the image doubles.
   *
   * This is the standard answer: the paths below are never needed at runtime.
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
