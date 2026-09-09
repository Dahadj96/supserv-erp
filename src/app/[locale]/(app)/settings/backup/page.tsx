import { CircleAlert, Clock, HardDrive, Info, Play, ShieldCheck } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type BackupState,
  backupScreen,
  type DestinationRefusal,
  driveOf,
} from "@/domain/control/backup";
import { Link } from "@/i18n/navigation";
import { runBackupNowAction, saveDestinationAction } from "./actions";

/**
 * Screen 66b — Backup.
 *
 * Task U1, and the sentence the whole wave is written to: a screen must say
 * what it is for, what state it is in right now, and what the person can do
 * next. Abdou's complaint was exact — "you talk about backup, there's no
 * settings for backup, or to change the folder. What does the backup do? How
 * does it work? Is it daily?" — so those are the four headings, in that order.
 *
 * Nothing here is stored (LAW 1). The schedule and the destination are read out
 * of `.env`, which is the file `scripts\server\backup.ps1` itself reads; the
 * last run is the receipt that script leaves; how far back the copies go is the
 * folder listing. A "backup settings" table would be a second opinion, and the
 * script would go on ignoring it.
 *
 * The loudest thing on the page is deliberately a warning rather than a
 * feature: on this machine `BACKUP_LOCAL_PATH` is `/mnt/usb-backup`, a Linux
 * path left over from a plan to host on a VPS, so every backup lands on the
 * same disk as the database it protects. The script has printed that every
 * night since August into a log nobody opens.
 */
export const dynamic = "force-dynamic";

const TONE: Record<BackupState, BadgeTone> = {
  never: "critical",
  failing: "critical",
  stale: "critical",
  sameDisk: "warning",
  good: "good",
};

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10} GB`;
}

export default async function BackupPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string; saved?: string; started?: string }>;
}) {
  const { locale } = await params;
  const { error, saved, started } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  // The same permission `/settings/storage` and `/settings/audit` hold. Where
  // the company's data is copied to is infrastructure, not a preference.
  const mayManage = Boolean(session.role && can(session.role, "settings.company"));
  if (!mayManage) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <h1 className="text-[19px] font-semibold text-ink">{t("backup.title")}</h1>
        <p className="mt-2 max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("backup.notPermitted")}
        </p>
      </main>
    );
  }

  const screen = await backupScreen();
  const { report, schedule, destination, copies, run } = screen;

  const when = (at: Date) =>
    at.toLocaleString(locale === "fr" ? "fr-DZ" : "en-GB", {
      dateStyle: "long",
      timeStyle: "short",
    });
  const day = (at: Date) =>
    at.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB", { dateStyle: "long" });

  /**
   * Why the copies are on the wrong disk, said in the one sentence that fits
   * this machine's actual state rather than a general one. Written out so
   * `tests/unit/messages.test.ts` can see every key.
   */
  const BECAUSE: Record<DestinationRefusal | "chosen", string> = {
    notSet: t("backup.sameDrive.becauseNotSet", { resolved: destination.resolved }),
    notWindowsPath: t("backup.sameDrive.becauseNotWindowsPath", {
      configured: destination.configured ?? "",
      resolved: destination.resolved,
    }),
    driveMissing: t("backup.sameDrive.becauseDriveMissing", {
      configured: destination.configured ?? "",
      drive: driveOf(destination.configured ?? "") ?? "",
      resolved: destination.resolved,
    }),
    chosen: t("backup.sameDrive.becauseChosen", { configured: destination.configured ?? "" }),
  };

  const runningReason =
    run.state === "running" && run.startedAt
      ? t("backup.run.busy", { when: when(run.startedAt) })
      : !screen.canRunFromHere
        ? t("backup.run.notWindows")
        : undefined;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("backup.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("backup.subtitle")}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/settings/storage">
            <Button variant="ghost">{t("backup.openStorage")}</Button>
          </Link>
          <form action={runBackupNowAction.bind(null, locale)}>
            <Button
              type="submit"
              variant="primary"
              icon={<Play className="size-4" aria-hidden />}
              disabledReason={runningReason}
            >
              {t("backup.run.now")}
            </Button>
          </form>
        </div>
      </div>

      {/* ── the warning the script prints every night and nobody reads ── */}
      {destination.sameDrive ? (
        <div className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3.5">
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
            <div className="max-w-[940px]">
              <p className="text-tiny font-semibold text-critical-ink">
                {t("backup.sameDrive.title")}
              </p>
              <p className="mt-1.5 text-tiny leading-relaxed text-critical-ink">
                {BECAUSE[destination.refusal ?? "chosen"]}
              </p>
              <p className="mt-1.5 text-tiny leading-relaxed text-critical-ink">
                {t("backup.sameDrive.covers")}
              </p>
              <p className="mt-1.5 text-tiny font-semibold leading-relaxed text-critical-ink">
                {t("backup.sameDrive.fix")}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny leading-relaxed text-critical-ink">
          {t.has(`backup.error.${error}`) ? t(`backup.error.${error}`) : t("backup.error.unknown")}
        </p>
      ) : null}
      {saved ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny leading-relaxed text-good-ink">
          {t("backup.savedDestination")}
        </p>
      ) : null}
      {started ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny leading-relaxed text-good-ink">
          {t("backup.run.started")}
        </p>
      ) : null}

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <ShieldCheck className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("backup.intro")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          {/* ── the last run ─────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("backup.last.title")}</h2>
              <span className="ms-auto">
                <Badge tone={TONE[report.state]}>{t(`backup.last.state.${report.state}`)}</Badge>
              </span>
            </div>

            <div className="px-5 py-4">
              {run.state === "running" && run.startedAt ? (
                <p className="mb-4 rounded-[var(--radius-control)] bg-accent-bg px-4 py-2.5 text-tiny leading-relaxed text-accent-ink">
                  {t("backup.run.running", { when: when(run.startedAt), who: run.by ?? "—" })}
                </p>
              ) : null}
              {run.state === "noReceipt" && run.startedAt ? (
                <p className="mb-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny leading-relaxed text-critical-ink">
                  {t("backup.run.noReceipt", { when: when(run.startedAt), who: run.by ?? "—" })}
                </p>
              ) : null}

              {report.state === "never" || !report.at ? (
                <p className="max-w-[820px] text-tiny leading-relaxed text-secondary">
                  {t("backup.last.none")}
                </p>
              ) : (
                <>
                  <p className="max-w-[820px] text-tiny leading-relaxed text-secondary">
                    {report.verified
                      ? t("backup.last.verifiedYes", {
                          tables: report.tablesChecked,
                          rows: report.rowsChecked,
                        })
                      : t("backup.last.verifiedNo")}
                  </p>
                  <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                    <div className="col-span-1 sm:col-span-2 flex items-baseline gap-3 border-b border-line-subtle py-2">
                      <dt className="shrink-0 text-tiny text-secondary">
                        {t("backup.last.finishedAt")}
                      </dt>
                      <dd className="ms-auto text-end text-tiny text-ink">
                        {when(report.at)}
                        <span className="ms-2 text-muted">
                          {report.ageDays === 0
                            ? t("backup.last.today")
                            : t("backup.last.daysAgo", { days: report.ageDays ?? 0 })}
                        </span>
                      </dd>
                    </div>
                    <div className="col-span-1 sm:col-span-2 flex items-baseline gap-3 border-b border-line-subtle py-2">
                      <dt className="shrink-0 text-tiny text-secondary">
                        {t("backup.last.destination")}
                      </dt>
                      <dd className="ms-auto break-all text-end font-mono text-micro text-ink">
                        {report.destination ?? "—"}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                      <dt className="text-tiny text-secondary">{t("backup.last.database")}</dt>
                      <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                        {human(report.dumpBytes)}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                      <dt className="text-tiny text-secondary">{t("backup.last.files")}</dt>
                      <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                        {human(report.filesBytes)}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </div>
          </section>

          {/* ── what it takes ────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("backup.takes.title")}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              <li className="text-tiny leading-relaxed text-secondary">
                {t("backup.takes.database")}
              </li>
              <li className="text-tiny leading-relaxed text-secondary">
                {t("backup.takes.files")}
              </li>
            </ul>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-[var(--radius-control)] bg-plane p-3">
                <p className="text-micro leading-relaxed text-secondary">
                  {t("backup.takes.notEnv")}
                </p>
              </div>
              <div className="rounded-[var(--radius-control)] bg-plane p-3">
                <p className="text-micro leading-relaxed text-secondary">
                  {t("backup.takes.notBuild")}
                </p>
              </div>
            </div>
          </section>

          {/* ── the copies that exist ────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <HardDrive className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("backup.copies.title")}</h2>
              <span className="ms-auto break-all font-mono text-micro text-muted">
                {copies.folder}
              </span>
            </div>
            <div className="px-5 py-4">
              {!copies.readable ? (
                <p className="text-tiny leading-relaxed text-secondary">
                  {t("backup.copies.unreadable")}
                </p>
              ) : copies.databases.length === 0 && copies.files.length === 0 ? (
                <p className="text-tiny leading-relaxed text-secondary">
                  {t("backup.copies.none")}
                </p>
              ) : (
                <>
                  <p className="max-w-[820px] text-tiny leading-relaxed text-secondary">
                    {t("backup.copies.range", {
                      count: copies.databases.length,
                      archives: copies.files.length,
                      size: human(copies.bytes),
                    })}
                  </p>
                  {copies.oldest ? (
                    <p className="mt-1.5 text-tiny font-semibold leading-relaxed text-ink">
                      {t("backup.copies.back", { oldest: day(copies.oldest) })}
                    </p>
                  ) : null}

                  <table className="mt-4 w-full border-collapse text-tiny">
                    <thead>
                      <tr className="border-b border-line-subtle text-micro text-muted">
                        <th className="py-2 pe-4 text-start font-medium">
                          {t("backup.copies.name")}
                        </th>
                        <th className="py-2 pe-4 text-start font-medium">
                          {t("backup.copies.taken")}
                        </th>
                        <th className="py-2 text-end font-medium">{t("backup.copies.size")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {copies.databases.slice(0, 10).map((copy) => (
                        <tr key={copy.name} className="border-b border-line-subtle last:border-0">
                          <td className="break-all py-2 pe-4 font-mono text-micro text-ink">
                            {copy.name}
                          </td>
                          <td className="py-2 pe-4 text-secondary">{when(copy.takenAt)}</td>
                          <td className="py-2 text-end tabular-nums text-secondary">
                            {human(copy.bytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {copies.databases.length > 10 ? (
                    <p className="mt-2 text-micro text-muted">
                      {t("backup.copies.andMore", { count: copies.databases.length - 10 })}
                    </p>
                  ) : null}

                  <p className="mt-3 text-micro leading-relaxed text-muted">
                    {t("backup.copies.pair")}
                  </p>
                  <p className="mt-2 text-micro leading-relaxed text-muted">
                    {t("backup.copies.retention")}
                  </p>
                </>
              )}
            </div>
          </section>

          {/* ── restoring ────────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("backup.restore.title")}</h2>
            <p className="mt-2 max-w-[820px] text-tiny leading-relaxed text-secondary">
              {t("backup.restore.noButton")}
            </p>

            <p className="mt-4 text-tiny leading-relaxed text-secondary">
              {t("backup.restore.drill")}
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-[var(--radius-control)] bg-plane p-3 font-mono text-micro text-ink">
              {t("backup.restore.drillCmd")}
            </pre>

            <p className="mt-4 text-tiny leading-relaxed text-secondary">
              {t("backup.restore.real")}
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-[var(--radius-control)] bg-plane p-3 font-mono text-micro text-ink">
              {t("backup.restore.realCmd")}
            </pre>

            <p className="mt-4 text-micro leading-relaxed text-muted">
              {t("backup.restore.filesToo")}
            </p>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("backup.restore.runbook")}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {/* ── when ─────────────────────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <Clock className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("backup.when.title")}</h2>
            </div>
            <p className="mt-3 text-tiny leading-relaxed text-ink">
              {t("backup.when.daily", { at: schedule.at })}
            </p>
            <p className="mt-1 text-micro text-muted">
              {schedule.fromEnv ? t("backup.when.fromEnv") : t("backup.when.default")}
            </p>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("backup.when.catchUp", { at: schedule.at })}
            </p>
            <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("backup.when.task")}
            </p>
          </section>

          {/* ── where, and the form that changes it ──────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("backup.where.title")}</h2>
            <dl className="mt-3">
              <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                <dt className="shrink-0 text-tiny text-secondary">
                  {t("backup.where.configured")}
                </dt>
                <dd className="ms-auto break-all text-end font-mono text-micro text-ink">
                  {destination.configured ?? t("backup.where.notSetValue")}
                </dd>
              </div>
              {destination.refusal ? (
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="shrink-0 text-tiny text-secondary">{t("backup.where.ignored")}</dt>
                  <dd className="ms-auto shrink-0">
                    {/* Only rendered when `refusal` is not null, so the built
                        key can only ever be one of the three that exist —
                        which is the check `/settings/storage` had to write a
                        lookup table for. */}
                    <Badge tone="critical">
                      {t(`backup.where.refusal.${destination.refusal}`)}
                    </Badge>
                  </dd>
                </div>
              ) : null}
              <div className="flex items-baseline gap-3 py-2">
                <dt className="shrink-0 text-tiny text-secondary">{t("backup.where.resolved")}</dt>
                <dd className="ms-auto break-all text-end font-mono text-micro text-ink">
                  {destination.resolved}
                </dd>
              </div>
            </dl>

            <form action={saveDestinationAction.bind(null, locale)} className="mt-4">
              <label htmlFor="backup-path" className="text-micro font-medium text-secondary">
                {t("backup.where.field")}
              </label>
              <input
                id="backup-path"
                name="path"
                type="text"
                placeholder="D:\supserv-backups"
                className={`${INPUT} mt-1`}
              />
              <p className="mt-1.5 text-micro leading-relaxed text-muted">
                {t("backup.where.hint")}
              </p>
              <div className="mt-3">
                <Button type="submit" variant="secondary">
                  {t("backup.where.save")}
                </Button>
              </div>
            </form>

            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("backup.where.driveCaveat")}
            </p>
          </section>

          {/* ── off this machine ─────────────────────────────────────── */}
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <Info className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("backup.offsite.title")}</h2>
            </div>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {screen.offsiteFolderNamed
                ? t("backup.offsite.named", { folder: screen.offsiteFolderNamed })
                : t("backup.offsite.notNamed")}
            </p>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("backup.offsite.what")}</p>
          </section>
        </div>
      </div>
    </main>
  );
}
