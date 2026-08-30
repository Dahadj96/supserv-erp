/**
 * Screen 08 — the dossier, and whether it will be accepted at the desk.
 *
 * PURE. It takes the pieces this tender asks for, the company's papers with
 * their expiry dates, and the closing time, and it says what will get the bid
 * thrown out. No database, no clock of its own — `now` and `closesAt` are both
 * arguments, because "expires before deposit" is the whole computation and a
 * function that read the clock could not be tested against September.
 *
 * THE FAILURE THIS EXISTS FOR. A CASNOS attestation valid today and expiring on
 * 30 August, deposited on 2 September, in a folder that is otherwise perfect.
 * Every other screen in this system would call that document valid. It is
 * valid. The bid is still rejected, because the date that matters is not today
 * — it is the day the envelope is opened.
 */

export const SECTIONS = ["administratif", "technique", "financier"] as const;
export type Section = (typeof SECTIONS)[number];

export const PROCEDURES = ["aonr", "aoo", "consultation", "rfq", "gre_a_gre"] as const;
export type Procedure = (typeof PROCEDURES)[number];

export function isProcedure(value: string | undefined): value is Procedure {
  return Boolean(value) && PROCEDURES.includes(value as Procedure);
}

/**
 * Ordered worst first, and the order is the design: a screen that lists
 * problems has to put the one that ends the bid at the top.
 */
export const PIECE_STATES = [
  "missing",
  "expired",
  "expiresBeforeDeposit",
  "expiring",
  "ready",
] as const;
export type PieceState = (typeof PIECE_STATES)[number];

/** A piece as it is stored: what is asked for, and what satisfies it. */
export type PieceInput = {
  key: string;
  section: Section;
  label: string | null;
  position: number;
  /** Set when a company-level paper satisfies it. */
  credentialKey: string | null;
  /** Set when something written for this tender satisfies it. */
  fileId: string | null;
};

/** A company paper, with the only two facts that decide anything. */
export type CredentialInput = {
  key: string;
  reference: string | null;
  expiresOn: string | null;
  fileId: string | null;
};

export type Piece = PieceInput & {
  state: PieceState;
  /** The credential's expiry, when a credential is what backs this piece. */
  expiresOn: string | null;
  reference: string | null;
  /** Days from now until it expires. Negative when it already has. */
  daysLeft: number | null;
  /** True when this one alone would have the bid rejected. */
  blocking: boolean;
};

/**
 * A piece is worth flagging before it expires, because renewing a CNAS
 * attestation is a morning at a counter and not a click. Thirty days is the
 * warning; expiring before the deposit is the refusal.
 */
export const EXPIRING_WITHIN_DAYS = 30;

const DAY = 86_400_000;

function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY);
}

export function pieceState(opts: {
  piece: PieceInput;
  credential: CredentialInput | undefined;
  now: Date;
  /** When the envelope has to be on the desk. Null when nobody recorded one. */
  closesAt: Date | null;
}): {
  state: PieceState;
  expiresOn: string | null;
  reference: string | null;
  daysLeft: number | null;
} {
  const { piece, credential, now, closesAt } = opts;

  // Satisfied by something written for this tender: it is on file or it is not.
  if (!piece.credentialKey) {
    return {
      state: piece.fileId ? "ready" : "missing",
      expiresOn: null,
      reference: null,
      daysLeft: null,
    };
  }

  // Asked for, backed by a company paper nobody has filed.
  if (!credential || !credential.fileId) {
    return {
      state: "missing",
      expiresOn: null,
      reference: credential?.reference ?? null,
      daysLeft: null,
    };
  }

  // Filed and does not expire — the statuts, the registre de commerce.
  if (!credential.expiresOn) {
    return { state: "ready", expiresOn: null, reference: credential.reference, daysLeft: null };
  }

  const expires = new Date(`${credential.expiresOn}T00:00:00Z`);
  const daysLeft = daysBetween(now, expires);

  const common = {
    expiresOn: credential.expiresOn,
    reference: credential.reference,
    daysLeft,
  };

  if (daysLeft < 0) return { state: "expired", ...common };

  /**
   * THE ONE THAT MATTERS. Valid today, invalid on the day it is deposited.
   *
   * Checked before the thirty-day warning, because a paper that expires two
   * days before the deposit is not "expiring soon" — it is already useless for
   * this tender, and calling it amber would put it below four other amber rows.
   */
  if (closesAt && expires.getTime() < closesAt.getTime()) {
    return { state: "expiresBeforeDeposit", ...common };
  }

  if (daysLeft <= EXPIRING_WITHIN_DAYS) return { state: "expiring", ...common };

  return { state: "ready", ...common };
}

/** Missing, expired, or dead by the deposit date. The rest can wait. */
export function isBlocking(state: PieceState): boolean {
  return state === "missing" || state === "expired" || state === "expiresBeforeDeposit";
}

export type SectionReadiness = {
  section: Section;
  ready: number;
  total: number;
};

export type Dossier = {
  pieces: Piece[];
  sections: SectionReadiness[];
  /** Whole percent, floored — 7 of 9 is 77, never 78. */
  percent: number;
  ready: number;
  total: number;
  /** Worst first, and only the ones that end the bid. */
  blocking: Piece[];
};

export function dossier(opts: {
  pieces: PieceInput[];
  credentials: CredentialInput[];
  now: Date;
  closesAt: Date | null;
}): Dossier {
  const byKey = new Map(opts.credentials.map((c) => [c.key, c]));

  const pieces: Piece[] = opts.pieces
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((piece) => {
      const resolved = pieceState({
        piece,
        credential: piece.credentialKey ? byKey.get(piece.credentialKey) : undefined,
        now: opts.now,
        closesAt: opts.closesAt,
      });
      return { ...piece, ...resolved, blocking: isBlocking(resolved.state) };
    });

  const sections: SectionReadiness[] = SECTIONS.map((section) => {
    const mine = pieces.filter((p) => p.section === section);
    return {
      section,
      ready: mine.filter((p) => p.state === "ready").length,
      total: mine.length,
    };
  }).filter((s) => s.total > 0);

  const ready = pieces.filter((p) => p.state === "ready").length;
  const total = pieces.length;

  /**
   * FLOORED, and only `ready` counts.
   *
   * An expiring piece is not half a piece. Rounding 7 of 9 up to 78 % - which
   * is what the frame prints - flatters a folder that will be refused, and the
   * one number on this screen everybody reads is the percentage.
   */
  const percent = total === 0 ? 0 : Math.floor((ready / total) * 100);

  const order = new Map(PIECE_STATES.map((state, index) => [state, index]));
  const blocking = pieces
    .filter((p) => p.blocking)
    .sort((a, b) => (order.get(a.state) ?? 0) - (order.get(b.state) ?? 0));

  return { pieces, sections, percent, ready, total, blocking };
}
