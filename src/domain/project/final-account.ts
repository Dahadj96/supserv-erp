import Decimal from "decimal.js";

/**
 * The décompte final — the one page that closes a marché.
 *
 * Everything on it is already a fact this system holds: the situations it
 * issued, what each one withheld, what the client paid against them, and what
 * the CCAP's penalty clause comes to. So NOTHING here is typed. The paper is
 * the arithmetic, and its whole value is that the four figures a wilaya's
 * accountant checks — travaux, avance, retenue, pénalités — come from the same
 * documents they have in their own file.
 *
 * PURE. Situations in, a balance out.
 *
 * What it is NOT: the décompte général et définitif itself. That paper is
 * drawn by the service contractant and notified to us; this is the *projet de
 * décompte final* the entreprise submits, which is the document a company is
 * expected to produce and the one that otherwise gets made in Excel.
 */

export type FinalAccountSituation = {
  sequence: number;
  number: string | null;
  issuedOn: string | null;
  approvedOn: string | null;
  /** `issued` or anything else. A draft cannot be counted in a final account. */
  status: string;
  excl: string;
  vat: string;
  incl: string;
  /** Retenue de garantie withheld from this one. */
  retention: string;
  /** Remboursement d'avance deducted from this one. */
  advanceDeducted: string;
  /** Allocated against it — see `paymentAllocation`. */
  paid: string;
};

export type FinalAccountInput = {
  situations: FinalAccountSituation[];
  /** Réception provisoire. A final account is drawn after the work is accepted. */
  pvProvisoireOn: string | null;
  /** What the CCAP's clause comes to. Null when nobody has read it off the CCAP. */
  penalty: string | null;
  /** Retenue de garantie already given back. */
  retentionReleased: string;
};

export type FinalAccount = {
  /** The situations counted, oldest first. */
  counted: FinalAccountSituation[];
  worksExcl: string;
  worksVat: string;
  worksIncl: string;
  /** Advance recovered across every situation. */
  advanceRecovered: string;
  /** Retention withheld across every situation. */
  retentionHeld: string;
  /** What was certified after those two — the sum of the "net à payer" lines. */
  netCertified: string;
  /** Received. */
  paid: string;
  /**
   * What the clause allows the client to apply. Zero when nobody has read the
   * CCAP — never a guess, and the screen says which it is.
   */
  penalty: string;
  /** Net certified, less what has been paid, less the penalties. */
  balance: string;
  /** Still held against the warranty, and due back at the réception définitive. */
  retentionToRelease: string;
  /**
   * Why no final account can be drawn yet. A draft or an unsigned situation
   * would leave work out of a paper whose whole point is that nothing is left
   * out.
   */
  blocked: "noSituations" | "situationUnissued" | "situationUnapproved" | "noReception" | null;
};

function d(value: string | null | undefined): Decimal {
  return new Decimal(value ?? "0");
}

export function finalAccountOf(input: FinalAccountInput): FinalAccount {
  const counted = input.situations.slice().sort((a, b) => a.sequence - b.sequence);

  const sum = (pick: (s: FinalAccountSituation) => string) =>
    counted.reduce((total, row) => total.plus(d(pick(row))), new Decimal(0));

  const worksExcl = sum((s) => s.excl);
  const worksVat = sum((s) => s.vat);
  const worksIncl = sum((s) => s.incl);
  const advanceRecovered = sum((s) => s.advanceDeducted);
  const retentionHeld = sum((s) => s.retention);
  const paid = sum((s) => s.paid);
  const penalty = d(input.penalty);

  const netCertified = worksIncl.minus(advanceRecovered).minus(retentionHeld);
  const balance = netCertified.minus(paid).minus(penalty);

  const blocked: FinalAccount["blocked"] =
    counted.length === 0
      ? "noSituations"
      : counted.some((s) => s.status !== "issued")
        ? "situationUnissued"
        : counted.some((s) => !s.approvedOn)
          ? "situationUnapproved"
          : input.pvProvisoireOn
            ? null
            : "noReception";

  return {
    counted,
    worksExcl: worksExcl.toFixed(2),
    worksVat: worksVat.toFixed(2),
    worksIncl: worksIncl.toFixed(2),
    advanceRecovered: advanceRecovered.toFixed(2),
    retentionHeld: retentionHeld.toFixed(2),
    netCertified: netCertified.toFixed(2),
    paid: paid.toFixed(2),
    penalty: penalty.toFixed(2),
    balance: balance.toFixed(2),
    retentionToRelease: Decimal.max(retentionHeld.minus(d(input.retentionReleased)), 0).toFixed(2),
    blocked,
  };
}
