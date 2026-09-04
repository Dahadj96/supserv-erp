import { Bot, CircleAlert, ExternalLink, Hourglass, TriangleAlert } from "lucide-react";
import { redirect as hardRedirect } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { whatIsLate } from "@/assistant/late";
import { listProposals } from "@/assistant/proposals";
import { toolsFor } from "@/assistant/registry";
import { getSession } from "@/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * Screen 43 — the assistant, in context.
 *
 * The frame draws this as an OVERLAY that opens on top of whatever screen you
 * are on. It is a page instead, and the reason is structural rather than
 * aesthetic: in the App Router a layout cannot read search params, so an
 * overlay living in the shell would have to become a client component fetching
 * its own data through an API route — a second way of reading the same facts,
 * with its own permission checks to get wrong.
 *
 * One reading path, checked in one place, is worth more than a drawer.
 * docs/DECISIONS/2026-08-28-the-assistant-is-a-page.md.
 *
 * What it answers is the plan's own question: what is late, and why. Every line
 * carries the link to the screen the fact came from.
 */
export const dynamic = "force-dynamic";

export default async function AssistantPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const session = await getSession();
  if (!session) hardRedirect(`/${locale}/sign-in`);

  const [answer, proposals] = await Promise.all([whatIsLate(), listProposals("waiting")]);
  const tools = toolsFor(session.role);

  const format = await getFormatter({ locale });
  const money = (amount: number) =>
    format.number(amount, { maximumFractionDigits: 0, minimumFractionDigits: 0 });

  /** The sentence for a reason, with its number filled in. */
  const why = (thing: (typeof answer.things)[number]) => {
    if (thing.why.reason === "deadlinePassed") {
      return t("assistantLate.deadlinePassed", { hours: thing.why.hours });
    }
    if (thing.why.reason === "deadlineImminent") {
      return t("assistantLate.deadlineImminent", { hours: thing.why.hours });
    }
    return t(`assistantLate.${thing.why.reason}`);
  };

  const isGone = (thing: (typeof answer.things)[number]) => thing.why.reason === "deadlinePassed";

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div className="flex items-baseline gap-3">
          <Bot className="size-5 self-center text-secondary" aria-hidden />
          <h1 className="text-[19px] font-semibold text-ink">{t("assistantPage.title")}</h1>
          <Link
            href="/settings/assistant"
            className="ms-auto inline-flex min-h-9 items-center md:min-h-0 text-tiny text-accent-ink hover:underline"
          >
            {t("assistantPage.whatICanDo", { count: tools.length })}
          </Link>
        </div>
        <p className="mt-1 text-tiny text-muted">{t("assistantPage.subtitle")}</p>
      </div>

      <div className="grid max-w-[1400px] grid-cols-1 md:grid-cols-3 items-start gap-5 px-4 md:px-7 py-6">
        <div className="col-span-1 md:col-span-2 flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface">
            <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">{t("assistantPage.whatIsLate")}</h2>
              <span className="ms-auto text-micro text-muted">
                {t("assistantPage.examined", { count: answer.examined })}
              </span>
            </div>

            {answer.things.length === 0 ? (
              <p className="p-5 text-tiny leading-relaxed text-secondary">
                {answer.examined === 0
                  ? t("assistantPage.nothingChecked")
                  : t("assistantPage.nothingLate", { count: answer.examined })}
              </p>
            ) : (
              <>
                <p className="border-b border-line-subtle bg-plane px-5 py-2.5 text-tiny text-ink">
                  {t("assistantPage.summary", {
                    count: answer.things.length,
                    amount: money(answer.amount),
                  })}
                </p>
                <ul>
                  {answer.things.map((thing) => (
                    <li
                      key={thing.id}
                      className="flex items-start gap-3 border-b border-line-subtle px-5 py-3 last:border-0"
                    >
                      {isGone(thing) ? (
                        <CircleAlert
                          className="mt-0.5 size-4 shrink-0 text-critical-ink"
                          aria-hidden
                        />
                      ) : (
                        <TriangleAlert
                          className="mt-0.5 size-4 shrink-0 text-warning-ink"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-tiny text-ink">{thing.what}</p>
                        <p className="mt-0.5 text-micro text-muted">
                          {why(thing)}
                          {thing.detail ? ` · ${thing.detail}` : ""}
                        </p>
                      </div>
                      <Link
                        href={thing.citation}
                        className="ms-auto inline-flex min-h-9 items-center md:min-h-0 shrink-0 gap-1 text-micro text-accent-ink hover:underline"
                      >
                        <ExternalLink className="size-3" aria-hidden />
                        {t("assistantPage.see")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="border-t border-line-subtle px-5 py-3 text-micro leading-relaxed text-muted">
              {t("assistantPage.arithmetic")}
            </p>
          </section>

          {answer.waitingOnOthers > 0 ? (
            <section className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <Hourglass className="mt-px size-4 shrink-0 text-muted" aria-hidden />
              <p className="text-tiny leading-relaxed text-secondary">
                {t("assistantPage.waitingOnOthers", { count: answer.waitingOnOthers })}{" "}
                <Link href="/waiting-on" className="text-accent-ink hover:underline">
                  {t("nav.waitingOn")}
                </Link>
              </p>
            </section>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-tiny font-semibold text-ink">{t("assistantPage.proposals")}</h2>
              {proposals.length > 0 ? (
                <span className="ms-auto">
                  <Badge tone="warning">{proposals.length}</Badge>
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {proposals.length === 0
                ? t("assistantPage.noProposals")
                : t("assistantPage.someProposals", { count: proposals.length })}
            </p>
            <Link href="/assistant/proposals" className="mt-3 inline-block">
              <Button variant="secondary" size="small">
                {t("assistantPage.openProposals")}
              </Button>
            </Link>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <h2 className="text-tiny font-semibold text-ink">{t("assistantPage.cannotDo")}</h2>
            <p className="mt-3 text-tiny leading-relaxed text-secondary">
              {t("assistantPage.cannotDoWhat")}
            </p>
            <Link
              href="/settings/assistant"
              className="mt-3 inline-block text-tiny text-accent-ink hover:underline"
            >
              {t("assistantPage.theWholeList")}
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
