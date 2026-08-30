import { CircleAlert } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import type { PieceState } from "@/domain/tender/dossier";
import { getTender } from "@/domain/tender/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 08 — the tender dossier.
 *
 * One question: will this folder be accepted at the desk on the day it is
 * deposited? Everything on the screen is arranged to answer it, and the state
 * that earns the screen is `expiresBeforeDeposit` — a paper that is valid
 * today, that every other screen in this system would call valid, and that will
 * have the bid thrown out on 2 September.
 *
 * Nothing here is stored. Ready, missing, expiring and expired are computed
 * from each paper's expiry against this tender's closing time, so a folder that
 * was complete in July stops being complete in September without anybody
 * touching a row.
 */
export const dynamic = "force-dynamic";

const PIECE_TONE: Record<PieceState, "good" | "warning" | "critical"> = {
  ready: "good",
  expiring: "warning",
  expiresBeforeDeposit: "critical",
  expired: "critical",
  missing: "critical",
};

export default async function TenderPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const tender = await getTender(id);
  if (!tender) notFound();

  const format = await getFormatter({ locale });
  const { folder } = tender;
  const when = (value: Date | null) =>
    value
      ? format.dateTime(value, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-7 py-5">
        <h1 className="text-[19px] font-semibold text-ink">
          {tender.clientReference ?? tender.ref} — {tender.object}
        </h1>
        <p className="mt-1 text-tiny text-muted">
          {tender.authority}
          {tender.closesAt ? ` · ${t("tender.closes", { at: when(tender.closesAt) })}` : ""}
        </p>
      </div>

      {folder.blocking.length > 0 && !tender.submittedAt ? (
        <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[940px] text-tiny leading-relaxed text-critical-ink">
            {t("tender.banner", {
              percent: folder.percent,
              blocking: folder.blocking.length,
            })}
          </p>
        </div>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-3 items-start gap-5 px-7 py-6">
        <div className="col-span-2 flex flex-col gap-5">
          {folder.sections.map((section) => (
            <section
              key={section.section}
              className="rounded-[var(--radius-card)] border border-line bg-surface"
            >
              <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
                <h2 className="text-tiny font-semibold text-ink">
                  {t(`tender.section.${section.section}`)}
                </h2>
                <span className="ms-auto text-micro text-muted">
                  {t("tender.readyOf", { ready: section.ready, total: section.total })}
                </span>
              </div>

              <ul>
                {folder.pieces
                  .filter((piece) => piece.section === section.section)
                  .map((piece) => (
                    <li
                      key={piece.key}
                      className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-tiny text-ink">
                          {piece.label ?? t(`tender.piece.${piece.key}`)}
                        </p>
                        <p className="mt-0.5 text-micro text-muted">
                          {piece.state === "missing"
                            ? t("tender.notOnFile")
                            : piece.expiresOn
                              ? t("tender.expiresOn", { on: piece.expiresOn })
                              : piece.reference
                                ? piece.reference
                                : t("tender.onFile")}
                        </p>
                      </div>
                      <span className="ms-auto shrink-0">
                        <Badge tone={PIECE_TONE[piece.state]}>
                          {t(`tender.state.${piece.state}`)}
                        </Badge>
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}

          {folder.total === 0 ? (
            <p className="max-w-[620px] text-tiny leading-relaxed text-muted">
              {t("tender.noPieces")}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("tender.submission.title")}</h2>
            <dl className="mt-3">
              {[
                {
                  key: "method",
                  value: t(`enquiry.method.${tender.submissionMethod}`),
                  warn: tender.submissionMethod === "deposit_sealed",
                },
                { key: "place", value: tender.submissionPlace ?? "—" },
                { key: "closes", value: when(tender.closesAt), warn: true },
                { key: "opens", value: when(tender.opensAt) },
                {
                  key: "caution",
                  value: tender.cautionAmount
                    ? `${format.number(Number(tender.cautionAmount), { maximumFractionDigits: 0 })} ${tender.currency}`
                    : tender.cautionPct
                      ? `${tender.cautionPct} %`
                      : "—",
                  warn: Boolean(tender.cautionAmount) && !tender.cautionReceivedAt,
                },
                {
                  key: "validity",
                  value: tender.offerValidityDays
                    ? t("tender.days", { n: tender.offerValidityDays })
                    : tender.requiredValidityDays
                      ? t("tender.days", { n: tender.requiredValidityDays })
                      : "—",
                },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="shrink-0 text-tiny text-secondary">
                    {t(`tender.submission.${row.key}`)}
                  </dt>
                  <dd className="ms-auto text-end">
                    {row.warn ? (
                      <Badge tone="warning">{row.value}</Badge>
                    ) : (
                      <span className="text-tiny text-ink">{row.value}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {tender.submittedAt ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-plane p-3 text-micro leading-relaxed text-secondary">
                {t("tender.submittedOn", {
                  on: when(tender.submittedAt),
                  receipt: tender.depositReceiptRef ?? t("tender.noReceipt"),
                })}
              </p>
            ) : null}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("tender.readiness")}</h2>
              <span className="ms-auto text-tiny tabular-nums text-secondary">
                {folder.percent}%
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {folder.sections.map((section) => (
                <div key={section.section}>
                  <div className="flex items-baseline gap-3">
                    <span className="text-tiny text-secondary">
                      {t(`tender.section.${section.section}`)}
                    </span>
                    <span className="ms-auto text-micro tabular-nums text-muted">
                      {section.ready} / {section.total}
                    </span>
                  </div>
                  <span
                    className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line"
                    aria-hidden
                  >
                    <span
                      className={`block h-full rounded-full ${
                        section.ready === section.total ? "bg-good" : "bg-warning"
                      }`}
                      style={{ width: `${Math.floor((section.ready / section.total) * 100)}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </section>

          {folder.blocking.length > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="flex items-baseline gap-3">
                <h2 className="text-tiny font-semibold text-ink">{t("tender.blocking.title")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t("tender.blocking.count", { n: folder.blocking.length })}
                </span>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {folder.blocking.map((piece) => (
                  <li key={piece.key} className="flex items-baseline gap-3">
                    <span className="text-tiny text-secondary">
                      {piece.label ?? t(`tender.piece.${piece.key}`)}
                    </span>
                    <span className="ms-auto shrink-0">
                      <Badge tone="critical">{t(`tender.state.${piece.state}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-micro leading-relaxed text-muted">
                {t("tender.blocking.why")}
              </p>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("tender.thisIsAnEnquiry")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("tender.thisIsAnEnquiryWhy")}
            </p>
            <Link
              href={`/deals/${tender.dealId}`}
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {tender.ref}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
