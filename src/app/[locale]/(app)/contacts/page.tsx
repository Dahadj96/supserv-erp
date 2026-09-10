import { CircleAlert } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  bouncingContacts,
  CONTACT_FACETS,
  contactCounts,
  contactQuality,
  isContactFacet,
  listContactRows,
} from "@/domain/contact";
import { Link } from "@/i18n/navigation";
import { ContactsList } from "./contacts-list";

/**
 * Screen 76 — Contacts.
 *
 * "A contact belongs to a company, but you deal with people. When a deadline is
 * in six hours you search a name, not a company. And a person moves — the same
 * buyer appears at a new employer and everything they told you should follow
 * them."
 *
 * The facet lives in the address (screen 79), so the chip a person clicks is a
 * link they can paste to somebody else.
 */
export const dynamic = "force-dynamic";

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ facet?: string }>;
}) {
  const { locale } = await params;
  const { facet: raw } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const facet = isContactFacet(raw) ? raw : "all";
  const [rows, counts, quality, bouncing] = await Promise.all([
    listContactRows(facet),
    contactCounts(),
    contactQuality(),
    bouncingContacts(),
  ]);

  const first = bouncing[0];

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex shrink-0 items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("nav.contacts")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("contacts.subtitle", {
              people: quality.total,
              companies: quality.companies,
              unverified: quality.unverified,
              bouncing: quality.bouncing,
            })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {/* The Excel move-in is screen 62 and arrives with phase 2. Listed and
              greyed rather than hidden — a permission or a phase never hides
              that a thing exists (screen 79). */}
          <Button variant="secondary" disabledReason={t("rules.comingInPhase", { phase: 2 })}>
            {t("contacts.import")}
          </Button>
          <Link href="/contacts/new">
            <Button variant="primary">{t("contacts.newContact")}</Button>
          </Link>
        </div>
      </div>

      {first ? (
        <div className="mx-4 md:mx-7 mt-5 flex items-center gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-2.5">
          <CircleAlert className="size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny text-critical-ink">
            {first.lastContactAt
              ? t("contacts.bouncingKnown", {
                  count: quality.bouncing,
                  company: first.companyName,
                })
              : t("contacts.bouncingNeverReached", {
                  count: quality.bouncing,
                  company: first.companyName,
                })}
          </p>
          <div className="ms-auto">
            <Link href="/contacts?facet=bouncing">
              <Button variant="secondary" size="small">
                {t("contacts.fixIt")}
              </Button>
            </Link>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pt-5">
        {CONTACT_FACETS.map((key) => {
          const active = key === facet;
          return (
            <Link
              key={key}
              href={key === "all" ? "/contacts" : `/contacts?facet=${key}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1 text-tiny transition-colors ${
                active
                  ? "bg-ink font-medium text-on-ink"
                  : "border border-line bg-surface text-secondary hover:bg-sunken"
              }`}
            >
              {t(`contacts.facet.${key}`)}
              <span className={active ? "text-on-ink/70" : "text-muted"}>{counts[key]}</span>
            </Link>
          );
        })}
      </div>

      <ContactsList rows={rows} total={counts.all} />

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 pb-8">
        <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("contacts.whyOwnScreenTitle")}</h2>
          <p className="mt-2 max-w-[680px] text-tiny leading-relaxed text-secondary">
            {t("contacts.whyOwnScreenBody")}
          </p>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("contacts.qualityTitle")}</h2>
          <dl className="mt-3">
            <QualityRow
              label={t("contacts.withAnEmail")}
              value={t("contacts.ofTotal", { n: quality.withEmail, total: quality.total })}
            />
            <QualityRow
              label={t("contacts.withAPhone")}
              value={t("contacts.ofTotal", { n: quality.withPhone, total: quality.total })}
            />
            <QualityRow label={t("contacts.neither")} value={String(quality.neither)} />
            <QualityRow label={t("contacts.facet.unverified")} value={String(quality.unverified)} />
            <QualityRow label={t("contacts.facet.bouncing")} value={String(quality.bouncing)} />
            <QualityRow
              label={t("contacts.neverContacted")}
              value={String(quality.neverContacted)}
            />
          </dl>
        </section>
      </div>
    </main>
  );
}

function QualityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0">
      <dt className="text-tiny text-secondary">{label}</dt>
      <dd className="ms-auto text-tiny text-ink">{value}</dd>
    </div>
  );
}
