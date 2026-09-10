import { redirect as hardRedirect, notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { canWrite } from "@/auth/can";
import { getSession } from "@/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { getDeal, SUBMISSION_METHODS } from "@/domain/deal/deal";
import { listContacts, liveCompanies } from "@/domain/party";
import { listUsers } from "@/domain/users";
import { Link } from "@/i18n/navigation";
import { editDealAction } from "./actions";

/**
 * V4 — the third `edit` route in the application, and the one that was missing.
 *
 * `find src/app -type d -name edit` returned two: a company and a document. An
 * enquiry had none, so a deadline read off a PDF and confirmed in a hurry was
 * unfixable for the life of the deal — and the deadline is the field that loses
 * the bid. `deal.owner_id` gets its first writer here too, which is what
 * unblocks "assign to" on the list and every role-scoped view after it.
 *
 * Every field on this form is one a PERSON typed or an EXTRACTOR guessed. The
 * ones that are facts about the world are not here: the reference was allocated
 * once and is how everybody refers to this enquiry, `received_at` is when the
 * email arrived, and the decision has its own screen with its own reasons.
 */
export const dynamic = "force-dynamic";

/** `datetime-local` wants local wall-clock with no zone, to the minute. */
function forInput(date: Date | null): string {
  if (!date) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default async function EditDealPage({
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
  const { deal: row } = found;

  const [clients, contacts, users] = await Promise.all([
    liveCompanies({ role: "client" }),
    listContacts(row.partyId),
    listUsers(),
  ]);

  const mayWrite = canWrite(session.role);

  return (
    <main className="min-h-0 flex-1 overflow-auto">
      <PageHeader
        crumb={[
          { label: "SUPSERV", href: "/today" },
          { label: t("nav.deals"), href: "/deals" },
          { label: row.ref, href: `/deals/${id}` },
          { label: t("dealEdit.title") },
        ]}
        title={t("dealEdit.title")}
        state={t("dealEdit.state", { ref: row.ref })}
        actions={
          <Link href={`/deals/${id}`}>
            <Button variant="secondary">{t("dealEdit.back")}</Button>
          </Link>
        }
      />

      {error ? (
        <p className="mx-4 mt-4 max-w-[840px] rounded-[var(--radius-control)] bg-critical-bg px-4 py-2.5 text-tiny text-critical-ink md:mx-7">
          {t.has(`dealEdit.error.${error}`) ? t(`dealEdit.error.${error}`) : error}
        </p>
      ) : null}

      <form
        action={editDealAction.bind(null, locale, id)}
        className="mx-4 mt-5 mb-8 flex max-w-[840px] flex-col gap-4 md:mx-7"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label>
            <span className="text-micro text-secondary">{t("deals.client")}</span>
            <select name="partyId" defaultValue={row.partyId} className={`${INPUT} mt-1`}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tradeName?.trim() || c.legalName} · {c.code}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-micro text-muted">{t("dealEdit.clientHint")}</span>
          </label>

          <label>
            <span className="text-micro text-secondary">{t("deal.reference")}</span>
            <input
              name="clientReference"
              defaultValue={row.clientReference ?? ""}
              placeholder="25/DA/2026"
              className={`${INPUT} mt-1`}
            />
            <span className="mt-1 block text-micro text-muted">{t("dealEdit.referenceHint")}</span>
          </label>
        </div>

        <label>
          <span className="text-micro text-secondary">{t("deals.subject")}</span>
          <input name="subject" defaultValue={row.subject} className={`${INPUT} mt-1`} />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <label>
            <span className="text-micro text-secondary">{t("deal.clientDeadline")}</span>
            <input
              type="datetime-local"
              name="deadlineAt"
              defaultValue={forInput(row.deadlineAt)}
              className={`${INPUT} mt-1`}
            />
            {/*
              The field this whole screen exists for. An extractor read it off a
              PDF and a person agreed with it in a hurry; six weeks later the
              only way to know it was corrected is the change history below.
            */}
            <span className="mt-1 block text-micro text-muted">{t("dealEdit.deadlineHint")}</span>
          </label>

          <label>
            <span className="text-micro text-secondary">{t("deal.submissionMethod")}</span>
            <select
              name="submissionMethod"
              defaultValue={row.submissionMethod}
              className={`${INPUT} mt-1`}
            >
              {SUBMISSION_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`deal.method.${method}`)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-micro text-secondary">{t("deal.currency")}</span>
            <input name="currency" defaultValue={row.currency} className={`${INPUT} mt-1`} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label>
            <span className="text-micro text-secondary">{t("dealEdit.contact")}</span>
            <select
              name="contactPersonId"
              defaultValue={row.contactPersonId ?? ""}
              className={`${INPUT} mt-1`}
            >
              <option value="">{t("dealEdit.noContact")}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName}
                  {c.trade ? ` · ${c.trade}` : ""}
                </option>
              ))}
            </select>
          </label>

          {/*
            `deal.owner_id` has existed since phase 4 with NO writer anywhere in
            the application — screen 05 has an Owner column that could only ever
            print whoever created the row. This select is its first one, and it
            is what "assign to" on the list needs before it can come back.
          */}
          <label>
            <span className="text-micro text-secondary">{t("dealEdit.owner")}</span>
            <select name="ownerId" defaultValue={row.ownerId ?? ""} className={`${INPUT} mt-1`}>
              <option value="">{t("dealEdit.noOwner")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.role ? ` · ${t(`auth.roles.${u.role}`)}` : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-micro text-muted">{t("dealEdit.ownerHint")}</span>
          </label>
        </div>

        <label>
          <span className="text-micro text-secondary">{t("deal.instructions")}</span>
          <textarea
            name="clientInstructions"
            rows={4}
            defaultValue={row.clientInstructions ?? ""}
            className={`${INPUT} mt-1`}
          />
        </label>

        <p className="rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-micro leading-relaxed text-secondary">
          {t("dealEdit.recorded")}
        </p>

        <div className="flex justify-end gap-2">
          <Link href={`/deals/${id}`}>
            <Button type="button" variant="secondary">
              {t("dealEdit.cancel")}
            </Button>
          </Link>
          <Button
            type="submit"
            variant="primary"
            disabledReason={mayWrite ? undefined : t("dealEdit.error.notAllowed")}
          >
            {t("dealEdit.save")}
          </Button>
        </div>
      </form>
    </main>
  );
}
