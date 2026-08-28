import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { CircleAlert } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { userRole } from "@/db/schema/auth";
import { bankAccount, vatRate } from "@/db/schema/company";
import { numberingSeries } from "@/db/schema/document";
import { documentTemplate } from "@/db/schema/document-template";
import { documentType } from "@/db/schema/document-type";
import { emailTemplate } from "@/db/schema/email-template";
import { intakeChannel } from "@/db/schema/intake";
import { setupState } from "@/domain/setup";
import { Link } from "@/i18n/navigation";

/**
 * Screen 29 — Settings.
 *
 * The design draws one tabbed screen that edits the company identity, the bank
 * accounts, the numbering and the tax rates in place. Day one (screen 85)
 * already edits all four, and two screens writing the same rows is how a
 * company ends up with two RC numbers and no idea which is on the invoice.
 *
 * So this is a hub, not a second editor: it shows the live state of every
 * setting and sends you to the one page that owns it. Anything not built yet is
 * listed and greyed with the reason — a setting that exists in the design and
 * nowhere in the app should still be visible, or nobody knows it is missing.
 */
export const dynamic = "force-dynamic";

type Entry = {
  key: string;
  href: string | null;
  /** null while nothing is known; otherwise a chip. */
  state: { tone: BadgeTone; label: string } | null;
  /** Why the row is grey. Screen 80 — never without one. */
  unbuilt?: boolean;
};

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const state = await setupState();

  const [[banks], [rates], [series], [roles], [channels], [types], [templates], [emailTemplates]] =
    await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(bankAccount)
        .where(isNull(bankAccount.archivedAt)),
      db.select({ n: sql<number>`count(*)::int` }).from(vatRate),
      db.select({ n: sql<number>`count(*)::int` }).from(numberingSeries),
      db.select({ n: sql<number>`count(*)::int` }).from(userRole),
      db
        .select({ n: sql<number>`count(*) filter (where ${intakeChannel.status} = 'live')::int` })
        .from(intakeChannel),
      db.select({ n: sql<number>`count(*)::int` }).from(documentType),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(documentTemplate)
        .where(eq(documentTemplate.active, true)),
      // Written, not merely seeded. A blank row is a to-do, and a chip counting
      // to-dos as if they were settings would read "30" on a system where nobody
      // has typed a single email.
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(emailTemplate)
        .where(and(eq(emailTemplate.active, true), ne(emailTemplate.body, ""))),
    ]);

  const done = (label?: string) => ({
    tone: "good" as BadgeTone,
    label: label ?? t("settings.set"),
  });
  const missing = { tone: "warning" as BadgeTone, label: t("settings.notSet") };
  const some = (n: number) => (n > 0 ? done(String(n)) : missing);

  const isDone = (key: string) => state.steps.find((s) => s.key === key)?.done ?? false;

  const groups: { key: string; entries: Entry[] }[] = [
    {
      key: "company",
      entries: [
        {
          key: "identity",
          href: "/setup/identity",
          state: isDone("identity") ? done() : missing,
        },
        { key: "logo", href: "/setup/identity", state: isDone("logo") ? done() : missing },
        { key: "bank", href: "/setup/bank", state: some(banks?.n ?? 0) },
        { key: "vat", href: "/setup/vat", state: some(rates?.n ?? 0) },
        { key: "numbering", href: "/setup/numbering", state: some(series?.n ?? 0) },
        { key: "documentTypes", href: "/settings/document-types", state: some(types?.n ?? 0) },
        { key: "templates", href: "/settings/templates", state: some(templates?.n ?? 0) },
        {
          key: "emailTemplates",
          href: "/settings/email-templates",
          state: some(emailTemplates?.n ?? 0),
        },
      ],
    },
    {
      key: "people",
      entries: [
        { key: "users", href: "/settings/users", state: some(roles?.n ?? 0) },
        { key: "profile", href: "/settings/profile", state: null },
        { key: "language", href: "/settings/language", state: null },
      ],
    },
    {
      key: "incoming",
      entries: [
        { key: "channels", href: "/settings/channels", state: some(channels?.n ?? 0) },
        { key: "import", href: "/settings/import", state: null },
        { key: "storage", href: "/settings/storage", state: null },
      ],
    },
    {
      key: "control",
      entries: [
        { key: "compliance", href: null, state: missing, unbuilt: true },
        { key: "bin", href: "/settings/bin", state: null },
        { key: "audit", href: null, state: null, unbuilt: true },
      ],
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-7 py-5">
        <div>
          <h1 className="text-[19px] font-semibold text-ink">{t("settings.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("settings.subtitle")}</p>
        </div>
        <div className="ms-auto">
          <Link href="/setup">
            <Button variant="secondary">{t("settings.dayOne")}</Button>
          </Link>
        </div>
      </div>

      {state.canIssue ? null : (
        <div className="mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-critical-ink">
            {t("settings.cannotIssue", {
              missing: state.missing.map((m) => t(`setup.step.${m}`)).join(", "),
            })}
          </p>
        </div>
      )}

      <div className="grid max-w-[1400px] grid-cols-2 items-start gap-5 px-7 py-6">
        {groups.map((group) => (
          <section
            key={group.key}
            className="rounded-[var(--radius-card)] border border-line bg-surface"
          >
            <h2 className="border-b border-line-subtle px-5 py-3.5 text-tiny font-semibold text-ink">
              {t(`settings.group.${group.key}`)}
            </h2>
            <ul>
              {group.entries.map((entry) => {
                const body = (
                  <div className="flex items-start gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className={`text-tiny ${entry.unbuilt ? "text-disabled" : "text-ink"}`}>
                        {t(`settings.entry.${entry.key}.name`)}
                      </p>
                      <p className="mt-0.5 text-micro leading-relaxed text-muted">
                        {entry.unbuilt
                          ? t(`settings.entry.${entry.key}.unbuilt`)
                          : t(`settings.entry.${entry.key}.what`)}
                      </p>
                    </div>
                    {entry.state ? (
                      <span className="ms-auto shrink-0 pt-0.5">
                        <Badge tone={entry.state.tone}>{entry.state.label}</Badge>
                      </span>
                    ) : null}
                  </div>
                );

                return (
                  <li key={entry.key} className="border-b border-line-subtle last:border-0">
                    {entry.href ? (
                      <Link className="block hover:bg-sunken" href={entry.href}>
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
