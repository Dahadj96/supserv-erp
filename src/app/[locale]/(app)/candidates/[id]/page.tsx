import { redirect as hardRedirect, notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCandidate } from "@/domain/recruitment/store";
import { Link } from "@/i18n/navigation";
import { saveCertificationAction, verifyCertificationAction } from "./actions";

/**
 * Screen 25 — one candidate.
 *
 * The certifications are the substance. Everything else on this page is contact
 * details somebody could keep in a phone; the tickets, their expiry dates and
 * which sites they let a man onto are what the system is for.
 *
 * "Being considered for" reads from the shortlists rather than from a field on
 * the person, because the same welder can be confirmed on one site and merely
 * shortlisted for another, and one stage on the person could not say that.
 */
export const dynamic = "force-dynamic";

export default async function CandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ recorded?: string; error?: string }>;
}) {
  const { locale, id } = await params;
  const { recorded, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const candidate = await getCandidate(id);
  if (!candidate) notFound();

  const format = await getFormatter({ locale });

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-title font-semibold text-ink">{candidate.name}</h1>
          <Badge tone={candidate.hired ? "good" : "neutral"}>
            {t(`candidates.stage.${candidate.hired ? "hired" : candidate.stage}`)}
          </Badge>
        </div>
        <p className="mt-1 text-tiny text-muted">
          {candidate.trade}
          {candidate.appliedFor
            ? ` · ${t("candidate.appliedFor", { for: candidate.appliedFor })}`
            : ""}
          {` · ${t("candidate.arrivedBy", { source: t(`people.source.${candidate.source}`) })}`}
        </p>
      </div>

      {recorded ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-good-bg px-4 py-2.5 text-tiny text-good-ink">
          {t(`candidate.recorded.${recorded}`)}
        </p>
      ) : null}
      {error ? (
        <p className="mx-4 md:mx-7 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink">
          {t(`candidate.error.${error}`)}
        </p>
      ) : null}

      <div className="grid max-w-[1200px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("candidate.certifications.title")}
              </h2>
              <span className="ms-auto text-micro text-muted">
                {t("candidate.certifications.why")}
              </span>
            </div>

            {candidate.certifications.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("candidate.certifications.none")}
              </p>
            ) : (
              <table className="w-full border-collapse text-tiny">
                <thead>
                  <tr className="border-b border-line-subtle bg-plane text-micro text-muted">
                    <th className="px-5 py-2 text-start font-medium">
                      {t("candidate.column.kind")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("candidate.column.number")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("candidate.column.issuedBy")}
                    </th>
                    <th className="px-3 py-2 text-start font-medium">
                      {t("candidate.column.expires")}
                    </th>
                    <th className="px-5 py-2 text-start font-medium">
                      {t("candidate.column.verified")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.certifications.map((cert) => (
                    <tr key={cert.id} className="border-b border-line-subtle last:border-0">
                      <td className="px-5 py-2.5 text-ink">{cert.kind}</td>
                      <td className="px-3 py-2.5 font-mono text-micro text-secondary">
                        {cert.number ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-secondary">{cert.issuedBy ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {cert.expiresOn === null ? (
                          <span className="text-muted">{t("candidate.doesNotExpire")}</span>
                        ) : (cert.daysLeft ?? 0) < 0 ? (
                          <Badge tone="critical">{t("candidates.expired")}</Badge>
                        ) : (cert.daysLeft ?? 0) <= 30 ? (
                          <Badge tone="warning">
                            {t("candidates.expiresIn", {
                              on: cert.expiresOn,
                              days: cert.daysLeft ?? 0,
                            })}
                          </Badge>
                        ) : (
                          <span className="text-secondary">{cert.expiresOn}</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5">
                        {/* LAW 2. A ticket somebody photocopied is not a ticket
                            anybody has checked, and a site that turns a man
                            away does not care which of the two it was.

                            The badge said "Non contrôlée" on every ticket in
                            the company for as long as this screen existed:
                            `is_verified` was a boolean nothing could set. It is
                            now a person and a date, and the button below is how
                            they get there. */}
                        <form
                          action={verifyCertificationAction.bind(null, locale, candidate.id)}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="certificationId" value={cert.id} />
                          <input
                            type="hidden"
                            name="verified"
                            value={cert.verified ? "no" : "yes"}
                          />
                          <Badge tone={cert.verified ? "good" : "warning"}>
                            {t(cert.verified ? "candidate.verified" : "candidate.unverified")}
                          </Badge>
                          <Button
                            type="submit"
                            variant="ghost"
                            disabledReason={
                              canWrite(session.role) ? undefined : t("documents.notAllowed")
                            }
                          >
                            {t(cert.verified ? "candidate.unsee" : "candidate.sawIt")}
                          </Button>
                          <span className="basis-full text-micro text-muted">
                            {cert.verified
                              ? t("candidate.checkedBy", {
                                  who: cert.verifiedByName ?? t("candidate.someone"),
                                  on: cert.verifiedOn ?? "",
                                })
                              : /* Unchecked: who to go and ask for the paper. */
                                t("candidate.typedBy", {
                                  who: cert.recordedByName ?? t("candidate.someone"),
                                  on: cert.recordedOn ?? "",
                                })}
                          </span>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/*
              THE TABLE ABOVE COULD ONLY EVER BE EMPTY. Screen 25 read
              `person_certification` from the day it was built, screen 51 puts
              the soonest-expiring ticket on every row, and screen 16's crew
              panel decides off it whether a man may work tomorrow — and there
              was no insert anywhere in the application. This is it.
            */}
            <form
              action={saveCertificationAction.bind(null, locale, candidate.id)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-line-subtle px-5 py-4"
            >
              <label className="sm:col-span-2">
                <span className="text-micro text-secondary">{t("candidate.f.kind")}</span>
                <input
                  name="kind"
                  required
                  placeholder={t("candidate.f.kindPlaceholder")}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("candidate.column.number")}</span>
                <input name="number" className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("candidate.column.issuedBy")}</span>
                <input name="issuedBy" className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("candidate.f.issuedOn")}</span>
                <input type="date" name="issuedOn" className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("candidate.f.expiresOn")}</span>
                <input type="date" name="expiresOn" className={`${INPUT} mt-1`} />
              </label>
              <p className="sm:col-span-2 text-micro leading-relaxed text-muted">
                {t("candidate.f.why")}
              </p>
              <div className="sm:col-span-2 flex">
                <div className="ms-auto">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabledReason={canWrite(session.role) ? undefined : t("documents.notAllowed")}
                  >
                    {t("candidate.f.add")}
                  </Button>
                </div>
              </div>
            </form>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t("candidate.considered.title")}
              </h2>
            </div>

            {candidate.considered.length === 0 ? (
              <p className="px-5 py-4 text-tiny leading-relaxed text-secondary">
                {t("candidate.considered.none")}
              </p>
            ) : (
              <ul>
                {candidate.considered.map((row) => (
                  <li
                    key={row.candidateId}
                    className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-2.5 last:border-0"
                  >
                    <Link href="/personnel-requests" className="text-tiny text-ink hover:underline">
                      {row.ref}
                    </Link>
                    <span className="text-tiny text-secondary">
                      {row.role}
                      {row.wilaya ? ` · ${row.wilaya}` : ""}
                      {row.startOn ? ` · ${t("candidate.startsOn", { on: row.startOn })}` : ""}
                    </span>
                    <span className="ms-auto shrink-0">
                      <Badge
                        tone={
                          row.stage === "confirmed"
                            ? "good"
                            : row.stage === "rejected"
                              ? "critical"
                              : "neutral"
                        }
                      >
                        {t(`requests.stage.${row.stage}`)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("candidate.details")}</h2>
            <dl className="mt-3">
              {[
                { key: "trade", value: candidate.trade },
                { key: "appliedFor", value: candidate.appliedFor ?? "—" },
                { key: "mobility", value: candidate.mobility ?? "—" },
                { key: "wilaya", value: candidate.wilaya ?? "—" },
                { key: "phone", value: candidate.phone ?? "—" },
                { key: "email", value: candidate.email ?? "—" },
                { key: "employer", value: candidate.employer ?? t("candidate.usOrNobody") },
                {
                  key: "received",
                  value: format.dateTime(candidate.receivedAt, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  }),
                },
              ].map((row) => (
                <div
                  key={row.key}
                  className="flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0"
                >
                  <dt className="shrink-0 text-tiny text-secondary">
                    {t(`candidate.field.${row.key}`)}
                  </dt>
                  <dd className="ms-auto break-all text-end text-tiny text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("candidate.samePerson")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("candidate.samePersonWhy")}
            </p>
            <Link
              href="/people"
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {t("nav.people")}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
