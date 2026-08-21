"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { computeTotals, formatMoney } from "@/domain/money";
import { Field, INPUT } from "../../setup/field";

/**
 * Screen 72's left column, for the one start-from option that has data behind
 * it today.
 *
 * The running totals are computed by `domain/money.ts` — the same module the
 * server uses when it saves. A second implementation in the browser is how a
 * total on screen ends up disagreeing with the total on the PDF.
 */

export type ClientOption = {
  id: string;
  code: string;
  legalName: string;
  docLocale: string;
  hasNif: boolean;
};

type Row = {
  key: number;
  designation: string;
  unit: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
};

const blank = (key: number): Row => ({
  key,
  designation: "",
  unit: "",
  qty: "",
  unitPrice: "",
  vatRate: "19",
});

export function InvoiceForm({
  clients,
  today,
  action,
}: {
  clients: ClientOption[];
  today: string;
  action: (form: FormData) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<Row[]>([blank(1), blank(2), blank(3)]);
  const [next, setNext] = useState(4);
  const [clientId, setClientId] = useState("");

  const client = clients.find((c) => c.id === clientId);

  // Only rows that would survive the server's own parse are counted, so the
  // figure on screen is the figure that gets saved.
  const totals = useMemo(
    () =>
      computeTotals(
        rows
          .filter((r) => r.designation.trim() && Number(r.qty) > 0)
          .map((r) => ({ qty: r.qty || 0, unitPrice: r.unitPrice || 0, vatRate: r.vatRate || 0 })),
      ),
    [rows],
  );

  const locale = client?.docLocale ?? "fr";
  const set = (key: number, field: keyof Row, value: string) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  return (
    <form action={action} className="col-span-2 flex flex-col gap-5">
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.startFrom")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-[var(--radius-pill)] bg-ink px-2.5 py-1 text-micro font-medium text-on-ink">
            {t("newInvoice.start.myself")}
          </span>
          {(["order", "offer", "situation"] as const).map((key) => (
            <span
              key={key}
              title={t("newInvoice.start.laterReason")}
              className="cursor-not-allowed rounded-[var(--radius-pill)] bg-inactive px-2.5 py-1 text-micro font-medium text-disabled"
            >
              {t(`newInvoice.start.${key}`)}
            </span>
          ))}
        </div>
        <p className="mt-2.5 text-micro leading-relaxed text-muted">
          {t("newInvoice.start.laterReason")}
        </p>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="grid grid-cols-2 gap-4">
          <Field htmlFor="partyId" label={t("newInvoice.client")} required>
            <select
              id="partyId"
              name="partyId"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={INPUT}
            >
              <option value="">{t("newInvoice.pickClient")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.legalName}
                </option>
              ))}
            </select>
          </Field>

          <Field htmlFor="issuedOn" label={t("newInvoice.date")} hint={t("newInvoice.dateHint")}>
            <input
              id="issuedOn"
              name="issuedOn"
              type="date"
              defaultValue={today}
              className={INPUT}
            />
          </Field>
        </div>

        {client ? (
          <div className="mt-3 flex flex-wrap gap-4 rounded-[var(--radius-control)] bg-plane px-3 py-2.5">
            <p className="text-micro text-secondary">
              {t("newInvoice.languageFrom", { language: client.docLocale.toUpperCase() })}
            </p>
            {client.hasNif ? null : (
              <p className="text-micro font-medium text-critical-ink">
                {t("newInvoice.clientHasNoNif")}
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-tiny font-semibold text-ink">{t("newInvoice.lines")}</h2>
          <span className="ms-auto text-micro text-muted">{t("newInvoice.linesHint")}</span>
        </div>

        <table className="w-full border-collapse text-tiny">
          <thead>
            <tr className="border-b border-line-subtle text-micro text-muted">
              <th className="w-8 py-2 ps-5 text-start font-medium">#</th>
              <th className="py-2 pe-3 text-start font-medium">
                {t("newInvoice.col.designation")}
              </th>
              <th className="w-[70px] py-2 pe-3 text-start font-medium">
                {t("newInvoice.col.unit")}
              </th>
              <th className="w-[90px] py-2 pe-3 text-end font-medium">{t("newInvoice.col.qty")}</th>
              <th className="w-[120px] py-2 pe-3 text-end font-medium">
                {t("newInvoice.col.unitPrice")}
              </th>
              <th className="w-[90px] py-2 pe-3 text-end font-medium">{t("newInvoice.col.vat")}</th>
              <th className="w-[130px] py-2 pe-3 text-end font-medium">
                {t("newInvoice.col.total")}
              </th>
              <th className="w-9 py-2 pe-5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const lineTotal = (Number(row.qty) || 0) * (Number(row.unitPrice) || 0);
              return (
                <tr key={row.key} className="border-b border-line-subtle last:border-0">
                  <td className="py-1.5 ps-5 text-micro text-muted">{i + 1}</td>
                  <td className="py-1.5 pe-3">
                    <input
                      name="designation"
                      value={row.designation}
                      onChange={(e) => set(row.key, "designation", e.target.value)}
                      placeholder={t("newInvoice.col.designation")}
                      className={INPUT}
                    />
                  </td>
                  <td className="py-1.5 pe-3">
                    <input
                      name="unit"
                      value={row.unit}
                      onChange={(e) => set(row.key, "unit", e.target.value)}
                      className={INPUT}
                    />
                  </td>
                  <td className="py-1.5 pe-3">
                    <input
                      name="qty"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={row.qty}
                      onChange={(e) => set(row.key, "qty", e.target.value)}
                      className={`${INPUT} text-end`}
                    />
                  </td>
                  <td className="py-1.5 pe-3">
                    <input
                      name="unitPrice"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={row.unitPrice}
                      onChange={(e) => set(row.key, "unitPrice", e.target.value)}
                      className={`${INPUT} text-end`}
                    />
                  </td>
                  <td className="py-1.5 pe-3">
                    <select
                      name="vatRate"
                      value={row.vatRate}
                      onChange={(e) => set(row.key, "vatRate", e.target.value)}
                      className={`${INPUT} text-end`}
                    >
                      <option value="19">19 %</option>
                      <option value="9">9 %</option>
                      <option value="0">0 %</option>
                    </select>
                  </td>
                  <td className="py-1.5 pe-3 text-end text-secondary tabular-nums">
                    {lineTotal ? formatMoney(lineTotal.toFixed(2), locale) : "—"}
                  </td>
                  <td className="py-1.5 pe-5 text-end">
                    {rows.length > 1 ? (
                      <button
                        type="button"
                        aria-label={t("newInvoice.removeLine")}
                        onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                        className="text-muted hover:text-critical-ink"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="border-t border-line-subtle px-5 py-3">
          <Button
            variant="secondary"
            size="small"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => {
              setRows((all) => [...all, blank(next)]);
              setNext((n) => n + 1);
            }}
          >
            {t("newInvoice.addLine")}
          </Button>
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <div className="ms-auto w-[320px]">
          <TotalLine
            label={t("newInvoice.totalExcl")}
            value={formatMoney(totals.totalExcl, locale)}
          />
          {Object.entries(totals.vatByRate).map(([rate, amount]) => (
            <TotalLine
              key={rate}
              label={t("newInvoice.vatAt", { rate: String(Number(rate)) })}
              value={formatMoney(amount, locale)}
            />
          ))}
          <TotalLine
            label={t("newInvoice.totalIncl")}
            value={formatMoney(totals.totalIncl, locale)}
            grand
          />
        </div>
        <p className="mt-3 text-micro leading-relaxed text-muted">
          {t("newInvoice.stampDutyLater")}
        </p>
      </section>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary">
          {t("newInvoice.saveDraft")}
        </Button>
        <p className="text-micro text-muted">{t("newInvoice.noNumberYet")}</p>
      </div>
    </form>
  );
}

function TotalLine({ label, value, grand }: { label: string; value: string; grand?: boolean }) {
  return (
    <div
      className={`flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0 ${
        grand ? "font-semibold text-ink" : "text-secondary"
      }`}
    >
      <span className="text-tiny">{label}</span>
      <span className="ms-auto text-tiny tabular-nums">{value}</span>
    </div>
  );
}
