# FIX QUEUE — the usability repair loop

This file is the loop's memory. A session with no other context can read this
file alone and continue the work correctly. Keep it accurate: it is the only
thing that survives between sessions.

Source of the plan: `docs/AUDIT-2026-09-08.md`. Read it once before your first
task, then work from this queue.

---

## THE LOOP

One task at a time. Never two in flight.

1. Read this file. Take the **first task that is `[ ]` and not blocked**.
2. Mark it `[~]` (in progress) and write the file back immediately, so a
   session that starts while you work does not take the same task.
3. Implement it. Follow `CLAUDE.md` — the six laws are not negotiable, and the
   audit's "What not to do" list is part of this queue.
4. Run the gate: `pnpm check`. It must be **green**. It runs typecheck, biome,
   `audit:actions`, `audit:forms`, `audit:schema`, and the full unit suite.
5. Commit with the task id in the subject: `0.2 discard and restore a deal`.
6. Push: `git push -u origin fix/usability-2026-09`.
7. Mark the task `[x]`, add a line to the Progress log with the commit sha,
   write this file back, commit the queue update with the next task's work.
8. Go to 1. Do not stop between tasks. Do not ask for permission to continue.

**If a task is blocked** — you need a decision only Abdou can make, or the
change would break one of the six laws — mark it `[!]`, write the question
under **Needs Abdou** at the bottom, and move to the next unblocked task.
Never guess, and never work around a law.

**If `pnpm check` goes red** and you cannot make it green within the task:
`git stash` or revert that task's changes, mark it `[!]` with the failure in
the notes, and move on. Never commit red. Never delete or weaken a test to
make it pass — if a test is genuinely wrong, that is a `[!]`.

**When the queue is empty**, run `pnpm check` once more, push, and write a
summary at the bottom under **Done**. Then stop.

---

## THE MACHINE

Facts learned the hard way. Do not rediscover them.

| | |
|---|---|
| Repo | `C:\SUPSERV-ERP` on **SUPSERVPC01** (Windows) |
| Branch | `fix/usability-2026-09` — **never commit to `main`** |
| Shell | Use Desktop Commander `start_process` with `shell: "cmd"`. **PowerShell cannot run `pnpm`** — execution policy blocks `pnpm.ps1`. |
| `device_bash` | Runs in an isolated Linux VM that only *mounts* the folder. It has **no pnpm, no docker, no Windows toolchain**. Use it for reading and grepping; use Desktop Commander for anything that runs. |
| Database | `supserv-db` container is already up. Check with `docker ps`. If it is down: `docker compose -f docker-compose.dev.yml up -d` |
| Long commands | `pnpm check` takes minutes. Start it redirected to a log — `pnpm check > .logs\check.log 2>&1` — and poll with `read_process_output`, or read the log. |
| Migrations | `pnpm db:generate` then `pnpm db:migrate`. **Never hand-edit a generated migration.** |
| New packages | Allowed if free. Add a line to `STACK.md` saying why, with the date. |
| Biome import order | Biome sorts imports and will fail the gate over it. Run `pnpm format` before `pnpm check`, then `git status --short` before staging — format touches only what it needs, but stage files by name, never `git add -A`. |
| Scheduled runs | A scheduled run may have no mounted folder, so `device_bash` fails. Everything can be done through Desktop Commander instead: `read_file`, `write_file`, `edit_block`, `start_process`. Do not stop over it. |
| MCP timeouts | A `start_process` call can time out at the tool layer while the process keeps running on the machine. Do not re-run the command — call `list_sessions`, find the pid, and `read_process_output`. Re-running is how you get "the file is being used by another process". |

---

## WAVE 0 — stop the discomfort

- [x] **0.7 · Land on `/today`, not `/deals`**
  `src/app/[locale]/page.tsx` redirects signed-in users to `/deals`. Change it
  to `/today`. The comment there says `user_preference` will choose it per
  person one day — leave that comment, update it to name the new default.
  *Done when:* signing in lands on Today, and `pnpm check` is green.

- [x] **0.2 · Discard and restore a deal**
  `deal.deleted_at` is already migrated and `listDeals` already filters
  `isNull(deal.deletedAt)`. Nothing writes it. Add `discardDeal` and
  `restoreDeal` to `src/domain/deletion.ts`, modelled exactly on
  `discardParty` / `restoreParty`: capture a reason, write an audit entry,
  and **guard on issued documents** — a deal with an issued invoice must
  refuse, the way `discardParty` does via `issuedDocumentCount`. Then a server
  action in `src/app/[locale]/(app)/deals/[id]/actions.ts` and a button on the
  deal page. Register the action in `tests/unit/action-permissions.test.ts`
  (`pnpm audit:actions` fails otherwise).
  *Done when:* a deal can be discarded from its page, disappears from
  `/deals`, appears in `/settings/bin`, and one with an issued document
  refuses with a reason on screen.

- [x] **0.1 · Discard a draft document**
  `document` has no deletion columns at all. Add `deleted_at` / `deleted_by` /
  `delete_reason` in a new migration. Guard: only when
  `number IS NULL AND locked_at IS NULL` — an issued document is never
  discardable (LAW 5). Add `discardDocument` to `src/domain/deletion.ts`, a
  server action in `documents/[id]/actions.ts`, and a button on the document
  page that is **present but greyed with a `disabledReason`** when the
  document is issued — never absent. Exclude discarded rows from the
  documents and invoices lists.
  *Done when:* a never-issued draft can be discarded and restored, an issued
  one shows a greyed button explaining that a correction is an avoir, and
  `pnpm check` is green.

- [x] **0.3 · Make the bin polymorphic**
  `listBin()` hardcodes a `party` select and `settings/bin/page.tsx` binds
  every row to `restoreCompany`. `BinRow.what` is already a generic label —
  add an entity discriminator and dispatch restore on it. Cover party, deal
  and document.
  *Done when:* the bin lists all three kinds, each restores correctly, and
  each row still shows its days-left.

- [x] **0.4 · A grey button with a reason wherever removal refuses**
  `RulePopover` has zero callers. `Button`'s `disabledReason` is used for
  issue and send only. Give every removal control a reason instead of an
  absence. `src/domain/rules.ts` no longer exists — do **not** recreate it;
  use `disabledReason` with a plain sentence, and only reach for
  `RulePopover` where an actual `blocking_rule` row with an authority exists.
  *Done when:* no removal path anywhere is a silently missing button.

- [x] **0.5 · Wire or remove the four bulk stubs**
  `deals-list.tsx:140` — `assign`, `tag`, `waiting`, `export` are all
  `run: () => {}`. Ticking rows and clicking does nothing, silently.
  Implement `export` (CSV of the selected rows) and `waiting`; remove
  `assign` and `tag` until they mean something. Do **not** add delete here —
  `bulk-bar.tsx` forbids it on purpose.
  *Done when:* every visible bulk action does what its label says.

- [ ] **0.6 · Clear my test data**
  A gérant-only action that **discards** — never `DELETE`s — every party,
  deal and draft document created before a chosen timestamp, writing one
  audit entry per record. Put it on `/settings` behind a typed confirmation.
  It must refuse to touch anything issued.
  *Done when:* Abdou can empty the hand-typed test junk in one action, and
  every discarded row is restorable from the bin.

- [ ] **0.8 · Cancel an issued invoice by avoir**
  `invoices.cancel` is granted to `gerant` and referenced exactly once — its
  own declaration. Wire it: cancelling an issued invoice generates a
  `credit_note` through `src/documents/` (LAW 3 — one engine), sets the
  original's `status` to `credited`, keeps its number, and never reuses a
  number. LAW 5 says enforce immutability with database triggers, not
  application code — check what triggers exist before adding application
  guards.
  *Done when:* CLAUDE.md acceptance test 3 passes — issue three, cancel the
  second, issue a fourth; the series reads 0001–0004 and 0002 is an avoir.
  Add that test to `tests/` if it does not exist.

- [~] **0.9 · A binned draft must not be picked as "the draft on this deal"**
  `src/domain/tender/bpu-store.ts:186, 522, 560` find the working quotation by
  `number is null`, so a discarded draft is still a candidate. Harmless while
  the bin is empty; the first time somebody bins a draft quotation and then
  imports a BPU on the same enquiry, the prices land in a binned document.
  Add the `liveDocument` clause and a test that proves a binned draft is
  skipped. Whoever takes this should read screen 42 first.
  *Done when:* importing a BPU on an enquiry whose draft quotation is in the
  bin creates or picks a live draft, and a test covers it.

## WAVE 1 — make the envelope readable

Strictly sequential. Each step is useless without the one above it.

- [ ] **1.1 · Fetch attachment bytes from Graph**
  `src/capture/mail/graph.ts:180` selects metadata only. Add
  `fetchAttachmentBytes` using `GET /messages/{id}/attachments/{aid}/$value`
  — not `contentBytes`, which Graph caps around 4 MB. Handle `itemAttachment`
  and `referenceAttachment` kinds explicitly rather than assuming
  `fileAttachment`. Must go through the existing `assertScoped()` and `get()`.
  *Done when:* a unit test proves the request shape, and the scope guard still
  refuses when `MS_MAILBOX_SCOPE_CONFIRMED` is not `true`.

- [ ] **1.2 · Store the bytes**
  In `storeOne` (`src/domain/intake/mailbox.ts:209`) call
  `storageFor("working").put()` and write `storage_path`. Restore the `sha256`
  column that `src/db/schema/intake.ts:137` says was dropped precisely because
  this fetcher did not exist, and write it. Copy the naming convention from
  `storagePathFor` in `dossier.ts:17`.
  *Done when:* a synced message's attachments have a storage path, and
  `/api/files/attachment:<id>` returns the file instead of 409.

- [ ] **1.3 · Move capture into a pg-boss job**
  `pg-boss` is installed, `pnpm worker` is declared, `docker-compose.yml` runs
  a worker service — and `src/jobs/` does not exist. Create it. Attachment
  download is slow, network-dependent and retryable, which is exactly what
  CLAUDE.md reserves that folder for. Keep "Sync now" working as a manual
  trigger that enqueues rather than blocks.
  *Done when:* attachments download in the background with retries, and the
  worker starts from `pnpm worker`.

- [ ] **1.4 · Expand ZIP attachments**
  New `src/capture/archive/zip.ts`. Guard against path traversal and zip
  bombs — mirror `safeJoin` in `src/storage/local.ts:38`, cap the entry count
  and the uncompressed total, and refuse nested archives beyond one level.
  Each entry becomes its own `intake_attachment` row keeping its path inside
  the archive as the display name. **Never delete the original archive.**
  A free package is fine (`yauzl` or `adm-zip`) — record it in `STACK.md`.
  *Done when:* a message with a `dossier.zip` lists every file inside it,
  each openable, and a malicious zip is refused with a logged reason.

- [ ] **1.5 · View a file inside the ERP**
  `inbox/[id]/page.tsx:196` renders attachments with no anchor at all. Make
  them links, and add a viewer using the pattern already working in
  `documents/[id]/page.tsx:220` — `<object type="application/pdf">`, the
  browser's own viewer, no new dependency. Images already pass `RENDERABLE`.
  Do **not** loosen `RENDERABLE` for HTML or SVG — that is a security
  decision, not an oversight. Add a paperclip indicator to the inbox list row.
  *Done when:* a PDF or image attachment opens inside the ERP without going
  to Outlook.

- [ ] **1.6 · Read Word and Excel**
  `extractText()` (`src/capture/ocr/provider.ts:100`) is PDF-only and throws
  for everything else. `exceljs` is already a dependency and reads XLSX. DOCX
  is a zip of XML — you will already have the unzip from 1.4. Extract into
  the same `intake_page` rows the PDF path writes, so review and citations
  work unchanged.
  *Done when:* a DOCX or XLSX attachment produces searchable page text with
  citations, and the review screen can propose fields from it.

- [ ] **1.7 · Show the document beside the fields on review**
  `inbox/dossier/[id]/review` renders `intake_page.text`. LAW 2 asks a person
  to confirm a field *against the source*. `intake_dossier.storage_path` is
  already populated and the viewer is already written — put the real page on
  screen next to the proposed value, scrolled to the cited page.
  *Done when:* confirming a deadline shows the page it was read from.

- [ ] **1.8 · Run extraction on attachments automatically**
  `ingestPdf()` (`src/domain/intake/dossier.ts:29`) already accepts
  `messageId` and `attachmentId`, and `intake_dossier` already has both
  foreign keys. No caller passes them. Pass them from the mail path, as a job.
  *Done when:* a tender dossier arriving by email produces a reviewable
  extraction with no manual upload.

- [ ] **1.9 · Images and scans** *(do not start until 1.1–1.8 are in daily use)*
  `Dockerfile.ocr` and the compose service exist with **no server code**, and
  nothing in `src` calls `OCR_URL`. `sharp` is installed and unused. Build the
  container's server and an HTTP client behind the existing provider
  interface. `docs/OCR.md` has the measurements and the `--psm 3` rule.
  *Done when:* a photographed bordereau produces page text with citations.

## WAVE 2 — the deal knows what it is, and what happens next

- [ ] **2.1 · "Make this a tender" on the deal page**
  `makeTender()` (`src/domain/tender/store.ts:235`) is written, transactional,
  guarded and tested, with zero callers outside `tests/`. Add a server action
  and a form on the deal page: `procedure` (the five values already exist),
  place of deposit, opening date, bid bond. Add `unmakeTender` so a wrong
  call is reversible — it must refuse once anything has been submitted.
  *Done when:* an enquiry becomes a tender in one press, appears on
  `/tenders` with its folder seeded, and can be turned back.

- [ ] **2.2 · Show the tender on the deal**
  `deals/[id]/page.tsx` contains the word "tender" zero times. Add a badge, a
  link to `/tenders/[id]`, a link to `/tenders/[id]/bpu` (reachable from
  nowhere today), and the folder percentage from the existing pure
  `dossier()`. Also link `/deals/[id]/items`, which is orphaned.
  *Done when:* nothing about a tender is reachable only by typing a URL.

- [ ] **2.3 · Suggest the conversion**
  The signals already exist and are thrown away: the routing rule matching
  *consultation · avis · appel d'offres*, and `attachmentLooksLike` tagging
  `cahier|charges|cctp|dossier|appel` as `tender_dossier`. Add ZIP-present
  and attachment-count. Show "this looks like a tender" on the inbox commit
  screen beside the existing buttons. **Propose, never decide** — LAW 2.
  *Done when:* a ZIP dossier arrives and the suggestion is on screen, and a
  person still chooses.

- [ ] **2.4 · Confirmed extractions reach the deal**
  `intake_dossier` has no `deal_id`, so six confirmed fields — submission
  deadline, opening session, place of deposit, bid bond, offer validity, late
  penalty — land in `extraction_field` and stop. Add the column and a
  `commitDossierToDeal` mapping them onto `deal.*` and `tender.*`. Only
  `confirmed_at IS NOT NULL` rows may be read (LAW 2).
  *Done when:* confirming the deadline on the review screen sets it on the
  deal, and `deal.requiredValidityDays` / `requiredDeliveryDays` /
  `latePenalty` finally have a writer, so the silent checks in
  `sourcing-store.ts:268` and `offer/submit.ts:120` start firing.

- [ ] **2.5 · A next-step panel on the deal**
  Eight cards render at once with no order. `submitChecks` in
  `src/domain/offer/submit.ts` already returns the right shape —
  `{ key, state: pass|warn|block|note, detail, fixHref }`. Write
  `dealChecks(facts)` returning the same type over `DealFacts`, which
  `getDeal` already computes on every load, and render it with the same
  markup at the top of the right column.
  *Done when:* the deal page always names the next thing to do, with a link
  that lands on the field or screen that does it.

- [ ] **2.6 · Generalise the `/setup` stepper to the two weekly workflows**
  `/setup` (screen 85) is the pattern that works: numbered computed steps,
  blocking ones with a filled badge and a primary button, done ones with a
  green badge and no button, a banner naming what is missing. Apply it to the
  enquiry run (items → suppliers asked → prices in → offer issued → order →
  BL → facture) and the tender run (folder pieces → BPU priced → caution →
  submitted). Both are computable from rows that already exist, exactly as
  `setupState()` is. **Do not store progress** — LAW 1.
  *Done when:* both runs show where they are without anyone ticking anything.

- [ ] **2.7 · Give the tender page its actions**
  The tender detail page has no form and no `actions.ts`. `markSubmitted`,
  `recordCaution`, `addPiece`, `removePiece` and above all `saveCredential`
  are exported and unreachable — without the last, every credential-backed
  folder piece computes as `missing` forever and the screen is all red the
  day it first has data.
  *Done when:* a tender can be taken from folder to recorded deposit without
  leaving the ERP.

- [ ] **2.8 · Fix `importBpu`'s silent loss**
  `src/domain/tender/bpu-store.ts:663` updates the `tender` row
  unconditionally; on a deal with no tender row that updates zero rows and the
  provenance the screen header prints is lost.
  *Done when:* importing a BPU on a plain deal either records provenance or
  says it cannot, and a test covers both.

## WAVE 3 — shrink the surface

Do not start Wave 3 until Waves 0–2 are green and pushed. It touches many
files and will conflict with everything above.

- [ ] **3.4 · Make the honest screens reachable** *(do this one first — it is
  small and independent)*
  `/settings/modules` and `/settings/forms` exist to make gaps visible and are
  reachable from nowhere. Add them to the `/settings` hub. Same for
  `/deliveries/new` from Deliveries, `/candidates` from People, and
  `/approvals` and `/prices/new` on the laptop — both are phone-bar-only today.

- [ ] **3.2 · Every list gets a `StateBlock` with a real action**
  About 60 empty states render as a bare `<p>`. `StateBlock` and its `action`
  slot already exist and are used twice, both error screens. Start with the
  screens that have zero `variant="primary"`: Tenders, Sourcing, Offers,
  Orders, Deliveries, Payments. Fix `tenders.none`, which currently instructs
  a workflow — once 2.1 ships, that instruction becomes true, so update the
  copy to name the button.

- [ ] **3.3 · One word per concept** — *decided, no longer blocked*
  **Deal**, not enquiry: `enquiry` appears 178 times in `en.json` against 54
  for `deal`, for the same object, while the nav and the route already say
  Deals. **Site**, not project, for *Chantier*. French keeps *Affaire* and
  *Chantier*. Routes do not move — `/projects` keeps its path, because a saved
  link is worth more than a tidy URL, and the label is what a person reads.
  Still open and yours to judge: *Sourcing* for *Approvisionnement*, and
  *Payments* sitting beside *relances* for *Règlements* — pick words in the
  same pass and say so in the commit.
  *Done when:* one English word per concept across nav, titles, body copy,
  empty states and errors, and `grep -c enquiry src/i18n/messages/en.json`
  returns 0.

- [ ] **3.1 · Rail from 24 rows to about 11**
  Today (absorbing Week and Waiting on as tabs) · Inbox (absorbing Scan,
  Quick capture, Conversations) · Enquiries · Offers · Orders+Deliveries ·
  Chantiers · Invoices (absorbing Payments and Ageing) · Approvals ·
  Companies (absorbing Contacts and People) · Compliance · Settings in the
  footer. Tenders becomes a **facet of the enquiry list** — which is what it
  already is in the data, since a tender *is* a deal. `docs/UI_INDEX.md`
  specified 18 rows and the sidebar's own comment admits 24 do not fit.

- [ ] **3.5 · Retire or demote what nobody touches weekly**
  `/dashboard` duplicates Today and Reports; `/files` is a file browser inside
  an ERP; `/week` is a view of Today. Demote rather than delete.

- [ ] **3.6 · Adopt `DataTable` on the next lists** *(incremental, last)*
  Used by 4 files; 53 others write a raw `<table>`, so filters, saved views,
  pagination and bulk actions exist on 4 screens only. Convert Tenders,
  Invoices, Payments, Deliveries. One screen per commit.

---

## Known gaps

Work a later run must finish. Written down rather than left half-done.

### 0.3 — the bin counts down to nothing

`BIN_DAYS` is 30 and is used for exactly one thing: computing `daysLeft` so the
bin can print "gone in 12 days" and `bin.afterThirtyDays` can say "after 30 days
the record is removed but the audit entry stays". **Nothing removes it.** There
is no purge — no job, no cron, no `src/jobs/` at all yet (see 1.3) — so a row
binned today is still there in a year with a `daysLeft` of `0`, and the sentence
under the table is the only untrue thing on screen 83.

Deliberately not fixed in 0.3. Writing a purge is a decision about destroying
data, not a bug fix: it needs Abdou to say what actually goes at day 30 (the row
itself, or only the fields that identify it), and it must never take an audit
entry, a number in a series, or anything the row is the last copy of. Until that
decision exists, the honest options are to soften the copy or to leave the
countdown as a promise nobody has kept — and softening copy the day before
somebody writes the purge is its own churn.

### 0.4 — four removal paths still silent, and one that must stay refused

The sweep covered a person, a note, a payment and the company button. What it
looked at and deliberately did not change, with the file each lives in:

| Silent path | File | Why it was left |
|---|---|---|
| A **site** (`/projects/[id]`) | `src/domain/project/store.ts`, `src/app/[locale]/(app)/projects/[id]/page.tsx` | `project.deleted_at` is migrated and four queries filter it; nothing writes it — the same shape as `person` and `note` before this task, so it is the obvious next one. Left because a site is opened only after a client says yes and then carries situations, a retenue de garantie, cautions and a crew. What a site refuses on is a real question (an issued situation? a caution not yet released?) and answering it by guessing is how a marché ends up in a bin. |
| A **line on a deal** (`/deals/[id]/items`) | `src/domain/deal/lines.ts` | There is no per-line remove. `replaceLines` re-reads the whole paste on the server and replaces the list, so removing a line means editing the paste and saving — which works, is not obvious, and is not a bin. |
| A **supplier asked** (`/sourcing/[id]`) | `src/domain/deal/sourcing-store.ts` | A supplier asked by mistake cannot be unasked. `sourcing_request` and `sourcing_response` have no deletion columns at all, so this needs a migration and a decision about what an already-answered request means. |
| A **price quote** (`/deals/[id]/prices`) | `src/domain/deal/price-store.ts` | `addQuote` writes; nothing removes. No deletion columns. Same migration-sized shape as sourcing, and the two belong in one pass. |

Deliveries and purchase orders are **not** on this list and do not need to be: a
bon de livraison and a bon de commande are `document` rows, and a draft of
either already discards through screen 18 (task 0.1).

**And one that is not a gap.** `payment.deleted_at` is migrated and six queries
in `src/domain/money/store.ts` filter on it, which reads exactly like the
unfinished bin `deal` and `document` had. It is not. `src/domain/deletion.ts`
names a recorded payment in the list of things nobody may delete, including the
Gérant, and money that arrived at the bank is not a row somebody may untype —
a system where it can be is a system nobody can reconcile against a statement.
Screen 19 now says so on a permanently grey button rather than by having no
button. Do not "finish" that column.

### 0.1 — `liveDocument` covers three query sites, not thirty-four

`src/domain/deletion.ts` exports `liveDocument` (`document.deleted_at is null`).
It is applied to the queries that actually list drafts:

- `billed()` — `src/domain/money/store.ts` — the invoices list, screen 17.
- `listOffers()` and `draftOffers()` — `src/domain/offer/store.ts` — screen 11.
- `offersForDeal()` — the offers panel on the enquiry, screen 06.

The rest were left alone on purpose, in three groups.

**Already safe — the clause would be true by construction.** These filter
`number is not null` or `status = 'issued'`, and a discarded row can be neither:
`owings()` and `settlements()`, `factsFor()` in `deal/deal.ts` (the counts the
enquiry's stage is derived from), `issuedDocumentCount` and
`issuedDocumentCountForDeal` in `deletion.ts`, `control/reports.ts`,
`import/run.ts:406`, `delivery/store.ts:372`, `purchase/store.ts:452`,
`project/candidates.ts`, the issued reads in `project/situations.ts`,
`today/gather.ts`, `waiting/gather.ts`.

**Deliberately unfiltered — reads by id.** A binned draft must keep its page or
nothing could restore it: every `eq(document.id, …)` in `src/documents/` and
under `documents/[id]/`, and `documentBinState` itself.

**Genuinely uncovered.** A discarded draft can still appear at each of these.
One `liveDocument` clause each, plus a look at the screen it feeds:

| Site | What it shows |
|---|---|
| `src/domain/order/list.ts:64` | the orders list — draft client and supplier orders |
| `src/domain/timeline/gather.ts:132` | the deal timeline — every document on the enquiry, drafts included |
| `src/domain/control/compliance-status.ts:87` | the compliance screen's count of drafts that would be refused |
| `src/domain/merge-preview.ts:131` | "what moves" when two companies merge |
| `src/domain/delivery/store.ts:351` | delivery notes, listed with no number filter |
| `src/domain/project/final.ts:118`, `retention.ts:152`, `situations.ts:941` | draft décomptes finaux, retention releases and avenants |
| `src/domain/tender/bpu-store.ts:186, 522, 560` | the sharpest one: these find "the draft quotation on this deal" by `number is null` in order to write BPU prices into it, and a binned draft is still the row they pick |

None of this is wrong today — the bin is empty until somebody uses it — but the
BPU one writes prices into a binned draft the first time both features meet on
the same enquiry.

---

## Needs Abdou

*(Nothing outstanding.)*

**Answered 2026-09-08 — the vocabulary is decided.** Abdou chose **Deals** and
**Sites**. So, in English, everywhere — nav, routes, page titles, body copy,
empty states, error messages:

| Use | Never |
|---|---|
| **Deal** | enquiry, consultation, RFQ *(as the name of the record)* |
| **Site** | project, chantier *(in English)* |

French is unchanged and stays idiomatic: *Affaire* and *Chantier*. The route
`/deals` is already right; `/projects` keeps its path — renaming a route breaks
every saved link for a word, and the label is what a person reads. Task 3.3
carries this out; anything written before 3.3 ships should already use it.

---

## Progress log

| Date | Task | Commit | Note |
|---|---|---|---|
| 2026-09-08 | — | `115da43` | Branch `fix/usability-2026-09` opened; in-progress schema-audit work carried over; audit filed. |
| 2026-09-08 | — | `bbf3d4a` | This queue filed. Baseline `pnpm check` green before any change. |
| 2026-09-08 | 0.7 | `e0771c8` | Landing redirect now `/today`. |
| 2026-09-08 | 0.2 | `6f557e0` | `discardDeal` / `restoreDeal` in `deletion.ts`, guarded on issued documents; `deals/[id]/delete-actions.ts`; a danger button on screen 06 that greys with a readable reason instead of disappearing; EN + FR copy; permission table updated. Restore is deliberately not on the deal page — `getDeal` filters `deleted_at`, so the bin (0.3) is what calls `restoreDealAction`. |
| 2026-09-08 | 0.1 | `792daee` | `document` gains `deleted_at` / `deleted_by` / `delete_reason` (migration 0051); `discardDocument` / `restoreDocument` guarded on `number is null AND locked_at is null` with its own `DocumentIsIssued`; `documents/[id]/delete-actions.ts`; a discard card on screen 18 whose button greys with the avoir sentence instead of vanishing, and offers Restore once binned; EN + FR copy; `liveDocument` on the invoices list, the offers list and the enquiry's offers panel. The sites left uncovered are named under Known gaps. |
| 2026-09-08 | 0.4 | `db50f51` | The sweep. A **person** can now be discarded and restored — `person.deleted_at` had been migrated since phase 1 with twelve queries filtering it and nothing writing it — with a Remove on every contact row of screen 22 and every row of screen 51, greyed with the reason when the person has not left a site crew (`peopleOnSite`). A **note** likewise on screen 56, the one row on a timeline nothing else holds a copy of: your own note is yours, anybody else's takes `records.delete`, and the timeline says once why only notes carry the control. A **payment** gets the opposite answer — present, grey and permanent, naming re-allocation and the avoir as what to do instead. The company discard on screen 22 stopped refusing after the press: `issuedDocumentCount` is exported so the grey button and the refusal run one query. The bin holds five kinds and dispatches restore through a table. `RulePopover` still has zero callers, deliberately — none of these five refusals is a `blocking_rule` row with an authority, and inventing one to give the component a caller would be asserting a law on our own authority. Four paths left silent are named under Known gaps. |
| 2026-09-08 | 0.3 | `47612a8` | `BinRow` gains a `kind` discriminator — company, deal or document; `listBin()` queries the three tables and sorts once across the whole set, newest first, rather than kind by kind. Restore dispatches to `restoreCompany` / `restoreDealAction` / `restoreDocumentAction`, all three still listed in the permission table. Each row leads with a neutral `Badge` naming its kind; a company and a draft link back to pages that render for a binned row, an enquiry does not because `getDeal` filters `deleted_at`. EN + FR copy for the three kind labels and "No number". `BIN_DAYS` untouched — and the fact that nothing purges at day 30 is now written under Known gaps rather than fixed, because destroying data is Abdou's decision. |
| 2026-09-08 | 0.5 | `1dfc939` | Export implemented, the other three removed rather than stubbed. `src/components/data/export-csv.ts` writes the ticked rows with the columns the table is showing — semicolon-separated with a BOM, because Excel in a French locale splits on `;` and reads UTF-8 as Windows-1252 without one; the header comes from the caller's translator (LAW 4) and the cell text is walked out of the rendered node, so the file says what the screen says. `BulkAction` gains the row type and a `BulkContext` — ticked records plus visible columns — since only the table knows what is on screen. **Tag** removed: there is no tag table. **Mark waiting on** removed: screen 58 is computed from silences (`domain/waiting/gather.ts` stores nothing), so there is no flag to set and a flag would be a stored state time changes (LAW 1). **Assign to** removed until it has a person picker, an action and a permission — `deal.owner_id` is real, a bar of plain buttons is not enough to write it. No bulk delete; `bulk-bar.tsx` now also states that a listed action must work the moment it is visible. Three message keys deleted from both files. |
