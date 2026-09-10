import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { discardPersonAction } from "@/app/[locale]/(app)/contacts/delete-actions";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deletedPartyNotice, issuedDocumentCount, peopleOnSite } from "@/domain/deletion";
import { reversibleMerge } from "@/domain/merge";
import { getParty, listContacts } from "@/domain/party";
import { Link, redirect } from "@/i18n/navigation";
import { addCompanyAlias } from "../actions";
import { archiveCompany, discardCompany, restoreCompany } from "../delete-actions";
import { unmergeCompanies } from "../merge-actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-3 border-b border-line-subtle py-2 last:border-0">
      <span className="w-[160px] shrink-0 text-micro text-muted">{label}</span>
      <span className="text-tiny text-ink">{value || "—"}</span>
    </div>
  );
}

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ blocked?: string; unmerged?: string; unmergeBlocked?: string }>;
}) {
  const { locale, id } = await params;
  const { blocked, unmerged, unmergeBlocked } = await searchParams;
  const undone = unmerged === "1";
  setRequestLocale(locale);
  const t = await getTranslations();

  const company = await getParty(id);
  if (!company) notFound();

  // A merged company still resolves — the old link lands on the survivor.
  if (company.survivor) redirect({ href: `/companies/${company.survivor.id}`, locale });

  // Screen 83 — never a blank 404. A dead link inside your own system should
  // say what used to be there, and offer to bring it back.
  const gone = await deletedPartyNotice(id);
  if (gone) {
    return (
      <main className="min-h-0 flex-1 overflow-auto px-4 md:px-7 py-10">
        <div className="mx-auto max-w-[560px] rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <h1 className="text-lead font-semibold text-ink">
            {t("bin.goneTitle", { code: gone.code, name: gone.legalName })}
          </h1>
          <p className="mt-2 text-tiny leading-relaxed text-secondary">
            {t("bin.goneBody", {
              date: gone.deletedAt.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB"),
              days: gone.daysLeft,
            })}
          </p>
          {gone.reason ? (
            <p className="mt-2 rounded-[var(--radius-control)] bg-plane px-3 py-2 text-micro text-secondary">
              {t("bin.reasonGiven", { reason: gone.reason })}
            </p>
          ) : null}
          <form action={restoreCompany.bind(null, locale, id)} className="mt-4">
            <Button type="submit" variant="primary">
              {t("bin.restore")}
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const [contacts, reversible, issued] = await Promise.all([
    listContacts(id),
    reversibleMerge(id),
    issuedDocumentCount(id),
  ]);

  /**
   * Screen 83's two buttons, greyed rather than left to refuse after the press.
   *
   * Both of these used to submit, be turned away by `discardParty`, and come
   * back with a banner. That is a refusal a person only meets by trying, and
   * the rule is that a control which already knows it will refuse says so while
   * it is still grey. `issuedDocumentCount` is the same query the refusal runs,
   * so the button and the domain cannot disagree.
   */
  const session = await getSession();
  const mayDelete = session?.role ? can(session.role, "records.delete") : false;
  const notAllowed = mayDelete ? undefined : t("bin.notAllowed");
  const discardBlockedBy = notAllowed ?? (issued > 0 ? t("bin.cannotDiscardIssued") : undefined);

  /**
   * And the same question for each contact: a name is binnable unless the
   * person is still on a site crew. It is one query for the whole panel rather
   * than one per row.
   */
  const onSite = await peopleOnSite(contacts.map((c) => c.id));

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{company.legalName}</h1>
          <p className="mt-1 flex items-center gap-2 text-tiny text-muted">
            <span>{company.code}</span>
            {company.roles.map((role) => (
              <span
                key={role}
                className="rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro"
              >
                {t(`company.role.${role}`)}
              </span>
            ))}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {/* Screen 23, and only for suppliers: a scorecard on a client would
              be reply rates and price positions about somebody who has never
              quoted us anything. */}
          {company.roles.includes("supplier") ? (
            <Link href={`/companies/${id}/scorecard`}>
              <Button variant="secondary">{t("company.scorecard")}</Button>
            </Link>
          ) : null}
          <Link href={`/companies/${id}/edit`}>
            <Button variant="secondary">{t("company.edit")}</Button>
          </Link>
        </div>
      </div>

      {/*
        A MERGE IS THE ONE OPERATION HERE THAT REWRITES A RECORD PEOPLE RELY ON.
        `reversible_until` sat on `merge_log` from the first day with nothing
        reading it — a promise the schema made and the system could not keep.
        The banner is on the KEPT company because that is the record somebody is
        looking at when they notice the name is wrong, usually because a client
        has just queried a facture.
      */}
      {undone ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t("merge.undone")}
        </p>
      ) : null}
      {unmergeBlocked ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t(`merge.blocked.${unmergeBlocked}`)}
        </p>
      ) : null}
      {reversible ? (
        <div className="mx-4 md:mx-7 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border border-warning bg-warning-bg px-4 py-3">
          <p className="min-w-0 flex-1 text-tiny leading-relaxed text-warning-ink">
            {t("merge.reversible", {
              code: reversible.retiredCode,
              name: reversible.retiredName,
              who: reversible.mergedByName ?? t("merge.someone"),
              on: reversible.mergedAt.toLocaleDateString(locale === "fr" ? "fr-DZ" : "en-GB"),
              until: (reversible.reversibleUntil ?? reversible.mergedAt).toLocaleDateString(
                locale === "fr" ? "fr-DZ" : "en-GB",
              ),
            })}
            {/* Which fields it took — the answer `field_choices` was written
                to give and nothing read. "It was merged in" and "it was merged
                in and took the payment terms" are different things to be told
                while deciding whether to put it back. */}
            {reversible.took.length > 0
              ? ` ${t("merge.tookFields", {
                  fields: reversible.took
                    .map((f) => (t.has(`merge.field.${f}`) ? t(`merge.field.${f}`) : f))
                    .join(", "),
                })}`
              : ` ${t("merge.tookNothing")}`}
          </p>
          <form action={unmergeCompanies.bind(null, locale, reversible.mergeLogId, id)}>
            <Button type="submit" variant="secondary">
              {t("merge.undo")}
            </Button>
          </form>
        </div>
      ) : null}

      <div className="grid max-w-[1100px] grid-cols-1 md:grid-cols-3 gap-5 px-4 md:px-7 py-6">
        <section className="col-span-1 md:col-span-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("company.legalIdentity")}</h2>
          <p className="mt-1 text-micro text-muted">{t("company.usedOnEveryInvoice")}</p>
          <div className="mt-3">
            <Row label="NIF" value={company.nif} />
            <Row label="NIS" value={company.nis} />
            <Row label="RC" value={company.rc} />
            <Row label="AI" value={company.ai} />
            <Row label={t("company.address")} value={company.address} />
            <Row label={t("companies.wilaya")} value={company.wilaya} />
            <Row label={t("company.email")} value={company.email} />
            <Row label={t("company.phone")} value={company.phone} />
            <Row label={t("company.paymentTerms")} value={company.paymentTerms} />
            <Row
              label={t("companies.docLocale")}
              value={company.docLocale === "fr" ? "Français" : "English"}
            />
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("company.alsoKnownAs")}</h2>
          <p className="mt-1 text-micro leading-relaxed text-muted">{t("company.aliasHelp")}</p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {company.aliases.length === 0 ? (
              <li className="text-micro text-muted">{t("company.noAliases")}</li>
            ) : (
              company.aliases.map((alias) => (
                <li
                  key={alias}
                  className="rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro text-secondary"
                >
                  {alias}
                </li>
              ))
            )}
          </ul>
          <form action={addCompanyAlias.bind(null, locale, id)} className="mt-3 flex gap-2">
            <input
              name="alias"
              placeholder={t("company.addAlias")}
              className="h-[30px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-tiny outline-none focus:border-ink"
            />
            <Button type="submit" variant="secondary" size="small">
              {t("common.save")}
            </Button>
          </form>
        </section>

        <section className="col-span-1 md:col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("nav.contacts")}</h2>
          {blocked === "onSite" ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
              {t("bin.blockedByCrew")}
            </p>
          ) : null}
          {blocked === "notAllowed" ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
              {t("bin.notAllowed")}
            </p>
          ) : null}
          {contacts.length === 0 ? (
            <p className="mt-2 text-micro text-muted">{t("company.noContacts")}</p>
          ) : (
            <table className="mt-3 w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="py-2 text-start font-medium">{t("company.contactName")}</th>
                  <th className="py-2 text-start font-medium">{t("company.contactTrade")}</th>
                  <th className="py-2 text-start font-medium">{t("company.email")}</th>
                  <th className="py-2 text-start font-medium">{t("company.phone")}</th>
                  <th className="py-2 text-end font-medium">{t("bin.remove")}</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-line-subtle last:border-0">
                    <td className="py-2 text-ink">{c.fullName}</td>
                    <td className="py-2 text-secondary">
                      {c.trade === "unspecified" ? (
                        <Badge tone="neutral">{t("company.tradeUnspecified")}</Badge>
                      ) : (
                        c.trade
                      )}
                    </td>
                    <td className="py-2 text-secondary">{c.email || "—"}</td>
                    <td className="py-2 text-secondary">{c.phone || "—"}</td>
                    {/*
                      A name is the cheapest row in this system to create and,
                      until now, the only one that could never be removed. It
                      goes to the bin for 30 days like everything else — and the
                      button is present and grey when it may not, so the reason
                      is readable rather than absent.
                    */}
                    <td className="py-2 text-end">
                      <form action={discardPersonAction.bind(null, locale)}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="back" value={`/companies/${id}`} />
                        <input type="hidden" name="screen" value="22" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="small"
                          disabledReason={
                            notAllowed ??
                            ((onSite.get(c.id) ?? 0) > 0
                              ? t("bin.personOnSite", { count: onSite.get(c.id) ?? 0 })
                              : undefined)
                          }
                        >
                          {t("bin.remove")}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Screen 83 — three words that are not the same. */}
        <section className="col-span-1 md:col-span-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("bin.removing")}</h2>
          <p className="mt-1 max-w-[720px] text-micro leading-relaxed text-secondary">
            {t("bin.removingHelp")}
          </p>

          {blocked === "issued" ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
              {t("bin.blockedByIssued")}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <form action={discardCompany.bind(null, locale, id)} className="flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-micro font-medium text-secondary">{t("bin.reason")}</span>
                <input
                  name="reason"
                  required
                  placeholder={t("bin.reasonPlaceholder")}
                  className="h-[34px] w-[320px] rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny outline-none focus:border-ink"
                />
              </label>
              <Button type="submit" variant="danger" disabledReason={discardBlockedBy}>
                {t("bin.discard")}
              </Button>
            </form>

            <form action={archiveCompany.bind(null, locale, id)}>
              <Button type="submit" variant="secondary" disabledReason={notAllowed}>
                {t("bin.archive")}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
