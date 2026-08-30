/**
 * Bank guarantees and the people on site — the two things on a project that
 * expire while nobody is looking.
 *
 * PURE, and `now` is an argument for the same reason it is in the tender
 * dossier: every question here is about a date that has not happened yet.
 */

export const CAUTION_KINDS = [
  "bonne_execution",
  "restitution_avance",
  "retenue_garantie",
  "soumission",
] as const;
export type CautionKind = (typeof CAUTION_KINDS)[number];

export const CAUTION_STATES = [
  "released",
  "lapsed",
  "expiresBeforeAcceptance",
  "expiring",
  "live",
] as const;
export type CautionState = (typeof CAUTION_STATES)[number];

export type CautionInput = {
  id: string;
  kind: string;
  amount: string | null;
  pct: string | null;
  bankName: string | null;
  reference: string | null;
  expiresOn: string | null;
  releasedOn: string | null;
};

export type Caution = CautionInput & {
  state: CautionState;
  daysLeft: number | null;
};

/** A bank takes about a month to renew one. Warn with time to act. */
export const CAUTION_EXPIRING_DAYS = 45;

const DAY = 86_400_000;

function daysUntil(iso: string, now: Date): number {
  const at = new Date(`${iso}T00:00:00Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((at - today) / DAY);
}

export function cautionState(opts: {
  caution: CautionInput;
  now: Date;
  /**
   * When the work is expected to be accepted. A caution de bonne exécution has
   * to outlive it — that is what it guarantees — and one expiring first is the
   * banner on screen 16.
   */
  acceptanceOn: string | null;
}): { state: CautionState; daysLeft: number | null } {
  const { caution, now, acceptanceOn } = opts;

  if (caution.releasedOn) return { state: "released", daysLeft: null };
  if (!caution.expiresOn) return { state: "live", daysLeft: null };

  const daysLeft = daysUntil(caution.expiresOn, now);
  if (daysLeft < 0) return { state: "lapsed", daysLeft };

  /**
   * Checked before the expiring window, for the same reason the tender dossier
   * checks "expires before deposit" before "expires soon": both are true of the
   * same guarantee, and the one that matters is the one that says the client
   * can call it in on a project that is not finished.
   */
  if (
    acceptanceOn &&
    new Date(`${caution.expiresOn}T00:00:00Z`) < new Date(`${acceptanceOn}T00:00:00Z`)
  ) {
    return { state: "expiresBeforeAcceptance", daysLeft };
  }

  if (daysLeft <= CAUTION_EXPIRING_DAYS) return { state: "expiring", daysLeft };
  return { state: "live", daysLeft };
}

export function readCautions(opts: {
  cautions: CautionInput[];
  now: Date;
  acceptanceOn: string | null;
}): Caution[] {
  return opts.cautions.map((caution) => ({
    ...caution,
    ...cautionState({ caution, now: opts.now, acceptanceOn: opts.acceptanceOn }),
  }));
}

export function needsAttention(state: CautionState): boolean {
  return state === "lapsed" || state === "expiresBeforeAcceptance" || state === "expiring";
}

/* ------------------------------------------------------------------ crew */

export const CREW_STATES = ["proposed", "onSite", "expiring", "expired", "left"] as const;
export type CrewState = (typeof CREW_STATES)[number];

export type CrewInput = {
  id: string;
  personId: string;
  name: string;
  trade: string | null;
  role: string | null;
  onSiteSince: string | null;
  leftOn: string | null;
  proposedAt: Date | null;
  /** The soonest-expiring certification this person holds, if any. */
  certification: string | null;
  certificationExpiresOn: string | null;
};

export type Crew = CrewInput & { state: CrewState; daysLeft: number | null };

/** A ticket takes weeks to renew and a man cannot work without it. */
export const CERTIFICATION_EXPIRING_DAYS = 60;

export function crewState(opts: { member: CrewInput; now: Date }): {
  state: CrewState;
  daysLeft: number | null;
} {
  const { member, now } = opts;

  if (member.leftOn) return { state: "left", daysLeft: null };
  if (!member.onSiteSince) return { state: "proposed", daysLeft: null };

  if (!member.certificationExpiresOn) return { state: "onSite", daysLeft: null };

  const daysLeft = daysUntil(member.certificationExpiresOn, now);
  /**
   * EXPIRED IS NOT "LEFT". The man is still on site; his ticket is not valid.
   * That is the state worth a red row — an unqualified welder on a SADEG job is
   * a stopped site and a contractual problem, not an administrative one.
   */
  if (daysLeft < 0) return { state: "expired", daysLeft };
  if (daysLeft <= CERTIFICATION_EXPIRING_DAYS) return { state: "expiring", daysLeft };
  return { state: "onSite", daysLeft };
}

export function readCrew(opts: { crew: CrewInput[]; now: Date }): Crew[] {
  return opts.crew.map((member) => ({ ...member, ...crewState({ member, now: opts.now }) }));
}
