import { CircleAlert, HardDrive, Info, Trash2, TriangleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type BackupState, backupReport } from "@/domain/control/backup";
import { storageReport } from "@/domain/files/storage-report";
import { Link } from "@/i18n/navigation";

/**
 * Screen 66 — Storage and files.
 *
 * The screen answers one question — where are the bytes — and it answers it by
 * reading the disk, not by trusting a count.
 *
 * Two cards, because there are two stores and they are in different states:
 * working files are on this machine and working, finished documents are meant
 * for SharePoint and are not there. The second card carries no numbers at all.
 * "SharePoint · 0 files" would be a chip that can only ever read zero, and this
 * project keeps deciding that a state is more honest than a count that cannot
 * move.
 *
 * The drift panel is the part worth building. It is the only place that would
 * ever tell you a file the database is sure about is not on the disk.
 */
export const dynamic = "force-dynamic";

/**
 * `sameDisk` is a warning, not a failure. A verified backup taken last night
 * that happens to sit on the wrong disk is worth far more than none, and
 * painting it the same red as "never taken" would teach somebody to read past
 * both. `stale` and `failing` are red because in both cases the honest answer
 * to "can we restore?" is no.
 */
const BACKUP_TONE: Record<BackupState, "good" | "warning" | "critical"> = {
  never: "critical",
  failing: "critical",
  stale: "critical",
  sameDisk: "warning",
  good: "good",
};

/**
 * A lookup rather than a built key. `storage.backup.${state}Why` would compile,
 * render, and throw MISSING_MESSAGE for `good` and `never` - which have no
 * explanation and should not - and this codebase has already shipped that exact
 * 500 once from `deals.filters.${badge}`.
 */
const BACKUP_WHY: Record<BackupState, string> = {
  never: "none",
  failing: "failingWhy",
  stale: "staleWhy",
  sameDisk: "sameDiskWhy",
  good: "how",
};

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10} GB`;
}

export default async function StoragePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  // The root path is infrastructure, and so is the list of orphaned files.
  if (!session.role || !can(session.role, "settings.company")) {
    return (
      <main className="min-h-0 flex-1 overflow-auto p-7">
        <p className="max-w-[560px] text-tiny leading-relaxed text-secondary">
          {t("storage.notPermitted")}
        </p>
      </main>
    );
  }

  const [{ working, final }, backup] = await Promise.all([storageReport(), backupReport()]);
  const drifting = working.missing.length > 0 || working.orphanedCount > 0;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("storage.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("storage.subtitle")}</p>
        </div>
        <div className="ms-auto">
          <Link href="/files">
            <Button variant="secondary">{t("storage.browseFiles")}</Button>
          </Link>
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("storage.banner")}
        </p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <HardDrive className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("storage.working.title")}</h2>
              <span className="ms-auto">
                <Badge tone={working.state === "ready" ? "good" : "critical"}>
                  {t(`storage.state.${working.state}`)}
                </Badge>
              </span>
            </div>

            <div className="px-5 py-4">
              <p className="max-w-[820px] text-tiny leading-relaxed text-secondary">
                {t("storage.working.what")}
              </p>

              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <div className="col-span-1 md:col-span-2 flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.working.root")}</dt>
                  <dd className="ms-auto break-all text-end font-mono text-micro text-ink">
                    {working.root}
                  </dd>
                </div>
                <div className="col-span-1 md:col-span-2 flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.working.configured")}</dt>
                  <dd className="ms-auto text-end text-tiny text-ink">
                    {working.configured
                      ? t("storage.working.fromEnv")
                      : t("storage.working.fallback")}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.working.files")}</dt>
                  <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                    {working.files}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.working.size")}</dt>
                  <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                    {human(working.bytes)}
                  </dd>
                </div>
              </dl>

              {working.state === "unwritable" ? (
                <p className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny leading-relaxed text-critical-ink">
                  <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
                  {t("storage.working.unwritableWhy")}
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("storage.drift.title")}</h2>
              <span className="ms-auto text-micro text-muted">{t("storage.drift.how")}</span>
            </div>

            <div className="px-5 py-4">
              {!drifting ? (
                <p className="text-tiny leading-relaxed text-secondary">
                  {t("storage.drift.agree", { files: working.files })}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {working.missing.length > 0 ? (
                    <div>
                      <p className="flex items-start gap-2 text-tiny leading-relaxed text-critical-ink">
                        <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
                        {t("storage.drift.missing", { count: working.missing.length })}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {working.missing.map((path) => (
                          <li key={path} className="break-all font-mono text-micro text-secondary">
                            {path}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {working.orphanedCount > 0 ? (
                    <div>
                      <p className="text-tiny leading-relaxed text-secondary">
                        {t("storage.drift.orphaned", {
                          count: working.orphanedCount,
                          size: human(working.orphanedBytes),
                        })}
                      </p>
                      <ul className="mt-2 flex flex-col gap-1">
                        {working.orphaned.map((path) => (
                          <li key={path} className="break-all font-mono text-micro text-muted">
                            {path}
                          </li>
                        ))}
                      </ul>
                      {working.orphanedCount > working.orphaned.length ? (
                        <p className="mt-2 text-micro text-muted">
                          {t("storage.drift.andMore", {
                            count: working.orphanedCount - working.orphaned.length,
                          })}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <p className="rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
                    {t("storage.drift.nothingIsDeleted")}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("storage.final.title")}</h2>
              <span className="ms-auto">
                <Badge tone="warning">{t(`storage.state.${final.state}`)}</Badge>
              </span>
            </div>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("storage.final.what")}
            </p>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("storage.final.needs", { permission: final.needs })}
            </p>
            <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("storage.final.meanwhile")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <Trash2 className="size-4 self-center text-muted" aria-hidden />
              <h2 className="text-tiny font-semibold text-ink">{t("storage.bin.title")}</h2>
            </div>
            <dl className="mt-3">
              <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                <dt className="text-tiny text-secondary">{t("storage.bin.files")}</dt>
                <dd className="ms-auto text-tiny tabular-nums text-ink">{working.binFiles}</dd>
              </div>
              <div className="flex items-baseline gap-3 py-2">
                <dt className="text-tiny text-secondary">{t("storage.bin.size")}</dt>
                <dd className="ms-auto text-tiny tabular-nums text-ink">
                  {human(working.binBytes)}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">{t("storage.bin.why")}</p>
            <Link
              href="/settings/bin"
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {t("storage.bin.records")}
            </Link>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("storage.backup.title")}</h2>
              <span className="ms-auto">
                <Badge tone={BACKUP_TONE[backup.state]}>
                  {t(`storage.backup.state.${backup.state}`)}
                </Badge>
              </span>
            </div>

            {backup.state === "never" ? (
              <p className="mt-3 text-tiny leading-relaxed text-secondary">
                {t("storage.backup.none")}
              </p>
            ) : (
              <dl className="mt-3">
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.backup.lastAt")}</dt>
                  <dd className="ms-auto text-end text-tiny text-ink">
                    {backup.ageDays === 0
                      ? t("storage.backup.today")
                      : t("storage.backup.daysAgo", { days: backup.ageDays ?? 0 })}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="shrink-0 text-tiny text-secondary">
                    {t("storage.backup.destination")}
                  </dt>
                  <dd className="ms-auto break-all text-end font-mono text-micro text-ink">
                    {backup.destination}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
                  <dt className="text-tiny text-secondary">{t("storage.backup.database")}</dt>
                  <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                    {human(backup.dumpBytes)}
                  </dd>
                </div>
                <div className="flex items-baseline gap-3 py-2">
                  <dt className="text-tiny text-secondary">{t("storage.backup.files")}</dt>
                  <dd className="ms-auto text-end text-tiny tabular-nums text-ink">
                    {human(backup.filesBytes)}
                  </dd>
                </div>
                {backup.verified ? (
                  <p className="mt-1 text-micro text-muted">
                    {t("storage.backup.compared", {
                      tables: backup.tablesChecked,
                      rows: backup.rowsChecked,
                    })}
                  </p>
                ) : null}
              </dl>
            )}

            {/* One sentence, and only when something is wrong with it. A card
                that explains itself when it is green is a card people stop
                reading before the day it turns red. */}
            {backup.state !== "good" && backup.state !== "never" ? (
              <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2.5 text-micro leading-relaxed text-critical-ink">
                <CircleAlert className="mt-px size-4 shrink-0" aria-hidden />
                {t(`storage.backup.${BACKUP_WHY[backup.state]}`)}
              </p>
            ) : null}

            <p className="mt-3 text-micro leading-relaxed text-muted">{t("storage.backup.how")}</p>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("storage.backup.drill")}
            </p>
            {/* Task U1. This card is a chip and four numbers; the screen it now
                links to is where the schedule, the destination, the copies that
                exist and the button that runs one live. */}
            <Link
              href="/settings/backup"
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {t("storage.backup.openScreen")}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
