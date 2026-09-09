import { describe, expect, it } from "vitest";
import type { GraphAttachment } from "@/capture/mail/graph";
import { matchToListing, type PendingAttachment } from "@/domain/intake/attachments";
import { attachmentFetchOptions } from "@/jobs/queue";

/**
 * 1.10 — pairing a row that has no bytes with the file still sitting in the
 * mailbox.
 *
 * Every attachment captured before 1.3 has a null `external_id`, so the only
 * way to fetch one is to list its message again and work out which entry it is.
 * Getting that wrong is not a failed fetch — it is the WRONG FILE behind a
 * name on screen 40, which nobody would notice until they read it. So the
 * matcher's real job is refusing to guess, and that is most of what is asserted
 * here.
 */

const entry = (over: Partial<GraphAttachment> & { id: string; name: string }): GraphAttachment => ({
  contentType: "application/pdf",
  size: 100,
  isInline: false,
  ...over,
});

const row = (
  over: Partial<PendingAttachment> & { id: string; filename: string },
): PendingAttachment => ({
  sizeBytes: 100,
  externalId: null,
  ...over,
});

describe("matching a row without bytes to what the mailbox still holds", () => {
  it("pairs on name and size", () => {
    const rows = [row({ id: "r1", filename: "CCTP.pdf", sizeBytes: 4242 })];
    const listing = [entry({ id: "g1", name: "CCTP.pdf", size: 4242 })];

    expect(matchToListing(rows, listing).get("r1")?.id).toBe("g1");
  });

  it("prefers the Graph id the row already holds, so a rename cannot lose it", () => {
    const rows = [row({ id: "r1", filename: "old-name.pdf", externalId: "g9" })];
    const listing = [entry({ id: "g9", name: "renamed.pdf", size: 999 })];

    expect(matchToListing(rows, listing).get("r1")?.id).toBe("g9");
  });

  it("falls back to the name when the size no longer agrees", () => {
    // Graph's `size` is the attachment in the mail store, encoding included,
    // and nothing promises it is the same number a year later.
    const rows = [row({ id: "r1", filename: "devis.pdf", sizeBytes: 100 })];
    const listing = [entry({ id: "g1", name: "devis.pdf", size: 137 })];

    expect(matchToListing(rows, listing).get("r1")?.id).toBe("g1");
  });

  it("refuses to choose between two files that look identical", () => {
    const rows = [row({ id: "r1", filename: "cv.pdf" })];
    const listing = [entry({ id: "g1", name: "cv.pdf" }), entry({ id: "g2", name: "cv.pdf" })];

    // Unmatched is reported as "not in the mailbox any more" and nothing is
    // written. A coin toss would file one candidate's CV under another's name.
    expect(matchToListing(rows, listing).has("r1")).toBe(false);
  });

  it("never gives one listing entry to two rows", () => {
    const rows = [
      row({ id: "r1", filename: "plan.pdf", externalId: "g1" }),
      row({ id: "r2", filename: "plan.pdf" }),
    ];
    const listing = [entry({ id: "g1", name: "plan.pdf" })];

    const matched = matchToListing(rows, listing);
    expect(matched.get("r1")?.id).toBe("g1");
    expect(matched.has("r2")).toBe(false);
  });

  it("says nothing about a row the message does not list at all", () => {
    const rows = [row({ id: "r1", filename: "gone.pdf" })];

    expect(matchToListing(rows, []).size).toBe(0);
  });
});

describe("how an attachment fetch is queued", () => {
  it("keys on the row's own id, so two callers cannot queue it twice", () => {
    // The poll and the backfill both queue this job. They share these options
    // rather than agreeing on them, because agreement drifts.
    expect(attachmentFetchOptions("row-1")).toEqual({
      singletonKey: "row-1",
      retryLimit: 5,
      retryDelay: 60,
      retryBackoff: true,
    });
  });
});
