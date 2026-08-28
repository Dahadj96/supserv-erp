import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Screen 33 — the only row this screen creates.
 *
 * Everything the notifications page shows is computed: a deadline and a clock,
 * a due date and a balance, an approval request and its age. None of it is
 * stored, for the reason the whole system keeps returning to — a stored copy of
 * an arithmetic result is wrong the moment the world moves, and then somebody
 * has to remember to delete it.
 *
 * "I have seen this" is the exception. No amount of arithmetic over invoices
 * produces it: it is a fact about a person, created by that person, and it is
 * the one thing on the page that cannot be derived.
 *
 * Keyed by the notification's own stable id — `chase:<documentId>`,
 * `deal:<dealId>`, `nif:<partyId>` — which is what `today/gather.ts` already
 * builds. That matters: the key survives the item disappearing and coming back.
 * An invoice that is paid, then credited, then unpaid again reappears with the
 * same key, still marked read by whoever read it in March, which is right —
 * they did read it.
 */
export const notificationRead = pgTable(
  "notification_read",
  {
    /**
     * Not a foreign key to `user`. Better Auth owns that table and this is a
     * per-person preference of no consequence — a deleted user's read marks
     * are dead weight, not an integrity problem, and a cascade here would be
     * more machinery than the fact deserves.
     */
    userId: text("user_id").notNull(),

    /** `deal:…`, `chase:…`, `nif:…` — see src/domain/today/gather.ts. */
    notificationKey: text("notification_key").notNull(),

    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One row per person per notification. Reading a thing twice is not two
    // facts, and the composite key says so rather than a trigger enforcing it.
    primaryKey({ columns: [table.userId, table.notificationKey] }),
  ],
);
