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

    /**
     * Vitest's default hook timeout is 10 s, which is a thin margin for a
     * `beforeAll` that talks to a real Postgres on a mini PC under the desk in
     * Adrar — `setup.test.ts` blew through it once on a full run and passed on
     * its own seconds later.
     *
     * Raised rather than retried. A flaky test is a test that cries wolf, and
     * the second time somebody sees this file go red they will assume it is the
     * machine again and be wrong.
     */
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
});
