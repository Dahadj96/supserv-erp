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
| Worker | `pnpm worker` is what empties the queue: no worker means no mailbox poll and every attachment stuck at "not copied here yet", with nothing on screen saying so. The `SUPSERV worker` scheduled task has run it at startup since 9 September and it polls every ten minutes — read `.data\worker.log` rather than `tasklist`, which cannot see a SYSTEM process from an unelevated session. **It runs `tsx` against the source, so it is only as new as the moment it started**: after changing anything the worker runs, either restart the task (Administrator) or start your own with `start "supserv-worker" /min cmd /c "pnpm worker > .data\worker-<task>.log 2>&1"`, use it, and close it. |
| Reboot | Fixed, 9 September: `SUPSERV ERP`, `SUPSERV worker` and `SUPSERV backup` are all registered and start at boot, so the machine comes back on its own. An unelevated session cannot query them — `schtasks /query` answers "Access is denied" — so read `.data\worker.log` and `.data\last-backup.json` for the truth, not the task list. |
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

- [x] **1.10 · Backfill the attachments that predate the fetcher**
  `enqueue(QUEUES.attachmentFetch, …)` fired only inside `storeOne`
  (`src/domain/intake/mailbox.ts:246`), so only attachments discovered by a
  *new* sync were ever queued. All 38 `intake_attachment` rows were recorded
  before the fetcher existed, so every `storage_path` was null and the viewer
  1.5 built had nothing to show. `pnpm backfill:attachments` now asks — after
  recovering the Graph id each row was missing, because `external_id` arrived
  with 1.3 and a backfill that only queued would have queued 38 jobs that
  stored nothing. **38 queued, 38 stored, 0 failed**, verified byte-for-byte
  against `.data\files`. The worker was covered by no scheduled task at all;
  that is under Known gaps with the one command that fixes it.

- [x] **1.4 · Expand ZIP attachments**
  `src/capture/archive/zip.ts` opens a `dossier.zip` and each file inside it
  becomes an `intake_attachment` row keeping its path in the archive as its
  name, pointing back at the archive through `parent_attachment_id`
  (migration 0056). The archive keeps its own row and its own bytes — a tender
  dossier is evidence, and what was sent is the archive, not our unpacking of
  it. `yauzl` (recorded in `STACK.md`) because it reads the central directory
  first: a declared size is refused before a byte is inflated, and the stream
  is counted as it arrives so a header that lies costs one entry rather than
  the disk. Traversal, nesting and the two size caps are each refused by name
  and written to the audit trail. What is left is under Known gaps.

- [x] **1.5 · View a file inside the ERP**
  `inbox/[id]/page.tsx:196` renders attachments with no anchor at all. Make
  them links, and add a viewer using the pattern already working in
  `documents/[id]/page.tsx:220` — `<object type="application/pdf">`, the
  browser's own viewer, no new dependency. Images already pass `RENDERABLE`.
  Do **not** loosen `RENDERABLE` for HTML or SVG — that is a security
  decision, not an oversight. Add a paperclip indicator to the inbox list row.
  *Done when:* a PDF or image attachment opens inside the ERP without going
  to Outlook.

- [x] **1.6 · Read Word and Excel**
  `src/capture/ocr/office.ts` reads both into the same `TextLayer` the PDF
  path produces, so `intake_page`, `proposeFields` and screen 40's citations
  never learn which reader ran. DOCX through 1.4's zip reader with a new
  `want` filter — only `word/document.xml` is inflated — walked token by
  token so a table keeps its rows and Word's own identifiers stay out. XLSX
  one page per worksheet through `exceljs`. `ingestPdf` became
  `ingestDocument`; `intake_dossier.content_type` (migration 0057) is what
  the files screen now reads instead of asserting `application/pdf`. What a
  "page" means in a Word file, and what is left, are under Known gaps.

- [x] **1.7 · Show the document beside the fields on review**
  The original is now the default view in screen 40's left pane, opened at the
  cited page with the PDF `#page=` fragment; "What was read" is one press away
  and keeps the highlighted sentence. Which view is on screen lives in the URL
  beside the page and the field, so the screen stays a server component and a
  person can send somebody exactly what they were looking at. `previewMode`
  decides drawability — the same function the route uses — so a Word or Excel
  dossier says why it can only be text. Fixed on the way: the "no OCR needed"
  badge matched `provider === "text-layer"` and so called every 1.6 Word file
  partially read.

- [x] **1.8 · Run extraction on attachments automatically**
  A third queue, `dossier.read`. The worker queues a reading after every fetch
  that ends `stored` or `already`, and one for every file that came out of an
  archive — a `dossier.zip` is where a CCTP hides. `readAttachmentIntoDossier`
  reports and does not decide, like the fetcher; only a store that could not
  be read is retried. `ingestDocument` gained an optional `storagePath` so the
  dossier points at the attachment's own bytes instead of keeping a second
  copy of every file the company is ever sent. The reading is linked from the
  message it arrived on, because screen 39's list is a log, not a route.

- [x] **1.11 · One catch-up that brings every stored attachment up to date**
  Every capability in wave 1 runs **on arrival** and nothing applied it to what
  was already stored — one bug that cost three catch-ups in a night: 1.10 for
  the bytes, a throwaway in `.bg/` for the one archive 1.4 never re-opened, and
  nothing at all for the text 1.6 and 1.8 extract. `pnpm backfill:attachments`
  is now the one tool for all three, in the order the stages depend on each
  other — bytes, then archives, then text, because a file inside a zip does not
  exist until stage 2 has written it. Each stage is a no-op on what is already
  done, and stages 2 and 3 call the same `expandArchiveFor` and the same
  `dossier.read` queue the worker calls, so a file caught up here is read by
  exactly the code that reads a file that arrived normally. **Real run: 46 of 46
  already had bytes; the RFQ archive was already open at 8 files; 32 of 46 were
  queued for reading and 31 became reviewable dossiers with page text**, 14
  being kinds nothing here reads (10 images, the .zip, a .pptx, one Word 97
  `.doc`). A second run does nothing, which is the point. The 32nd found a real
  bug and fixed it — a NUL in a PDF's text layer, which Postgres `text` cannot
  hold, losing the whole document to one character nobody typed. The throwaway
  is deleted.

- [ ] **1.9 · Images and scans** *(BLOCKED — waiting on 1.1–1.8 in daily use,
  which needs the build on port 3000 restarted and a worker running against
  the real mailbox. Not a fault; the gate is the queue's own.)*
  `Dockerfile.ocr` and the compose service exist with **no server code**, and
  nothing in `src` calls `OCR_URL`. `sharp` is installed and unused. Build the
  container's server and an HTTP client behind the existing provider
  interface. `docs/OCR.md` has the measurements and the `--psm 3` rule.
  *Done when:* a photographed bordereau produces page text with citations.

## WAVE 2 — the deal knows what it is, and what happens next

- [~] **2.1 · "Make this a tender" on the deal page**
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

- [ ] **2.4a · Nothing is ever proposed — find out why before 2.4**
  *Recorded 9 September 2026 while taking 2.1. Not a guess: measured.*
  The 1.11 catch-up read **31 documents successfully** — page text stored,
  every one reviewable — and **every single one proposed zero fields**. Among
  them are the seven files of a real French RFQ that are full of *caution de
  soumission*, *date limite de dépôt des offres*, *délai de validité* and
  *séance d'ouverture des plis*: the exact six facts `proposeFields` exists to
  find. Thirty-one for thirty-one is not a bad hit rate, it is a wire that is
  not connected.
  Two candidates, and the first thing to do is tell them apart: either the cues
  in `src/capture/extract/` do not match how these documents are actually
  written (French, accented, often across a line break, sometimes in a table
  cell), or nothing calls `proposeFields` on the text that 1.6 and 1.8 store —
  in which case the reading pipeline ends one function short and no cue would
  ever have fired. Start by running `proposeFields` by hand over the stored
  page text of one of those seven files and looking at what comes back.
  *Done when:* it is known which of the two it is, written down here, and a
  real French dossier proposes at least its submission deadline.
  **This is ahead of 2.4 on purpose.** 2.4 carries confirmed fields from the
  review screen onto the deal. If nothing is ever proposed, nothing is ever
  confirmed, and 2.4 ships a road with no traffic on it.

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

### 1.10 — the worker comes back after a reboot now, and one thing about it does not

**Done, 9 September, 02:25.** `install-services.ps1` registered `SUPSERV worker`
beside `SUPSERV ERP` and `SUPSERV backup`; the worker has been up since and has
polled the mailbox every ten minutes, and the backup has run twice and verified
itself — `.data\last-backup.json` says `verified: true`, 68 tables, 714 rows.
The gap this section used to describe — a machine that came back from a reboot
with a web app and no worker, silently — is closed.

**What is left is not registration but the process's age.** A worker started at
02:25 is running the source as it stood at 02:25, and 1.6 landed at 02:31 and
1.8 at 02:49: that process fetches bytes and expands archives and has no
`dossier.read` handler at all, because the queue did not exist when it started.
Nothing already stored is waiting on it — 1.11's catch-up read all of that
through a worker on current source — but a document arriving NOW gets its bytes
and no reading until the worker is restarted, which `restart-erp.cmd` does not
do: that script stops and starts the ERP task and the process on port 3000, and
touches neither the worker nor the tunnel. `Restart-ScheduledTask -TaskName
"SUPSERV worker"` in an **Administrator** PowerShell, or any reboot, is the
whole of it. It is the same restart the build is waiting on, and the same
Administrator prompt.


### 1.10 — the content type is the sender's word, and two files pay for it

Two of the 38 are named `.png` and were declared `application/octet-stream` by
whatever mail client sent them, so `RENDERABLE` will not preview them and screen
40 offers a download instead of the picture. `store()` does not overwrite
`content_type` with what `/$value` returned either, so a fetch cannot correct it.

Deliberately not changed here. `serving.ts` says why in its own words: the
content type on an email attachment was chosen by whoever sent the email, and
the set of types served inline is what stops `text/html` from contact@ running
as script in a signed-in session. Sniffing a type from the bytes, or trusting a
filename extension, is a change to that door — not a fix to a fetcher — and it
belongs with somebody looking at the CSP gap 1.5 measured. Seven of the 38 are
downloads rather than previews for this and related reasons: three .docx, one
.pptx (both wait on 1.6), one .zip (1.4), and these two .png.

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

### 1.6 — a Word file has no pages, and three things that follow from it

**A .docx is one page unless its author forced a break.** Pagination is
something a renderer does; the file records only `<w:br w:type="page"/>`, and
that is what pages are split on. So a forty-page CCTP written without forced
breaks cites every field to "page 1" — true, and much less useful than the PDF
path's page numbers. `<w:lastRenderedPageBreak/>` is Word's cache of where it
last paginated and was deliberately not used: absent in files written by
anything else, stale in a file edited since, so a citation built on it points at
a page the reader does not have. If this ever needs to be better, the honest
route is rendering the .docx to PDF and reading that — which is LibreOffice in a
container, the same shape as the OCR service that is not on this machine yet.

**A .xlsx cites a sheet, and screen 40 says "page".** One worksheet is one
`intake_page`, which is the right unit — it is what a person means by "the
second tab" — but the review screen's word for it is still "page N". The sheet
name is the first line of the page so the citation is findable; a column on
screen 40 that said "sheet" for a workbook and "page" for a PDF would be
better, and is a screen change rather than a reader change.

**Headers and footers are not read.** On an Algerian administrative document
they carry the letterhead and a page number, repeated on every page, and reading
them would drown the extraction in the same six lines over and over. The cost is
that a document whose reference number lives only in its header has that number
nowhere in `intake_page`. Nothing has needed it yet.

**Neither reader can be reached from an attachment.** `ingestDocument` accepts
`messageId` and `attachmentId` and nothing passes them — that is 1.8, unchanged
by this task. Until it ships, a .docx in the mailbox is readable only by
downloading it and uploading it again on screen 39, and screen 40's "no preview
yet" still shows for Office attachments, because `RENDERABLE` is about what a
BROWSER can display in place and neither format is. Extracting text from a file
and rendering it in a frame are different questions; 1.6 answered the first.

### 1.8 — two questions the first real run asked, and one it answered badly

**The attachments already here are read now** — 1.11, which is the `backfill:`
script this section asked for, doing this and 1.4's gap and 1.10's in one pass
because they are one bug. 31 of the 46 files became reviewable dossiers on
9 September. The paragraph that used to be here, about nothing re-reading what
arrived before the reader existed, is answered.

**Everything readable is read, and that is a choice.** A PDF, a .docx or an
.xlsx arriving on any message becomes a dossier, whether or not it looks like a
tender. The narrower rule was available — `looks_like = 'tender_dossier'`, or
the message's own classification — and was not taken: the classifier reads a
filename, a CCTP is often called `CPS.pdf`, and a dossier that proposes nothing
costs a row and says so on screen 39 ("Nothing was read from this document that
matches a field we know how to check"), while a dossier that was never made
costs a deadline nobody saw. What it will look like after a week of real mail is
a list on screen 39 with a lot of invoices and CVs in it. If that list becomes
the problem, the fix is a filter on the screen, not a narrower reader — the page
text is worth having either way, because it is what makes an attachment
searchable.

**A re-read has no route, and there is now one real file waiting on it.**
`readAttachmentIntoDossier` answers `already` once a dossier points at the
attachment, which is what stops a redelivered job making two. It also means a
file whose reading failed can never be read again without deleting a row by
hand. **`CV_Boudeba_Mohamed_Aide_Soignant_ATS.pdf` is that file**: its text
layer carries a NUL, the page insert was refused by Postgres, and its dossier
row is stuck at `reading` with no pages. 1.11 fixed the cause — `stripUnstorable`
in `text-layer.ts` — so no file will do this again, but that row is already
written and stage 3 will answer `already` for it for ever. It is one CV, and it
is the cheapest possible demonstration of why this screen is wanted. The honest
fix is a "read it again" on screen 39 beside the failed row, which is the same
missing row as the exhausted-fetch retry 1.3 wrote down and 1.5 unblocked. Four
different tasks now want that one screen.

### 1.4 — the archive already here is open, and what is still true about the caps

**Done in 1.11.** Expansion runs in the worker straight after a fetch, so an
archive whose bytes arrived before that existed was never opened — on this
database, the one .zip, which 1.10's own backfill had fetched an hour earlier.
`backfill:attachments` stage 2 now walks every stored top-level attachment
through `expandArchiveFor`, whose own guards make that safe; the RFQ dossier
came out as its 8 files on 9 September. It was written off here as "a loop, not
a mechanism" and not worth a script for one row, which was wrong twice over —
the same gap existed for text at the same moment, and a catch-up nobody writes
is a catch-up somebody does by hand in `.bg/` at three in the morning.

**The caps are numbers, not a policy.** 512 files, 100 MB an entry, 400 MB an
archive, chosen against the largest real dossier anybody has sent SUPSERV.
Nothing on any screen says an archive was refused for being too large: the
reason is in the audit trail and the files simply are not listed. When somebody
first meets a refused dossier, that silence is the thing to fix — the row on
screen 60 that names an exhausted fetch is the same row, and both are waiting on
somewhere to sit.

**Word and Excel inside an archive are still not readable**, and neither is a
nested zip. They become rows with bytes and no preview, which is 1.6's business.
The extension → content type table in `src/domain/intake/archive.ts` is the only
place in this repository that infers a type, and it deliberately maps into a
*subset* of `RENDERABLE`: never `text/html`, never `image/svg+xml`. If 1.6 or a
later task widens it, that is a change to the same door `serving.ts` guards, and
it wants reading first.

### 1.11 — what the catch-up does not do, and the fields nobody proposed

**It queues; the worker reads.** Stages 1 and 3 put jobs on a queue, so their
counts are a promise until `pnpm worker` has emptied it — the script says so,
and a second run is what turns the promise into `already`. Stage 2 is the
exception and unpacks as it runs, because that is local work on bytes already
here. A database whose attachments have no bytes yet therefore needs two runs to
converge, and nothing is lost in between: the worker expands and reads whatever
it fetches, on the normal path.

**31 documents were read and not one field was proposed.** Every dossier on
screen 39 says "nothing was read from this document that matches a field we know
how to check", and for most of them that is the honest answer rather than a
fault: the majority are CVs, invoices, catalogues and company profiles, and
`proposeFields` looks for a submission deadline, an opening session, a bid bond
and three other things that appear in a règlement de consultation and nowhere
else. The seven readable files of the RFQ dossier are the real test of that, and
they proposed nothing either — worth reading once against the documents
themselves, on screen 40, before deciding whether the rules or the documents are the surprise. It is the first
time this reader has ever met an Algerian tender it did not have a fixture for.

**The `.doc` and the `.pptx` are not read, and that is a decision, not a bug.**
One of the 8 files in the RFQ dossier — `D_..._ExigencesTechnique.doc` — is a
Word 97 binary, a format nothing here reads and no free library reads well; the
`.pptx` in the mailbox is a supplier's slide deck. Both are stored, both
download, both say what they are. Widening the readers is a task with a
dependency, not a line.

### 1.5 — the route's CSP never reaches the browser, and three smaller things

**`/api/files/[id]` sets a Content-Security-Policy that is thrown away.** The
route sends `default-src 'none'; sandbox`; `next.config.ts` applies
`Content-Security-Policy: frame-ancestors 'self'` to `/(.*)`, and a header from
Next's `headers()` REPLACES the one a route handler set. Measured on a running
build on 9 September 2026: the only CSP on an attachment response is
`frame-ancestors 'self'`. The same is true of `/api/documents/[id]/pdf`, which
sets none of its own.

This is not an open door. What actually keeps a `text/html` attachment from
running with the Gérant's session is `RENDERABLE` forcing it to
`application/octet-stream` with `content-disposition: attachment`, plus
`x-content-type-options: nosniff` — both still there, both tested. What is
missing is the second lock `serving.ts` claimed, and the comment now says so
rather than claiming it. Left for its own commit because making a route's CSP
survive means changing a config every response in the application passes
through, and because the fix has a choice inside it: per-route `headers()`
entries, or setting the header in the route and removing `/(.*)` from the
blanket. Worth knowing before then: `default-src 'none'; sandbox` was measured
against a real Chrome during 1.5 and does NOT stop the PDF viewer, so the
obvious fear about restoring it is unfounded.

**An attachment nobody typed a content type for gets no preview.** `previewMode`
reads the declared type and refuses to guess from the extension. Two of the 38
rows in the mailbox today are PNGs whose sender's mail client declared
`application/octet-stream`, so they download rather than open. A narrow fix is
available and was deliberately not taken in 1.5: fall back to the extension
ONLY when the declared type is empty or `application/octet-stream` — never
upgrading an explicit claim, so `text/html` and `image/svg+xml` stay downloads —
and only onto types already in `RENDERABLE`. With `nosniff` set, a file that
lies about its extension renders as a broken image rather than as anything. It
was left out because it widens a security-shaped function for two files, and
because every PDF in the mailbox is correctly typed, which is the case that
matters.

**Nothing retries an attachment whose job gave up** — 1.3 wrote that down and
said the button wanted 1.5's viewer to exist first so it would have somewhere
to sit. It exists now. The row on screen 60 that says which fetches are
exhausted, and a "try again", is unblocked.

**A .docx, a .xlsx and a .zip say "no preview yet".** That is 1.6 and 1.4, and
the words on screen name the state rather than pretending.

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

### Wave 1 is written and nobody has seen it work (1.4–1.8, and 1.11)

Six tasks shipped on 9 September and **none of them is live**. Port 3000 still
serves the build from before 1.4: a commit is not a deployment. `pnpm build` has
been run and succeeded, so the only thing left needs Abdou's own machine and
Administrator, which a scheduled run cannot answer.

**Double-click `restart-erp.cmd`** in `C:\SUPSERV-ERP` and say yes to the
prompt. Then `pnpm smoke`. Nothing from 1.4 to 1.8 is visible until this
happens.

That is the whole list. What used to be the second item here — "start a worker,
nothing schedules one" — was true when it was written and is not now: `SUPSERV
worker` was registered at 02:25 on 9 September beside `SUPSERV ERP` and `SUPSERV
backup`, the worker has been up and polling every ten minutes since, and the
backup has run twice and verified itself (`.data\last-backup.json`:
`verified: true`, 68 tables, 714 rows). One thing about that worker is still
outstanding and it is the same restart — the running process started before 1.6
and 1.8 landed, so it reads no documents until it is restarted, and
`restart-erp.cmd` does not restart it. `Restart-ScheduledTask -TaskName "SUPSERV
worker"`, in the same Administrator window, or a reboot. Under Known gaps.

Every attachment ALREADY in this database is caught up and waiting for that
build: 46 files with bytes, the one archive expanded into its 8 files, and 31
documents read into reviewable dossiers with their page text (1.11). So the
restart is not the beginning of the acceptance test — it is the end of it. What
Abdou sees on screen 39 the moment the new build answers is a list of 31 read
documents, and screen 40 shows each of them beside the file it was read from.

A real message with a `dossier.zip` or a `.docx` arriving afterwards is what
proves the automatic path as well as the catch-up: the files inside the archive
appear on the message, each openable; a CCTP is read without anybody uploading
it; and the deadline it proposes is checked against the document itself on
screen 40, not against our transcription of it.

**This is also what unblocks 1.9.** That task says in its own words not to start
until 1.1–1.8 are in daily use, and "daily use" cannot begin until the restart
above. It is marked blocked rather than skipped.


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
| 2026-09-09 | 1.10 | `72124f3` | The 38 attachments that predate the fetcher have bytes. `enqueue(QUEUES.attachmentFetch)` fired in exactly one place — `storeOne`, as a message is stored — so only files a NEW sync discovered were ever queued, and every row in this database predates that: 38 rows, every `storage_path` null, nothing that would ever ask. `pnpm backfill:attachments` (`--dry-run` to look first) asks. **It could not have been a loop over `enqueue`, and that is the finding**: `external_id` arrived with 1.3 (migration 0055), so on all 38 it was NULL and `fetchAttachmentFor` answers `gone / noGraphId` without spending a request — a backfill that only queued would have queued 38 jobs, stored nothing, and looked like it worked. So each message is listed once, live, and its rows are matched back to what the mailbox still holds. That listing is also the **only** place a reference attachment can be recognised: `intake_attachment` has no `@odata.type` column, so a stored row genuinely cannot say whether it is a OneDrive link, and guessing from a null content type would be inventing a fact about somebody's mail. Graph does send the annotation despite `$select` not naming it — 38 of 38 carried it, none was a reference — and the script prints that ratio either way, because if it ever stopped the only thing left to catch a link would be the 405. `matchToListing` narrows three times (the id we hold, then name AND size, then name alone), claims each entry once, and **refuses to guess**: two candidates is a coin toss, so the row is left unmatched and reported, because the failure mode is not a missing file but the wrong file behind a name on screen 40. Queue options moved to `attachmentFetchOptions` and both callers use it — the poll and the backfill must key the job identically or a backfill during a poll fetches the same 12 MB twice. Each recovered id is an audit entry (`intake_attachment` / `backfill`, both languages). **Real run against the real database with a worker up: 38 queued, 38 stored, 0 failed**, and verified rather than believed — every path non-null, all 38 files on disk under `.data\files\attachments\`, each one's length and SHA-256 recomputed from disk against its row, 19,178,730 bytes, no mismatch; 38 `fetch` audit entries, all `stored`. **The worker was covered by no scheduled task at all** — the installer registered the ERP and the backup and nothing else — so a reboot has always brought back a web app that looks healthy and has silently stopped capturing. `run-worker.ps1` is written (SYSTEM has no `pnpm`, so node is invoked machine-wide against an absolute path, and it waits ten minutes for Docker's Postgres like `run-erp.ps1`) and the installer now registers `SUPSERV worker`, but **registering it needs Administrator and is Abdou's to run** — the single command is in RUNBOOK section 3 and under Known gaps. Tonight's worker is a console window. |
| 2026-09-09 | 1.5 | `c8580b4` | An attachment opens inside the ERP. `FileViewer` (`src/components/ui/file-viewer.tsx`) is screen 18's `<object type="application/pdf">` lifted out of the document page so the mailbox and screen 60 share one — no new dependency, three modes (object for a PDF, `img` for a picture, iframe for plain text). **Which file is open lives in the URL** (`?file=<id>`): both screens stay server components, a message with fifteen attachments renders one viewer and not fifteen, and the address of a particular file is something one person can send another. `previewMode()` sits beside `contentHeaders()` and is DERIVED from `RENDERABLE` rather than being a second list — a screen whose set were wider than the route's would offer a Show that downloads the file, so a test asserts the containment. `RENDERABLE` untouched: HTML and SVG stay downloads, Office files say "no preview yet" until 1.6. **The stale copy is corrected** — "in Outlook only" stopped being true the day 1.2 shipped, so a row with no bytes now says "not copied here yet" and the list says once that copies arrive in the background. The inbox list gains a paperclip and a count, by correlated subquery rather than a join. A read dossier declares `application/pdf` (its only writer puts it with that mime) so it opens inline too — unless the read failed, because that usually means it was not a PDF. **Verified against a real build in a real Chrome**, not assumed: a throwaway harness seeded four attachments in the TEST database and TEST file store, minted a gérant session, and photographed both locales — the PDF renders, the PNG decodes, the route answers 200 `application/pdf` `inline` and the bytes begin `%PDF-`. Headless Chromium has no PDF viewer and always shows the fallback, so the assertion is that the fallback is NOT visible. **No attachment in the application database has bytes yet** — 38 rows, every `storage_path` null, because no sync has run with a worker since 1.3. What the viewer does is correct and Abdou will see "not copied here yet" on all 38 until `pnpm worker` runs against a sync. The CSP measurement and three smaller gaps are under Known gaps. |
| 2026-09-09 | 1.4 | `b9e2114` | A `dossier.zip` becomes files a person can read. `src/capture/archive/zip.ts` treats the archive as hostile throughout — it was written by whoever emailed us — and `yauzl` was chosen over a one-call unzip for one reason: `lazyEntries` reads the central directory first, so an entry's declared size is refused BEFORE a byte is inflated, and each stream is counted as it arrives, so a header that lies costs one entry rather than the disk. A library that returns a map of decompressed buffers has already spent the disk by the time you could check. Caps are 512 files, 100 MB an entry, 400 MB an archive. **`decodeStrings: false` is the finding the tests produced**: with names decoded yauzl validates them itself and errors on the WHOLE archive the moment it meets `../../.env` — safe, and the wrong answer, because one hostile name would cost every honest file in a dossier and the person who needed the bordereau would be told only that the archive was refused. Names come back as bytes and `safeEntryPath` refuses that one entry, mirroring `safeJoin` in `src/storage/local.ts` but one step earlier, at the name, and **refusing rather than repairing** — quietly turning `../../.env` into `.env` keeps the file and loses the warning. **The archive is never touched**: it keeps its row, its name and its bytes, and the files inside become rows beside it through `parent_attachment_id` (migration 0056, one additive column), which is also the guard against unpacking twice — a queue may deliver a job twice — and against a second level, since a row that HAS a parent is never opened. A nested zip is stored and not opened, and keeps its bytes so it can still be downloaded; that is where a zip quine wins. Each child carries its path inside the archive as its name, because on a dossier that structure is most of what the sender meant, and a null `external_id`, because an unpacked file was never in the mailbox and nothing must ever ask Graph for it. **The content type is the one thing this infers**, and it overrides nobody: a zip has no field for one, so the extension is the only source there is — mapped into a *subset* of `RENDERABLE`, never `text/html` or `image/svg+xml`, which is the door that set exists to hold shut. Expansion runs in the worker after the fetch rather than inside `fetchAttachmentFor`, for the same reason the fetch reports rather than decides: unpacking is local work on bytes already here and every way it can fail is terminal, so failing the job would pull 12 MB over the fibre again to be refused again, five times. The inbox paperclip counts what the MESSAGE carried, so a zip counts once; the message screen lists what came out of it, indented, with a count. `tests/unit/zip-attachment.test.ts` builds its archives by hand — no zip tool a person would use produces a traversing name, a directory that understates a file by three orders of magnitude, or an archive holding an archive — and it found both bugs above; `tests/integration/archive-expand.test.ts` proves the writing half against the real database and the real store. What is left, including the one .zip already in this mailbox that no job will re-open, is under Known gaps. |
| 2026-09-09 | 1.6 | `5de9fa6` | Word and Excel are read. Both come back as the SAME `TextLayer` the PDF path produces, which is the whole design: `intake_page`, `proposeFields`, screen 40 and its citations never learn which reader ran. DOCX through 1.4s zip reader, given a `want` filter so only `word/document.xml` is inflated and a 40 MB file s images are stepped over rather than read into memory to find one part — not wanted is not refused. The body is walked token by token rather than tag-stripped, because only `<w:t>` holds text a person typed and a blanket strip pulls formatting, revision history and Word s own identifiers in as content; `</w:tc>` is a column and `</w:p>` a line, so a bordereau written in Word comes out row by row, which is the only form in which it means anything. **Pages are the honest problem**: a .docx has none, so it is split on the breaks the AUTHOR forced and a file with none is one page — `<w:lastRenderedPageBreak/>` is Word s cache of its own pagination, absent elsewhere and stale after an edit, so a citation built on it would point at a page the reader does not have. XLSX is one page per worksheet through `exceljs` (already a dependency), the sheet name leading its page so a citation is findable, and a formula giving its RESULT rather than `=SUM(B2:B14)`. `ingestPdf` became `ingestDocument` — one path, three kinds — and a kind nothing can read writes no row and stores no bytes, because a file this cannot read is not a dossier that failed, it is a file that was never a dossier. `intake_dossier.content_type` (migration 0057) carries the other half: `dossierFiles()` asserted `application/pdf` for every dossier on the true-at-the-time grounds that one writer put it there, and that claim moved onto the row rather than staying in a reader repeating it. Screen 39 takes the three kinds and says what a page means for each; the scan folder is deliberately not widened. Tests build a .docx part by part and a workbook with exceljs — the table, the forced break, revision marks, entities, the formula result, both refusals — and prove the ingest over the real database. What a page means in Word, what is not read, and the fact that no attachment reaches this yet (1.8) are under Known gaps. |
| 2026-09-09 | 1.7 | `d339e9c` | The document itself, beside the fields. Screen 40 showed `intake_page.text` and treated it as the source; it is not — it is what a reader made of the source, and confirming a deadline against our own transcription proves only that the transcription is self-consistent. The original now fills the same pane, opened at the cited page through `#page=N`, the fragment every browser PDF viewer understands, with the frame keyed on the page because the same element with a new fragment is not guaranteed to move. It is the DEFAULT whenever the browser can draw the file, because that is the check LAW 2 asks for; What was read stays one press away and keeps the highlighted sentence, which is the thing text is better at. The choice lives in the URL beside the page and the field, so the screen stays a server component and a person can send somebody exactly what they were looking at. **`previewMode` decides drawability, not this screen** — the same function the serving route uses, so screen 40 can never offer a preview that arrives as a download: a Word or Excel dossier (1.6) is read but drawn by no browser, a dossier whose bytes are gone has nothing to draw, and each says which rather than leaving the tabs off unexplained. `loadReview` carries `storage_path` and `content_type` for that decision; `FileViewer` gained `chrome="none"` so the document sits in the pane whose tabs chose it instead of a second box repeating the filename. **A bug found on the way**: the no-OCR-needed badge matched `provider === "text-layer"`, so every Word file 1.6 read perfectly was labelled Partially read — it now matches the `-partial` suffix, which is what the badge was always about. Tests hold the contract rather than the layout: a PDF dossier has a path and a drawable type, its deadline cites a page inside the document the frame will open, the bytes sit behind `inbox.view` (this is the first frame pointed at that route), and a Word dossier is the case that must fall back to text. **Not seen in a browser**: port 3000 still serves the build from before 1.4, and the restart needs Administrator. |
| 2026-09-09 | 1.8 | `d542bab` | A tender dossier that arrives by email is read without anybody uploading it. `ingestDocument` had accepted `messageId` and `attachmentId` since it was written, `intake_dossier` had carried both foreign keys, and nothing ever passed them — so the only way a CCTP was ever read was to download it from Outlook and upload it again on screen 39, which is the shape of the whole complaint wave 1 answers. A third queue, `dossier.read`, because the work differs in kind: fetching is the network and worth five tries over an hour, reading is this machine s CPU on bytes already here and a corrupt PDF will not be less corrupt in ten minutes — two tries, enough to survive a database restart and not enough to grind on a bad file all afternoon. The worker queues a reading after every fetch ending `stored` or `already`, and one for every file that came out of an archive, because a `dossier.zip` is precisely where a CCTP hides; `expandArchiveFor` returns the ids it made rather than queueing them, since whether a new row deserves a job is the worker s business. `readAttachmentIntoDossier` reports and does not decide, like the fetcher: six outcomes and only `failed` retried, because `notReadable` is an image or an archive and will never become readable and `noBytes` has nothing to read. **One copy of the bytes** — `ingestDocument` gained an optional `storagePath`, because the fetcher put this file in the working store ten minutes ago and a second copy of every dossier the company is ever sent, on a mini PC, buys nothing; two rows claiming one file is not a lie, and screen 66 looks for the opposite. **The reading is reachable from the mail**: screen 39 s Read so far is a log, not a route, and an extraction nobody can reach from the message it arrived on is one nobody knows happened — found by a second query rather than a join, which would multiply the file list the day an attachment has two readings. Tests run the real reader over the real database: both foreign keys written, the deadline proposed and not confirmed (LAW 2), the bytes not duplicated, the link present, a redelivered job reading nothing twice, and the image, the copy-less row and the dismissed row each answered separately. The 38 attachments already here are read by nothing yet — under Known gaps with 1.4 s twin. |
| 2026-09-09 | 1.11 | `d6e5fd3` | One catch-up, because it was one bug three times. Every capability in wave 1 fires ON ARRIVAL — the fetcher as a message is stored, expansion after a fetch, reading after an expansion — so the whole chain hangs off a file being NEW and nothing in it ever revisits a row that was already there. That cost 1.10 for the bytes, a throwaway in `.bg/` for the single archive whose bytes 1.10 itself had delivered an hour earlier (so no fetch would ever ask again, so it was never opened), and nothing at all for the text. `pnpm backfill:attachments` is now all three, in the order they depend on each other: bytes, archives, text — **the order is the design**, since a file inside `dossier.zip` is where the CCTP is and its row does not exist until stage 2 writes it, so a text stage running first would skip exactly the files this wave exists for. **It reuses the worker's paths rather than repeating them**: stage 2 calls the same `expandArchiveFor`, stage 3 puts the same job on the same `dossier.read` queue with the same options, retries and all — a second reading path would be a second thing to keep true. Every stage is a no-op on what is done (`expandArchiveFor`'s own guards, a dossier that already points at the row, pg-boss's singleton key), so it is safe to run repeatedly, and the report's four buckets add up to everything the stage looked at because a summary that does not account for every row can hide one. **Real run, real database, worker up: bytes 46 of 46 already stored; archives 38 top-level considered, 37 not archives, 1 already expanded; text 46 considered including the 8 files out of the archive — 32 queued, 14 unreadable kinds, 31 read into reviewable dossiers with page text. A second run: nothing to do, everywhere.** Zero fields proposed on all 31, which is honest for a mailbox of CVs and invoices and is the first thing to check on screen 40 for the seven RFQ files. **The 32nd is a bug this found**: `CV_Boudeba_Mohamed_Aide_Soignant_ATS.pdf` has a font mapping with no glyph for a character, so pdf.js returns U+0000 and Postgres `text` cannot hold one — the page insert was refused (22P05), which cost the whole document, and pg-boss then could not record the failure because the error quotes the text. `stripUnstorable` takes it out at the reader, removed rather than replaced because a NUL is the absence of a character and a U+FFFD would show a person a mark for something the document never said. That row is stuck at `reading` and stage 3 will answer `already` for it for ever — the fourth task now wanting the "read it again" row on screen 39. The queue's stale note is corrected: `SUPSERV worker` was registered at 02:25 beside the ERP and the backup, the worker has polled every ten minutes since, the backup has run twice and verified (68 tables, 714 rows) — and what is left is the restart, in two places, because the worker process started before 1.6 and 1.8 landed and `restart-erp.cmd` does not restart it. |
