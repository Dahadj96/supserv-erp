"use client";

import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { Button } from "@/components/ui/button";
import type { LineKind } from "@/documents/draft";
import { computeTotals, formatMoney } from "@/domain/money";
import { INSTRUMENTS } from "@/domain/money/instruments";
import { stampDutyFor } from "@/domain/money/stamp-duty";

/**
 * Screen 47 — the line editor.
 *
 * The running totals come from `domain/money.ts`, the same module the server
 * uses when it saves. A second implementation in the browser is how a figure on
 * screen ends up disagreeing with the figure on the PDF.
 *
 * Reordering is by button rather than by drag. The design draws a grip handle;
 * a keyboard user cannot grab one, and up/down moves the row in exactly the way
 * a grip would with a tenth of the machinery.
 */

export type Row = {
  key: number;
  lineKind: LineKind;
  designation: string;
  reference: string;
  unit: string;
  qty: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
  isOption: boolean;
};

const blank = (key: number, lineKind: LineKind): Row => ({
  key,
  lineKind,
  designation: "",
  reference: "",
  unit: lineKind === "item" ? "U" : "",
  qty: "",
  unitPrice: "",
  discountPct: "0",
  vatRate: "19",
  isOption: false,
});

const ADDABLE: LineKind[] = ["item", "section", "text", "subtotal", "page_break"];

export function Builder({
  locale,
  kind,
  kinds,
  issuedOn,
  globalDiscountPct,
  advanceDeducted,
  retentionPct,
  settlement: initialSettlement,
  stampDutyConfirmed,
  theirNumber,
  carriesTheirNumber,
  initial,
  currency,
  action,
}: {
  locale: string;
  kind: string;
  kinds: { kind: string; label: string }[];
  issuedOn: string;
  /** The counterparty's own reference, for a kind that carries theirs, not ours. */
  theirNumber: string;
  /** Screen 50: this kind is numbered by the counterparty (a client's order). */
  carriesTheirNumber: boolean;
  globalDiscountPct: string;
  advanceDeducted: string;
  retentionPct: string;
  /** virement | cheque | especes | traite | compensation, or "" for not said. */
  settlement: string;
  /** Screen 69: has a person confirmed `invoice.stampDutyThreshold`? */
  stampDutyConfirmed: boolean;
  initial: Row[];
  currency: string;
  action: (form: FormData) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<Row[]>(
    initial.length > 0 ? initial : [blank(1, "item"), blank(2, "item")],
  );
  const [next, setNext] = useState(initial.length + 10);
  const [discount, setDiscount] = useState(globalDiscountPct);
  const [advance, setAdvance] = useState(advanceDeducted);
  const [retention, setRetention] = useState(retentionPct);
  const [settlement, setSettlement] = useState(initialSettlement);

  const set = (key: number, field: keyof Row, value: string | boolean) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const move = (index: number, by: number) =>
    setRows((all) => {
      const to = index + by;
      if (to < 0 || to >= all.length) return all;
      const copy = [...all];
      const [row] = copy.splice(index, 1);
      if (row) copy.splice(to, 0, row);
      return copy;
    });

  const totals = useMemo(() => {
    const priceable = rows
      .filter((r) => r.lineKind === "item" && r.designation.trim() && Number(r.qty) > 0)
      .map((r) => ({
        qty: r.qty || 0,
        unitPrice: r.unitPrice || 0,
        discountPct: r.discountPct || 0,
        vatRate: r.vatRate || 0,
        isOption: r.isOption,
      }));
    const adjustments = { globalDiscountPct: discount || "0", advanceDeducted: advance || "0" };
    // The same two passes `saveDraft` makes, so what the screen shows while
    // typing is what the server will store. The duty is on the sum including
    // VAT, and only once the rule is confirmed and the settlement is cash.
    const before = computeTotals(priceable, adjustments);
    const stampDuty = stampDutyFor({
      totalIncl: before.totalIncl,
      settlement,
      ruleConfirmed: stampDutyConfirmed,
    });
    return computeTotals(priceable, { ...adjustments, stampDuty });
  }, [rows, discount, advance, settlement, stampDutyConfirmed]);

  const money = (value: string) => formatMoney(value, { locale, currency });

  return (
    <form action={action} className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-3">
      {/*
        One column under 1536px. On the 12-inch laptop the shell leaves about
        1 100px for content, and a two-thirds column of that, less seven fixed
        columns, gave the designation — the field a person types most — 30px.
      */}
      <div className="flex flex-col gap-5 2xl:col-span-2">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("builder.kind")}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {kinds.map((k) => (
              <label key={k.kind} className="cursor-pointer">
                <input
                  type="radio"
                  name="kind"
                  value={k.kind}
                  defaultChecked={k.kind === kind}
                  className="peer sr-only"
                />
                <span className="inline-flex rounded-[var(--radius-pill)] bg-chip px-2.5 py-1 text-micro font-medium text-secondary peer-checked:bg-ink peer-checked:text-on-ink">
                  {k.label}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="flex items-baseline gap-3 border-b border-line-subtle px-5 py-3.5">
            <h2 className="text-tiny font-semibold text-ink">{t("builder.lines")}</h2>
            <span className="ms-auto text-micro text-muted">{t("builder.linesHint")}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-tiny">
              <thead>
                <tr className="border-b border-line-subtle text-micro text-muted">
                  <th className="w-[44px] py-2 ps-4 text-start font-medium">#</th>
                  <th className="min-w-[240px] py-2 pe-2 text-start font-medium">
                    {t("builder.col.designation")}
                  </th>
                  <th className="w-[60px] py-2 pe-2 text-start font-medium">
                    {t("builder.col.unit")}
                  </th>
                  <th className="w-[80px] py-2 pe-2 text-end font-medium">
                    {t("builder.col.qty")}
                  </th>
                  <th className="w-[104px] py-2 pe-2 text-end font-medium">
                    {t("builder.col.unitPrice")}
                  </th>
                  <th className="w-[70px] py-2 pe-2 text-end font-medium">
                    {t("builder.col.discount")}
                  </th>
                  <th className="w-[80px] py-2 pe-2 text-end font-medium">
                    {t("builder.col.vat")}
                  </th>
                  <th className="w-[112px] py-2 pe-2 text-end font-medium">
                    {t("builder.col.total")}
                  </th>
                  <th className="w-[86px] py-2 pe-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isItem = row.lineKind === "item";
                  const lineTotal =
                    (Number(row.qty) || 0) *
                    (Number(row.unitPrice) || 0) *
                    (1 - (Number(row.discountPct) || 0) / 100);

                  return (
                    <tr
                      key={row.key}
                      className={`border-b border-line-subtle last:border-0 ${
                        row.lineKind === "section" ? "bg-plane" : ""
                      }`}
                    >
                      {/* Order and kind travel with the row, in the order the
                          browser posts them — which is document order. */}
                      <input type="hidden" name="lineKind" value={row.lineKind} />
                      {row.isOption ? (
                        <input type="hidden" name="isOption" value={String(index)} />
                      ) : null}

                      <td className="py-1.5 ps-4 text-micro text-muted">
                        {isItem ? index + 1 : t(`builder.lineKind.${row.lineKind}`)}
                      </td>

                      <td className="py-1.5 pe-2" colSpan={row.lineKind === "page_break" ? 7 : 1}>
                        {row.lineKind === "page_break" ? (
                          <p className="text-micro text-muted">{t("builder.pageBreak")}</p>
                        ) : (
                          <input
                            name="designation"
                            value={row.designation}
                            onChange={(e) => set(row.key, "designation", e.target.value)}
                            placeholder={t(`builder.placeholder.${row.lineKind}`)}
                            className={`${INPUT} w-full ${
                              row.lineKind === "section" ? "font-semibold uppercase" : ""
                            }`}
                          />
                        )}
                      </td>

                      {row.lineKind === "page_break" ? null : (
                        <>
                          <td className="py-1.5 pe-2">
                            {isItem ? (
                              <input
                                name="unit"
                                value={row.unit}
                                onChange={(e) => set(row.key, "unit", e.target.value)}
                                className={`${INPUT} w-full`}
                              />
                            ) : (
                              <input type="hidden" name="unit" value="" />
                            )}
                          </td>
                          <td className="py-1.5 pe-2">
                            {isItem ? (
                              <input
                                name="qty"
                                type="number"
                                step="0.0001"
                                min="0"
                                value={row.qty}
                                onChange={(e) => set(row.key, "qty", e.target.value)}
                                className={`${INPUT} w-full text-end`}
                              />
                            ) : (
                              <input type="hidden" name="qty" value="" />
                            )}
                          </td>
                          <td className="py-1.5 pe-2">
                            {isItem ? (
                              <input
                                name="unitPrice"
                                type="number"
                                step="0.0001"
                                min="0"
                                value={row.unitPrice}
                                onChange={(e) => set(row.key, "unitPrice", e.target.value)}
                                className={`${INPUT} w-full text-end`}
                              />
                            ) : (
                              <input type="hidden" name="unitPrice" value="" />
                            )}
                          </td>
                          <td className="py-1.5 pe-2">
                            {isItem ? (
                              <input
                                name="discountPct"
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={row.discountPct}
                                onChange={(e) => set(row.key, "discountPct", e.target.value)}
                                className={`${INPUT} w-full text-end`}
                              />
                            ) : (
                              <input type="hidden" name="discountPct" value="" />
                            )}
                          </td>
                          <td className="py-1.5 pe-2">
                            {isItem ? (
                              <select
                                name="vatRate"
                                value={row.vatRate}
                                onChange={(e) => set(row.key, "vatRate", e.target.value)}
                                className={`${INPUT} w-full text-end`}
                              >
                                <option value="19">19 %</option>
                                <option value="9">9 %</option>
                                <option value="0">0 %</option>
                              </select>
                            ) : (
                              <input type="hidden" name="vatRate" value="" />
                            )}
                          </td>
                          <td className="py-1.5 pe-2 text-end text-secondary tabular-nums">
                            {isItem && lineTotal ? (
                              row.isOption ? (
                                <span className="text-muted">({money(lineTotal.toFixed(2))})</span>
                              ) : (
                                money(lineTotal.toFixed(2))
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      )}

                      <td className="py-1.5 pe-4">
                        <div className="flex items-center justify-end gap-0.5">
                          {isItem ? (
                            <button
                              type="button"
                              title={t("builder.option")}
                              aria-pressed={row.isOption}
                              onClick={() => set(row.key, "isOption", !row.isOption)}
                              className={`inline-flex min-h-6 items-center rounded-[var(--radius-pill)] px-1.5 py-0.5 text-micro font-semibold ${
                                row.isOption ? "bg-warning-bg text-warning-ink" : "text-muted"
                              }`}
                            >
                              {t("builder.optionShort")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={t("builder.moveUp")}
                            onClick={() => move(index, -1)}
                            className="text-muted hover:text-ink"
                          >
                            <ChevronUp className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={t("builder.moveDown")}
                            onClick={() => move(index, 1)}
                            className="text-muted hover:text-ink"
                          >
                            <ChevronDown className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={t("builder.removeLine")}
                            onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
                            className="text-muted hover:text-critical-ink"
                          >
                            <X className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line-subtle px-5 py-3">
            {ADDABLE.map((lineKind) => (
              <Button
                key={lineKind}
                variant="secondary"
                size="small"
                icon={<Plus className="size-3.5" aria-hidden />}
                onClick={() => {
                  setRows((all) => [...all, blank(next, lineKind)]);
                  setNext((n) => n + 1);
                }}
              >
                {t(`builder.add.${lineKind}`)}
              </Button>
            ))}
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("builder.totals")}</h2>
          <dl className="mt-3">
            <Line label={t("builder.totalExcl")} value={money(totals.totalExcl)} />
            {Number(totals.discountTotal) !== 0 ? (
              <Line
                label={t("builder.globalDiscount")}
                value={`− ${money(totals.discountTotal)}`}
              />
            ) : null}
            {Object.entries(totals.vatByRate).map(([rate, amount]) => (
              <Line
                key={rate}
                label={t("builder.vatAt", { rate: String(Number(rate)) })}
                value={money(amount)}
              />
            ))}
            {Number(totals.stampDuty) !== 0 ? (
              <Line label={t("builder.stampDuty")} value={money(totals.stampDuty)} />
            ) : null}
            <Line label={t("builder.totalIncl")} value={money(totals.totalIncl)} strong />
            {Number(totals.advanceDeducted) !== 0 ? (
              <>
                <Line label={t("builder.advance")} value={`− ${money(totals.advanceDeducted)}`} />
                <Line label={t("builder.dueNow")} value={money(totals.dueNow)} strong />
              </>
            ) : null}
          </dl>

          {Number(totals.optionsExcl) !== 0 ? (
            <p className="mt-3 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-micro text-warning-ink">
              {t("builder.optionsNotIncluded", { amount: money(totals.optionsExcl) })}
            </p>
          ) : null}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("builder.adjustments")}</h2>

          <div className="mt-3 flex flex-col gap-3">
            <label className="block">
              <span className="text-micro text-secondary">{t("builder.settlement")}</span>
              <select
                name="settlement"
                value={settlement}
                onChange={(e) => setSettlement(e.target.value)}
                className={`${INPUT} mt-1`}
              >
                <option value="">{t("builder.settlementUnsaid")}</option>
                {INSTRUMENTS.map((instrument) => (
                  <option key={instrument} value={instrument}>
                    {t(`payments.instrumentName.${instrument}`)}
                  </option>
                ))}
              </select>
              {settlement === "especes" ? (
                <span className="mt-1 block text-micro leading-relaxed text-muted">
                  {stampDutyConfirmed
                    ? t("builder.stampDutyApplied")
                    : t("builder.stampDutyUnconfirmed")}
                </span>
              ) : null}
            </label>

            <label className="block">
              <span className="text-micro text-secondary">{t("builder.globalDiscountPct")}</span>
              <input
                name="globalDiscountPct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className={`${INPUT} mt-1`}
              />
            </label>

            <label className="block">
              <span className="text-micro text-secondary">{t("builder.advanceDeducted")}</span>
              <input
                name="advanceDeducted"
                type="number"
                step="0.01"
                min="0"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
                className={`${INPUT} mt-1`}
              />
            </label>

            <label className="block">
              <span className="text-micro text-secondary">{t("builder.retentionPct")}</span>
              <input
                name="retentionPct"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
                className={`${INPUT} mt-1`}
              />
              <span className="mt-1 block text-micro leading-relaxed text-muted">
                {t("builder.retentionUnconfirmed")}
              </span>
            </label>

            <label className="block">
              <span className="text-micro text-secondary">{t("builder.date")}</span>
              <input
                name="issuedOn"
                type="date"
                defaultValue={issuedOn}
                className={`${INPUT} mt-1`}
              />
            </label>

            {carriesTheirNumber ? (
              <label className="block">
                <span className="text-micro text-secondary">{t("builder.theirNumber")}</span>
                <input
                  name="theirNumber"
                  defaultValue={theirNumber}
                  placeholder={t("builder.theirNumberPlaceholder")}
                  className={`${INPUT} mt-1`}
                />
                <span className="mt-1 block text-micro leading-relaxed text-muted">
                  {t("builder.theirNumberHint")}
                </span>
              </label>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary">
            {t("builder.save")}
          </Button>
          <Button type="submit" name="then" value="preview" variant="secondary">
            {t("builder.saveAndPreview")}
          </Button>
          <p className="text-micro leading-relaxed text-muted">{t("builder.noNumberYet")}</p>
        </div>
      </div>
    </form>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline gap-3 border-b border-line-subtle py-2 last:border-0 ${
        strong ? "font-semibold text-ink" : "text-secondary"
      }`}
    >
      <dt className="text-tiny">{label}</dt>
      <dd className="ms-auto text-tiny tabular-nums">{value}</dd>
    </div>
  );
}
