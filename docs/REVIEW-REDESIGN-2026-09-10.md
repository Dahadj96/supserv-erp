# The pattern proposal, checked against the code — 10 September 2026

A second review arrived on 10 September, after `docs/OWNER-REVIEW-2026-09-10.md`
and from the same reading of the running ERP. Where the owner's review listed
defects, this one proposes **patterns** — borrowed from Dynamics 365 Business
Central (role-tailored home screens), SAP Fiori (four repeating page types) and
Odoo (documents that carry each other forward) — and applies them to SUPSERV in
nine sections.

This document is that proposal read against `C:\SUPSERV-ERP`. Every verdict
below names the file it was checked in. The proposal was not written with the
repository open, so a fair amount of it describes things this codebase already
decided, sometimes for reasons worth keeping.

---

## The verdict in one line

**Three of its nine sections are new work worth doing, four are already the
queue's plan under other names, one is already built and one is measurably
wrong.** The single most valuable idea in it is not in its list of five screens:
it is the sentence in §3 about **separating the lifecycle dimensions**, which
names a real defect in `src/domain/deal/stage.ts` that nothing else has caught.

| § | Recommendation | Verdict |
|---|---|---|
| 1 | Role-based home screens | **New, and the biggest of the three.** Six roles exist and no screen reads them. Has a prerequisite the proposal does not mention. |
| 2 | The deal as a dossier with one next action | **Mostly built.** `dealChecks` and `Stepper` shipped as 2.5 and 2.6. What is left is tabs and promoting *one* action — already owner review §2. |
| 3 | Buttons that carry context forward | **Half queued as T1/T2/T7. The other half — separate lifecycle dimensions — is new and is the best thing in the proposal.** |
| 4 | Four standard screen types | **Already the plan.** `PageHeader`, `DataTable`, `StateBlock`, `Stepper` all exist. The gap is adoption: P1b and 3.6. No new task. |
| 5 | Eight-group sidebar, expand the active one | **Conflicts with 3.1.** Both cannot ship. One paragraph from Abdou settles it; a merge is proposed below. |
| 6 | One line-item editor | **New in part, and the highest-value screen.** It is T7 + T8, and two of its seven requirements are already built elsewhere. |
| 7 | Inbox as a triage workspace | **New in part.** The five states it asks for are orthogonal to the six facets that exist. Duplicate detection: nothing. |
| 8 | Quieter visual design | **Mostly already true.** One accent exists, badges already carry text. One measurable finding survives, and it is not the one stated. |
| 9 | Approvals as part of the workflow | **Already built, and better than described.** Nine gates with thresholds and justifications. Only the return path is missing. |

---

## §1 · Role-based home screens — new, and it has a prerequisite

**The roles the proposal invents already exist.** `src/auth/can.ts:62` defines
six, and five of them are the proposal's five almost exactly:

| Proposal | `ROLES` in `can.ts` |
|---|---|
| Gérant | `gerant` — every permission |
| Commercial | `commercial` |
| Purchasing | `achats` |
| Finance | `compta` |
| Operations | `chantier` |
| — | `lecture` (read-only; the proposal has no row for it and needs one) |

**And no screen reads them.** `src/components/layout/nav-items.ts` contains the
words `role`, `permission` and `can(` zero times — the rail is the same 23 rows
for a Gérant and for `lecture`. `src/domain/today/gather.ts` has no role
argument: Today assembles the same nine kinds of item for everybody, so a
`chantier` account is shown unpaid invoices it may not touch and a `compta`
account is shown tender deadlines it does not bid.

**The prerequisite.** The proposal's home screens are "what needs *my*
attention". There is no *my*. `deal.ownerId` is written in exactly two places —
`deals/new/actions.ts:46` and `intake/commit.ts:262`, both to `session.userId`
— so it records **who created the deal, not who is working it**, it cannot be
changed afterwards (that is T6), and `deals/page.tsx:68` renders it as two
initials. Nothing else in the system is assigned to anybody at all. Build
role homes on top of that and every role's home is "everything, filtered by
job title", which is a different and much weaker product than the one proposed.

So the order is: **assignment first (T6 makes owner editable), role-scoped
Today second, role home screens third.** Not the reverse.

**One caution about scoping the rail by role.** `gerant` holds every permission
and Abdou is the Gérant, so role-scoped navigation would hide nothing from the
person complaining — it would only affect the five other accounts. The proposal's
own workspace switcher is therefore not a fallback for people who wear several
hats; for this company it is the primary mechanism, and the role filter is the
secondary one. Worth building in that order too.

---

## §2 · The deal as a dossier — mostly built, and the frame quotes it back

The proposal's record screen sketch —

> Next action: Complete pricing — 2 items need a price
> **[Complete pricing]**

— is `src/domain/deal/checks.ts`, shipped as task 2.5. `dealChecks(facts)`
returns `{ key, state: pass | warn | block | note, detail, fixHref }` and
already produces exactly that sentence for exactly that case
(`checks.ts:185-190` — `state: "warn"`, `fixHref: /deals/{id}/prices`). The
progress strip is `src/components/ui/stepper.tsx`, shipped as 2.6 and rendered
on both `deals/[id]/page.tsx` and `tenders/[id]/page.tsx`.

**What is genuinely missing is two things, and the owner's review already says
both.** First, the panel lists every check rather than promoting one — the
proposal is right that a person wants *the* next action, not a checklist of
nine. Second, the tabs: `deals/[id]/page.tsx` renders qualification, tender
conversion, loss, deletion, supplier requests, offer building and technical
notes on one screen, and only the technical section is behind anything
resembling a tab (`page.tsx:202`). That is owner review §2 word for word.

**"Opening an invoice should still show which order and enquiry it belongs
to"** is `PageHeader`'s breadcrumb, built in P1 and adopted on 9 of the 93
`page.tsx` files under `src/app`. The rest are P1b, already queued.

**One correction.** The proposal says "Promote it to the top and replace 'Do
it' with specific actions." Right, and it is not in any task yet — owner review
§5 raises the same wording problem ("Do it", "Fix it", "Everything that
happened", "Prices gathered", "They went elsewhere") and no queue entry owns it.
It is added below as **R4**.

---

## §3 · Carrying context forward — and the one finding nothing else caught

The table of transitions is already the queue's work, item for item:

| Proposal's transition | Where it lives |
|---|---|
| Prepare delivery ← ordered items and remaining quantities | **T1** (critical) |
| Create invoice ← billable quantities, prices, references | **T2** (critical) |
| Prepare quotation ← supplier costs, client details | **T7** |
| Request supplier prices ← enquiry items, quantities | owner review §6, Sourcing |
| Record payment ← outstanding invoices and balances | built — `/payments` renders its table inside `RecordPayment` |

**But this sentence is new, and it is the best thing in the document:**

> One order can be confirmed, partly delivered, partly invoiced, and unpaid at
> the same time. A single stage label cannot represent all four accurately.

That is a defect and it is verifiable. `src/domain/deal/stage.ts:21` defines
six stages as one ladder — `new · qualifying · sourcing · offerOut · ordered ·
invoiced` — and `stageOf` "reads invoiced → ordered → offerOut → sourcing and
stops at the furthest thing that exists". The file's own comment concedes the
consequence: a bon de livraison is **deliberately not a stage**, because it does
not fit the ladder. So a deal that is ordered, half-delivered, half-invoiced and
unpaid renders one chip reading `invoiced`, and the three facts a person
actually needs are not on the screen.

**This fits LAW 1 rather than fighting it.** All four dimensions are computable
from rows that already exist — `ordersReceived`, `coveredAgainst` in
`domain/delivery/store.ts`, `billed` and `balanceOf` in `domain/money/`. Nothing
gets stored. `DealFacts` already carries most of the inputs and is already
computed on every page load. The change is a second pure function beside
`stageOf`, not a schema change.

Added below as **R1**, and it should be taken before the role homes: a role home
for Operations that cannot say "partly delivered" has nothing to put on it.

---

## §4 · Four screen types — already the plan, no new task

Worklist, record list, record detail, editor. Each of the four already has its
component, and three of them are already the subject of an open queue task:

| Proposal's type | Component | State |
|---|---|---|
| Work queue | `/today` + `domain/today/gather.ts` | Built; T3/T4 fix its accuracy |
| Record list | `components/data/data-table.tsx` — filters, saved views, pagination, bulk bar | **5 files render it; 56 hand-write `<table>`** — task 3.6 |
| Record detail | `components/layout/page-header.tsx` — `actions` is a required prop and `null` forces `noActionReason` | **9 of 93 adopted** — task P1b |
| Editor | three of them, see §6 | T7 |

Saved views (`components/data/saved-views.tsx`) already exist inside `DataTable`,
so the proposal's "Assigned to me, Due this week, Awaiting supplier, Overdue" is
configuration of a built component — except *Assigned to me*, which needs §1's
assignment prerequisite.

**The one part to decline for now: board and calendar views.** Nothing in the
repository draws either, and the audit's own "what not to do" ends with *do not
write a third table component*. A kanban and a calendar are two more list
components for a company with six users and a rail that does not fit. Revisit
after 3.6 has finished converting the four remaining lists to the one component
that already exists.

---

## §5 · The sidebar — this is the one real conflict, and it needs Abdou

The proposal wants **eight groups, expand only the active one**:
My work · Inbox · Sales · Purchasing · Operations · Finance · Directory ·
Administration.

Task **3.1** wants **eleven flat rows**, and it is `[!]` blocked on Abdou
already, waiting on where five destinations go.

Both cannot ship, and the difference is not cosmetic:

- **The proposal keeps every destination** and moves it one level down. Eight
  headings over the same 23 rows is still 23 rows; it trades scrolling for
  clicking, and on a screen where somebody moves between Deals and Invoices all
  day, an accordion that collapses the group they just left is worse than a
  scrollbar.
- **3.1 removes rows** by absorbing screens into tabs — Conversations into Inbox
  (already decided, 10 September), Week and Waiting-on into Today, Payments and
  Ageing into Invoices, Tenders into the deal list as a facet.

**The merge worth proposing.** 3.1's absorptions are right and already argued;
the proposal's *group names* are better than the current ones, because they are
how the business talks (`work`, `money`, `companiesPeople`, `control` are ours;
Sales, Purchasing, Finance, Directory are theirs). So: **3.1's eleven rows,
under the proposal's headings, with Purchasing given the row it deserves** —
Sourcing and purchase orders are `achats`'s whole job and are currently split
between the `work` group and a route with no rail row at all.

That is one paragraph from Abdou. It is written up under Needs Abdou in the
queue and is **not** something a run should decide.

Two smaller points in §5 are simply right and cheap: **scan setup belongs under
Administration** while ordinary upload belongs on Inbox and on records (owner
review §6 says the same), and a **Create button in the top bar** does not exist
— `components/layout/topbar.tsx` has search, the assistant, the locale switcher,
the bell and the avatar — and no create action among them. Global search is
already there and already global.

---

## §6 · One line-item editor — the highest-value screen, and two of its seven parts exist

**There are three editors, not two.** The proposal says "combine your offer
pricing screen and document builder"; the count is:

| File | Lines |
|---|---|
| `deals/[id]/prices/page.tsx` | 398 |
| `offers/[id]/build/page.tsx` | 500 |
| `documents/[id]/edit/builder.tsx` | 559 |

That is T7, and it is the right task to take first of the whole set.

Against its seven requirements:

| Requirement | State |
|---|---|
| Description, reference, qty, unit, cost, price, discount, tax | Built — `documents/draft.ts` `DraftLine` carries all of them |
| **Role-controlled cost and margin visibility** | **Already expressible** — `offers.margin.view` exists in `can.ts:29` and is held by `gerant` and `compta` only |
| **Paste from Excel with a preview of interpreted columns** | **Already built, on the wrong screens** — `src/domain/deal/paste.ts` reads both tab-separated Excel paste and prose, reports what it ignored rather than dropping it, and proposes without writing. It has two callers, `deals/new/actions.ts` and `deals/[id]/items/actions.ts` — both about *what the client asked for*, neither about *what we are charging*. Reuse it in the editor; do not write a second one |
| Keyboard navigation between cells | **Absent** — `builder.tsx` contains no `onKeyDown` |
| Immediate totals | Server-recomputed on save (`edit/actions.ts` — "a total that arrived over the wire is a total somebody could have edited"). Live client totals need care not to become a second calculator |
| Errors attached to the relevant cell | Absent — `DraftRefused` redirects with an error code |
| **Draft preservation, including incomplete rows** | **Refused on purpose today** — `documents/draft.ts:106` filters out any line with no designation, with the comment *"dropping it silently is kinder than storing a blank line the client will see"* |
| A clear saved/unsaved indicator | Absent |

**The draft-preservation line is a decision to reverse, not a bug to fix.** T8
is right that silently discarding typed work costs trust faster than anything
else on the list, and the old comment's reasoning is answerable: a blank line
the client would see is a *printing* problem, not a *storing* problem. Keep the
row, mark it incomplete, and refuse to issue until it is filled or removed.
Whoever takes T8 should read that comment first and replace it, so the next
person does not restore the filter.

The narrow-window note — **totals below the table, not beside it** — is worth
keeping in the frame: the owner's review independently observed the offer screen
scrolling horizontally for a single item.

---

## §7 · Inbox triage — the states asked for are orthogonal to the ones that exist

The proposal wants five: Unread · Needs classification · Needs action ·
Waiting for a reply · Completed.

What exists is a different axis. `src/domain/intake/inbox.ts:18` gives seven
facets and six of them are **kinds**, not states: `all`, `enquiry`, `tender`,
`candidate`, `payment`, `supplierQuote`, `needsReview`. The stored status
(`db/schema/intake.ts:90`) is three values: `needs_review`, `committed`,
`archived`. So the proposal is right that a *work state* axis is missing, and
only one of its five — needs classification — exists today.

**But one of the five belongs to another screen.** "Waiting for a reply" is
`/waiting-on`, which exists, and Today deliberately keeps waiting-on items off
itself (`domain/today/list.ts` — "a page that lists what you cannot do anything
about is a page that stops being read"). Adding a Waiting chip to Inbox without
settling that overlap gives the company two answers to one question, which is
the mistake `/dashboard` already made and 3.5 already undid.

**"Reading a message does not mean completing the work"** and **"receiving a
newsletter does not mean somebody is waiting on you"** are T4, in his own words
already.

**Duplicate detection before creating a second enquiry from the same
conversation: nothing exists.** Every `dedupe` match in the repository is a
pg-boss job key. It is small, it is real, and it is a good candidate for a
cheap win — added below as **R3**.

The reading pane is new: `/inbox` links to `/inbox/[id]` as a separate page.
Worth a frame, not worth arguing about.

---

## §8 · Visual design — mostly already true, and the stated finding is the wrong one

Four of the eight bullets are already how this codebase works:

- **One accent colour.** `globals.css:42` — `--color-accent: #2a78d6`, and it is
  the only one.
- **Red for actual errors.** `--color-critical: #d03b3b` sits beside a separate
  `serious` orange and a `warning` amber precisely so red is not spent on
  "attention".
- **Status labels with text, not colour alone.** `components/ui/badge.tsx` takes
  `children` and every call site passes a string. There is no colour-only badge
  to fix.
- **Consistent placement of Create, Edit, Save, Cancel.** `PageHeader` makes
  `actions` a required prop for exactly this reason. It is adoption (P1b), not
  design — 9 page files of 93 use it today.

**"Stronger contrast for secondary text" is right about a problem and wrong
about which token.** Measured against `--color-plane #fafaf9`:

| Token | Value | Contrast | WCAG AA (4.5:1) |
|---|---|---|---|
| `--color-secondary` | `#5c5c58` | **6.4 : 1** | passes |
| `--color-muted` | `#8a8a85` | **3.3 : 1** | **fails** |

`text-muted` appears **861 times** across 117 files in `src/`, much of it at
`text-micro` (11.5px), which is too small to qualify for the large-text
exemption. So the fix is one token, measurable, and it changes 861 places at
once — a good task. (Count it with `grep -ao`, not `grep -o`: plain grep skips
`tenders/[id]/page.tsx` as binary and quietly loses 16 of them.)
Added as **R2**.

**"Help text beside the decision, not paragraphs explaining the architecture"**
is verifiable too: `src/i18n/messages/en.json` mentions `.env` thirteen times,
"phase 5" once, and explains "computed from … not stored" at two keys. Those are
notes to a developer sitting in a user's interface. Folded into **R4**.

The rest of §8 — fewer nested cards, more width for business data, card headings
off the body size — is **P2b**, already queued and already explicitly a
judgement-per-screen job rather than a regex.

---

## §9 · Approvals — already built, and better than the proposal describes

`src/domain/approval/gates.ts` defines nine gates, including
`offer.marginBelowFloor` with a `threshold`, a `role` that may decide,
`requiresReasonCode` and `requiresJustification`. The proposal's mock-up —

> Approval required: Margin is below the configured threshold
> Proposed margin · threshold · justification **[Request approval]**

— is that gate rendered. `/approvals` joined the rail on 3.4, having previously
been reachable only from the phone bar.

The file also answers the proposal's implied question better than the proposal
does: a gate **blocks, it does not warn**, and self-approval is deliberately
allowed, because in a company where one man is both Gérant and Commercial the
value of the gate is the written reason in the audit log six months later, not
the second person.

**What is actually missing is only the last sentence of the section:** "After
approval, the original employee should return directly to the next action."
There is no return path — an approval is granted on `/approvals` and the person
who asked for it is not sent anywhere. Small, real, added to **R5**.

---

## What to add to the queue

Five items. Numbered `R*` so they do not collide with the audit's waves.

- **R1 · A deal has four lifecycle answers, not one** *(§3 — the best finding)*
  A pure `dimensionsOf(facts)` beside `stageOf`, returning ordered ·
  delivered · invoiced · paid independently, each computed, none stored.
  Renders as four small states in the deal header and as a column on the list.
- **R2 · `--color-muted` fails contrast in 861 places** *(§8)*
  One token, measured: 3.3:1 against the plane. Darken it to clear 4.5:1 and
  check nothing that relied on it being faint now shouts.
- **R3 · Warn before a second enquiry is made from the same conversation** *(§7)*
  Nothing detects it. Show the candidate and let the person link instead.
- **R4 · Say the verb, and take the architecture out of the interface** *(§2, §5, §8)*
  "Do it" → the actual verb. "Everything that happened" → Activity. "Prices
  gathered" → Supplier prices. "They went elsewhere" → Mark lost. And the
  thirteen `.env` mentions, the "phase 5", and the two "computed, not stored"
  explanations leave `en.json` for the docs.
- **R5 · An approval returns you to what you were doing** *(§9)*
  The gate, the request and the decision all exist. The return path does not.

And two that are **not** tasks yet because they are Abdou's to settle:

- **The rail: eight groups or eleven rows?** (§5 against 3.1) — one paragraph.
- **Role-scoped Today and role home screens** (§1) — real work, and it is third
  in line behind T6 (make the owner editable) and a decision about whether
  assignment means anything in a six-person company.

---

## Where this sits in the order

The proposal's own last line asks for its five screens "alongside the broken
workflow fixes from the audit", and that is the right instinct — but Wave T is
not the audit's list, it is Abdou's, and it outranks everything.

So: **Wave T first, unchanged.** Two of its nine items (T7, T8) *are* the
proposal's §6 editor, and three more (T1, T2, T4) are its §3 and §7. Finishing
Wave T delivers most of the proposal's second and third sections without a new
plan.

Then **R1**, because it is cheap, it is the finding nothing else caught, and
every role home in §1 needs it. Then **R2, R3, R4, R5**, which are small and
independent. Then the §1 role work, once T6 has made assignment mean something.

The five screens the proposal recommends redrawing, re-cut against what exists:

| Proposal's five | What it actually is here |
|---|---|
| Role-based home | New, and third in line. Needs T6 first. |
| Inbox | T4 + T5 + the work-state axis (§7) + a reading pane |
| Enquiry list | **`DataTable` adoption — 3.6.** Already queued, already has a worked example in `tenders-list.tsx` |
| Enquiry dossier | Tabs + promote one action. `dealChecks` and `Stepper` already supply the content |
| Unified quotation editor | **T7 + T8.** The one to draw first |

Every one of them has a visible surface, so the design-first rule applies:
frames on `v4 - Complete`, approved, then built.
