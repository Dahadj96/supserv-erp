import { describe, expect, it } from "vitest";
import {
  assessBackup,
  assessRun,
  type BackupReceipt,
  type BackupState,
  checkNewDestination,
  driveOf,
  envValueFrom,
  localStamp,
  parseCopyName,
  planDestination,
  RUN_WINDOW_MINUTES,
  STALE_DAYS,
  scheduleFrom,
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

/**
 * Task U1 — what screen 66b reads before the script has run again.
 *
 * The state under test is the one this installation is actually in and nobody
 * could see: BACKUP_LOCAL_PATH is a Linux path on a Windows machine, so the
 * script ignores it and every copy lands on the disk holding the database. It
 * is proved here rather than on the machine, because a test that needs a
 * Windows box to run is a test that does not run.
 */
const ENV = [
  "# ---- backup",
  "BACKUP_LOCAL_PATH=/mnt/usb-backup          # external SSD, plugged in",
  "BACKUP_SHAREPOINT_FOLDER=/Backups/ERP      # off-site, already paid for",
  "BACKUP_ENCRYPTION_KEY=secret",
  "BACKUP_AT=02:30                            # nightly",
].join("\n");

const REPO = "C:\\SUPSERV-ERP";
const noDrives = () => false;
const allDrives = () => true;

describe("reading .env the way backup.ps1 reads it", () => {
  it("takes the value and drops the trailing comment", () => {
    expect(envValueFrom(ENV, "BACKUP_LOCAL_PATH")).toBe("/mnt/usb-backup");
    expect(envValueFrom(ENV, "BACKUP_AT")).toBe("02:30");
  });

  it("is null for a key that is absent, so nothing downstream invents one", () => {
    expect(envValueFrom(ENV, "BACKUP_NOWHERE")).toBeNull();
    expect(envValueFrom("BACKUP_LOCAL_PATH=", "BACKUP_LOCAL_PATH")).toBeNull();
  });

  it("does not match a key that merely ends with the name", () => {
    // `OLD_BACKUP_AT=23:00` must not answer for `BACKUP_AT`.
    expect(envValueFrom("OLD_BACKUP_AT=23:00", "BACKUP_AT")).toBeNull();
  });

  it("falls back to the time install-services.ps1 registers the task with", () => {
    expect(scheduleFrom(ENV)).toEqual({ at: "02:30", fromEnv: true });
    expect(scheduleFrom("")).toEqual({ at: "02:30", fromEnv: false });
    // A time that is not a time is not a schedule. Reporting it would be the
    // screen repeating a typo back as if it were the truth.
    expect(scheduleFrom("BACKUP_AT=whenever")).toEqual({ at: "02:30", fromEnv: false });
  });
});

describe("where the next backup will actually be written", () => {
  it("refuses the POSIX path this machine has been configured with, and says so", () => {
    const plan = planDestination("/mnt/usb-backup", { repo: REPO, driveExists: allDrives });
    expect(plan.refusal).toBe("notWindowsPath");
    expect(plan.resolved).toBe("C:\\SUPSERV-ERP\\.data\\backups");
    // The whole point: the copies are on the disk they are meant to protect.
    expect(plan.sameDrive).toBe(true);
  });

  it("falls back the same way when nothing is set at all", () => {
    const plan = planDestination(null, { repo: REPO, driveExists: allDrives });
    expect(plan.refusal).toBe("notSet");
    expect(plan.sameDrive).toBe(true);
  });

  it("refuses a rooted path whose drive is not plugged in", () => {
    const plan = planDestination("D:\\supserv-backups", { repo: REPO, driveExists: noDrives });
    expect(plan.refusal).toBe("driveMissing");
    expect(plan.resolved).toBe("C:\\SUPSERV-ERP\\.data\\backups");
  });

  it("uses a real drive as written, and stops warning once it is another one", () => {
    const plan = planDestination("D:\\supserv-backups", { repo: REPO, driveExists: allDrives });
    expect(plan.refusal).toBeNull();
    expect(plan.resolved).toBe("D:\\supserv-backups");
    expect(plan.sameDrive).toBe(false);
  });

  it("still warns when the destination is a folder on the ERP's own drive", () => {
    // Configured, existing, writable — and useless against the disk failing.
    const plan = planDestination("C:\\backups", { repo: REPO, driveExists: allDrives });
    expect(plan.refusal).toBeNull();
    expect(plan.sameDrive).toBe(true);
  });

  it("does not call a network share the same drive as anything", () => {
    const plan = planDestination("\\\\nas\\backups", { repo: REPO, driveExists: allDrives });
    expect(plan.refusal).toBeNull();
    expect(plan.sameDrive).toBe(false);
  });

  it("reads a drive letter without caring how it was typed", () => {
    expect(driveOf("c:\\x")).toBe("C:");
    expect(driveOf("\\\\nas\\share")).toBeNull();
  });
});

describe("what may be typed into the destination box", () => {
  it("refuses the drive the ERP is on, which the script itself tolerates", () => {
    // Stricter than backup.ps1 on purpose: the script has to keep working on a
    // machine nobody has fixed; a person typing this is choosing it.
    expect(checkNewDestination("C:\\backups", REPO)).toBe("sameDrive");
  });

  it("refuses a POSIX path, blank, and a bare folder name", () => {
    expect(checkNewDestination("/mnt/usb-backup", REPO)).toBe("notWindowsPath");
    expect(checkNewDestination("   ", REPO)).toBe("blank");
    expect(checkNewDestination("backups", REPO)).toBe("notWindowsPath");
  });

  it("accepts another drive and a network share", () => {
    expect(checkNewDestination("D:\\supserv-backups", REPO)).toBeNull();
    expect(checkNewDestination("\\\\nas\\supserv", REPO)).toBeNull();
  });
});

describe("how far back the copies go", () => {
  it("reads the date out of the file name, which is what the script stamps", () => {
    const parsed = parseCopyName("supserv-2026-09-09-0230.dump");
    expect(parsed?.kind).toBe("database");
    expect(parsed?.stamp).toBe("2026-09-09-0230");
    expect(parsed?.takenAt.getFullYear()).toBe(2026);
    expect(parsed?.takenAt.getHours()).toBe(2);
    expect(parseCopyName("files-2026-08-30-1741.zip")?.kind).toBe("files");
  });

  it("ignores anything that is not one of the two shapes it writes", () => {
    // `last-backup.json` sits in the same folder, and a half-copied file must
    // never be counted as a backup somebody could restore from.
    expect(parseCopyName("last-backup.json")).toBeNull();
    expect(parseCopyName("supserv-2026-09-09-0230.dump.part")).toBeNull();
    expect(parseCopyName("before-restore-2026-09-09-0230.dump")).toBeNull();
  });
});

describe("a run started from the screen", () => {
  const now = new Date("2026-09-09T10:00:00");
  const started = { startedAt: localStamp(new Date("2026-09-09T09:58:00")), by: "Abdou" };

  it("says nothing at all when nobody has started one", () => {
    expect(assessRun(null, null, now).state).toBe("idle");
  });

  it("says running while no receipt newer than the marker exists", () => {
    const run = assessRun(started, receipt({ finishedAt: "2026-09-09T02:30:12" }), now);
    expect(run.state).toBe("running");
    expect(run.by).toBe("Abdou");
  });

  it("goes quiet the moment the script writes its receipt", () => {
    // The receipt is the answer to the marker. Nothing clears the marker file —
    // it does not have to, because the comparison is the state.
    const run = assessRun(started, receipt({ finishedAt: "2026-09-09T09:59:30" }), now);
    expect(run.state).toBe("idle");
  });

  it("stops claiming a run is in progress once the task's own limit has passed", () => {
    const old = {
      startedAt: localStamp(new Date(now.getTime() - (RUN_WINDOW_MINUTES + 1) * 60_000)),
      by: "Abdou",
    };
    expect(assessRun(old, receipt({ finishedAt: "2026-09-08T02:30:12" }), now).state).toBe(
      "noReceipt",
    );
  });

  it("writes the marker in the same shape the receipt uses, with no zone", () => {
    // A marker in UTC against a receipt in local time is an hour of wrongness
    // in Algeria, and it always errs towards "still running".
    expect(localStamp(new Date(2026, 8, 9, 2, 30, 12))).toBe("2026-09-09T02:30:12");
  });
});
