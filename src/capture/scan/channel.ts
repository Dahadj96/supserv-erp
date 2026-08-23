/**
 * The key screen 38 lists this channel under, and screen 41 configures.
 *
 * It lives here rather than in the screen's `actions.ts` because a file marked
 * `"use server"` may export ONLY async functions — export a plain constant from
 * one and Next.js discards every export in the module, which shows up as
 * "the module has no exports at all" on a page that looks fine to TypeScript.
 */
export const SCAN_CHANNEL = "scan";
