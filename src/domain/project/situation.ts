import Decimal from "decimal.js";
import { lineTotalExcl } from "@/domain/money";

/**
 * The arithmetic of a situation de travaux — the décompte a public client
 * signs, in the layout the wilaya's own "partie co-contractant" form uses.
 *
 * PURE. The contract's lines, what earlier situations already claimed on each
 * of them, and what this period claims go in; every column of the form comes
 * out. Nothing cumulative is stored anywhere: "cumul précédent" is the sum of
 * the ISSUED situations before this one, and it moves only when one of those
 * is issued — which, being issued, it never does again (LAW 5).
 *
 * The form, as the client reads it, line by line:
 *
 *   n° prix · désignation · U · qté marché · P.U. ·
 *   qté précédente · qté période · qté cumulée · montant cumulé
 *
 * then, underneath:
 *
 *   travaux cumulés à ce jour (HT)
 *   − travaux précédemment certifiés (HT)
 *   = montant de la présente situation (HT)
 *   TVA · TTC
 *   − retenue de garantie
 *   − remboursement d'avance
 *   = net à payer
 *
 * The last block is `computeTotals` in src/domain/money.ts, called by the
 * store with the period's lines — this file only supplies the cumulative
 * columns that the totals engine has no business knowing about.
 */

export type ContractLine = {
  lineId: string;
  position: number;
  reference: string | null;
  designation: string | null;
  unit: string | null;
  /** Quantité du marché. */
  qty: string;
  unitPrice: string;
  vatRate: string;
};

export type SituationRow = ContractLine & {
  /** Claimed on the situations issued before this one. */
  qtyPrevious: string;
  /** Claimed on this one. */
  qtyPeriod: string;
  /** Previous plus period. */
  qtyCumul: string;
  amountPeriod: string;
  amountCumul: string;
  /**
   * The cumulative quantity has gone past the contract's. Not refused — the
   * work was done and the client's engineer will sign or strike it — but shown,
   * because a line past its quantity is the thing an avenant exists for.
   */
  overContract: boolean;
};

const d = (value: string | number | null | undefined) => new Decimal(value ?? 0);

/** Every contract line, with the three quantity columns filled in. */
export function situationRows(opts: {
  contract: ContractLine[];
  /** lineId → quantity already claimed on earlier ISSUED situations. */
  previous: Record<string, string>;
  /** lineId → quantity claimed on this situation. Absent lines claim nothing. */
  period: Record<string, string>;
}): SituationRow[] {
  return opts.contract
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((line) => {
      const qtyPrevious = d(opts.previous[line.lineId]);
      const qtyPeriod = d(opts.period[line.lineId]);
      const qtyCumul = qtyPrevious.plus(qtyPeriod);
      return {
        ...line,
        qtyPrevious: qtyPrevious.toFixed(),
        qtyPeriod: qtyPeriod.toFixed(),
        qtyCumul: qtyCumul.toFixed(),
        amountPeriod: lineTotalExcl({
          qty: qtyPeriod.toFixed(),
          unitPrice: line.unitPrice,
        }).toFixed(2),
        amountCumul: lineTotalExcl({ qty: qtyCumul.toFixed(), unitPrice: line.unitPrice }).toFixed(
          2,
        ),
        overContract: qtyCumul.greaterThan(d(line.qty)),
      };
    });
}

export type Cumulative = {
  /** Travaux cumulés à ce jour, HT — every line's cumulative amount. */
  cumulExcl: string;
  /** Travaux précédemment certifiés, HT — the earlier situations' totals. */
  previouslyCertifiedExcl: string;
  /** The difference, which must equal the period's own total. */
  periodExcl: string;
  /** Cumulative over the contract value, whole percent. Null with no contract. */
  percentOfContract: number | null;
  /** Lines whose cumulative quantity exceeds the contract's. */
  overContract: number;
};

/**
 * The three lines above the VAT block.
 *
 * `previouslyCertifiedExcl` is passed in rather than re-derived from the rows
 * because it is the sum of the earlier situations' OWN totals as they were
 * issued — the figure the client already certified — and a line whose unit
 * price changed by avenant between two situations would make the two
 * differ. When they differ, the certified figure is the one the form prints,
 * and `periodExcl` is what closes the gap.
 */
export function cumulative(opts: {
  rows: SituationRow[];
  previouslyCertifiedExcl: string;
  contractExcl: string | null;
}): Cumulative {
  const cumulExcl = opts.rows.reduce((sum, row) => sum.plus(row.amountCumul), new Decimal(0));
  const previous = d(opts.previouslyCertifiedExcl);
  const contract = opts.contractExcl ? d(opts.contractExcl) : null;
  return {
    cumulExcl: cumulExcl.toFixed(2),
    previouslyCertifiedExcl: previous.toFixed(2),
    periodExcl: cumulExcl.minus(previous).toFixed(2),
    percentOfContract: contract?.greaterThan(0)
      ? Math.floor(cumulExcl.div(contract).times(100).toNumber())
      : null,
    overContract: opts.rows.filter((row) => row.overContract).length,
  };
}
