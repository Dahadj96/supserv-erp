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
| **Seeing the work** | **A commit is not a deployment.** The ERP is served by `next start` over a *built* `.next`, so code on disk changes nothing a person can see. After finishing a task: `pnpm build`, then `restart-erp.cmd` (or `scripts\server\restart.ps1`). **The restart needs Administrator** — the process on port 3000 will not die without it, and Windows shows a prompt on the machine that only Abdou can answer. So: build unattended, then tell him to double-click `restart-erp.cmd` and say yes. Never claim a change is live until port 3000 has been restarted onto the new build. `pnpm smoke` afterwards. |
| Reboot | There is **no `SUPSERV ERP` scheduled task** on this machine, so the ERP does not come back after a reboot or a power cut, while cloudflared does — the tunnel answers with a Cloudflare error page pointing at nothing. `scripts\server\install-services.ps1` fixes it once, from an Administrator PowerShell. Abdou's call, and it needs his machine. |
| MCP timeouts | A `start_process` call can time out at the tool layer while the process keeps running on the machine. Do not re-run the command — call `list_sessions`, find the pid, and `read_process_output`. Re-running is how you get "the file is being used by another process". |

---

## WAVE 0 — stop the discomfort

**Complete, 8 September 2026.** All nine tasks are `[x]`. What Wave 0 was for
— nothing removable is silently missing, nothing issued can be un-issued, and
the last of it, an issued invoice can now be cancelled the only way LAW 5
allows. What each one deliberately left for later is under Known gaps; the
questions none of them could answer are under Needs Abdou. Wave 1 is next.

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

- [x] **0.6 · Clear my test data**
  A gérant-only action that **discards** — never `DELETE`s — every party,
  deal and draft document created before a chosen timestamp, writing one
  audit entry per record. Put it on `/settings` behind a typed confirmation.
  It must refuse to touch anything issued.
  *Done when:* Abdou can empty the hand-typed test junk in one action, and
  every discarded row is restorable from the bin.

- [x] **0.8 · Cancel an issued invoice by avoir**
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

- [x] **0.9 · A binned draft must not be picked as "the draft on this deal"**
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

- [x] **1.1 · Fetch attachment bytes from Graph**
  `src/capture/mail/graph.ts:180` selects metadata only. Add
  `fetchAttachmentBytes` using `GET /messages/{id}/attachments/{aid}/$value`
  — not `contentBytes`, which Graph caps around 4 MB. Handle `itemAttachment`
  and `referenceAttachment` kinds explicitly rather than assuming
  `fileAttachment`. Must go through the existing `assertScoped()` and `get()`.
  *Done when:* a unit test proves the request shape, and the scope guard still
  refuses when `MS_MAILBOX_SCOPE_CONFIRMED` is not `true`.

- [x] **1.2 · Store the bytes**
  In `storeOne` (`src/domain/intake/mailbox.ts:209`) call
  `storageFor("working").put()` and write `storage_path`. Restore the `sha256`
  column that `src/db/schema/intake.ts:137` says was dropped precisely because
  this fetcher did not exist, and write it. Copy the naming convention from
  `storagePathFor` in `dossier.ts:17`.
  *Done when:* a synced message's attachments have a storage path, and
  `/api/files/attachment:<id>` returns the file instead of 409.

- [x] **1.3 · Move capture into a pg-boss job**
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

- [~] **1.5 · View a file inside the ERP**
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

### 1.3 — the screen cannot see the queue, and dev needs a second terminal

Two things a later run should close, neither of them a bug in what shipped.

**"Sync now" says the same thing whether or not a worker is running.** The
banner says the mailbox is being read; if nothing is emptying the queue, that
sentence is a promise nobody keeps, and the only way to find out is that no
message ever appears. The honest fix is on screen 38, which already shows a
channel as Live or not: it should also show the depth of `mailbox.poll` and
`attachment.fetch` and when a job last completed — pg-boss keeps all of that in
the same database, so it is a query, not a mechanism. Left out of 1.3 because
it is a screen change on top of a plumbing change, and doing both in one commit
would have made the plumbing hard to review.

**In dev the worker is a second terminal.** `pnpm dev` no longer captures mail
on its own; `pnpm worker` does, and it is now in CLAUDE.md's command list.
Compose runs it as a service in production, so this is a development-machine
fact rather than a deployment one — but it is the first time the app has needed
two processes to be fully working, and somebody will meet it by pressing Sync
now and seeing nothing.

**Nothing retries an attachment whose job has been exhausted.** After five
tries a `attachment.fetch` job fails for good and the row keeps its null path.
That is correct — the original is still in the mailbox and the file can be
asked for again — but there is no "try again" anywhere on screen 60, and no
list of what gave up. `deadLetter` on the queue plus a row on the files screen
is the shape; it wants 1.5's viewer to exist first, so that the button has
somewhere to sit.

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

### 0.6 — what the sweep leaves for a person, on purpose

Three things `/settings/clear` deliberately does not do. None is a bug; each is
a decision waiting on Abdou using it for a week first.

- **It never purges.** Everything it takes sits in the bin, and nothing empties
  the bin at day 30 — the same gap 0.3 wrote down. A sweep of two hundred rows
  makes that visible for the first time, and it is still Abdou's decision what
  actually goes at day 30 and what stays.
- **It does not sweep notes.** A note is the only row on a timeline that nothing
  else in the system holds a copy of, and it is reached through the record it is
  about, so a note on a binned deal is already out of sight. Sweeping them would
  be the one irrecoverable thing in the act.
- **The upward refusal has no override.** A company with a deal typed after the
  cut-off is skipped, and the only way through is to move the cut-off or bin
  that deal by hand. That is the right default; if Abdou finds himself moving
  the cut-off repeatedly to catch one company, a "take it and its children too"
  checkbox is the change, and it needs to be asked for rather than assumed.

### 0.8 — what the avoir does not do, and what the trigger does not cover

**The trigger is on UPDATE only.** Migration 0053 freezes an issued
document's row against every UPDATE, which is the class of bug LAW 5 is
about — a new `db.update(document)` written six months from now that nobody
thinks to guard. It does **not** refuse a `DELETE`. Nothing in `src` deletes
a document at all, `discardDocument` refuses on `number is null and
locked_at is null`, and CLAUDE.md forbids a hard DELETE in any migration —
so the rule is kept, just not by the database. It is not covered because the
integration suite tears its own fixtures down with real DELETEs against
`<database>_test`, and a trigger that made the suite unteardownable would
have been traded for a rule the application already keeps. The same reasoning
leaves `document_line` alone: `saveDraft` deletes and reinserts lines, and
the teardowns delete the lines of issued fixtures.

**`render_snapshot` is deliberately not frozen**, and that is worth knowing
before somebody "finishes" the trigger. It is not only the freeze taken at
issue: `markSubmitted` (`src/domain/offer/store.ts`, screen 12) records the
deposit of an offer into it — the place, the hour, the receipt reference —
which is a fact about an envelope handed over *after* the document was
issued. Freezing the column would break screen 12 and would be freezing the
wrong thing. If it ever needs freezing, the submission facts want their own
columns first.

**`settles` is still enforced by nothing.** `document_link.relation` carried
the comment "a proforma may NEVER carry `settles`. Enforced by trigger" from
the day the table was written, and no such trigger was ever migrated. The
schema now says so in words instead. Nothing writes `settles` either, so it
is a rule with no subject rather than a hole — but it is the second thing
this survey found that the schema claimed and the database did not do.

**An avoir passes no compliance check.** `check()` in
`src/documents/compliance.ts` matches a rule to a document by
`appliesTo`/`code` prefix, and every rule is keyed `invoice.*` or
`proforma.*`. A `credit_note` therefore matches none of them and issues
without the décret 05-468 identity and client-NIF checks the invoice it
credits had to pass. An avoir is a pièce comptable and almost certainly wants
the same mentions; keying rules to it is a small change to the seed and a
question for the accountant at the same time, so it is written here and asked
under Needs Abdou rather than assumed.

**Only a full credit exists.** `cancelByCreditNote` credits the whole
invoice, restating its frozen figures exactly, and moves it to `credited`. A
partial avoir — a returned line, a rebate agreed after the fact — leaves the
invoice owed for the rest and must NOT move its status, which is different
arithmetic and a different screen. See Needs Abdou.

**Only `invoice` may be credited**, read off the catalogue (`convertsTo`
includes `credit_note`) rather than typed as a second list. A situation de
travaux, an advance invoice and a retention release are all money owed and
none of them can be cancelled today. That is scope, not oversight: an avoir
on a situation touches the cumulative columns of every situation after it,
and guessing at that is how a marché stops reconciling.

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
| ~~`src/domain/tender/bpu-store.ts:186, 522, 560`~~ | **done in 0.9** — plus a fourth site this list missed, the erratum's `draftLinesLosingPrice` count |

None of this is wrong today — the bin is empty until somebody uses it — but the
BPU one wrote prices into a binned draft the first time both features met on
the same enquiry, which is why it went first (0.9). The rest still stand, and
none of them writes.

---

## Needs Abdou

### Five questions an avoir raises that are accounting, not code (0.8)

Cancelling an issued invoice now works for the case that is not in doubt: the
whole invoice, cancelled, credited in full, with the reason printed on the
avoir. Everything below was left alone on purpose. Each is a question for the
accountant, and the compliance rules that touch them are among the four
CLAUDE.md records as unconfirmed — which **warn, never block**.

1. **A partial avoir.** A client returns four of twelve, or a rebate is agreed
   after the facture has gone out. Today the only avoir is for the whole
   invoice. A partial one must leave the invoice owed for the rest, so it must
   *not* set `credited` — which means "what is owed" stops being
   `totalIncl − paid` and becomes `totalIncl − paid − credited`, on screens 17,
   19 and 20 at once. **Is a partial avoir something SUPSERV actually issues,
   or is the practice to cancel in full and re-invoice?** The second is
   simpler, and if it is what the accountant expects, nothing more is needed.

2. **The droit de timbre on the avoir.** The avoir copies the invoice's stamp
   duty, so a full credit reverses exactly what was billed. That is right if
   the duty is a charge on the INVOICE. If it is a charge on the cash PAYMENT —
   which is what `invoice.stampDutyThreshold` is unconfirmed about — then an
   avoir on an unpaid cash invoice should carry none, and one on an invoice
   already paid in cash may not be reclaimable at all. **Which is it?**

3. **Which period the TVA reversal belongs to.** The avoir restates the
   invoice's VAT lines exactly, and it is dated the day it is raised. **Does
   the reversal go on the déclaration of the month of the AVOIR, or of the
   month of the invoice being corrected?** The answer decides whether an avoir
   may ever be dated back — and if it may, the avoir series stops being
   chronological, which is its own problem.

4. **Payments already allocated to a credited invoice.** Nothing moves them.
   The invoice leaves `owings()` the moment it is credited, and any
   `payment_allocation` rows against it stay where they are — so the money is
   still recorded as having settled a document that is now void, and it is
   neither refundable nor re-allocatable from any screen. **When an invoice
   that has been part or fully paid is cancelled: does the money move to the
   replacement invoice, or is it refunded and the avoir settled?** There is no
   re-allocation screen either way; this decides which one to build.

5. **Whether an avoir carries the décret 05-468 mentions.** No compliance rule
   is keyed to `credit_note`, so an avoir issues today without the identity and
   client-NIF checks an invoice must pass (see Known gaps). **Does an avoir
   need the same mandatory mentions as the facture it credits?** If yes it is a
   one-line change to the rule seed; asking first is cheaper than asserting a
   law on our own authority.

Until each is answered, the full-credit path stands and nothing guesses.

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
| 2026-09-08 | 0.9 | `b58e432` | `liveDocument` on all four `number is null` lookups in `bpu-store.ts` — the queue named three, and the fourth (`reviewErratum`'s `draftLinesLosingPrice`) would have made screen 42 overstate what an erratum costs. The one that mattered is `applyErratum`, which cleared `unit_price` on every draft line on the enquiry including binned ones; `bpu()`'s `draftOfferId` was the other, sending "Build the offer" into the bin. `tests/integration/bpu-binned-draft.test.ts` proves it: four of its five assertions fail with the clause removed, including the binned row's price being cleared. Survey as asked — `src/documents/` has no lookup of this shape (every query there is by id, which must stay so a binned draft keeps its page); `offersForDeal()` and `draftOffers()` in `src/domain/offer/` already had the clause from 0.1, and `build.ts` inserts rather than looks up. |
| 2026-09-08 | 0.6 | `6405226` | `/settings/clear`, reached from the settings hub beside the bin. `src/domain/sweep.ts` plans and runs it: pick a moment, see the counts and the first five of each kind, type CLEAR (EFFACER in French, compared against the reader's own message file), and every company, deal, draft document and person created before it goes to the 30-day bin. It discards through `discardParty` / `discardDeal` / `discardDocument` / `discardPerson` — no new UPDATE, so every guard still refuses and every audit entry is still written. **It does not cascade**: the four passes run child first — documents, deals, people, companies — and refuse UPWARDS, so a company or a deal that still has a live child the cut-off does not cover is skipped and counted. A cut-off is a moment somebody chose, not a tree, and cascading would let "before 1 September" reach a deal typed yesterday. Anything issued is skipped and named. Archived, merged and already-binned rows are not candidates; **notes are not swept** — a note is the only row a timeline holds no other copy of. One audit entry per record plus one `sweep` entry carrying the cut-off, the counts and every refusal, written last so screen 32 shows it above its own consequences. `tests/integration/sweep.test.ts` dates its fixtures in the year 2000 and cuts at June 2000 — the suite shares one database and a sweep is global, so a cut-off of "now" in a test would bin every other file's fixtures. |
| 2026-09-08 | 0.8 | `4754849` | Cancelling an issued invoice writes an avoir. `src/documents/credit.ts` raises it the way `convert.ts` raises a facture — the invoice is read, copied and linked, never edited — and the ORDER is the point: the draft avoir and its `credits` link go in first, the engine issues it (which is what allocates `AV/{YYYY}/{####}`), and only then does the invoice become `credited`. The other way round leaves an invoice reading "credited" with no paper behind it the first time an issue is refused. The figures are copied rather than recomputed, so a full credit can never state a sum nobody was billed. **The trigger survey the task asked for:** the whole schema had exactly one trigger — `payment_allocation_within_payment`, migration 0021, about money and not about paper — so LAW 5's "enforce this with database triggers" had never been carried out. `document_kind_number_once` (0037) stopped a number being reused; everything else was five TypeScript guards the next `db.update(document)` would walk past. And the comment claiming a trigger enforced "a proforma may never carry `settles`" described one that does not exist. Migration 0053 is that trigger — it freezes everything an issued document prints and lets `status` move only along the two edges `MACHINES.document` declares — and 0052 adds `document_credited_once`, so two people cancelling at the same second get one avoir and one refusal that costs no number. **The money already knew how**, and nothing had ever exercised it: `owings()` and `settlements()` drop `credited`, `credit_note` is not an `INVOICE_KIND`, `paidStateOf` has answered "credited" since phase 5. `tests/integration/credit-note.test.ts` proves it over the real functions and carries CLAUDE.md's third acceptance test — issue three, cancel the second, issue a fourth; 0001–0004, four distinct numbers, 0002 credited with its number, lines and lock intact, the avoir on its own series — asserted in the database, including by asking Postgres to reuse 0002 and to edit an issued row and being refused. Screen 18 gains the cancel card beside 0.1's discard card, grey with the reason on every case that does not apply, and both ends of the link on screen. Five accounting questions filed under Needs Abdou; what the trigger does not cover is under Known gaps. |
| 2026-09-08 | 1.1 | `b1522af` | `fetchAttachmentBytes` on `/$value`, never `contentBytes` — which arrives base64 inside the listing JSON and stops being populated somewhere around 4 MB, so a list-and-decode fetcher works on every message anybody tests with and returns nothing for the 12 MB CCTP the feature exists for, without erroring. The three kinds are answered separately because only one is a file: a **file** comes back at its original content type; an **item** (contact, event, message) comes back serialised as MIME, which is worth storing but is not the file a person thinks they attached, so the result carries `kind: "item"` for 1.2 to act on; a **reference** is a link to OneDrive and has no bytes in the mailbox at all — Graph's documented answer to `$value` on one is **405**, and new `AttachmentHasNoBytes` carries that as a reason rather than a failure, because a link is the normal case for a large dossier and 1.3 must not retry it forever. Refused twice on purpose: by `@odata.type` before a request is spent, and by the 405 when the listing did not carry it — the annotation is not a property, `$select` does not govern it, and nothing depends on it being present. `get()` parsed JSON and `/$value` is bytes, so the request is factored into `request()` and both readers sit on it rather than a second `fetch` becoming a second place to forget `assertScoped()`; `get()` is unchanged in behaviour. The test pins the two things that fail invisibly — the request shape (ids encoded into the path rather than pasted) and that the guard still refuses **without making any request**, setting the scope env itself in both directions so a machine whose `.env` says `true` cannot decide which half runs. |
| 2026-09-08 | 1.2 | `b4154cd` | `storeOne` fetches each attachment through 1.1, puts it in the working store and writes `storage_path` — so `/api/files/attachment:<id>` stops answering 409 for every file the company has ever been sent. `sha256` restored (migration 0054, one additive column) with the fetcher whose absence was the stated reason it was dropped; the schema comment claimed `storageFor().put()` returns the digest and it does not — `sha256()` was exported from `storage/local.ts` with no caller, and has one now. The rows go in **before** the bytes because the path is keyed on our row id, not the Graph attachment id: Graph ids change when a message is moved between folders, and a path built from one stops resolving for a reason invisible on screen. Naming follows `storagePathFor` in `dossier.ts` and `import/batch.ts` — `attachments/<row id>/<safe filename>`. **Three outcomes and only one is a fault**, and `fetchInto` never throws: `stored`; `linked`, a OneDrive or SharePoint reference with nothing in the mailbox to fetch, where the null path is correct and the route's 409 already says "the file is real, this copy is not"; and `failed`, the network or a 403 that after a successful listing is the Exchange permission cache catching up. Keeping those apart is 1.3's whole basis — a job that cannot tell a link from a flaky link retries the link forever — and an attachment that will not download must never cost the message it arrived on. Nothing in this layer logs and there is no column for a per-attachment reason, so the capture audit entry carries the outcome counts and the failing filename with its reason. `size_bytes` becomes the length of the copy held rather than Graph's mail-store figure, which includes encoding. The test runs the real `pollMailbox` against the real database with only the three Graph calls mocked and the real error classes kept (`fetchInto` dispatches on `instanceof`), and removes its own files in teardown — screen 66 reports files no row claims, and a suite that litters the working store makes that report lie. |
| 2026-09-08 | 1.3 | `a951b41` | `src/jobs/` exists — pg-boss was installed, `pnpm worker` declared and compose running `node dist/jobs/worker.js` since before there was anything there to run. Two queues, separate because the retry is: `mailbox.poll` reads the mailbox, `attachment.fetch` pulls one file, and the link dropping on file nine of a dozen must cost file nine, not the message, not the other eleven, not the poll. Each file queues with five tries and exponential backoff from a minute, keyed on its own row so overlapping polls cannot queue it twice. The poll now only NOTICES files; `intake_attachment` gains `external_id` (migration 0055) because a job running ten minutes later has nothing else to ask Graph for, and a reference attachment never becomes a job at all. `src/domain/intake/attachments.ts` fetches and **reports rather than decides** — whether to try again is a queue's business — with five outcomes of which `failed` is the only one the worker throws on: `already` because a queue may deliver twice and re-pulling 12 MB to write identical bytes is not free on this link, `linked`, `gone` for a row whose message was dismissed while the job waited, and a 403 counted as `failed` because after a successful listing it is the permission cache catching up. The worker refuses to retry exactly one thing that reads like a failure — a poll raising `MailboxNotScoped`, which is configuration not weather, and would otherwise fill the queue with the same refusal and tell nobody. **Capture is now on a clock** (`MAILBOX_POLL_CRON`, ten minutes): an ERP that reads the mailbox only when somebody presses a button is a mailbox somebody still has to watch. "Sync now" enqueues that same job and returns; `inbox.synced` ("3 new messages") is deleted from both message files because the count is not knowable at the moment of pressing, replaced by a line saying the mailbox is being read and files appear as they arrive. `intake_attachment` and `fetch` needed words in both languages too — `tests/unit/audit.test.ts` caught that, correctly. The web app starts pg-boss with `supervise` and `schedule` off: two processes share the queue and cron belongs to the worker alone, or every Next server instance is a second scheduler racing the first. `pnpm worker` is now in CLAUDE.md's commands, because in dev it is a second terminal and nothing said so. What the screen still cannot see — queue depth, and an exhausted job — is under Known gaps. |
