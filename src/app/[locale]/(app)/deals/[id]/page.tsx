import { and, eq, isNull } from "drizzle-orm";
import { AlertCircle } from "lucide-react";
import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { can } from "@/auth/can";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { db } from "@/db";
import { party, partyRole } from "@/db/schema/party";
import { dealChecks, nextStep } from "@/domain/deal/checks";
import { getDeal, NO_BID_REASONS } from "@/domain/deal/deal";
import { requestsForDeal } from "@/domain/deal/sourcing-store";
import { badgeMessageKey, DEADLINE_WARNING_HOURS } from "@/domain/deal/stage";
import { formatMoney } from "@/domain/money";
import { offersForDeal } from "@/domain/offer/store";
import { liveCompanies } from "@/domain/party";
import { projectForDeal } from "@/domain/project/store";
import { PROCEDURES } from "@/domain/tender/dossier";
import { getTender, unmakeTenderBlockedBy } from "@/domain/tender/store";
import { Link } from "@/i18n/navigation";
import { decideAction, lostAction, reopenAction } from "./actions";
import { askSuppliersAction } from "./ask-actions";
import { buildOfferAction } from "./build-actions";
import { discardDealAction } from "./delete-actions";
import { makeTenderAction, unmakeTenderAction } from "./tender-actions";

/*
 * The table of tones that used to live here — the same four screen 12 gives the
 * same four states — moved into `Stepper` with task 2.6. Three screens draw
 * these states now, and a second table of class names is how two of them come
 * to disagree about what `note` looks like.
 */

/**
 * Screen 06 — the enquiry.
 *
 * The banner at the top is the reason this screen is worth building before the
 * offer builder. TouatGaz does not accept submission by email; an offer sent
 * that way is not late, it is discarded. The system knew that from the moment
 * the consultation was read, and a system that knows and does not say so is
 * worse than no system at all.
 */
export const dynamic = "force-dynamic";

const TONE: Record<string, "good" | "warning" | "critical" | "neutral" | "accent"> = {
  new: "accent",
  qualifying: "neutral",
  sourcing: "warning",
  offerOut: "accent",
  ordered: "good",
  invoiced: "good",
  won: "good",
  lost: "critical",
  noBid: "neutral",
};

export default async function EnquiryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const found = await getDeal(id);
  if (!found) notFound();

  const { deal: row, clientName, lines, facts, badge, open, deadline } = found;

  /**
   * Screen 83's button, greyed rather than absent.
   *
   * A missing control teaches nothing. Both reasons a person cannot bin an
   * enquiry are worth reading: one is about their role, the other is LAW 5 —
   * an enquiry carrying an issued document is evidence, and the fix is an
   * avoir, not a deletion. The domain refuses either way; this only decides
   * which sentence to show.
   */
  const mayDelete = session.role ? can(session.role, "records.delete") : false;
  const hasIssuedDocuments =
    facts.offersIssued > 0 || facts.ordersReceived > 0 || facts.invoicesIssued > 0;
  const discardBlockedBy = !mayDelete
    ? t("deal.discard.notAllowed")
    : hasIssuedDocuments
      ? t("deal.discard.hasIssued")
      : undefined;

  /**
   * Is this deal answering a formal procedure?
   *
   * `getTender` returns null for an ordinary enquiry, which is most of them,
   * and that null is what decides between offering the conversion and offering
   * the undo. Nothing about it is stored on the deal — a tender IS a deal, and
   * the `tender` row's existence is the whole of the classification.
   */
  const [suppliers, requests, offers, projectOpened, tenderOn] = await Promise.all([
    // T9 — the same rule the directory uses, so a supplier this deal offers is
    // a supplier screen 21 lists.
    liveCompanies({ role: "supplier" }),
    requestsForDeal(id),
    offersForDeal(id),
    projectForDeal(id),
    getTender(id),
  ]);

  // Why the undo is grey, when it is. Asked only when there is something to
  // undo, and answered by the same function the domain refuses with.
  const unmakeBlockedBy = tenderOn ? await unmakeTenderBlockedBy(id) : null;

  /**
   * `offers.issue` — saying a deal answers a formal procedure is the same
   * judgement as deciding to pursue it, and the same permission. Greyed with
   * the reason rather than absent, both ways round: a Compta who cannot
   * classify should be able to read why, not wonder where the button is.
   */
  const mayClassify = session.role ? can(session.role, "offers.issue") : false;
  const classifyBlockedBy = mayClassify ? undefined : t("tender.make.notAllowed");

  /*
    WHAT HAPPENS NEXT — task 2.5.

    Eight cards render below in the order somebody happened to write them, all
    equally loud, and a person opening an enquiry has to read all eight to find
    the one waiting on them. `dealChecks` answers that in the shape screens 12
    and 18 already use, over the facts `getDeal` computed on the way in — LAW 1,
    no column, no second opinion, and no extra query.

    The draft to point at is the first offer with no number: LAW 5 says a draft
    is not an offer out, so a deal carrying one still has something waiting, and
    the link goes to that draft rather than to a form that makes a second.
  */
  const checks = dealChecks({
    ...facts,
    dealId: id,
    open,
    deadlineAt: row.deadlineAt,
    offersDrafted: offers.length,
    draftOfferId: offers.find((offer) => !offer.number)?.id ?? null,
  });
  const next = nextStep(checks);

  const when = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-DZ" : "en-GB", { dateStyle: "medium" });

  const urgent =
    deadline.kind === "at" &&
    deadline.hoursLeft !== null &&
    deadline.hoursLeft < DEADLINE_WARNING_HOURS;
  const overdue = deadline.kind === "at" && (deadline.hoursLeft ?? 0) < 0;

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex flex-wrap items-start gap-3 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5">
        <div className="min-w-0">
          <h1 className="text-title font-semibold text-ink">
            {row.ref} — {row.subject}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-tiny text-muted">
            <span>{clientName}</span>
            {row.clientReference ? <span>· {row.clientReference}</span> : null}
            <span>
              · {t("deal.received")} {when.format(row.receivedAt)}
            </span>
            <Badge tone={TONE[badge] ?? "neutral"}>{t(badgeMessageKey(badge))}</Badge>
            {/*
              Until now this page contained the word "tender" nought times, so
              nothing on it said that this deal is answering a formal procedure
              — the one fact that changes what everybody does next.
            */}
            {tenderOn ? (
              <Badge tone="accent">
                {t("tender.onDeal.badge", {
                  procedure: t(`tenders.procedure.${tenderOn.procedure}`),
                })}
              </Badge>
            ) : null}
          </p>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {/* Screen 56 — everything that happened, and the only place a note
              or a logged call can be written down. */}
          <Link href={`/deals/${id}/timeline`}>
            <Button variant="secondary">{t("timeline.everythingThatHappened")}</Button>
          </Link>
          <Link href={`/deals/${id}/prices`}>
            <Button variant="secondary">{t("prices.gathered")}</Button>
          </Link>
          <Link href={`/deals/${id}/technical`}>
            <Button variant="secondary">{t("technical.tab")}</Button>
          </Link>
          {/*
            Screen 73. It has existed since the item-list hole was filled and
            NOTHING in the codebase linked to it — the only way to correct a
            quantity read wrong from an email was to know the URL. It belongs
            beside the other three tabs of the same deal.
          */}
          <Link href={`/deals/${id}/items`}>
            <Button variant="secondary">{t("dealItems.title")}</Button>
          </Link>
          {tenderOn ? (
            <>
              <Link href={`/tenders/${id}`}>
                <Button variant="secondary">{t("tender.onDeal.folder")}</Button>
              </Link>
              {/*
                Screen 42, the bordereau import — reachable from nowhere but
                itself until now, which on a tender is the screen the work
                actually happens on.
              */}
              <Link href={`/tenders/${id}/bpu`}>
                <Button variant="secondary">{t("tender.onDeal.bpu")}</Button>
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {/*
        The banner. Only shown while the enquiry is still live — telling somebody
        how to submit an offer for a consultation they walked away from in June
        is the sort of noise that teaches people to scroll past red.
      */}
      {open && row.submissionMethod === "deposit_sealed" ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-critical-ink">
            {t("deal.sealedBanner", { client: clientName })}
          </p>
        </div>
      ) : null}

      {open && row.submissionMethod === "portal" ? (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-line bg-warning-bg px-4 py-3 md:mx-7">
          <AlertCircle className="mt-px size-4 shrink-0 text-warning-ink" aria-hidden />
          <p className="text-tiny leading-relaxed text-warning-ink">
            {t("deal.portalBanner", { client: clientName })}
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mx-4 mt-4 rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`deal.error.${error}`) ? t(`deal.error.${error}`) : error}
        </p>
      ) : null}

      <div className="grid max-w-[1400px] grid-cols-1 items-start gap-5 px-4 py-5 md:grid-cols-3 md:px-7 md:py-6">
        <div className="flex flex-col gap-5 md:col-span-2">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("deal.requestedItems")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("deal.nLines", { n: lines.length })} · {t("deal.noClientCodes")}
              </span>
            </div>

            {lines.length === 0 ? (
              <p className="px-5 py-4 text-tiny text-muted">{t("deal.noLines")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-tiny">
                  <thead>
                    <tr className="text-micro uppercase tracking-wide text-muted">
                      <th className="py-2 ps-5 text-start font-medium">#</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("deal.lineRef")}</th>
                      <th className="py-2 pe-4 text-start font-medium">{t("deal.designation")}</th>
                      <th className="py-2 pe-4 text-end font-medium">{t("deal.qty")}</th>
                      <th className="py-2 pe-5 text-start font-medium">{t("deal.unit")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.id} className="border-t border-line-subtle">
                        <td className="py-2.5 ps-5 text-muted">{line.position}</td>
                        <td className="py-2.5 pe-4 font-mono text-micro text-secondary">
                          {line.reference ?? "—"}
                        </td>
                        <td className="py-2.5 pe-4 text-ink">{line.designation}</td>
                        <td className="py-2.5 pe-4 text-end tabular-nums">{Number(line.qty)}</td>
                        <td className="py-2.5 pe-5 text-muted">{line.unit ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* `id`s here and on the two cards below are what the next-step
              panel's links land on. A check whose fix is a form on this same
              screen should scroll to that form, not reload the page. */}
          <section
            id="decision"
            className="scroll-mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("deal.decision")}</h2>
              <span className="ms-auto text-micro text-muted">{t("deal.decisionWhy")}</span>
            </div>

            {open ? (
              <form action={decideAction.bind(null, locale, id)} className="mt-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(["pursue", "no_bid"] as const).map((choice) => (
                    <label
                      key={choice}
                      className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border border-line bg-plane px-4 py-3 has-[:checked]:border-ink has-[:checked]:bg-surface"
                    >
                      <input
                        type="radio"
                        name="decision"
                        value={choice}
                        defaultChecked={row.decision === choice}
                        className="mt-0.5 size-5 accent-ink md:size-4"
                      />
                      <span>
                        <span className="block text-tiny font-medium text-ink">
                          {t(choice === "pursue" ? "deal.pursue" : "deal.noBid")}
                        </span>
                        <span className="block text-micro text-muted">
                          {t(choice === "pursue" ? "deal.pursueHint" : "deal.noBidHint")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label>
                    <span className="text-micro text-secondary">{t("deal.reasonLabel")}</span>
                    {/*
                      A closed list, not a text box. "Recorded so we can learn
                      from it" is only true if the reasons can be counted, and
                      free text cannot be counted. The note field below takes
                      the words.
                    */}
                    <select name="reason" defaultValue="" className={`${INPUT} mt-1`}>
                      <option value="">{t("deal.chooseReason")}</option>
                      {NO_BID_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {t(`deal.reasons.${reason}`)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span className="text-micro text-secondary">
                      {t("deal.expectedValue", { currency: row.currency })}
                    </span>
                    <input
                      name="expectedValue"
                      inputMode="decimal"
                      defaultValue={row.expectedValue ?? ""}
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>
                </div>

                <label className="mt-3 block">
                  <span className="text-micro text-secondary">{t("deal.noteLabel")}</span>
                  <input name="note" className={`${INPUT} mt-1`} />
                </label>

                <div className="mt-4 flex items-center gap-3">
                  {row.decidedAt ? (
                    <p className="text-micro text-muted">
                      {t("deal.decidedOn", { when: day.format(row.decidedAt) })}
                    </p>
                  ) : null}
                  <div className="ms-auto">
                    <Button type="submit" variant="primary">
                      {t("deal.save")}
                    </Button>
                  </div>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Badge tone={TONE[badge] ?? "neutral"}>{t(badgeMessageKey(badge))}</Badge>
                <p className="text-tiny text-secondary">
                  {row.lostReason ?? row.decisionReason ?? "—"}
                </p>
                {row.lostAt ? (
                  <form action={reopenAction.bind(null, locale, id)} className="ms-auto">
                    <Button type="submit" variant="secondary">
                      {t("deal.reopen")}
                    </Button>
                  </form>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-tiny font-semibold text-ink">{t("deal.instructions")}</h2>
              <span className="ms-auto text-micro text-muted">{t("deal.verbatim")}</span>
            </div>
            {row.clientInstructions ? (
              // Verbatim, and rendered as text rather than markdown or HTML.
              // The sentence about the sealed double envelope is the one that
              // loses the bid, and it must survive exactly as it was written.
              <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-plane p-4 text-tiny leading-relaxed text-secondary">
                {row.clientInstructions}
              </p>
            ) : (
              <p className="mt-3 text-tiny text-muted">{t("deal.noInstructions")}</p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {/*
            WHAT HAPPENS NEXT — task 2.5, at the top of the column on purpose,
            and a NUMBERED RUN since task 2.6.

            The one line under the heading is the first thing actually waiting
            on somebody: a blocker before a warning before a note, and within
            each, the order of the run itself. The list under it is every check,
            so the panel says what is done as well as what is not — a screen
            that only ever names problems teaches people that opening it is bad
            news.

            2.6 made that list the numbered stepper screen 85 uses for day one,
            in `Stepper`, shared by all three so they cannot drift — and gave it
            the two rungs the checks did not carry: prices in, and the bon de
            livraison. A second panel beside this one would have put two lists
            about the same run on one screen, which is the clutter this wave
            exists to remove, so `dealChecks` grew rather than gaining a rival.
          */}
          <Stepper
            title={t("deals.next.title")}
            aside={t("common.doneOf", {
              done: checks.filter((c) => c.state === "pass").length,
              total: checks.length,
            })}
            lead={next ? t(`deals.check.${next.key}`, next.detail ?? {}) : t("deals.next.nothing")}
            doneLabel={t("common.done")}
            stateLabel={(state) => t(`offer.state.${state}`)}
            steps={checks.map((check) => ({
              key: check.key,
              state: check.state,
              label: t(`deals.step.${check.key}`),
              detail: t(`deals.check.${check.key}`, check.detail ?? {}),
              href: check.fixHref,
              // The verb only appears where there is somewhere to go. A step
              // with no `fixHref` — the missing deadline, the uninvoiced order
              // — draws its badge instead, which is the honest answer while no
              // screen in this application can set either.
              action: check.fixHref ? t("deals.next.go") : undefined,
            }))}
          />

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deal.details")}</h2>
            <dl className="mt-3 flex flex-col gap-2.5 text-tiny">
              {(
                [
                  ["client", clientName],
                  ["reference", row.clientReference ?? "—"],
                  ["received", when.format(row.receivedAt)],
                  [
                    "clientDeadline",
                    deadline.kind === "closed"
                      ? t("deals.closed")
                      : deadline.at
                        ? day.format(deadline.at)
                        : "—",
                  ],
                  ["submissionMethod", t(`deal.method.${row.submissionMethod}`)],
                  ["currency", row.currency],
                  ["source", row.source],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="shrink-0 text-secondary">
                    {t(key === "client" ? "deals.client" : `deal.${key}`)}
                  </dt>
                  <dd
                    className={`ms-auto min-w-0 truncate text-end ${
                      key === "clientDeadline" && urgent
                        ? "font-medium text-critical-ink"
                        : "text-ink"
                    }`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {overdue ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
                {t("deal.deadlinePassed")}
              </p>
            ) : deadline.kind === "at" && deadline.hoursLeft !== null && urgent ? (
              <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro text-critical-ink">
                {t("deal.hoursLeft", { n: deadline.hoursLeft })}
              </p>
            ) : null}
          </section>

          {/*
            WHAT THIS DEAL IS.
            "Some clients send an RFQ, but when it's a ZIP file with a lot of
            files it means it's a tender." Both of those arrive as the same
            record on this screen, and until now nothing on it could say which
            one it was — `makeTender` has existed, transactional and tested,
            since the tender module was written, with no caller outside
            `tests/`. This is the caller, and the undo beside it.
          */}
          {tenderOn ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-tiny font-semibold text-ink">{t("tender.onDeal.title")}</h2>
                <span className="ms-auto text-micro text-muted">
                  {t(`tenders.procedure.${tenderOn.procedure}`)}
                </span>
              </div>

              {/*
                THE FOLDER, AND WHERE THE NUMBER COMES FROM.
                `getTender` has already run the pure `dossier()` over this
                tender's pieces, the company's papers and the closing date.
                Nothing is recomputed here and nothing is stored — a folder that
                was 100 % in July is not 100 % in September when the CASNOS
                attestation expired in between, and a second arithmetic on this
                page could disagree with screen 08 about the same folder.
              */}
              <div className="mt-3 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" aria-hidden>
                  <span
                    className={`block h-full rounded-full ${
                      tenderOn.folder.blocking.length > 0
                        ? "bg-critical"
                        : tenderOn.folder.percent === 100
                          ? "bg-good"
                          : "bg-warning"
                    }`}
                    style={{ width: `${tenderOn.folder.percent}%` }}
                  />
                </span>
                <span className="tabular-nums text-micro text-secondary">
                  {tenderOn.folder.percent}%
                </span>
              </div>

              {tenderOn.folder.total === 0 ? (
                <p className="mt-2 text-micro leading-relaxed text-muted">{t("tender.noPieces")}</p>
              ) : (
                <dl className="mt-3 flex flex-col gap-1.5 text-micro">
                  {tenderOn.folder.sections.map((section) => (
                    <div key={section.section} className="flex items-baseline gap-3">
                      <dt className="text-secondary">{t(`tender.section.${section.section}`)}</dt>
                      <dd className="ms-auto tabular-nums text-ink">
                        {t("tender.readyOf", { ready: section.ready, total: section.total })}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {/* The sentence screen 08 leads with, on the screen a person is
                  already looking at. Only while it can still be acted on. */}
              {tenderOn.folder.blocking.length > 0 && !tenderOn.submittedAt ? (
                <p className="mt-3 rounded-[var(--radius-control)] bg-critical-bg px-3 py-2 text-micro leading-relaxed text-critical-ink">
                  {t("tender.banner", {
                    percent: tenderOn.folder.percent,
                    blocking: tenderOn.folder.blocking.length,
                  })}
                </p>
              ) : null}

              {tenderOn.submittedAt ? (
                <p className="mt-3 text-micro text-muted">
                  {t("tenders.submittedOn", { on: day.format(tenderOn.submittedAt) })}
                </p>
              ) : null}

              {/* Screen 08 and screen 42. The second was reachable from nowhere
                  but itself, which is where a tender's prices are actually
                  entered. */}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/tenders/${id}`}>
                  <Button variant="secondary">{t("tender.onDeal.folder")}</Button>
                </Link>
                <Link href={`/tenders/${id}/bpu`}>
                  <Button variant="secondary">{t("tender.onDeal.bpu")}</Button>
                </Link>
              </div>

              <p className="mt-4 border-t border-line-subtle pt-4 text-micro leading-relaxed text-muted">
                {t("tender.unmake.what", {
                  procedure: t(`tenders.procedure.${tenderOn.procedure}`),
                })}
              </p>
              <form action={unmakeTenderAction.bind(null, locale, id)} className="mt-3">
                <label className="block">
                  <span className="text-micro text-secondary">{t("tender.unmake.reason")}</span>
                  <input name="reason" className={`${INPUT} mt-1`} />
                </label>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabledReason={
                      classifyBlockedBy ??
                      (unmakeBlockedBy ? t(`tender.unmake.refused.${unmakeBlockedBy}`) : undefined)
                    }
                  >
                    {t("tender.unmake.action")}
                  </Button>
                </div>
              </form>
            </section>
          ) : (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("tender.make.title")}</h2>
              <p className="mt-1.5 text-micro leading-relaxed text-muted">{t("tender.make.why")}</p>

              <form action={makeTenderAction.bind(null, locale, id)} className="mt-3">
                <label className="block">
                  <span className="text-micro text-secondary">{t("tender.make.procedure")}</span>
                  {/*
                    The five values come from `PROCEDURES` in `dossier.ts`, not
                    from a list retyped here — a sixth would reach this select,
                    `seedFor` and the label in one move or in none.
                  */}
                  <select name="procedure" defaultValue="aonr" className={`${INPUT} mt-1`}>
                    {PROCEDURES.map((procedure) => (
                      <option key={procedure} value={procedure}>
                        {t(`tenders.procedure.${procedure}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {/*
                  The distinction the owner draws between "a simple RFQ" and "a
                  real tender" is already in the data: `seedFor` leaves the
                  caution, the qualification and the casier judiciaire out of an
                  RFQ and a consultation. Saying so here is cheaper than four
                  permanently red rows on screen 08 teaching somebody to ignore
                  red.
                */}
                <p className="mt-1.5 text-micro leading-relaxed text-muted">
                  {t("tender.make.seedHint")}
                </p>

                <label className="mt-3 block">
                  <span className="text-micro text-secondary">{t("tender.make.place")}</span>
                  <input
                    name="submissionPlace"
                    placeholder={t("tender.make.placeExample")}
                    className={`${INPUT} mt-1`}
                  />
                </label>

                <label className="mt-3 block">
                  <span className="text-micro text-secondary">{t("tender.make.opensAt")}</span>
                  <input type="datetime-local" name="opensAt" className={`${INPUT} mt-1`} />
                </label>
                <p className="mt-1 text-micro text-muted">{t("tender.make.opensAtHint")}</p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label>
                    <span className="text-micro text-secondary">
                      {t("tender.make.cautionAmount", { currency: row.currency })}
                    </span>
                    <input
                      name="cautionAmount"
                      inputMode="decimal"
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>
                  <label>
                    <span className="text-micro text-secondary">{t("tender.make.cautionPct")}</span>
                    <input
                      name="cautionPct"
                      inputMode="decimal"
                      className={`${INPUT} mt-1 text-end tabular-nums`}
                    />
                  </label>
                </div>
                {/* Whichever the cahier des charges wrote. Converting between
                    them needs an estimate that has not been made yet. */}
                <p className="mt-1 text-micro text-muted">{t("tender.make.cautionHint")}</p>

                <label className="mt-3 block">
                  <span className="text-micro text-secondary">{t("tender.make.validity")}</span>
                  <input
                    name="offerValidityDays"
                    inputMode="numeric"
                    className={`${INPUT} mt-1 text-end tabular-nums`}
                  />
                </label>

                <div className="mt-4 flex justify-end">
                  <Button type="submit" variant="primary" disabledReason={classifyBlockedBy}>
                    {t("tender.make.action")}
                  </Button>
                </div>
              </form>
            </section>
          )}

          {open ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("deal.markLost")}</h2>
              {/*
                The only fact on this screen no document will ever contain. It
                arrives by telephone, so it is typed in — and it is reversible,
                because telephones mishear.
              */}
              <form action={lostAction.bind(null, locale, id)} className="mt-3">
                <label className="block">
                  <span className="text-micro text-secondary">{t("deal.lostReason")}</span>
                  <input name="reason" className={`${INPUT} mt-1`} />
                </label>
                <div className="mt-3 flex justify-end">
                  <Button type="submit" variant="secondary">
                    {t("deal.lost")}
                  </Button>
                </div>
              </form>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deal.discard.title")}</h2>
            <p className="mt-1 text-micro text-secondary">{t("deal.discard.what")}</p>
            {/*
              No restore button here: `getDeal` filters on `deleted_at`, so a
              binned enquiry has no page to put one on. Taking it back out is
              screen 83's job, and `restoreDealAction` is what the bin calls.
            */}
            <form action={discardDealAction.bind(null, locale, id)} className="mt-3">
              <label className="block">
                <span className="text-micro text-secondary">{t("deal.discard.reason")}</span>
                <input name="reason" className={`${INPUT} mt-1`} />
              </label>
              <div className="mt-3 flex justify-end">
                <Button type="submit" variant="danger" disabledReason={discardBlockedBy}>
                  {t("deal.discard.action")}
                </Button>
              </div>
            </form>
          </section>

          {open && lines.length > 0 ? (
            <section
              id="ask"
              className="scroll-mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5"
            >
              <h2 className="text-tiny font-semibold text-ink">{t("ask.title")}</h2>
              <p className="mt-1.5 text-micro leading-relaxed text-muted">{t("ask.hint")}</p>

              {suppliers.length === 0 ? (
                <p className="mt-3 text-tiny text-muted">{t("ask.noSuppliers")}</p>
              ) : (
                <form action={askSuppliersAction.bind(null, locale, id)} className="mt-3">
                  <input type="hidden" name="subject" value={row.subject} />
                  <div className="flex max-h-[220px] flex-col gap-1.5 overflow-auto">
                    {suppliers.map((supplier) => (
                      <label key={supplier.id} className="flex items-center gap-2 text-tiny">
                        <input type="checkbox" name="supplierId" value={supplier.id} />
                        <span className="min-w-0 truncate text-ink">
                          {supplier.tradeName?.trim() || supplier.legalName}
                        </span>
                      </label>
                    ))}
                  </div>

                  <label className="mt-3 block">
                    <span className="text-micro text-secondary">{t("ask.replyBy")}</span>
                    <input type="datetime-local" name="replyBy" className={`${INPUT} mt-1`} />
                  </label>

                  <div className="mt-3 flex justify-end">
                    <Button type="submit" variant="secondary">
                      {t("ask.create")}
                    </Button>
                  </div>
                </form>
              )}

              {requests.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  {requests.map((request) => (
                    <li key={request.id} className="flex items-baseline gap-2 text-tiny">
                      <Link className="text-ink hover:underline" href={`/sourcing/${request.id}`}>
                        {request.ref}
                      </Link>
                      <span className="ms-auto text-micro text-muted">
                        {request.sentAt
                          ? t("ask.askedReplied", { asked: request.asked, replied: request.quoted })
                          : t("ask.draft")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {open && lines.length > 0 ? (
            <section
              id="offer"
              className="scroll-mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5"
            >
              <h2 className="text-tiny font-semibold text-ink">{t("offer.build.title")}</h2>
              <p className="mt-1.5 text-micro leading-relaxed text-muted">
                {t("offer.build.hint")}
              </p>

              <form
                action={buildOfferAction.bind(null, locale, id)}
                className="mt-3 flex items-end gap-2"
              >
                <label className="flex-1">
                  <span className="text-micro text-secondary">{t("offer.build.marginLabel")}</span>
                  <input
                    name="marginPct"
                    inputMode="decimal"
                    defaultValue="20"
                    className={`${INPUT} mt-1 text-end tabular-nums`}
                  />
                </label>
                <Button type="submit" variant="primary">
                  {t("offer.build.go")}
                </Button>
              </form>

              {offers.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-1.5 border-t border-line-subtle pt-3">
                  {offers.map((offer) => (
                    <li key={offer.id} className="flex items-baseline gap-2 text-tiny">
                      <Link className="text-ink hover:underline" href={`/offers/${offer.id}/build`}>
                        {offer.number ?? t("offer.noNumberYet")}
                      </Link>
                      <span className="ms-auto flex items-center gap-2">
                        {/*
                          The client said yes. Their bon de commande is recorded
                          as a document made from the offer they accepted — the
                          step every sales system calls "Confirm", and the only
                          thing that moves this enquiry to "won".
                        */}
                        {offer.number && facts.ordersReceived === 0 ? (
                          <Link
                            className="text-micro text-accent-ink hover:underline"
                            href={`/documents/${offer.id}/convert?target=client_order`}
                          >
                            {t("deals.recordOrder")}
                          </Link>
                        ) : null}
                        <Badge tone={offer.number ? "good" : "neutral"}>
                          {offer.number ? t("offer.issued") : t("offer.draft")}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/*
            The works. Once the client has said yes — an order recorded, or at
            least an offer out — the enquiry becomes a site with situations,
            retention and cautions, and that lives on screen 16. One project
            per enquiry: the link goes to it once it exists.
          */}
          {projectOpened || facts.ordersReceived > 0 || facts.offersIssued > 0 ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("deals.project.title")}</h2>
              {projectOpened ? (
                <p className="mt-2 text-tiny leading-relaxed text-secondary">
                  {t("deals.project.opened")}{" "}
                  <Link
                    href={`/projects/${projectOpened.id}`}
                    className="font-medium text-accent-ink hover:underline"
                  >
                    {projectOpened.code}
                  </Link>
                </p>
              ) : (
                <>
                  <p className="mt-2 text-micro leading-relaxed text-muted">
                    {t("deals.project.why")}
                  </p>
                  <Link href={`/projects/new?deal=${id}`} className="mt-3 inline-block">
                    <Button variant="secondary">{t("deals.project.open")}</Button>
                  </Link>
                </>
              )}
            </section>
          ) : null}

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("deals.stageDerivedLabel")}</h2>
            <p className="mt-2 text-micro leading-relaxed text-muted">
              {t("deals.stageIsDerived")}
            </p>
            <dl className="mt-3 flex flex-col gap-1.5 text-micro">
              {(
                [
                  ["lines", facts.lineCount],
                  ["suppliersAsked", facts.suppliersAsked],
                  ["offersIssued", facts.offersIssued],
                  ["ordersReceived", facts.ordersReceived],
                  ["invoicesIssued", facts.invoicesIssued],
                ] as const
              ).map(([key, n]) => (
                <div key={key} className="flex items-baseline gap-3">
                  <dt className="text-secondary">{t(`facts.${key}`)}</dt>
                  <dd className="ms-auto tabular-nums text-ink">{n}</dd>
                </div>
              ))}
            </dl>
          </section>

          {row.expectedValue ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <h2 className="text-tiny font-semibold text-ink">{t("deals.value")}</h2>
              <p className="mt-1 text-lead font-semibold tabular-nums text-ink">
                {formatMoney(row.expectedValue, { locale, currency: row.currency })}
              </p>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
