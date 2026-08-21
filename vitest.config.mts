import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests are pure and fast. Integration tests need the real Postgres,
 * because pg_trgm and unaccent are the thing under test — mocking them would
 * only prove that the mock works.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // The integration suite shares one database; parallel files would race on
    // the fixtures they insert and clean up.
    fileParallelism: false,
  },
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
});
