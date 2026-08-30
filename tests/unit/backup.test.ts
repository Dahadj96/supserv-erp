import { describe, expect, it } from "vitest";
import {
  assessBackup,
  type BackupReceipt,
  type BackupState,
  STALE_DAYS,
} from "@/domain/control/backup";

/**
 * The card on screen 66 is the only thing in the ERP that will ever say the
 * backups have stopped. Every branch of it is exercised here, because the day
 * it is wrong is a day nobody finds out it was wrong.
 *
 * The bias under test is one-directional: this must never report a state
 * BETTER than the truth. Reporting `stale` on a good backup wastes somebody's
 * morning. Reporting `good` on a broken one loses the company's records.
 */

const NOW = new Date("2026-08-30T09:00:00Z");

function receipt(over: Partial<BackupReceipt> = {}): BackupReceipt {
  return {
    startedAt: "2026-08-30T02:30:00Z",
    finishedAt: "2026-08-30T02:31:00Z",
    destination: "D:\\supserv-backups",
    offsite: true,
    dump: "supserv-2026-08-30-0230.dump",
    dumpBytes: 193_848,
    files: "files-2026-08-30-0230.zip",
    filesBytes: 287_299,
    verified: true,
    tablesChecked: 57,
    rowsChecked: 488,
    ...over,
  };
}

describe("what the ERP says about its own backup", () => {
  it("says never when no backup has ever run", () => {
    const report = assessBackup(null, NOW);
    expect(report.state).toBe("never");
    expect(report.at).toBeNull();
    expect(report.ageDays).toBeNull();
  });

  it("says good for last night's verified backup on another disk", () => {
    const report = assessBackup(receipt(), NOW);
    expect(report.state).toBe("good");
    expect(report.ageDays).toBe(0);
    expect(report.rowsChecked).toBe(488);
  });

  it("says sameDisk when it is verified and recent but not off this machine", () => {
    expect(assessBackup(receipt({ offsite: false }), NOW).state).toBe("sameDisk");
  });

  it("says failing when the run did not read its own dump back", () => {
    expect(assessBackup(receipt({ verified: false }), NOW).state).toBe("failing");
  });

  it("counts an unverified backup as failing even when it was taken minutes ago", () => {
    // Recency is not a defence. A dump that has never been restored is a file.
    const report = assessBackup(
      receipt({ verified: false, finishedAt: "2026-08-30T08:59:00Z" }),
      NOW,
    );
    expect(report.state).toBe("failing");
  });

  it("goes stale on the second missed night, not the first morning", () => {
    // 02:30 means the newest backup is already hours old by nine, so a
    // threshold of one day would cry wolf every single working morning.
    const lastNight = assessBackup(receipt({ finishedAt: "2026-08-30T02:31:00Z" }), NOW);
    expect(lastNight.state).toBe("good");

    const nightBefore = assessBackup(receipt({ finishedAt: "2026-08-29T02:31:00Z" }), NOW);
    expect(nightBefore.ageDays).toBe(1);
    expect(nightBefore.state).toBe("good");

    const twoNights = assessBackup(receipt({ finishedAt: "2026-08-28T02:31:00Z" }), NOW);
    expect(twoNights.ageDays).toBe(STALE_DAYS);
    expect(twoNights.state).toBe("stale");
  });

  it("reports failing rather than stale when it is both", () => {
    // Worst first. "Out of date" would let somebody restore an old dump that
    // was never readable in the first place.
    const report = assessBackup(
      receipt({ verified: false, finishedAt: "2026-07-01T02:31:00Z", offsite: false }),
      NOW,
    );
    expect(report.state).toBe("failing");
  });

  it("treats an unreadable date as no backup at all", () => {
    // Not "a backup of unknown age". The one thing this must never do on bad
    // input is look reassuring.
    expect(assessBackup(receipt({ finishedAt: "not a date" }), NOW).state).toBe("never");
  });

  it("never invents a state the screen has no label for", () => {
    const known: BackupState[] = ["never", "failing", "stale", "sameDisk", "good"];
    const cases = [
      null,
      receipt(),
      receipt({ offsite: false }),
      receipt({ verified: false }),
      receipt({ finishedAt: "2026-01-01T00:00:00Z" }),
      receipt({ finishedAt: "" }),
    ];
    for (const one of cases) {
      expect(known).toContain(assessBackup(one, NOW).state);
    }
  });
});
