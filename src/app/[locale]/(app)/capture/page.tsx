import { desc, inArray } from "drizzle-orm";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { intakeMessage } from "@/db/schema/intake";
import { Link } from "@/i18n/navigation";
import { CaptureBox } from "./box";

/**
 * Screen 61 — Quick capture.
 *
 * The right-hand column is not decoration. "It handles these too" is the list
 * of things people currently keep in their pocket and their memory, and half of
 * those lines are still promises — so the ones that are promises say so, in the
 * same place, rather than being quietly left out of the list.
 */
export const dynamic = "force-dynamic";

/** What the screen claims it can do, and whether it can do it yet. */
const HANDLES = [
  ["deliveryNote", "warning"],
  ["dossier", "good"],
  ["phoneCall", "good"],
  ["priceList", "good"],
  ["businessCard", "warning"],
] as const;

export default async function QuickCapturePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  const { saved, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const recent = await db
    .select({
      id: intakeMessage.id,
      subject: intakeMessage.subject,
      classifiedAs: intakeMessage.classifiedAs,
      status: intakeMessage.status,
      createdAt: intakeMessage.createdAt,
    })
    .from(intakeMessage)
    .where(inArray(intakeMessage.channelKey, ["manual", "phone_note"]))
    .orderBy(desc(intakeMessage.createdAt))
    .limit(8);

  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("capture.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("capture.subtitle")}</p>
        </div>
      </div>

      {saved ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("capture.savedIt")}{" "}
          <Link className="underline" href="/inbox">
            {t("capture.seeItInInbox")}
          </Link>
        </p>
      ) : null}

      {error ? (
        <p className="mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t.has(`capture.error.${error}`) ? t(`capture.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2">
          <CaptureBox locale={locale} />
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("capture.handlesToo")}</h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {HANDLES.map(([key, tone]) => (
                <li key={key}>
                  <div className="flex items-baseline gap-2">
                    <p className="text-tiny text-ink">{t(`capture.handles.${key}.what`)}</p>
                    <span className="ms-auto shrink-0">
                      <Badge tone={tone}>{t(`capture.handles.${key}.state`)}</Badge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-micro leading-relaxed text-muted">
                    {t(`capture.handles.${key}.detail`)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("capture.whyThisExists")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-secondary">{t("capture.why")}</p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("capture.recent")}</h2>
            </div>
            {recent.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("capture.nothingYet")}</p>
            ) : (
              <ul className="flex flex-col">
                {recent.map((row) => (
                  <li
                    key={row.id}
                    className="border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <p className="truncate text-tiny text-ink">{row.subject ?? "—"}</p>
                    <p className="mt-0.5 text-micro text-muted">
                      {row.classifiedAs && t.has(`capture.shape.${row.classifiedAs}`)
                        ? t(`capture.shape.${row.classifiedAs}`)
                        : t("capture.shape.unknown")}{" "}
                      · {when.format(row.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
