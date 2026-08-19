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
};

export default withNextIntl(nextConfig);
