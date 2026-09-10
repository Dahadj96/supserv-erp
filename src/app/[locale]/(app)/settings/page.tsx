import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { CircleAlert } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TOOLS, toolsFor } from "@/assistant/registry";
import { getSession } from "@/auth/session";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { userRole } from "@/db/schema/auth";
import { bankAccount, vatRate } from "@/db/schema/company";
import { auditEntry } from "@/db/schema/control";
import { numberingSeries } from "@/db/schema/document";
import { documentTemplate } from "@/db/schema/document-template";
import { documentType } from "@/db/schema/document-type";
import { emailTemplate } from "@/db/schema/email-template";
import { importBatch } from "@/db/schema/import";
import { intakeChannel } from "@/db/schema/intake";
import { countProfile, profile } from "@/domain/compliance-profile";
import { type BackupState, backupReport } from "@/domain/control/backup";
import { moduleCounts } from "@/domain/control/modules";
import { countBin } from "@/domain/deletion";
import { fileCounts } from "@/domain/files";
import { storageHeadline } from "@/domain/files/storage-report";
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
 *
 * TASK U3 — "settings a person can read". Abdou's words were "when you take a
 * look at settings, it's not user friendly, it's not clear", and two things
 * were wrong rather than one.
 *
 * ONE · Nine of the twenty-three rows had no chip at all, so half this hub was
 * a name and a link — exactly what its own paragraph above says it is not.
 * Every row now carries a state, and each of them is READ, never assumed: the
 * bin says how many records are in it, compliance how many rules are still
 * unconfirmed, storage whether a file written now would land, the assistant how
 * many of its tools YOUR role holds. Where a row is an act rather than a
 * setting — Move in, Clear my test data — the state is when it last happened,
 * which is the question somebody actually arrives with.
 *
 * TWO · The groups were named after parts of the system. "Control" held the
 * backup, the bin, the audit log, the compliance rules and the assistant, which
 * is five answers to five different questions. They are grouped by what a
 * person came here to do now, and each group says so in a sentence: the
 * compliance rules moved to the company (they decide what may be issued) and
 * the assistant to the group of screens that only report (nothing on it can be
 * changed, which is LAW 6 made checkable rather than a setting).
 */
export const dynamic = "force-dynamic";

type Entry = {
  key: string;
  href: string | null;
  /**
   * The chip. Never null since U3 — a row without a state is a row a person has
   * to click to learn anything from, and this hub exists so they do not have to.
   */
  state: { tone: BadgeTone; label: string };
  /** Why the row is grey. Screen 80 — never without one. */
  unbuilt?: boolean;
};

export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const state = await setupState();
  // Pure — a list in `src/domain/control/modules.ts`, no query. The chip on the
  // Modules row is the same count that screen's own subtitle prints.
  const modules = moduleCounts();
  // The same union screen 60 lists, counted. It reads five tables, which is
  // why it is awaited beside `setupState` rather than in the batch below.
  const files = await fileCounts();
  // Task U1. Reads a JSON receipt off the disk, not a table — the row can say
  // "3 days ago" rather than "set", which is the only chip on this hub whose
  // wrong reading costs the company its records.
  const backup = await backupReport();

  /*
    Task U3 — the four states that are not a count of a table.

    `session` is here because two rows are about the person reading them: My
    profile prints their role and Language prints the interface language they
    are in, which is the honest chip for a setting whose whole point is that it
    is per-person (LAW 4). The assistant row is the same shape — screen 45
    renders what YOUR role may ask for, so the hub says how much of the registry
    that is rather than a total nobody holds.

    `binned` is five counts rather than `listBin()`, and `storageHeadline()` one
    filesystem check rather than a walk of the whole tree: see both functions.
  */
  const session = await getSession();
  const [binned, rules, storage] = await Promise.all([countBin(), profile(), storageHeadline()]);
  const complianceCounts = countProfile(rules);
  const assistantTools = session?.role ? toolsFor(session.role).length : 0;

  const [
    [banks],
    [rates],
    [series],
    [roles],
    [channels],
    [types],
    [templates],
    [emailTemplates],
    [audited],
    [imported],
    [lastSweep],
  ] = await Promise.all([
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
    db.select({ n: sql<number>`count(*)::int` }).from(auditEntry),
    /*
      Task U3. Batches that actually landed — `mapping` and `previewed` are a
      person part-way through screen 62, not an import, and `undone` is one
      taken back. A chip counting the first three would tell somebody they had
      imported their contacts when they had opened a file and closed it.
    */
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(importBatch)
      .where(eq(importBatch.status, "imported")),
    /*
      "Clear my test data" writes one audit entry per sweep, entity `sweep` —
      `readSweep` in `src/domain/sweep.ts` reads the same row back. So the last
      one is the newest of those, and the row can say when rather than nothing.
    */
    db
      .select({ at: auditEntry.at })
      .from(auditEntry)
      .where(eq(auditEntry.entity, "sweep"))
      .orderBy(desc(auditEntry.at))
      .limit(1),
  ]);

  /**
   * The backup row is the one chip on this hub that is a verdict rather than a
   * count, so it carries the same tones screen 66 uses: amber for a backup that
   * works but sits on the wrong disk, red for one nobody can restore.
   */
  const BACKUP_TONE: Record<BackupState, BadgeTone> = {
    never: "critical",
    failing: "critical",
    stale: "critical",
    sameDisk: "warning",
    good: "good",
  };

  const done = (label?: string) => ({
    tone: "good" as BadgeTone,
    label: label ?? t("settings.set"),
  });
  const missing = { tone: "warning" as BadgeTone, label: t("settings.notSet") };
  const some = (n: number) => (n > 0 ? done(String(n)) : missing);
  /**
   * A count that is nobody's to-do — the bin, the imports, the audit log. Green
   * would read as an achievement and amber as a reproach; both are wrong for a
   * number that is simply how many there are.
   */
  const plain = (label: string) => ({ tone: "neutral" as BadgeTone, label });

  const isDone = (key: string) => state.steps.find((s) => s.key === key)?.done ?? false;

  /*
    Written as a map rather than a key built from `uiLocale`: that column is
    free text a person could one day hold a fourth value in, and a message key
    that misses throws MISSING_MESSAGE, which is a 500 on the settings hub
    rather than a wrong chip. The role beside it IS built from its value,
    because `Role` is a union the permission table already exhausts.
  */
  const LOCALE_NAME: Record<string, string> = {
    fr: t("language.name.fr"),
    en: t("language.name.en"),
    ar: t("language.name.ar"),
  };

  const sweptDaysAgo = lastSweep
    ? Math.floor((Date.now() - lastSweep.at.getTime()) / 86_400_000)
    : null;

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
        /*
          Task U3 — moved out of "Control". The compliance profile is not a
          control surface, it is the list of things that stop a document being
          issued, so it belongs with the rows that decide what a document says.
          The chip counts what is still WARNING rather than blocking: an
          unconfirmed rule is the one state on that screen a person can change,
          and CLAUDE.md's hard rule is that the system never asserts a law on
          its own authority.
        */
        {
          key: "compliance",
          href: "/settings/compliance",
          state:
            complianceCounts.unconfirmed > 0
              ? {
                  tone: "warning",
                  label: t("settings.state.unconfirmed", {
                    count: complianceCounts.unconfirmed,
                  }),
                }
              : done(t("settings.state.allConfirmed")),
        },
      ],
    },
    {
      key: "people",
      entries: [
        { key: "users", href: "/settings/users", state: some(roles?.n ?? 0) },
        // Your own role, read from the same table screen 30 writes. It is what
        // somebody opening "My profile" is checking, and it is why every other
        // row on this hub greys the way it does for them.
        {
          key: "profile",
          href: "/settings/profile",
          state: plain(
            session?.role ? t(`auth.roles.${session.role}`) : t("settings.state.noRole"),
          ),
        },
        // LAW 4 — the interface follows the person. So the chip is the language
        // THIS person works in, not a company setting.
        {
          key: "language",
          href: "/settings/language",
          state: plain(LOCALE_NAME[session?.uiLocale ?? "fr"] ?? LOCALE_NAME.fr ?? "Français"),
        },
      ],
    },
    {
      key: "incoming",
      entries: [
        { key: "channels", href: "/settings/channels", state: some(channels?.n ?? 0) },
        {
          key: "import",
          href: "/settings/import",
          state: plain(
            (imported?.n ?? 0) > 0
              ? t("settings.state.imported", { count: imported?.n ?? 0 })
              : t("settings.state.never"),
          ),
        },
        /*
          Two questions and the chip answers the one that can go wrong today.
          "Where do finished documents go" is SharePoint and it is not
          connected, which the row's own sentence has said since August; "would
          a file written right now land" is a property of a disk, and a disk
          that has filled or been unmounted is the failure nobody would see
          until an attachment vanished. So: red when the working volume refuses
          a write, amber while final storage is the same local disk.
        */
        {
          key: "storage",
          href: "/settings/storage",
          state:
            storage.working === "unwritable"
              ? { tone: "critical", label: t("settings.state.unwritable") }
              : { tone: "warning", label: t("settings.state.localOnly") },
        },
        /*
          Task 3.5. Screen 60 left the rail — a file browser is not a
          destination inside an ERP, because every file in it already belongs
          to the message, dossier, import, item or company paper that brought
          it in, and those are where somebody looks. It is not deleted: it is
          the screen that answers "the bytes are somewhere, where", which is a
          storage question, so it sits beside Storage. It was already reachable
          from `/settings/storage`; this makes it one click from Settings
          rather than two, which is what taking a rail row away owes it.
        */
        { key: "files", href: "/files", state: some(files.all) },
      ],
    },
    /*
      TASK U3 — this group was called "Control" and held five answers to five
      different questions. What is left is one question: something has gone
      wrong, or you want to be sure it will not. Getting a record back, proving
      a copy of everything exists, and reading who did what. The compliance
      rules went to the company and the assistant to the group below, and
      neither of them was ever a thing a person came here worried about.
    */
    {
      key: "safety",
      entries: [
        /*
          Task U1. Not in "What comes in" beside Storage, though that is where
          the bytes are: Storage answers "where do the files live", and this
          answers "does any of it survive the disk". Storage's own backup card
          links here, so the person who starts from the file question still
          arrives.
        */
        {
          key: "backup",
          href: "/settings/backup",
          state: {
            tone: BACKUP_TONE[backup.state],
            label: t(`backup.last.state.${backup.state}`),
          },
        },
        // How many records are recoverable right now. Not a to-do either way:
        // an empty bin is a company that has deleted nothing, not a tidy one.
        {
          key: "bin",
          href: "/settings/bin",
          state: plain(
            binned > 0 ? t("settings.state.inBin", { count: binned }) : t("settings.state.empty"),
          ),
        },
        /*
          Beside the bin, because it is the same act and lands in the same
          place: everything this takes is on that page for thirty days.

          The chip is when it last happened rather than what it would take. A
          count of what a sweep WOULD discard depends on the moment somebody
          picks on screen 32 and would mean planning a sweep nobody asked for on
          every load of this hub; "you already did this, four days ago" is the
          thing a person actually comes back wondering.
        */
        {
          key: "clear",
          href: "/settings/clear",
          state: plain(
            sweptDaysAgo === null
              ? t("settings.state.neverRun")
              : t("settings.state.lastRun", { days: sweptDaysAgo }),
          ),
        },
        // The count is entries, and it is never a to-do: an empty audit log on
        // a system that has issued documents would be the alarming reading.
        { key: "audit", href: "/settings/audit", state: plain(String(audited?.n ?? 0)) },
      ],
    },
    /*
      THE TWO SCREENS THAT SAY WHAT THIS SYSTEM DOES NOT DO — task 3.4.

      Screen 31 (Modules) and screen 46 (Website forms) exist for exactly the
      reason the paragraph at the top of this file gives: "a setting that exists
      in the design and nowhere in the app should still be visible, or nobody
      knows it is missing." Both were written, both are honest, and neither was
      reachable from anywhere — which made them the only two screens in this ERP
      that had to be found by typing a URL to be read.

      Their own group rather than appended to `control`, because they are not
      settings: nothing on either can be changed. They answer "what is here and
      what is not", which is a question about the system rather than about how
      it is configured, and the counts say so — built against parked, live
      channels against the one that is not built.
    */
    {
      key: "whatIsBuilt",
      entries: [
        {
          key: "modules",
          href: "/settings/modules",
          state: {
            tone: "neutral",
            label: t("settings.builtOf", {
              built: modules.built,
              total: modules.built + modules.parked,
            }),
          },
        },
        // The website form is the one intake channel that does not exist, and
        // screen 46 is the page that says so and names what it would need. It
        // is not `unbuilt` — the SCREEN is built; the channel is not.
        {
          key: "forms",
          href: "/settings/forms",
          state: { tone: "warning", label: t("settings.state.notBuilt") },
        },
        /*
          Task U3 — moved here out of "Control", and this is the group it was
          always in. Screen 45 renders the assistant's actual registry: nothing
          on it can be changed, because LAW 6 makes the absences the safety —
          no delete tool, no issue tool, no send tool. It answers "what is
          here", which is what these three rows are for.

          The chip is YOUR count, not the registry's total, and that is the
          honest rendering: the assistant holds exactly the signed-in person's
          rights, so a Lecture seule reading "4 of 12" is being told the truth
          about what it would do for them.
        */
        {
          key: "assistant",
          href: "/settings/assistant",
          state: plain(t("settings.state.tools", { mine: assistantTools, total: TOOLS.length })),
        },
      ],
    },
  ];

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-start gap-3 border-b border-line-subtle bg-surface px-4 md:px-7 py-5">
        <div>
          <h1 className="text-title font-semibold text-ink">{t("settings.title")}</h1>
          <p className="mt-1 text-tiny text-muted">{t("settings.subtitle")}</p>
        </div>
        <div className="ms-auto">
          <Link href="/setup">
            <Button variant="secondary">{t("settings.dayOne")}</Button>
          </Link>
        </div>
      </div>

      {state.canIssue ? null : (
        <div className="mx-4 md:mx-7 mt-4 flex items-start gap-3 rounded-[var(--radius-control)] border border-critical bg-critical-bg px-4 py-3">
          <CircleAlert className="mt-px size-4 shrink-0 text-critical-ink" aria-hidden />
          <p className="max-w-[900px] text-tiny leading-relaxed text-critical-ink">
            {t("settings.cannotIssue", {
              missing: state.missing.map((m) => t(`setup.step.${m}`)).join(", "),
            })}
          </p>
        </div>
      )}

      <div className="grid max-w-[1400px] grid-cols-1 sm:grid-cols-2 items-start gap-5 px-4 md:px-7 py-6">
        {groups.map((group) => (
          <section
            key={group.key}
            className="rounded-[var(--radius-card)] border border-line bg-surface"
          >
            {/*
              Task U3. A heading naming a part of the system tells somebody who
              already knows the system where they are. The sentence under it is
              for the person who does not — it says what the rows below are for,
              in the same voice the rows themselves use.
            */}
            <div className="border-b border-line-subtle px-5 py-3.5">
              <h2 className="text-tiny font-semibold text-ink">
                {t(`settings.group.${group.key}`)}
              </h2>
              <p className="mt-0.5 text-micro leading-relaxed text-muted">
                {t(`settings.groupWhat.${group.key}`)}
              </p>
            </div>
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
                    <span className="ms-auto shrink-0 pt-0.5">
                      <Badge tone={entry.state.tone}>{entry.state.label}</Badge>
                    </span>
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
