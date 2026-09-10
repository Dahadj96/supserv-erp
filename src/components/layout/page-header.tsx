import { Fragment, type ReactNode } from "react";
import { Link } from "@/i18n/navigation";

/**
 * P1 — the page header. Figma frame `175:2` on the `v5 · repair` page, applied
 * on `186:116`, approved 10 September 2026.
 *
 * There was no component for this. The markup
 * `border-b border-line-subtle bg-surface px-4 …` with an `h1` inside it was
 * copy-pasted into 66 files, and a slot nobody is required to fill is a slot
 * that ends up empty — twenty screens carried a title, a sentence and nothing
 * a person could do.
 *
 * So `actions` is a REQUIRED prop, and that is the whole design decision. You
 * may pass `null`, and the type then requires `noActionReason` with it: a
 * sentence saying why there is nothing to do here, rendered where the button
 * would have been. You cannot get a header with an empty actions slot by
 * forgetting — only by writing down, in the reader's language, that the screen
 * is genuinely finished. That sentence is for the person wondering whether they
 * have misunderstood the screen.
 *
 * The other two required props exist for the same reason:
 *
 *   `state`  a LIVE line — what is true right now that would make me act. Never
 *            a description of what the screen is; the screen's name is directly
 *            above it and says that already.
 *   `crumb`  ends in the record. `topbar.tsx` derives its crumb from
 *            `NAV_GROUPS`, so it is two levels and can never name one:
 *            `/deals/9f2c…` reads "SUPSERV / Deals" and stops. Only the page
 *            knows what it is showing, so the page passes it.
 *
 * While both crumbs exist, `globals.css` hides the topbar's on any page that
 * renders this component — hence `data-page-header`. Both go together when the
 * last screen is converted (P1b in docs/FIX-QUEUE.md).
 */
export type Crumb = {
  label: string;
  /** Omitted on the last crumb: you are already standing there. */
  href?: string;
};

type Base = {
  /** Root first, the record last. `[{ label: "SUPSERV", href: "/today" }, …]` */
  crumb: Crumb[];
  title: ReactNode;
  /** Live and computed. If it would read the same tomorrow, it is not state. */
  state: ReactNode;
};

export type PageHeaderProps = Base &
  ({ actions: ReactNode; noActionReason?: never } | { actions: null; noActionReason: string });

export function PageHeader({ crumb, title, state, actions, noActionReason }: PageHeaderProps) {
  // The union above makes this unreachable from TypeScript. It is here because
  // the one thing this component exists to prevent is a header with an empty
  // actions slot, and a rule enforced only at compile time is a rule that a
  // `as never` three years from now walks straight past.
  if (actions === null && !noActionReason) {
    throw new Error(
      "PageHeader: actions={null} needs noActionReason — say why there is nothing to do.",
    );
  }

  return (
    <div
      data-page-header
      className="shrink-0 border-b border-line-subtle bg-surface px-4 py-4 md:px-7 md:py-5"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-x-2 text-micro text-muted"
      >
        {crumb.map((step, i) => (
          <Fragment key={step.label}>
            {i > 0 ? <span aria-hidden>/</span> : null}
            {step.href ? (
              <Link className="hover:text-secondary hover:underline" href={step.href}>
                {step.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-secondary">
                {step.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>

      {/*
        `min-w-[220px]` rather than `min-w-0`, which is what a title column
        usually wants. With `min-w-0` the column shrinks instead of making the
        row wrap, and on a 390px phone three buttons in the actions slot left
        the state line about forty pixels wide — one word per line, straight
        down the screen. A floor on the title column is what forces the actions
        onto their own row instead. Checked at 390 with Invoices, which has the
        widest actions slot in the ERP.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-[220px] flex-1">
          <h1 className="text-title font-semibold text-ink">{title}</h1>
          <p className="mt-1 text-base text-secondary">{state}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions ?? (
            <p className="max-w-[320px] rounded-[var(--radius-control)] border border-line-subtle bg-sunken px-3 py-2 text-micro leading-relaxed text-muted">
              {noActionReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
