import { asc } from "drizzle-orm";
import { Info } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { discardPersonAction } from "@/app/[locale]/(app)/contacts/delete-actions";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { party } from "@/db/schema/party";
import { liveParty } from "@/domain/deletion";
import { isPeopleFacet, listPeople, PEOPLE_FACETS, peopleCounts } from "@/domain/people";
import { Link } from "@/i18n/navigation";
import { AddPerson } from "./add-person";
import { PeopleList } from "./people-list";

/**
 * Screen 51 — People.
 *
 * "A CV is evidence, not a requirement." The whole screen is arranged to make
 * that true rather than to say it: the four origins are listed as equals, the
 * add form has two required fields, and nothing anywhere asks for a document
 * before a person may exist.
 */
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ facet?: string; error?: string; blocked?: string }>;
}) {
  const { locale } = await params;
  const { facet: raw, error, blocked } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  const mayDelete = session?.role ? can(session.role, "records.delete") : false;

  const facet = isPeopleFacet(raw) ? raw : "all";
  const [rows, counts, employers] = await Promise.all([
    listPeople(facet),
    peopleCounts(),
    db
      .select({ id: party.id, legalName: party.legalName })
      .from(party)
      .where(liveParty)
      .orderBy(asc(party.legalName))
      .limit(500),
  ]);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex shrink-0 items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("nav.people")}</h1>
          <p className="mt-1 text-tiny text-muted">
            {t("people.subtitle", {
              total: counts.all,
              fromCv: counts.cv,
              rest: counts.all - counts.cv,
            })}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {/*
            Task 3.4. `/candidates` is the other half of this screen — the
            people who are not on the payroll yet — and it was reachable from
            nowhere. Somebody screening CVs had to know the URL, on the screen
            that lists everyone they would be screening against.
          */}
          <Link href="/candidates">
            <Button variant="secondary">{t("people.candidates")}</Button>
          </Link>
          <Button variant="secondary" disabledReason={t("rules.comingInPhase", { phase: 2 })}>
            {t("contacts.import")}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
          {t(`people.error.${error}`)}
        </p>
      ) : null}

      {/* The grey button submits — `aria-disabled`, not `disabled` — so every
          reason it was grey comes back as a sentence rather than a 500. */}
      {blocked === "onSite" ? (
        <p className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
          {t("bin.blockedByCrew")}
        </p>
      ) : null}
      {blocked === "notAllowed" ? (
        <p className="mx-4 md:mx-7 mt-5 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
          {t("bin.notAllowed")}
        </p>
      ) : null}

      <div className="mx-4 md:mx-7 mt-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-accent bg-accent-bg px-4 py-3">
        <Info className="mt-px size-4 shrink-0 text-accent-ink" aria-hidden />
        <p className="text-tiny leading-relaxed text-accent-ink">{t("people.directlyBanner")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pt-5">
        {PEOPLE_FACETS.map((key) => {
          const active = key === facet;
          return (
            <Link
              key={key}
              href={key === "all" ? "/people" : `/people?facet=${key}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1 text-tiny transition-colors ${
                active
                  ? "bg-ink font-medium text-on-ink"
                  : "border border-line bg-surface text-secondary hover:bg-sunken"
              }`}
            >
              {t(`people.facet.${key}`)}
              <span className={active ? "text-on-ink/70" : "text-muted"}>{counts[key]}</span>
            </Link>
          );
        })}
      </div>

      <PeopleList
        rows={rows}
        total={counts.all}
        discard={discardPersonAction.bind(null, locale)}
        notAllowed={mayDelete ? undefined : t("bin.notAllowed")}
      />

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 pb-8">
        <div className="col-span-1 md:col-span-2">
          <AddPerson locale={locale} employers={employers} />
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("people.whereFromTitle")}</h2>
              <span className="ms-auto text-micro text-muted">{t("people.allFourEqual")}</span>
            </div>
            <dl className="mt-3">
              {(["cv", "direct", "subcontractor", "import"] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="text-tiny text-secondary">{t(`people.origin.${key}`)}</dt>
                  <dd className="ms-auto text-tiny text-ink">
                    {t("people.nPeople", { n: counts[key] })}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-micro leading-relaxed text-muted">
              {t("people.whereFromBody")}
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("people.appliesTitle")}</h2>
            <dl className="mt-3">
              <Applies label={t("people.applies.expiry")} tone="good" value={t("common.yes")} />
              <Applies label={t("people.applies.project")} tone="good" value={t("common.yes")} />
              <Applies
                label={t("people.applies.moyensHumains")}
                tone="warning"
                value={t("people.ifCertified")}
              />
              <Applies
                label={t("people.applies.subcontractorRisk")}
                tone="warning"
                value={t("people.tracked")}
              />
              <div className="flex items-baseline gap-3 py-2">
                <dt className="text-tiny text-secondary">{t("people.applies.retention")}</dt>
                <dd className="ms-auto text-tiny">
                  <Link href="/settings" className="text-ink underline underline-offset-2">
                    {t("people.setInSettings")}
                  </Link>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </main>
  );
}

function Applies({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "good" | "warning";
  value: string;
}) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line-subtle py-2">
      <dt className="text-tiny text-secondary">{label}</dt>
      <dd className="ms-auto">
        <Badge tone={tone}>{value}</Badge>
      </dd>
    </div>
  );
}
