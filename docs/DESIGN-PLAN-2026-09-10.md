# Designing the whole ERP — the plan

**Decided 10 September 2026 by Abdou**, after seeing the first five screens:

1. **Keep this look and apply it everywhere.** The tokens in `globals.css` are
   the design system — Geist, the quiet greys, one `#2a78d6` accent, the
   11.5–24px scale, 7/10/20px radii. The work is consistency and hierarchy
   across 93 screens, not a new style. This also keeps the implementation diff
   small: the CSS variables already exist and are already correct.
2. **Design the whole ERP first, then build.** Not a flow at a time. He wants
   the complete picture before the code moves again.
3. **Sales first within that** — deal → offer → proforma, the journey he runs
   every day and the one he tested.

The design lives in one Claude Design canvas, **SUPSERV ERP Design**, split
into pages. It supersedes the five-screen canvas of the same day; those five
screens are carried into it.

---

## The rule this plan exists to enforce

93 `page.tsx` files. Nobody can draw 93 screens well, and nobody should: **most
of them are the same four screens with different rows in them.** So the canvas
is built in two halves, and the first half is the one that matters.

**Foundations decides 80 of the 93.** One page of the canvas holding the
controls, the table system, the four page shells, the navigation and the
feedback patterns. Every screen after it inherits rather than invents. A screen
gets its own artboard only when it does something the foundations do not
already answer.

**Then the screens that carry the business** get drawn properly, in flow order,
so the handoffs between them are designed rather than discovered.

---

## Page 1 · Foundations

| Artboard | What it settles |
|---|---|
| Tokens | Colour with its meaning, the six type levels, spacing, radii, the tabular-numbers rule |
| Controls | Buttons in every state — including **greyed with a reason**, which is this codebase's own rule and is used in eight places and missing in forty |
| Data | The table: header, facets, saved views, row states, bulk bar, pagination, and the empty state with a real action in it |
| Shells | The four page types side by side — worklist, list, record, editor — with the page header that makes `actions` a required prop |
| Navigation | The rail at eleven rows, the topbar with a create action, and the phone bar's four jobs |
| Feedback | Banners, honest refusals, destructive confirmations, the approval gate, and the next-action panel |

## Page 2 · Sales — deal to proforma *(first, by his choice)*

`deals` · `deals/[id]` · `deals/[id]/items` · `deals/[id]/technical` ·
`deals/new` · `sourcing` · `sourcing/[id]` · `offers` · `offers/[id]/build` ·
`documents/[id]/edit` · `documents/[id]` · `documents/new` · `tenders` ·
`tenders/[id]` · `tenders/[id]/bpu`

Fifteen routes, and the design collapses several: `deals/[id]/prices`,
`offers/[id]/build` and `documents/[id]/edit` become **one editor** (V5), and
`tenders` becomes a facet of the deal list rather than a rail row (3.1).

## Page 3 · Inbox and Today

`today` · `week` · `waiting-on` · `inbox` · `inbox/[id]` · `inbox/dossier` ·
`inbox/dossier/[id]/review` · `inbox/scan` · `capture` · `conversations` ·
`notifications`

Conversations folds into Inbox as a tab (decided 10 September). Week and
Waiting-on fold into Today. Scan splits: the station's setup goes to
Administration, ordinary upload comes to Inbox.

## Page 4 · Orders to payment

`orders` · their purchase order arriving · `purchase-orders/[id]` ·
`deliveries` · `deliveries/[id]` · `deliveries/new` · `invoices` ·
`invoices/new` · `payments` · `payments/ageing` · `projects` · `projects/[id]` ·
`projects/[id]/situation` · `projects/[id]/amendment`

The one screen here that has no code behind it at all is the client's PO
arriving — Wave V block 3.

## Page 5 · Directory and compliance

`companies` · `companies/[id]` · `companies/[id]/edit` ·
`companies/[id]/scorecard` · `companies/duplicates` · `companies/merge` ·
`companies/new` · `contacts` · `contacts/new` · `people` · `candidates` ·
`candidates/[id]` · `personnel-requests` · `compliance` · `compliance/expiring`

Contacts and People fold under Companies in the eleven-row rail. Most of these
are the list and record shells with different columns — they get one worked
example each, not fifteen artboards.

## Page 6 · Settings, setup and the honest screens

`settings` and its seventeen children · `setup` and its four · `reports` ·
`dashboard` · `search` · `files` · `approvals` · `assistant`

The settings hub is drawn; the seventeen children share one detail pattern.
`settings/modules` and `settings/forms` exist to make gaps visible and are
reachable from nowhere — they get their group on the hub.

## Page 7 · On a phone

`src/mobile.ts` says there are four phone jobs — capture, approve, the counter
price, and signing off a delivery. Four artboards, and the rule that building
and deciding stay on the laptop.

---

## What the canvas is not

It is not a second source of truth for what exists. `docs/UI_INDEX.md` and
`docs/SCREENS.md` still say what is built. The canvas says what it should look
like, and `docs/FIX-QUEUE.md` says what to do about the difference.

## Order of drawing

Foundations → Sales → Orders to payment → Inbox and Today → Directory and
compliance → Settings → Phone.

Foundations first because everything inherits it. Sales second because he asked
for it. After that, by how much money moves through the screen.
