"use server";

import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { access, constants, mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { revalidatePath } from "next/cache";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { db } from "@/db";
import { auditEntry } from "@/db/schema/control";
import {
  checkNewDestination,
  localStamp,
  markerPath,
  type NewDestinationRefusal,
  runLogPath,
  writeBackupDestination,
} from "@/domain/control/backup";
import { redirect } from "@/i18n/navigation";

/**
 * Screen 66b — the two things a person may do about backups from inside the ERP.
 *
 * `settings.company`, the same permission `/settings/storage` and
 * `/settings/audit` hold, and for the same reason: where the company's data is
 * copied to is infrastructure, not a preference. Starting a run is behind it
 * too — the script drops and recreates a scratch database and reads every row
 * of the live one, which is not a thing anybody who can see a screen should be
 * able to set off.
 *
 * RESTORING IS NOT HERE, ON PURPOSE. `scripts\server\restore.ps1` can overwrite
 * the live database, and it refuses to do so while the ERP is serving on port
 * 3000 — which this action would be. A button here could only ever run the
 * harmless half, and a button labelled "Restore" that cannot restore is worse
 * than no button. The screen prints the command instead, and says why.
 */
async function requireOwner(locale: string) {
  const session = await getSession();
  if (!session) {
    redirect({ href: "/sign-in", locale });
    throw new Error("unreachable");
  }
  if (!session.role || !can(session.role, "settings.company")) {
    redirect({ href: "/settings/backup?error=notAllowed", locale });
    throw new Error("unreachable");
  }
  return session;
}

/**
 * Start `scripts\server\backup.ps1` and come straight back.
 *
 * Detached and unwatched, because the run takes minutes — it restores its own
 * dump into a scratch database and compares every row — and a server action
 * that waited would time out long before the receipt was written. What the
 * screen shows afterwards is not a promise that it worked: it is a marker
 * saying a run was started, and the marker is answered by the receipt the
 * script writes when it finishes. If no receipt appears, the screen says so.
 */
export async function runBackupNowAction(locale: string): Promise<void> {
  const session = await requireOwner(locale);

  // Everywhere but Windows there is no PowerShell and no scheduled task, so
  // there is nothing to start. Saying that is better than spawning something
  // that fails into a log nobody opens.
  if (process.platform !== "win32") {
    redirect({ href: "/settings/backup?error=notWindows", locale });
    return;
  }

  const repo = process.cwd();
  const script = join(repo, "scripts", "server", "backup.ps1");
  await mkdir(resolve(repo, ".data"), { recursive: true });

  // Appended, never truncated: the reason to open this file is usually the run
  // before the one that just started.
  const log = openSync(runLogPath(), "a");
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    { cwd: repo, detached: true, stdio: ["ignore", log, log], windowsHide: true },
  );
  child.unref();

  await writeFile(
    markerPath(),
    `${JSON.stringify({ startedAt: localStamp(new Date()), by: session.displayName }, null, 2)}\n`,
    "utf8",
  );

  await db.insert(auditEntry).values({
    actorId: session.userId,
    actorKind: "user",
    entity: "backup",
    action: "run",
    sourceScreen: "66",
  });

  revalidatePath(`/${locale}/settings/backup`);
  redirect({ href: "/settings/backup?started=1", locale });
}

/**
 * Point the nightly backup at another drive.
 *
 * It writes `BACKUP_LOCAL_PATH` into `.env` and nothing else — which is enough,
 * because backup.ps1 reads that file on every run rather than an environment
 * the ERP was started with. So the next run lands on the new drive without
 * anybody restarting anything.
 *
 * Everything is checked before the file is touched: a real folder, on this
 * machine, that this account can write to, on a different drive from the ERP.
 * A destination that turns out not to exist at 02:30 is a destination that
 * silently becomes `.data\backups` again.
 */
export async function saveDestinationAction(locale: string, form: FormData): Promise<void> {
  const session = await requireOwner(locale);

  const typed = String(form.get("path") ?? "").trim();
  const back = (refusal: NewDestinationRefusal | "envUnexpected") =>
    redirect({ href: `/settings/backup?error=${refusal}`, locale });

  const shape = checkNewDestination(typed, process.cwd());
  if (shape) return back(shape);

  try {
    if (!(await stat(typed)).isDirectory()) return back("noSuchFolder");
  } catch {
    return back("noSuchFolder");
  }

  try {
    await access(typed, constants.W_OK);
  } catch {
    return back("notWritable");
  }

  const result = await writeBackupDestination(typed);
  if (result !== "ok") return back("envUnexpected");

  await db.insert(auditEntry).values({
    actorId: session.userId,
    actorKind: "user",
    entity: "backup",
    // `configure`, which screen 32 already reads as "Configured" — a new verb
    // for the same shape of act would be a second word for one concept.
    action: "configure",
    after: { BACKUP_LOCAL_PATH: typed },
    sourceScreen: "66",
  });

  revalidatePath(`/${locale}/settings/backup`);
  revalidatePath(`/${locale}/settings/storage`);
  redirect({ href: "/settings/backup?saved=1", locale });
}
