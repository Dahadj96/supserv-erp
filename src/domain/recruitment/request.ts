/**
 * Screen 26 — personnel requests.
 *
 * PURE. A request is "two welders in In Salah by the 24th", and the only
 * questions worth asking about it are how many are confirmed, how long there is
 * left, and whether the men who are confirmed will still hold a valid ticket on
 * the day they arrive.
 *
 * That last one is the same rule as the tender dossier and the project caution,
 * for the third time in this system: THE DATE THAT DECIDES IS NOT TODAY. A
 * welding attestation valid this morning and expired on the 24th is a man who
 * cannot be on that site, and a screen that showed him green would send him.
 */

export const CANDIDATE_STAGES = [
  "new",
  "reviewing",
  "shortlisted",
  "interview",
  "confirmed",
  "rejected",
] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

/** The pipeline on the person, which is a different thing. See the schema. */
export const PERSON_STAGES = [
  "new",
  "reviewing",
  "shortlisted",
  "interview",
  "hired",
  "archived",
] as const;
export type PersonStage = (typeof PERSON_STAGES)[number];

export const REQUEST_STATES = ["urgent", "open", "filled", "cancelled", "late"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

/** Inside this many days from the start date, an unfilled request is urgent. */
export const URGENT_WITHIN_DAYS = 7;

export type ShortlistEntry = {
  id: string;
  personId: string;
  name: string;
  trade: string | null;
  mobility: string | null;
  stage: CandidateStage;
  certification: string | null;
  certificationExpiresOn: string | null;
};

export type ShortlistRow = ShortlistEntry & {
  /**
   * True when this person is confirmed for the job and their ticket will have
   * expired by the time the work starts.
   */
  certificationLapsesBeforeStart: boolean;
  daysLeftOnCertification: number | null;
};

const DAY = 86_400_000;

function daysUntil(iso: string, from: Date): number {
  const at = new Date(`${iso}T00:00:00Z`).getTime();
  const today = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((at - today) / DAY);
}

export function readShortlist(opts: {
  entries: ShortlistEntry[];
  startOn: string | null;
  now: Date;
}): ShortlistRow[] {
  return opts.entries.map((entry) => {
    const daysLeft = entry.certificationExpiresOn
      ? daysUntil(entry.certificationExpiresOn, opts.now)
      : null;

    const lapses =
      Boolean(entry.certificationExpiresOn) &&
      Boolean(opts.startOn) &&
      new Date(`${entry.certificationExpiresOn}T00:00:00Z`) < new Date(`${opts.startOn}T00:00:00Z`);

    return {
      ...entry,
      certificationLapsesBeforeStart: lapses,
      daysLeftOnCertification: daysLeft,
    };
  });
}

export type Request = {
  needed: number;
  /** People at stage `confirmed`. */
  confirmed: number;
  /** Confirmed people whose ticket is valid on the day the work starts. */
  usable: number;
  state: RequestState;
  daysToStart: number | null;
  /** Confirmed but cannot go: the sentence the banner is made of. */
  blocked: ShortlistRow[];
};

export function readRequest(opts: {
  needed: number;
  startOn: string | null;
  status: string;
  certificationRequired: boolean;
  shortlist: ShortlistRow[];
  now: Date;
}): Request {
  const confirmedRows = opts.shortlist.filter((row) => row.stage === "confirmed");

  /**
   * A confirmed man with a lapsed ticket does not count towards the headcount
   * WHEN THE SITE REQUIRES ONE. That condition is the whole subtlety: a
   * manœuvre needs no certificate and would otherwise be counted as unusable
   * forever, and a welder on a TouatGaz site with an expired attestation is not
   * a warning, he is one man short.
   */
  const blocked = opts.certificationRequired
    ? confirmedRows.filter((row) => row.certificationLapsesBeforeStart)
    : [];

  const usable = confirmedRows.length - blocked.length;
  const daysToStart = opts.startOn ? daysUntil(opts.startOn, opts.now) : null;

  const state: RequestState =
    opts.status === "cancelled"
      ? "cancelled"
      : usable >= opts.needed
        ? "filled"
        : daysToStart !== null && daysToStart < 0
          ? "late"
          : daysToStart !== null && daysToStart <= URGENT_WITHIN_DAYS
            ? "urgent"
            : "open";

  return {
    needed: opts.needed,
    confirmed: confirmedRows.length,
    usable,
    state,
    daysToStart,
    blocked,
  };
}

/**
 * Filled is computed, never stored.
 *
 * The `status` column holds only what a person decided — that the request was
 * cancelled, and why. Whether it is filled is arithmetic over the shortlist and
 * changes the moment somebody's certificate expires, which is exactly the kind
 * of change nobody remembers to go back and record.
 */
export function isFilled(request: Request): boolean {
  return request.state === "filled";
}
