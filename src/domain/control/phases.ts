/**
 * The eight phases of `docs/PLAN.md` §7, and what each one was done when.
 *
 * Here rather than only in the plan because screen 31 shows it, and a screen
 * reading a markdown file at request time would be reading a document that can
 * be edited without anybody noticing the screen changed.
 */
export const PHASES = [
  { n: "0", key: "shell" },
  { n: "1", key: "records" },
  { n: "2", key: "capture" },
  { n: "3", key: "documents" },
  { n: "4", key: "sell" },
  { n: "5", key: "money" },
  { n: "6", key: "organisation" },
  { n: "7", key: "control" },
] as const;

export type Phase = (typeof PHASES)[number];
