import { defineRouting } from "next-intl/routing";

/**
 * LAW 4 — three language axes, never merged. This one is the INTERFACE axis:
 * it follows the person (`user_preference.ui_locale`). Documents follow the
 * counterparty (`party.doc_locale`) and are resolved in `src/documents/`,
 * never here.
 *
 * French is the default because that is what the office runs on. Arabic is not
 * drawn yet, but every layout uses logical properties so adding it is config.
 */
export const routing = defineRouting({
  locales: ["fr", "en"],
  defaultLocale: "fr",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
