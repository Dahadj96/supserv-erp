import { getTranslations } from "next-intl/server";
import { INPUT } from "@/app/[locale]/(app)/setup/field";
import { Button } from "@/components/ui/button";
import { INSTRUMENTS } from "@/domain/money/instruments";
import type { PurchaseOrderView } from "@/domain/purchase/order";
import type { Payable } from "@/domain/purchase/store";
import { payAction, receiveAction, supplierInvoiceAction } from "./actions";

/**
 * Screen 68's three forms: the goods arrived, their facture arrived, we paid.
 *
 * Server-rendered forms, one per fact, each posting to the action that
 * records it. Quantities default to what is still expected, prices to what
 * was agreed — the person corrects what differs, which is exactly the
 * difference the three-way match then shows.
 */
export async function RecordPanels({
  locale,
  order,
  owed,
  canReceive,
  canRecordInvoice,
  canPay,
}: {
  locale: string;
  order: PurchaseOrderView;
  owed: Payable[];
  canReceive: boolean;
  canRecordInvoice: boolean;
  canPay: boolean;
}) {
  const t = await getTranslations();
  const today = new Date().toISOString().slice(0, 10);
  const lines = order.match.lines.filter((line) => line.lineId);
  const open = owed.filter((p) => Number(p.totalIncl) - Number(p.paid) > 0.005);

  if (order.status !== "issued") {
    return (
      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.record.title")}</h2>
        <p className="mt-2 text-micro leading-relaxed text-muted">
          {t("purchaseOrder.record.notIssued")}
        </p>
      </section>
    );
  }

  return (
    <>
      {canReceive ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.record.receipt")}</h2>
          <form
            action={receiveAction.bind(null, locale, order.id)}
            className="mt-3 flex flex-col gap-3"
          >
            <table className="w-full text-tiny">
              <tbody>
                {lines.map((line) => (
                  <tr key={line.lineId} className="border-b border-line-subtle last:border-0">
                    <td className="py-1.5 pe-2 text-secondary">{line.designation}</td>
                    <td className="w-[110px] py-1.5">
                      <input
                        name={`qty:${line.lineId}`}
                        inputMode="decimal"
                        defaultValue={line.remainingQty === "0" ? "" : line.remainingQty}
                        className={`${INPUT} text-end`}
                        aria-label={line.designation ?? ""}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.receivedOn")}
                </span>
                <input
                  type="date"
                  name="receivedOn"
                  defaultValue={today}
                  className={`${INPUT} mt-1`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.supplierRef")}
                </span>
                <input name="supplierRef" className={`${INPUT} mt-1`} />
              </label>
            </div>
            <label>
              <span className="text-micro text-secondary">
                {t("purchaseOrder.record.receivedBy")}
              </span>
              <input name="receivedBy" className={`${INPUT} mt-1`} />
            </label>
            <label>
              <span className="text-micro text-secondary">
                {t("purchaseOrder.record.reserves")}
              </span>
              <input
                name="reserves"
                placeholder={t("purchaseOrder.record.reservesHint")}
                className={`${INPUT} mt-1`}
              />
            </label>
            <div className="flex items-center gap-3">
              <p className="text-micro text-muted">{t("purchaseOrder.record.createsADraft")}</p>
              <div className="ms-auto">
                <Button type="submit" variant="primary">
                  {t("purchaseOrder.record.receiptGo")}
                </Button>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {canRecordInvoice ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.record.invoice")}</h2>
          <form
            action={supplierInvoiceAction.bind(null, locale, order.id)}
            className="mt-3 flex flex-col gap-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.theirNumber")}
                </span>
                <input name="theirNumber" required className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.invoiceDate")}
                </span>
                <input
                  type="date"
                  name="invoiceDate"
                  defaultValue={today}
                  className={`${INPUT} mt-1`}
                />
              </label>
            </div>
            <table className="w-full text-tiny">
              <thead>
                <tr className="text-micro text-muted">
                  <th className="py-1 text-start font-medium">
                    {t("purchaseOrder.column.designation")}
                  </th>
                  <th className="w-[80px] py-1 text-end font-medium">
                    {t("purchaseOrder.column.received")}
                  </th>
                  <th className="w-[110px] py-1 text-end font-medium">
                    {t("purchaseOrder.record.unitPrice")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.lineId} className="border-b border-line-subtle last:border-0">
                    <td className="py-1.5 pe-2 text-secondary">{line.designation}</td>
                    <td className="py-1.5 pe-1">
                      <input
                        name={`qty:${line.lineId}`}
                        inputMode="decimal"
                        defaultValue={line.receivedQty === "0" ? "" : line.receivedQty}
                        className={`${INPUT} text-end`}
                        aria-label={line.designation ?? ""}
                      />
                    </td>
                    <td className="py-1.5">
                      <input
                        name={`price:${line.lineId}`}
                        inputMode="decimal"
                        defaultValue={line.orderedUnitCost}
                        className={`${INPUT} text-end`}
                        aria-label={t("purchaseOrder.record.unitPrice")}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.dueDate")}
                </span>
                <input type="date" name="dueDate" className={`${INPUT} mt-1`} />
              </label>
              <label>
                <span className="text-micro text-secondary">{t("convert.settlement")}</span>
                <select name="settlement" defaultValue="" className={`${INPUT} mt-1`}>
                  <option value="">{t("convert.settlementUnsaid")}</option>
                  {INSTRUMENTS.map((instrument) => (
                    <option key={instrument} value={instrument}>
                      {t(`payments.instrumentName.${instrument}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-micro leading-relaxed text-muted">
              {t("purchaseOrder.record.invoiceHint")}
            </p>
            <div className="flex items-center gap-3">
              <p className="text-micro text-muted">{t("purchaseOrder.record.createsADraft")}</p>
              <div className="ms-auto">
                <Button type="submit" variant="primary">
                  {t("purchaseOrder.record.invoiceGo")}
                </Button>
              </div>
            </div>
          </form>
        </section>
      ) : null}

      {canPay && open.length > 0 && order.supplier ? (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
          <h2 className="text-tiny font-semibold text-ink">{t("purchaseOrder.record.payment")}</h2>
          <form
            action={payAction.bind(null, locale, order.id)}
            className="mt-3 flex flex-col gap-3"
          >
            <input type="hidden" name="partyId" value={order.supplier.id} />
            <label>
              <span className="text-micro text-secondary">
                {t("purchaseOrder.record.whichInvoice")}
              </span>
              <select name="invoiceId" className={`${INPUT} mt-1`}>
                {open.map((p) => (
                  <option key={p.documentId} value={p.documentId}>
                    {p.number ?? "—"} · {(Number(p.totalIncl) - Number(p.paid)).toFixed(2)}{" "}
                    {p.currency}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.amount")}
                </span>
                <input
                  name="amount"
                  inputMode="decimal"
                  defaultValue={order.money.safeToPay}
                  className={`${INPUT} mt-1 text-end`}
                />
              </label>
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.paidOn")}
                </span>
                <input type="date" name="paidOn" defaultValue={today} className={`${INPUT} mt-1`} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label>
                <span className="text-micro text-secondary">{t("convert.settlement")}</span>
                <select name="method" defaultValue="virement" className={`${INPUT} mt-1`}>
                  {INSTRUMENTS.map((instrument) => (
                    <option key={instrument} value={instrument}>
                      {t(`payments.instrumentName.${instrument}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-micro text-secondary">
                  {t("purchaseOrder.record.bankRef")}
                </span>
                <input name="bankRef" className={`${INPUT} mt-1`} />
              </label>
            </div>
            <p className="text-micro leading-relaxed text-muted">
              {t("purchaseOrder.record.paymentHint")}
            </p>
            <div className="ms-auto">
              <Button type="submit" variant="primary">
                {t("purchaseOrder.record.paymentGo")}
              </Button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
