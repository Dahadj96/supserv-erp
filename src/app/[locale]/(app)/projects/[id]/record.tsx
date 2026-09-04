import { getTranslations } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { Button } from "@/components/ui/button";
import { WILAYA_LIST_ID, WilayaList } from "@/components/ui/wilaya-list";
import { RETENTION_BASES } from "@/domain/money";
import type { ContractCandidate } from "@/domain/project/situations";
import type { ProjectDetail } from "@/domain/project/store";
import {
  cautionAction,
  physicalAction,
  receptionAction,
  releaseCautionAction,
  termsAction,
} from "./actions";

const CAUTION_KINDS = ["bonne_execution", "restitution_avance", "retenue_garantie", "soumission"];

/**
 * Screen 16's forms — the facts a site produces, each small enough to fill
 * in from a phone on the chantier.
 *
 * Nothing here is computed. Physical progress is what the chef de chantier
 * said; the PV dates are the days two papers were signed; the terms are what
 * the marché says. What the system derives from them is on the page beside.
 */
export async function RecordPanels({
  locale,
  p,
  contracts,
  canWrite,
}: {
  locale: string;
  p: ProjectDetail;
  contracts: ContractCandidate[];
  canWrite: boolean;
}) {
  const t = await getTranslations();
  const today = new Date().toISOString().slice(0, 10);
  const disabled = canWrite ? undefined : t("documents.notAllowed");
  const live = p.cautions.filter((c) => c.state !== "released");
  const amount = (value: string) =>
    Number(value).toLocaleString(locale === "fr" ? "fr-DZ" : "en-GB", {
      maximumFractionDigits: 0,
    });

  return (
    <>
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("projectRecord.physical.title")}</h2>
        <p className="mt-1 text-micro leading-relaxed text-muted">
          {t("projectRecord.physical.why")}
        </p>
        <form
          action={physicalAction.bind(null, locale, p.id)}
          className="mt-3 flex items-end gap-2"
        >
          <label className="flex-1">
            <span className="text-micro text-secondary">{t("projectRecord.physical.percent")}</span>
            <input
              name="percent"
              inputMode="numeric"
              defaultValue={p.progress.physicalPercent ?? ""}
              className={`${INPUT} mt-1 text-end tabular-nums`}
            />
          </label>
          <Button type="submit" variant="secondary" disabledReason={disabled}>
            {t("projectRecord.record")}
          </Button>
        </form>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("projectRecord.reception.title")}</h2>
        <form
          action={receptionAction.bind(null, locale, p.id)}
          className="mt-3 flex flex-col gap-3"
        >
          <label>
            <span className="text-micro text-secondary">{t("projectRecord.reception.which")}</span>
            <select
              name="which"
              defaultValue={p.pvProvisoireOn ? "definitive" : "provisoire"}
              className={`${INPUT} mt-1`}
            >
              <option value="planned">{t("projectRecord.reception.planned")}</option>
              <option value="provisoire" disabled={Boolean(p.pvProvisoireOn)}>
                {t("project.reception.provisoire")}
              </option>
              <option value="definitive" disabled={Boolean(p.pvDefinitiveOn)}>
                {t("project.reception.definitive")}
              </option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="text-micro text-secondary">{t("projectRecord.reception.on")}</span>
              <input type="date" name="on" defaultValue={today} className={`${INPUT} mt-1`} />
            </label>
            <Button type="submit" variant="secondary" disabledReason={disabled}>
              {t("projectRecord.record")}
            </Button>
          </div>
          <p className="text-micro leading-relaxed text-muted">
            {t("projectRecord.reception.why")}
          </p>
        </form>
      </section>

      <section
        id="terms"
        className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
      >
        <h2 className="text-tiny font-semibold text-ink">{t("projectRecord.terms.title")}</h2>
        <p className="mt-1 text-micro leading-relaxed text-muted">{t("projectRecord.terms.why")}</p>
        <form action={termsAction.bind(null, locale, p.id)} className="mt-3 flex flex-col gap-3">
          <WilayaList />
          <label>
            <span className="text-micro text-secondary">{t("projectNew.f.contract")}</span>
            <select
              name="contractDocumentId"
              defaultValue={p.contractDocumentId ?? ""}
              className={`${INPUT} mt-1`}
            >
              <option value="">{t("projectNew.f.contractLater")}</option>
              {contracts.map((c) => (
                <option key={c.documentId} value={c.documentId}>
                  {t(`documents.kind.${c.kind}`)} {c.number ?? ""} · {amount(c.totalExcl)}{" "}
                  {p.currency} HT
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.contractRef")}</span>
              <input
                name="contractRef"
                defaultValue={p.contractRef ?? ""}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.wilaya")}</span>
              <input
                name="wilaya"
                list={WILAYA_LIST_ID}
                defaultValue={p.wilaya ?? ""}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.amountExcl")}</span>
              <input
                name="amountExcl"
                inputMode="decimal"
                defaultValue={p.amountExcl ?? ""}
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.warrantyMonths")}</span>
              <input
                name="warrantyMonths"
                inputMode="numeric"
                defaultValue={p.warrantyMonths ?? ""}
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.startedOn")}</span>
              <input
                type="date"
                name="startedOn"
                defaultValue={p.startedOn ?? ""}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.contractualEnd")}</span>
              <input
                type="date"
                name="contractualEnd"
                defaultValue={p.contractualEnd ?? ""}
                className={`${INPUT} mt-1`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.retentionPct")}</span>
              <input
                name="retentionPct"
                inputMode="decimal"
                defaultValue={p.retentionPct}
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectNew.f.retentionBase")}</span>
              <select
                name="retentionBase"
                defaultValue={p.retentionBase ?? ""}
                className={`${INPUT} mt-1`}
              >
                <option value="">{t("projectNew.retentionBase.unsaid")}</option>
                {RETENTION_BASES.map((base) => (
                  <option key={base} value={base}>
                    {t(`projectNew.retentionBase.${base}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ms-auto">
            <Button type="submit" variant="secondary" disabledReason={disabled}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("projectRecord.caution.title")}</h2>
        <form action={cautionAction.bind(null, locale, p.id)} className="mt-3 flex flex-col gap-3">
          <label>
            <span className="text-micro text-secondary">{t("projectRecord.caution.kind")}</span>
            <select name="kind" defaultValue="bonne_execution" className={`${INPUT} mt-1`}>
              {CAUTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`project.caution.${kind}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-micro text-secondary">{t("projectRecord.caution.amount")}</span>
              <input
                name="amount"
                inputMode="decimal"
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectRecord.caution.pct")}</span>
              <input
                name="pct"
                inputMode="decimal"
                className={`${INPUT} mt-1 text-end tabular-nums`}
              />
            </label>
            <label>
              <span className="text-micro text-secondary">{t("projectRecord.caution.bank")}</span>
              <input name="bankName" className={`${INPUT} mt-1`} />
            </label>
            <label>
              <span className="text-micro text-secondary">
                {t("projectRecord.caution.reference")}
              </span>
              <input name="reference" className={`${INPUT} mt-1`} />
            </label>
            <label>
              <span className="text-micro text-secondary">
                {t("projectRecord.caution.issuedOn")}
              </span>
              <input type="date" name="issuedOn" className={`${INPUT} mt-1`} />
            </label>
            <label>
              <span className="text-micro text-secondary">
                {t("projectRecord.caution.expiresOn")}
              </span>
              <input type="date" name="expiresOn" className={`${INPUT} mt-1`} />
            </label>
          </div>
          <div className="ms-auto">
            <Button type="submit" variant="secondary" disabledReason={disabled}>
              {t("projectRecord.caution.add")}
            </Button>
          </div>
        </form>

        {live.length > 0 ? (
          <form
            action={releaseCautionAction.bind(null, locale, p.id)}
            className="mt-4 flex flex-col gap-2 border-t border-line-subtle pt-3"
          >
            <span className="text-micro text-secondary">{t("projectRecord.caution.released")}</span>
            <div className="flex items-end gap-2">
              <select name="cautionId" className={`${INPUT} flex-1`}>
                {live.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(`project.caution.${c.kind}`)}
                    {c.bankName ? ` · ${c.bankName}` : ""}
                    {c.expiresOn ? ` · ${c.expiresOn}` : ""}
                  </option>
                ))}
              </select>
              <input type="date" name="on" defaultValue={today} className={`${INPUT} w-[150px]`} />
              <Button type="submit" variant="secondary" disabledReason={disabled}>
                {t("projectRecord.record")}
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
