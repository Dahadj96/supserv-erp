import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The server runs in a container on a mini PC with no public IP; output
  // tracing keeps the production image small. See docs/SERVER.md.
  output: "standalone",
  typedRoutes: true,
};

export default withNextIntl(nextConfig);
