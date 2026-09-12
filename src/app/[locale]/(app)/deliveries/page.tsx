import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  describeDocumentDiscard,
  discardDocumentFromListAction,
} from "@/app/[locale]/(app)/documents/[id]/delete-actions";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowDelete } from "@/components/ui/row-delete";
import { StateBlock } from "@/components/ui/state-block";
import { deliveries } from "@/domain/delivery/store";
import { Link } from "@/i18n/navigation";

/**
 * Screen 14 — Deliveries.
 *
 * The frame draws this inside one order: "ORD-2026-0046 / Deliveries", with an
 * order overview beside it. Orders are not a module in this system yet — they
 * appear in no phase of `docs/PLAN.md` §7 — so the list is anchored on what
 * does exist: the document each bon de livraison COVERS, which is the offer or
 * proforma the client agreed to. The same query takes a `sourceId` and narrows
 * to one, which is the per-order view the day orders arrive.
 *
 * The amber banner is the point of the screen: "Delivery BL-2026-0118 has no
 * signed proof attached. Without it we cannot answer a delivery dispute."
 */
export const dynamic = "force-dynamic";

export default async function DeliveriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { locale } = await params;
  const { source } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const rows = await deliveries(source ? { sourceId: source } : {});

  // Issued, gone out, and no signed copy has come back. A draft is a lorry
  // that has not left, so it is not missing anything yet.
  const unsigned = rows.filter((row) => row.number !== null && row.signedCopyOnFile === null);

  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      {/*
        P1. Task 3.4's button keeps its place and its reason: `/deliveries/new`
        was reachable from nowhere — from screen 06's next-step panel since 2.6,
        and before that from a typed URL and nothing else — so the one screen
        that STARTS a delivery was missing from the screen that lists them.
        Greyed with the reason rather than hidden, per the law: a permission
        never hides that a thing exists.
      */}
      <PageHeader
        crumb={[{ label: "SUPSERV", href: "/today" }, { label: t("deliveries.title") }]}
        title={t("deliveries.title")}
        state={t("deliveries.subtitle", { n: rows.length, unsigned: unsigned.length })}
        actions={
          <Link href="/deliveries/new">
            <Button
              variant="primary"
              disabledReason={
                can(session.role, "deliveries.issue") ? undefined : t("deliveries.newNotAllowed")
              }
            >
              {t("deliveries.new")}
            </Button>
          </Link>
        }
      />

      {unsigned.length > 0 ? (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3 md:mx-7">
          <AlertCircle className="size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-warning-ink">
            {t("deliveries.noProof", {
              numbers: unsigned
                .slice(0, 3)
                .map((row) => row.number)
                .join(", "),
              n: unsigned.length,
            })}
          </p>
        </div>
      ) : null}

      <div className="px-4 py-5 md:px-7">
        {/*
          Task 3.2. The empty state REPLACES the card rather than sitting inside
          it: `StateBlock` draws its own border and its own padding, and one
          bordered box centred inside another is the look of a component used
          where it does not belong. An empty table has no header worth keeping.
        */}
        {rows.length === 0 ? (
          <StateBlock
            title={t("deliveries.emptyTitle")}
            body={t("deliveries.empty")}
            action={
              <Link href="/deliveries/new">
                <Button
                  variant="primary"
                  disabledReason={
                    can(session.role, "deliveries.issue")
                      ? undefined
                      : t("deliveries.newNotAllowed")
                  }
                >
                  {t("deliveries.new")}
                </Button>
              </Link>
            }
          />
        ) : (
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle text-micro uppercase tracking-wide text-muted">
                    <th className="py-2 ps-5 text-start font-medium">{t("deliveries.number")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.client")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.covers")}</th>
                    <th className="py-2 pe-4 text-start font-medium">{t("deliveries.date")}</th>
                    <th className="py-2 pe-4 text-end font-medium">{t("deliveries.lines")}</th>
                    <th className="py-2 pe-5 text-start font-medium">{t("deliveries.proof")}</th>
                    <th className="w-10 py-2.5 pe-5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.documentId} className="border-b border-line-subtle last:border-0">
                      <td className="py-2.5 ps-5">
                        <Link
                          href={`/deliveries/${row.documentId}`}
                          className="font-mono text-micro font-medium text-ink hover:underline"
                        >
                          {row.number ?? t("deliveries.draft")}
                        </Link>
                      </td>
                      <td className="py-2.5 pe-4 text-secondary">{row.clientName}</td>
                      <td className="py-2.5 pe-4 font-mono text-micro text-muted">
                        {row.coversNumber ?? "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-muted">
                        {row.issuedOn ? day.format(row.issuedOn) : "—"}
                      </td>
                      <td className="py-2.5 pe-4 text-end tabular-nums text-ink">{row.lines}</td>
                      <td className="py-2.5 pe-5">
                        {row.number === null ? (
                          // Nothing has gone out, so nothing is missing.
                          <span className="text-micro text-muted">
                            {t("deliveries.notDispatched")}
                          </span>
                        ) : row.signedCopyOnFile ? (
                          <Badge tone="good">
                            {t("deliveries.signedBy", { who: row.receivedBy ?? "—" })}
                          </Badge>
                        ) : (
                          <Badge tone="warning">{t("deliveries.proofMissing")}</Badge>
                        )}
                      </td>
                      {/* Drafts only. A bon de livraison that has gone out is
                          paper the client signed for. */}
                      <td className="py-2.5 pe-5 text-end">
                        {row.number === null ? (
                          <RowDelete
                            label={t("deliveries.draft")}
                            what={t("rowDelete.what.document")}
                            describe={describeDocumentDiscard.bind(null, locale, row.documentId)}
                            action={discardDocumentFromListAction.bind(
                              null,
                              locale,
                              "/deliveries",
                              row.documentId,
                            )}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("deliveries.whyItMatters")}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
