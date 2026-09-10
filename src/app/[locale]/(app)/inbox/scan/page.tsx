import { desc, eq } from "drizzle-orm";
import { Info } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { SCAN_CHANNEL } from "@/capture/scan/channel";
import { READ_SUBFOLDER } from "@/capture/scan/folder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { intakeDossier } from "@/db/schema/dossier";
import { intakeChannel } from "@/db/schema/intake";
import { Link } from "@/i18n/navigation";
import { saveFolderAction, sweepAction } from "./actions";

/**
 * Screen 41 — Scan station.
 *
 * The frame draws a 44-page binder mid-correction: pages to deskew, a split
 * into two documents, Arabic OCR at 71%. Two of those three need page IMAGES
 * and the OCR container, which is not on this machine (docs/OCR.md §7). The
 * third — getting the paper in at all — needs neither, and is the part that
 * changes somebody's morning.
 *
 * So this is the folder the scanner already writes to, read on demand, with
 * everything that is missing named on the screen rather than mimed.
 */
export const dynamic = "force-dynamic";

export default async function ScanStationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    read?: string;
    left?: string;
    found?: string;
  }>;
}) {
  const { locale } = await params;
  const { saved, error, read, left, found } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);
  const mayConfigure = Boolean(session.role && can(session.role, "settings.company"));

  const [channel] = await db
    .select()
    .from(intakeChannel)
    .where(eq(intakeChannel.key, SCAN_CHANNEL))
    .limit(1);

  const folder = ((channel?.config ?? {}) as { folder?: string }).folder ?? "";

  const recent = await db
    .select({
      id: intakeDossier.id,
      filename: intakeDossier.filename,
      pages: intakeDossier.pages,
      locale: intakeDossier.locale,
      provider: intakeDossier.provider,
      unreadPages: intakeDossier.unreadPages,
      status: intakeDossier.status,
      createdAt: intakeDossier.createdAt,
    })
    .from(intakeDossier)
    .orderBy(desc(intakeDossier.createdAt))
    .limit(12);

  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("scan.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("scan.subtitle")}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Link href="/inbox/dossier">
            <Button variant="secondary">{t("scan.uploadOne")}</Button>
          </Link>
          {mayConfigure && folder ? (
            <form action={sweepAction.bind(null, locale)}>
              <Button type="submit" variant="primary">
                {t("scan.readNow")}
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="max-w-[940px] text-tiny leading-relaxed text-accent-ink">
          {t("scan.banner")}
        </p>
      </div>

      {saved ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("scan.folderSaved")}
        </p>
      ) : null}

      {read !== undefined ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("scan.sweepDone", {
            read: Number(read),
            left: Number(left ?? 0),
            found: Number(found ?? 0),
          })}
        </p>
      ) : null}

      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`scan.error.${error}`) ? t(`scan.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("scan.theFolder")}</h2>
              <span className="ms-auto">
                <Badge tone={folder ? "good" : "warning"}>
                  {folder ? t("scan.watching") : t("scan.notSetUp")}
                </Badge>
              </span>
            </div>

            {mayConfigure ? (
              <form
                action={saveFolderAction.bind(null, locale)}
                className="mt-3 flex items-end gap-2"
              >
                <label className="flex-1">
                  <span className="text-micro text-secondary">{t("scan.folderLabel")}</span>
                  <input
                    name="folder"
                    defaultValue={folder}
                    placeholder="C:\\Users\\Abderrahmane\\Documents\\Scans"
                    className={`${INPUT} mt-1 font-mono`}
                  />
                </label>
                <Button type="submit" variant="secondary">
                  {t("scan.saveFolder")}
                </Button>
              </form>
            ) : (
              <p className="mt-3 font-mono text-tiny text-secondary">{folder || "—"}</p>
            )}

            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("scan.folderHow", { readFolder: READ_SUBFOLDER })}
            </p>
            {channel?.lastReceivedAt ? (
              <p className="mt-1 text-micro text-muted">
                {t("scan.lastPickedUp", { when: when.format(channel.lastReceivedAt) })}
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("scan.recent")}</h2>
              <span className="ms-auto text-micro text-muted">{t("scan.recentWhat")}</span>
            </div>

            {recent.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("scan.nothingYet")}</p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <tbody>
                  {recent.map((row) => {
                    const unread = (row.unreadPages as number[] | null) ?? [];
                    return (
                      <tr key={row.id} className="border-b border-line-subtle last:border-0">
                        <td className="py-2.5 ps-5">
                          <Link
                            className="text-ink hover:underline"
                            href={`/inbox/dossier/${row.id}/review`}
                          >
                            {row.filename}
                          </Link>
                        </td>
                        <td className="py-2.5 pe-4 text-micro text-muted">
                          {t("scan.nPages", { n: row.pages })}
                        </td>
                        <td className="py-2.5 pe-4 text-micro uppercase text-muted">
                          {row.locale ?? "—"}
                        </td>
                        <td className="py-2.5 pe-4">
                          {unread.length > 0 ? (
                            <Badge tone="warning">
                              {t("scan.pagesNeedOcr", { n: unread.length })}
                            </Badge>
                          ) : (
                            <Badge tone="good">{t("scan.fullyRead")}</Badge>
                          )}
                        </td>
                        <td className="py-2.5 pe-5 text-micro text-muted">
                          {when.format(row.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("scan.howPaperGetsIn")}</h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {(
                [
                  ["folder", "good"],
                  ["upload", "good"],
                  ["mailbox", "warning"],
                  ["driver", "neutral"],
                ] as const
              ).map(([key, tone]) => (
                <li key={key}>
                  <div className="flex items-baseline gap-2">
                    <p className="text-tiny text-ink">{t(`scan.route.${key}.what`)}</p>
                    <span className="ms-auto shrink-0">
                      <Badge tone={tone}>{t(`scan.route.${key}.state`)}</Badge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-micro leading-relaxed text-muted">
                    {t(`scan.route.${key}.detail`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("scan.readingThePages")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">{t("scan.textFirst")}</p>
            <p className="mt-2 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
              {t("scan.arabicNote")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("scan.notHereYet")}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {(["deskew", "split", "ocr", "worker"] as const).map((key) => (
                <li key={key} className="text-micro leading-relaxed text-muted">
                  {t(`scan.missing.${key}`)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
