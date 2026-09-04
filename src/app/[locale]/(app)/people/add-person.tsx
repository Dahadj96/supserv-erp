import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { WILAYA_LIST_ID, WilayaList } from "@/components/ui/wilaya-list";
import { PERSON_RELATIONSHIPS } from "@/domain/people";
import { addPerson } from "./actions";

const INPUT =
  "h-[34px] w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-tiny outline-none placeholder:text-muted focus:border-ink";

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-micro font-medium text-secondary">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Screen 51 — "Add a person", inline on the list rather than behind a route.
 *
 * "only two fields are required" is printed on the card, and it is true: a name
 * and a trade. Everything else is placeholdered `optional` so the form itself
 * says which parts can wait.
 */
export async function AddPerson({
  locale,
  employers,
}: {
  locale: string;
  employers: { id: string; legalName: string }[];
}) {
  const t = await getTranslations();
  const required = <span className="text-critical"> *</span>;

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="text-tiny font-semibold text-ink">{t("people.addTitle")}</h2>
        <span className="ms-auto text-micro text-muted">{t("people.onlyTwoRequired")}</span>
      </div>

      <form action={addPerson.bind(null, locale)} autoComplete="off">
        <div className="grid grid-cols-2 gap-4">
          <Field
            htmlFor="fullName"
            label={
              <>
                {t("people.fullName")}
                {required}
              </>
            }
          >
            <input id="fullName" name="fullName" required className={INPUT} />
          </Field>

          <Field
            htmlFor="trade"
            label={
              <>
                {t("people.trade")}
                {required}
              </>
            }
          >
            <input
              id="trade"
              name="trade"
              required
              placeholder={t("people.tradePlaceholder")}
              className={INPUT}
            />
          </Field>

          <Field htmlFor="phone" label={t("people.phone")}>
            <input id="phone" name="phone" placeholder={t("common.optional")} className={INPUT} />
          </Field>

          <Field htmlFor="nationalId" label={t("people.idNumber")}>
            <input
              id="nationalId"
              name="nationalId"
              placeholder={t("common.optional")}
              className={INPUT}
            />
          </Field>

          <Field htmlFor="wilaya" label={t("people.wilaya")}>
            <input
              id="wilaya"
              name="wilaya"
              list={WILAYA_LIST_ID}
              placeholder={t("common.optional")}
              className={INPUT}
            />
            <WilayaList />
          </Field>

          <Field htmlFor="relationship" label={t("people.relationship")}>
            <select id="relationship" name="relationship" defaultValue="daily" className={INPUT}>
              {PERSON_RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {t(`people.relationshipValue.${value}`)}
                </option>
              ))}
            </select>
          </Field>

          <Field htmlFor="employerPartyId" label={t("people.employer")}>
            <select id="employerPartyId" name="employerPartyId" defaultValue="" className={INPUT}>
              <option value="">{t("people.employerSupserv")}</option>
              {employers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legalName}
                </option>
              ))}
            </select>
          </Field>

          <Field htmlFor="dailyRate" label={t("people.dailyRate")}>
            <input
              id="dailyRate"
              name="dailyRate"
              inputMode="decimal"
              placeholder={t("common.optional")}
              className={INPUT}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-micro text-muted">{t("people.attachments")}</span>
          {(["cv", "certification", "idCopy"] as const).map((key) => (
            <span
              key={key}
              className="rounded-[var(--radius-pill)] bg-chip px-2 py-0.5 text-micro text-secondary"
              title={t("rules.comingInPhase", { phase: 6 })}
            >
              {t(`people.attachment.${key}`)}
            </span>
          ))}
          {/* The screen's button reads "Add and assign to a project". Projects
              are a later phase, and a button that cannot do the second half of
              what it says is worse than one that promises less. */}
          <div className="ms-auto">
            <Button type="submit" variant="primary">
              {t("people.addPerson")}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
