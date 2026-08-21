/**
 * Screen 38 — Safety rails. "the same rules the assistant obeys."
 *
 * These are not settings. Three of the five are marked Enforced on the screen,
 * which means they are not switchable, and the way to make that true is to keep
 * them here as constants rather than as rows somebody can edit.
 *
 * The other two are On, and could one day be configurable. They are still here,
 * because the moment they move into the database is the moment somebody turns
 * one off at 18:00 to get a batch through.
 */

/**
 * "Nothing is auto-created below 85% confidence."
 *
 * Below this, a rule marked `auto` is downgraded to `suggest`. It is not
 * discarded — a 60% guess is still the best lead a person has, it just does not
 * get to write to the database on its own.
 */
export const AUTO_CREATE_FLOOR = 0.85;

/** "Nothing is ever auto-deleted." Enforced — there is no code path that could. */
export const NEVER_AUTO_DELETE = true;

/** "Nothing is auto-replied to a client." Enforced. Drafts, never sends. */
export const NEVER_AUTO_REPLY = true;

/** "Original email kept as the archive." Always. The parse is a derived view. */
export const ORIGINAL_ALWAYS_KEPT = true;

/** "Unmatched mail goes to Needs review." Never silently dropped. */
export const UNMATCHED_TO_NEEDS_REVIEW = true;

export type RailKey =
  | "confidenceFloor"
  | "neverAutoDelete"
  | "neverAutoReply"
  | "originalKept"
  | "unmatchedToReview";

export type Rail = {
  key: RailKey;
  /** enforced = not switchable, ever. on = currently on. */
  state: "enforced" | "on";
};

/** What screen 38 lists, in the order it lists them. */
export const SAFETY_RAILS: Rail[] = [
  { key: "confidenceFloor", state: "on" },
  { key: "neverAutoDelete", state: "enforced" },
  { key: "neverAutoReply", state: "enforced" },
  { key: "originalKept", state: "enforced" },
  { key: "unmatchedToReview", state: "on" },
];
