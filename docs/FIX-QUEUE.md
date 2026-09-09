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
   **WAVE U OUTRANKS EVERYTHING.** Added 9 September from Abdou directly: the
   ERP is powerful and nobody can tell what it does. Take Wave U before the
   rest of Wave 2 and before Wave 3, whatever the numbering suggests.
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

- [x] **2.1 · "Make this a tender" on the deal page**
  `makeTender()` (`src/domain/tender/store.ts:235`) is written, transactional,
  guarded and tested, with zero callers outside `tests/`. Add a server action
  and a form on the deal page: `procedure` (the five values already exist),
  place of deposit, opening date, bid bond. Add `unmakeTender` so a wrong
  call is reversible — it must refuse once anything has been submitted.
  *Done when:* an enquiry becomes a tender in one press, appears on
  `/tenders` with its folder seeded, and can be turned back.

- [x] **2.2 · Show the tender on the deal**
  `deals/[id]/page.tsx` contains the word "tender" zero times. Add a badge, a
  link to `/tenders/[id]`, a link to `/tenders/[id]/bpu` (reachable from
  nowhere today), and the folder percentage from the existing pure
  `dossier()`. Also link `/deals/[id]/items`, which is orphaned.
  *Done when:* nothing about a tender is reachable only by typing a URL.

- [x] **2.3 · Suggest the conversion**
  `tenderHint()` reads all four signals off one message and returns a reading:
  which fired, and whether they add up. The two strong ones — the subject
  naming a procedure, an attachment the sender called a dossier — each carry
  it alone, because each is somebody else's word rather than our inference.
  The two weak ones — an archive, four files or more — carry it only together:
  a zip by itself is a supplier's photographs as often as a dossier. The
  procedure words are read off the seeded tender rule rather than retyped, and
  a test walks that rule's own list so the two cannot drift. It writes nothing
  and never reclassifies on its own; the panel prints every signal that fired
  so a person can disagree with one of them rather than with the machine, and
  the button is the same reclassify the select box above it performs. What was
  deliberately left out is under Known gaps.

- [x] **2.4a · Nothing is ever proposed — find out why before 2.4**
  **Answered, 9 September. It is the cues, and the wire is fine — but neither
  candidate was right about WHY.** `ingestDocument` calls `proposeFields` on
  the pages it just read and inserts every proposal into `extraction_field`
  (`dossier.ts:170`), so the pipeline does not end a function short. Running
  `proposeFields` by hand over the page text stored for all 32 read dossiers
  reproduced the same answer exactly: **0 fields**. The line-break theory was
  measured and is also wrong — every cue was searched again with the whole
  document's whitespace collapsed to single spaces, and not one cue appeared
  that had not appeared already. The full finding, the two files that do carry
  a cue, and what was changed, are under Known gaps.
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

- [x] **2.4b · A cue in a heading must reach the value under it**
  A window of **two lines**, measured rather than chosen: the rate is eleven
  lines below its heading, but clause 13.3 ends "…paiera au CLIENT des
  pénalités de" and the next line opens "retard comme suit : 1 % par jour", so
  the cue fires again beside the value and what is crossed is a line break
  rather than a paragraph. The citation follows the VALUE — a citation pointing
  at a heading is a field nobody can check — while `articleAbove` still names
  the article, and the `readBelowCue` caveat costs 0.15 confidence so it can
  never auto-confirm. Two guards, both from real text: dot leaders mean a table
  of contents and are never read below, and a heading plus the clause under it
  that restates the value are one reading arrived at twice rather than two
  candidates. **Over the 32 stored dossiers: 1 proposal → 2, and nothing else
  on the database gained anything.** Details under Known gaps.
  *Found by 2.4a on 9 September, measured, not guessed. Full evidence under
  Known gaps.*
  `proposeFields` only looks for a value inside the cue's OWN sentence, so a
  document that puts the label on one line and the fact on the next proposes
  nothing. `F_RFQ-…_Projet de Contrat.pdf` is the proof on this database:
  "ARTICLE 13 – PENALITES DE RETARD" is a heading, and *"1 % par jour du
  montant total du bon de commande, jusqu'à un maximum"* is four lines below
  it. That layout is not a quirk of one file — it is how every numbered French
  administrative document is written, a public règlement de consultation
  included, so this costs more than one field the first time a real marché
  arrives.
  Give a rule a small window: when the cue's own sentence yields nothing, read
  the next few lines, and **cite the line the value actually came from** with a
  caveat saying it was read below the cue — a citation that points at the
  heading would be a field a person cannot check, which is the one thing screen
  40 may not do. Two things to get right: the table of contents (the same
  heading appears there with dot leaders and a page number, and must not
  produce a proposal), and the window's size, which decides the false-positive
  rate and is therefore a measurement rather than a preference.
  *Done when:* `F_RFQ-…_Projet de Contrat.pdf` proposes its late penalty with a
  citation on the line that states it; the run over all 32 stored dossiers is
  repeated and the count of NEW proposals on documents that are not tenders is
  reported here; and no document that proposed nothing before proposes
  something wrong now.

- [x] **2.4 · Confirmed extractions reach the deal**
  `intake_dossier.deal_id` (migration 0058) and `commitDossierToDeal`. LAW 2
  governs the whole module: it reads `status IN (confirmed, corrected) AND
  confirmed_at IS NOT NULL` and nothing else, and a test proves a dossier of
  proposed rows leaves the deal untouched. `offerValidity` writes BOTH
  `deal.required_validity_days` and `tender.offer_validity_days`, because one
  screen reads each. Three refusals rather than guesses — a column that already
  has a value is reported, not overwritten; the tender fields are skipped on a
  deal that is not one rather than failing the whole carry; and a validity in
  months is refused rather than multiplied by thirty. On screen 40 the deal is
  not picked from a list: `intake_message.committed_entity` already holds it.
  Gated on `offers.issue`, the same permission 2.1 chose. What it does not do
  is under Known gaps.
  `intake_dossier` has no `deal_id`, so six confirmed fields — submission
  deadline, opening session, place of deposit, bid bond, offer validity, late
  penalty — land in `extraction_field` and stop. Add the column and a
  `commitDossierToDeal` mapping them onto `deal.*` and `tender.*`. Only
  `confirmed_at IS NOT NULL` rows may be read (LAW 2).
  *Done when:* confirming the deadline on the review screen sets it on the
  deal, and `deal.requiredValidityDays` / `requiredDeliveryDays` /
  `latePenalty` finally have a writer, so the silent checks in
  `sourcing-store.ts:268` and `offer/submit.ts:120` start firing.

- [x] **2.4c · The seventh field: how long the client gives us to deliver**
  `deliveryTime` is the seventh key, with its own rule, kept apart from
  `offerValidity` in the VOCABULARY rather than in a rule ordering somebody
  could break — *validité* and *livraison* are different words. The rule reads
  a number and a person confirms the meaning, because "inférieur ou égal à 15
  jours" and "à partir de 15 jours" are opposite claims in nearly the same
  words. Weeks are converted and months are still refused: a week is seven days
  everywhere and always, which is exactly what a month is not. **Over the 32
  stored dossiers: 2 proposals → 3**, the new one cited to the line that states
  it, and nothing else on the database gained anything. The extract test that
  asserted nothing was read from that clause is now the boundary between the
  two rules — it was true, and it was only half the point.
  *Found by 2.4 on 9 September. `deal.required_delivery_days` is the one column
  2.4's done-when named that still has no writer, and the reason is upstream:
  `FIELD_KEYS` has six entries and none of them is a delivery time, so nothing
  ever proposes one.*
  Add `deliveryTime` to `FIELD_KEYS` and a rule for it, then map it onto
  `deal.requiredDeliveryDays` in `commitDossierToDeal` beside the other six.
  The real RFQ states it in 2.4b's exact shape — `C_RFQ-…
  _EtenduedesFournitures_.pdf` page 3, *"5 DELAI DE LIVRAISON"* over *"Ce délai
  devra être inférieur ou égal à 15 jours"* — so the heading window already
  built should reach it with no new mechanism.
  Two things to be careful of. The cue must not collide with `offerValidity`:
  both end in a count of days and `extract.test.ts` already pins that a
  delivery clause must NOT propose a validity, so that test becomes the
  boundary between the two rules rather than an assertion that nothing is read.
  And *"inférieur ou égal à 15 jours"* is a MAXIMUM the client sets, which is
  what `requiredDeliveryDays` means — but a document that says "livraison sous
  15 jours" is stating the same thing and one that says "à partir de 15 jours"
  is not, so the rule reads the number and the person confirms the meaning.
  New keys need `review.field.*` in both message files, and screen 40's label
  list is what a person sees.
  *Done when:* that file proposes its delivery time, a confirmed one lands on
  `deal.required_delivery_days`, the check in `sourcing-store.ts:268` fires for
  the first time, and the run over all 32 stored dossiers reports how many
  documents gained a proposal they should not have.

- [x] **2.5 · A next-step panel on the deal**
  `dealChecks` returns `submitChecks`' shape and imports `CheckState` rather
  than redeclaring it, so screens 12, 18 and 06 cannot drift into meaning
  different things by the same four names. The order is the run itself and
  `nextStep` takes a blocker before a warning before a note. LAW 1: computed
  from `DealFacts` and four columns the page already holds, with no new query
  and no column. Asking suppliers warns rather than blocks; waiting on the
  client is a note rather than a failure; a closed deal gets one line saying
  how it ended rather than a list of everything it never did. Two checks
  carry no link on purpose — see Known gaps.
  Eight cards render at once with no order. `submitChecks` in
  `src/domain/offer/submit.ts` already returns the right shape —
  `{ key, state: pass|warn|block|note, detail, fixHref }`. Write
  `dealChecks(facts)` returning the same type over `DealFacts`, which
  `getDeal` already computes on every load, and render it with the same
  markup at the top of the right column.
  *Done when:* the deal page always names the next thing to do, with a link
  that lands on the field or screen that does it.

- [x] **2.6 · Generalise the `/setup` stepper to the two weekly workflows**
  One `Stepper` (`src/components/ui/stepper.tsx`), shared by screens 85, 06 and
  08 so the three cannot drift into three ideas of what a step is. The enquiry
  half is **not a second panel**: `dealChecks` grew the two rungs the run named
  and the checks did not carry — **prices in** (`price_quote`, on `DealFacts`,
  not `suppliersAsked` under another name: a price given over a counter is a
  price and nobody was asked for it) and the **bon de livraison** (a note, not a
  warning: a service has nothing to deliver). Neither joins `stageOf`, and two
  tests pin that refusal. The tender half is `tenderSteps` — folder → BPU priced
  → caution → submitted — with the bond appearing only when the cahier des
  charges asked for one, and a deposited tender reading as finished rather than
  as a list of failures. `NO_COUNTS` replaces four copies of the same literal.
  What is still open is under Known gaps.
  `/setup` (screen 85) is the pattern that works: numbered computed steps,
  blocking ones with a filled badge and a primary button, done ones with a
  green badge and no button, a banner naming what is missing. Apply it to the
  enquiry run (items → suppliers asked → prices in → offer issued → order →
  BL → facture) and the tender run (folder pieces → BPU priced → caution →
  submitted). Both are computable from rows that already exist, exactly as
  `setupState()` is. **Do not store progress** — LAW 1.
  *Done when:* both runs show where they are without anyone ticking anything.
  **READ THIS BEFORE STARTING — 2.5 changed what this task is.** Screen 06 now
  has a next-step panel (`dealChecks`, task 2.5) which already computes most of
  the enquiry run from `DealFacts` and renders it with a state badge per step
  and one primary button. Adding a second panel beside it would put two lists
  about the same run on one screen, and that is the clutter this wave exists to
  remove. The enquiry half of 2.6 is therefore **not a new panel** — it is
  turning the one that is there into the numbered stepper `/setup` uses, on the
  foundation 2.5 laid: number the steps, give the first unfinished one the
  primary button it already has, and add the two the checks do not carry —
  **prices in** (a `price_quote` count, which means adding it to `DealFacts`
  rather than querying from the page; see the 2.5 note under Known gaps) and
  **bon de livraison issued**. `dealChecks` should grow those two steps rather
  than a second module growing a parallel list.
  The tender half has no conflict and nothing on screen today: `/tenders/[id]`
  has no stepper and no actions at all, so folder pieces → BPU priced → caution
  → submitted is new work there. It overlaps 2.7, which gives that same page
  its forms — worth doing the two together, or 2.7 first, since a stepper whose
  steps have no buttons is a list of things you cannot do.

- [x] **2.7 · Give the tender page its actions** *(taken before 2.6 on 2.6's own
  instruction: "worth doing the two together, or 2.7 first, since a stepper
  whose steps have no buttons is a list of things you cannot do." 2.6 was
  untouched and is the next task.)*
  Five forms on screen 08, and the one that mattered is `saveCredential`:
  `pieceState` returns `missing` while the company paper behind a piece has no
  scan ON FILE, so nine of the nineteen rows a new tender seeds could go red
  and stay red with nothing in the ERP able to file one. The form is on the red
  row rather than behind a link — the person who finds out that the CASNOS
  attestation expires four days before the deposit is the person holding the
  folder. Filing a scan needed somewhere to put it, so `company_credential`
  gains `file_name` / `file_type` (migration 0059) and `credential` is the
  fifth kind in `FILE_KINDS`, keyed on the credential KEY rather than a uuid so
  a link keeps resolving to whatever is current. Two permissions, not one:
  the four presses about THIS tender are `offers.issue` like screen 06's
  conversion, and filing a company paper is `settings.company`, because that
  row is read by every open folder at once. Three things tightened on the way
  past — `removePiece`'s audit entry, `saveCredential`'s upsert blanking the
  file, and both piece presses refused after a deposit — are in the commit
  message; what is still open is under Known gaps.
  The tender detail page has no form and no `actions.ts`. `markSubmitted`,
  `recordCaution`, `addPiece`, `removePiece` and above all `saveCredential`
  are exported and unreachable — without the last, every credential-backed
  folder piece computes as `missing` forever and the screen is all red the
  day it first has data.
  *Done when:* a tender can be taken from folder to recorded deposit without
  leaving the ERP.

- [x] **2.8 · Fix `importBpu`'s silent loss**
  The provenance was never actually lost, only unreachable by the header:
  `commitBpuBatch` writes an `import_batch` row per sheet with the filename,
  the deal and the moment, and screen 42's own Sources tab has been listing
  them all along. So `importedFrom` reads the newest `deal_line` batch and
  `bpu()` falls back to it — no new column, and the two `tender` columns turn
  out to be a cache of it, still written because `unmakeRefusalFor` reads them.
  `importBpu` also returns `provenanceOn: "tender" | "batch"` and puts it in the
  audit entry. Not a refusal: importing a bordereau onto a plain enquiry is
  legitimate, and refusing it would remove a working path to fix a header.
  `src/domain/tender/bpu-store.ts:663` updates the `tender` row
  unconditionally; on a deal with no tender row that updates zero rows and the
  provenance the screen header prints is lost.
  *Done when:* importing a BPU on a plain deal either records provenance or
  says it cannot, and a test covers both.

## WAVE U — the ERP explains itself

**Added 9 September 2026, from Abdou, in his words.** This wave outranks the
rest of Wave 2 and Wave 3; take these first.

> "It's not usable for someone that never used it. You introduce the ERP to
> someone and he does not understand the flow, how it works. It's not clear.
> There's a lot of screens with no real actions. We have a powerful ERP but it's
> not user friendly. And this is through all the ERP functions. When you take a
> look at settings, it's not user friendly, it's not clear. You talk about
> backup — there's no settings for backup, or to change the folder. What does
> the backup do? How does it work? Is it daily? And the documents expiration,
> it's not clear. A lot of things are not clear."

The rule for every task in this wave: **a screen must say what it is for, what
state it is in right now, and what the person can do next.** A screen that only
displays rows has failed, even when every row is correct.

- [ ] **U1 · A backup screen, because a promise nobody can see is not a promise**
  There is no `/settings/backup`. Everything about backups is invisible: the
  schedule lives in `BACKUP_AT` in `.env`, the destination in
  `BACKUP_LOCAL_PATH`, the last result in `.data/last-backup.json`, and the
  only way to know any of it is to read files on the server.
  The screen says, in sentences: **when** it runs (daily at 02:30, and that it
  catches up if the machine was off), **where** it writes, **what** it takes
  (the database and the files), **when it last ran and whether it was proved
  restorable** — `last-backup.json` already carries `verified`, `tablesChecked`
  and `rowsChecked` — and **how far back** the copies go. It offers: run one
  now, change the destination, and restore.
  **It must show the warning the script prints and nobody reads:**
  `BACKUP_LOCAL_PATH` is currently `/mnt/usb-backup`, a Linux path on a Windows
  machine, so it is ignored and every backup lands on the same disk as the
  database. That covers a mistake and nothing else — not a dead disk, not a
  theft, not a fire. On screen, in red, with the fix.
  *Done when:* Abdou can answer "am I backed up, and where?" without leaving
  the ERP, and change the destination from it.

- [ ] **U2 · Everything that expires, in one place**
  Expiry is scattered and mostly invisible. `companyCredential.expiresOn` (CNAS,
  CASNOS, extrait de rôle, qualification) decides whether a tender folder is
  complete, and `expiresBeforeDeposit` in `src/domain/tender/dossier.ts` is the
  state the whole module exists for — a piece valid today and expired on the
  day of deposit is the thing that gets a bid thrown out. Offer validity,
  proforma validity and caution validity are the same shape.
  One view that answers "what expires, when, and what breaks when it does",
  ordered by date, each row leading to the screen that renews it. Computed, not
  stored (LAW 1).
  *Done when:* a credential expiring in three weeks is impossible to miss, and
  every tender whose folder it breaks is named beside it.

- [ ] **U3 · Settings a person can read**
  Every row states what it is for and its live state — not a name and a link.
  Group by what a person is trying to do, not by module. Anything unbuilt says
  so (that pattern already exists and works). Add the two orphans nobody can
  reach: `/settings/modules` and `/settings/forms`.
  *Done when:* somebody who has never seen the system can open Settings and say
  what each row would do before clicking it.

- [ ] **U4 · The flow, drawn on the screen it happens on** *(2.5 and 2.6 do this
  for deals and tenders — this is the same job everywhere else)*
  A person new to the ERP cannot see the shape: mail arrives → it becomes a
  deal → the deal is priced → an offer goes out → an order comes back →
  delivery → invoice → payment. Every screen sits somewhere on that line and
  none of them says where.
  *Done when:* on any screen in the chain, a person can see where they are, what
  came before, and what happens next.

- [ ] **U5 · No screen without an action**
  ~20 screens have no `variant="primary"` at all. Every one gets either a real
  primary action or an honest sentence saying why there is nothing to do here
  and where to go instead. `StateBlock` already has the `action` slot.
  *Done when:* `grep -rL 'variant="primary"' src/app/**/page.tsx` returns only
  screens that genuinely are read-only, and each of those says so.

## WAVE 3 — shrink the surface

Do not start Wave 3 until Waves 0–2 are green and pushed. It touches many
files and will conflict with everything above.

- [x] **3.4 · Make the honest screens reachable** *(do this one first — it is
  small and independent)*
  All six. The two honest screens get a group of their own on the settings hub
  rather than a row in `control`, because nothing on either can be changed:
  they answer "what is here", not "how is it set up". `/deliveries/new` gets a
  primary button on Deliveries, greyed with the reason for a role that cannot
  issue one; `/candidates` a button on People. The two phone-bar-only routes
  are treated differently on purpose — approving is a DESTINATION and joins the
  rail's control group (one of 3.1's eleven rows, so it arrives early rather
  than moving twice), while the counter price is a phone JOB and gets a button
  on Sourcing instead, because `src/mobile.ts` says there are four phone jobs
  and putting one in the rail would claim a fifth.
  `/settings/modules` and `/settings/forms` exist to make gaps visible and are
  reachable from nowhere. Add them to the `/settings` hub. Same for
  `/deliveries/new` from Deliveries, `/candidates` from People, and
  `/approvals` and `/prices/new` on the laptop — both are phone-bar-only today.

- [x] **3.2 · Every list gets a `StateBlock` with a real action**
  The six the audit named. Three of the six are judgements rather than
  defaults: **Orders gets two buttons**, because a client's order arrives from
  the deal and a purchase order from the sourcing comparison, and one primary
  would be wrong half the time; **Payments gets none**, because the recorder is
  on the same screen above the list it is rendered inside; and **Deliveries**
  reuses `/deliveries/new`, which 3.4 had linked an hour earlier. On those last
  two the block replaces the card rather than sitting inside it — `StateBlock`
  draws its own border. `tenders.none` needed no fixing: 2.1 had already made
  its instruction true. **About 54 empty states are still bare `<p>`s**, and
  what to do about them is under Known gaps.
  About 60 empty states render as a bare `<p>`. `StateBlock` and its `action`
  slot already exist and are used twice, both error screens. Start with the
  screens that have zero `variant="primary"`: Tenders, Sourcing, Offers,
  Orders, Deliveries, Payments. Fix `tenders.none`, which currently instructs
  a workflow — once 2.1 ships, that instruction becomes true, so update the
  copy to name the button.

- [x] **3.3 · One word per concept** — *decided, no longer blocked*
  **Not one English string in `en.json` says "enquiry" any more** — 78 did —
  and the Chantier screens say Site rather than Project. French is untouched.
  The two words left to judge are decided: **Sourcing stays Sourcing** for
  *Approvisionnement* (the standard English procurement word, and the route
  and nav already say it), and **"Ageing and relances" becomes "Ageing and
  reminders"** — that was a French word inside an English sentence on two
  screens, which is a gap in a translation rather than a translation.
  `project` was deliberately NOT swept by regex: it is a real English word here
  meaning a job title, a research project and a repository folder, so only 36
  strings under an explicit key list moved, and 23 more were rewritten by hand
  where the right English was a judgement. The static KEYS moved too — the
  `enquiry` and `newEnquiry` namespaces became `deal` and `newDeal`, 87
  references across 16 files — and `messages.test.ts` caught the one reference
  a literal rewrite could not see. **The done-when's grep reads 7, not 0**, and
  why is under Known gaps: all seven are keys built from a database value.
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

- [!] **3.1 · Rail from 24 rows to about 11** *(blocked 9 September: the eleven
  rows are decided and five current destinations are not. Question under Needs
  Abdou — it is one paragraph to answer and the task is a day's work after it.
  Nothing else about the task is unclear, and 3.5 was taken instead because it
  removes three of the rows this one would remove, without pre-empting any of
  the five placements.)*
  Today (absorbing Week and Waiting on as tabs) · Inbox (absorbing Scan,
  Quick capture, Conversations) · Enquiries · Offers · Orders+Deliveries ·
  Chantiers · Invoices (absorbing Payments and Ageing) · Approvals ·
  Companies (absorbing Contacts and People) · Compliance · Settings in the
  footer. Tenders becomes a **facet of the enquiry list** — which is what it
  already is in the data, since a tender *is* a deal. `docs/UI_INDEX.md`
  specified 18 rows and the sidebar's own comment admits 24 do not fit.

- [x] **3.5 · Retire or demote what nobody touches weekly**
  Dashboard leaves the rail and lives on Reports — it had no other link, so
  that one is the whole of what taking the row away owed it. Files leaves the
  rail and sits beside Storage on the settings hub with a count, because a file
  browser is not a destination inside an ERP: `src/domain/files` is explicit
  that there is no `file` table, so every file already belongs to what brought
  it in. **`/week` needed nothing** — the task lists it and it was never in the
  rail; Today has linked it since it was built. The rail is 23 rows.
  `/dashboard` duplicates Today and Reports; `/files` is a file browser inside
  an ERP; `/week` is a view of Today. Demote rather than delete.

- [ ] **3.6 · Adopt `DataTable` on the next lists** *(incremental, last —
  **Tenders is done, `38f6b10`. Three remain: Invoices, Payments,
  Deliveries.**)*
  `tenders-list.tsx` is the worked example and the next three copy it: a client
  list component holding the row type and the columns, and a server page that
  hands it rows **already formatted** — a date is the string that will be
  printed, a badge is a tone and a label, so the locale and the arithmetic stay
  where they already are. Two decisions came with it and hold for the rest: the
  facet chips stay above the table rather than becoming `filterFields`, because
  they are counted server-side and live in the URL; and the screen's own
  `StateBlock` (3.2) is rendered on the server and passed in as `emptyState`,
  so a screen has one empty state rather than two.
  **Payments is the awkward one** and worth taking last of the three: its table
  is rendered inside the `RecordPayment` form, so the form's shape has to be
  settled before the table can move.
  Used by 4 files; 53 others write a raw `<table>`, so filters, saved views,
  pagination and bulk actions exist on 4 screens only. Convert Tenders,
  Invoices, Payments, Deliveries. One screen per commit.

---

## Known gaps

Work a later run must finish. Written down rather than left half-done.

### 3.3 — seven keys the copy pass could not reach, and the French is drifting

**`grep -c enquiry src/i18n/messages/en.json` reads 7, not 0, and each of the
seven is a key built from a database value.** Renaming any of them means
renaming data, not copy:

| Key | Built from | What renaming it costs |
|---|---|---|
| `inbox.type.enquiry`, `inbox.facet.enquiry`, `inbox.action.enquiry` | `intake_message.classified_as` | A migration over every classified message, the classifier's own list, the routing rules seeded against it, and `tenderHint`'s reclassify. |
| `capture.shape.enquiry` | the capture shape enum | Screen 61 and the phone job. Small, and it travels with the one above. |
| `emailTemplates.name.enquiryAck`, `emailTemplates.when.enquiryAck` | `email_template.key` | A migration over the template rows, and any draft already written against that key. |
| `assistantSafety.tool.draftEnquiryReply` | the assistant's tool name | The tool registry, and the unit test that asserts what the assistant may and may not do. |

None is user-visible: a person reads the VALUE, and every value now says deal.
The right time to move them is when somebody is already migrating that data for
another reason, and the wrong time is inside a copy pass.

**The French has the same drift the English just lost, and nobody has decided
it.** `nav.deals` is *Affaires* while `offer.fromWhich` and
`scorecard.column.enquiry` head the same column *Consultation*, and
`enquiry.discard.*` says *consultation* throughout; `nav.payments` is
*Règlements* while `payments.title` is *Encaissements*. Left alone on purpose —
the decision of 8 September settled the ENGLISH words and said French stays
idiomatic, and picking between *Affaire* and *Consultation* on our own is the
kind of guess this queue forbids. It is a question under Needs Abdou.

### 3.2 — six of about sixty, and the other fifty-four are not all the same

**The task said "start with" these six and that is what this did.** The rest are
not one job. They fall into three kinds and only one of them is worth a sweep:

1. **A list on its own screen with an empty state** — the same shape as the six,
   and the same fix. Invoices, Projects, Compliance, Companies, Contacts, People,
   Candidates, Personnel requests, Files, Conversations. Ten or so, one commit,
   and the only question per screen is which button.
2. **A panel inside a screen that is not empty** — "no lines yet" on a document,
   "no answers yet" on a sourcing request, "no notes" on a timeline. A
   `StateBlock` in a card is the wrong component (it draws its own border and
   fourteen units of padding), and the surrounding screen usually already offers
   the action. These want a sentence that names the next step, not a box.
3. **A cell or a column saying "—"**. Not an empty state at all. Leave them.

Sweeping all three as one would put a bordered box inside forty cards. What
would help more than the sweep is the reason the audit could count them at all:
they are `<p>` tags with a message key, and a script could list every one that is
rendered where a list would be. That is the same static shape as the check 3.4's
gap asks for, and both belong in one commit if either is written.

**`StateBlock` still has no `permission` caller.** Its third tone exists for
"you may not see this" and nothing uses it. Screen 79's rule is that a permission
never hides that a thing exists, so the tone is right and the callers are the
ones that would draw a list a role may not read — which today grey a column
instead. Worth knowing it is there before somebody writes a fourth tone.

### 3.4 — the rail is 25 rows now, and nothing counts the ways in

**Adding Approvals took the rail from 24 to 25**, on the task whose wave exists
to cut it to about 11. That is deliberate and it is still uncomfortable: the row
had to go somewhere a laptop can reach, 3.1 keeps Approvals as one of its
eleven, and leaving it unreachable for another task would have been the worse
trade. 3.1 is what makes the number go the right way, and it should be taken
before anything else adds a row.

**Nothing prevents the next unreachable screen.** Six routes had no way in and
they were found by the audit reading the tree, not by anything in the gate.
`scripts/screen-coverage.mjs` exists and counts screens against
`docs/SCREENS.md`; what does not exist is a check that every ROUTE under
`(app)` is linked from at least one other route. That is a static walk of `href`
literals — the same shape as `audit-forms.mjs` — and it would have caught all
six. Worth writing once the rail settles in 3.1, not before: half the answers
would change.

**`/inbox/[id]` and `/deals/[id]/items` are reachable now but were not always.**
Both were found and linked by earlier tasks (the 9 September run, and 2.2). The
pattern is the same one — a screen built for a purpose, linked from nothing —
and it is why the check above is worth more than the six links this task added.

### 2.8 — the cache is still a cache, and nothing reconciles it

**`tender.bpu_source` can now disagree with the batch behind it.** Nothing makes
it: `importBpu` writes both in one transaction and refuses a second import. But
the column is a cache of a row in another table and there is no longer one
writer of the truth — an erratum applied, a line list replaced by hand, or a
batch marked `undone` would all leave the cached filename standing. It is
`unmakeRefusalFor` that keeps the column alive, and the honest end state is for
that refusal to read the batch too and the two columns to go. That is a
migration and a change to a refusal, which is its own task.

**`importedFrom` takes the newest batch, and "newest" is `imported_at`.** A
batch whose `imported_at` is null sorts last on Postgres's default
`nulls last` for `desc`, which is right — a row that never finished importing
should never win — but it is a property of the query rather than a filter, and
`status = 'imported'` is what actually guarantees it. Worth knowing before
somebody widens the status filter.

### 2.6 — screen 85 is now the odd one out, and three smaller things

**The stepper is shared by three screens and screen 85 does not use it.** That
is the wrong way round: `/setup` is where the pattern came from, and it still
renders its own `<table>` with its own number badges and its own `setup.done`.
Converting it was deliberately left out of 2.6 — it is the one of the three that
already works, it has an eleventh column of "why" text the other two do not, and
a task that changes the day-one screen while changing two others is a task whose
diff nobody can read. It should be one commit of its own, and `Stepper` may need
a `why` slot to take it.

**`common.done` and `setup.done` now both say "Done".** The second is screen
85's and predates the first. Whichever survives, one of them is a duplicate, and
the answer depends on the paragraph above: convert screen 85 and `setup.done`
goes with it.

**The tender stepper costs a `bpu()` call on every load of screen 08.** It reads
every deal line and its prices to learn two numbers — `totals.lines` and
`totals.priced`. At this company's volume that is free and it is honest (LAW 1:
computed, not stored), but it is the first thing to look at if screen 08 ever
feels slow, and the fix is a count query rather than a stored column.

**A step with no `fixHref` draws a badge, and two on screen 06 still have none.**
The missing deadline and the uninvoiced order — both named under 2.5 above, both
unchanged by this task, and both now more visible because they sit in a numbered
run with a button beside every other row. The deadline one is the honest fix
(`/deals/[id]/edit` does not exist); the invoice one is a real choice about
which document a facture is raised from.

### 2.7 — the company's papers have no screen of their own, and nothing warns

**Nine rows shared by every folder, edited from whichever tender is open.** The
credential form is on the piece row, which is right for the moment somebody
notices a problem — and it means there is no list anywhere of what SUPSERV
holds and when each paper expires. That is the screen somebody wants in the
week before three deposits, and it is a settings screen: one table, nine rows,
`credentialDetails()` already returns exactly it. 3.4 is already about making
settings screens reachable and this is a natural companion, but it is a new
screen rather than a link, so it was not smuggled in here.

**Nothing warns before an attestation expires.** `EXPIRING_WITHIN_DAYS` is 30
and it computes a badge on a folder somebody is already looking at. A CNAS
expiring in nine days with no open tender is invisible until a tender exists to
make it visible — and renewing one is a morning at a counter, so nine days'
notice is the whole value. It is a computed fact with no row behind it, which
is exactly what screen 55 is built from: Today should say "CASNOS expires in 9
days" whether or not anything is being deposited. Not built here because Today
is its own screen and this task was the folder.

**The scan is filed and never read.** 1.6 and 1.8 extract text from a dossier;
a credential scan goes into working storage and nothing reads it, so the expiry
date is typed by hand even when it is printed on the paper being uploaded. That
is deliberate rather than lazy — reading it would make the date a proposal, and
LAW 2 says a proposal stops at a review step with a citation, which is screen
40's shape and not a one-line form's. Worth doing the day somebody mistypes a
year; worth NOT doing as a silent auto-fill.

**A forced deposit does not say so on screen afterwards.** `markSubmitted` takes
`force` with a reason and writes both into the audit entry beside the list of
what was blocking at that moment, so the record is complete. But the panel
afterwards prints only `tender.submittedOn` — the date and the receipt — so
"this folder went in knowing three pieces were missing" lives in the log and
nowhere a person looks. One line on the submission panel, reading the audit
entry, is the fix; it needs a query the panel does not make today.

**`removePiece` still removes rather than hides.** Recorded rather than changed:
2.1 argued this out for `unmakeTender` — `tender` and `tender_piece` have no
deletion columns, giving them three would mean every reader in this module and
in `bpu-store.ts` filtering forever, and what the HARD RULE asks for is "an
audit entry that outlives the record". This commit made that true rather than
nominal: the row's key, label, section and file go into `before` before it
goes. If Abdou would rather a removed piece be restorable, it is a migration
and a filter in three readers, and it is a decision rather than a bug fix.

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

### 2.5 — two checks with no link, and what the panel cannot see

**A missing deadline has no fix route, and that is the application's gap rather
than the panel's.** There is no `/deals/[id]/edit`: a deadline is set at
`/deals/new` or carried off a confirmed dossier (2.4), and nowhere else. The
audit noted the same thing about `submissionMethod`, which "can only be set
once, at `/deals/new`, and is read-only afterwards". Pointing the check at a
screen that cannot set it would be worse than naming the gap, so it warns with
no button — and the honest fix is an edit route, which is its own task and
touches more than this panel.

**An uninvoiced order has no fix route either, and this one is a real choice.**
A facture is made FROM a document through screen 18's convert — the bon de
commande, or the bon de livraison when there is one — and the deal knows only
that an order was received, not which document to convert. Linking to the
likelier of the two would be right most of the time, which is the worst kind of
link on a screen about money. What it wants is the deal to name the documents
it holds, which is a query this panel deliberately does not make.

**The panel does not know about the tender folder.** A deal with a `tender` row
has a folder of administrative pieces that will get the bid thrown out if one
has expired, and `dossier()` already computes its completeness — 2.2 put the
percentage on the header. It is not a check yet: a folder piece is `missing`
until `saveCredential` has a value to compare against, and 2.7 is the task that
gives that function a screen. Adding a check that reads red for every tender
until 2.7 ships would teach people to ignore the panel in the week before it
becomes true.

**Nothing on the panel is about prices.** `price_quote` rows are what an offer
is built from and the panel never mentions them, because counting them is a
query and `DealFacts` does not carry one. `suppliersAsked` is the nearest
proxy and it is not the same fact: a price typed in by hand from a phone call
is a price, and no supplier was asked for it. If the offer check ever needs to
say *why* it cannot be built, that count is the thing to add to `DealFacts`
rather than to the page.

### 2.4c — the checks fire now, and nobody has watched one fail

**Screen 67's delivery check has never run against a real number.** That is the
whole point of the task and also the thing still unproven: `requiredDeliveryDays`
now has a writer, and no deal on this database has been through
confirm → carry → ask a supplier → read their lead time. The first time it
fires it will either say something useful or say something wrong, and only
somebody watching it can tell which. Same for `requiredValidityDays` on the
same screen and `latePenalty` on screen 12. All three are unblocked and none is
verified in use.

**A delivery time and an offer validity can both be read off one document, and
nothing checks they are not the same sentence.** The two rules are kept apart by
vocabulary, which holds for every wording anybody has written down — but a
clause saying "l'offre reste valable pendant le délai de livraison" would feed
both, and the screen would show two fields with one number. It has not happened
and the caveat machinery would not catch it. Worth knowing before somebody
widens either cue list.

### 2.4 — what it left, and one thing 2.4c closed

**`deal.required_delivery_days` — closed by 2.4c the same day.** 2.4's own
done-when named it beside `requiredValidityDays` and `latePenalty`, and 2.4
could not give it one: the gap was upstream, in a reader with six field keys
and no delivery time among them. 2.4c added the seventh and the column has a
writer. All three checks the done-when named now have one.

**Only a dossier that arrived by email can be carried.** The deal is found
through `intake_message.committed_entity`, which screen 02 writes. A dossier
somebody uploaded on screen 39 has no message and therefore no deal, and the
panel does not appear for it — the screen says the document is not attached to
a deal and points at the message route, which is true and unhelpful for an
upload. A picker was deliberately not built: a select of every deal is a poor
control and a searching one is a component, and the path that matters for
wave 2 is the one that starts in the mailbox. The honest fix is "attach this
dossier to a deal" on screen 39, beside the upload.

**Nothing carries automatically, and nothing should — but nothing reminds
either.** A person can confirm six fields and walk away without pressing the
button, and the deal stays empty with the facts sitting one screen away. That
is the correct default (LAW 2 governs the field; a person's press governs what
is done with it), but a dossier with confirmed fields and no `deal_id` is a
knowable state and belongs on Today, which is exactly the kind of computed fact
screen 55 is built from. Worth doing once 2.5 exists, in the same shape.

**A second carry can fill what the first could not, and that is deliberate.**
Press it, then make the deal a tender, then press it again: the three tender
fields land the second time, because the first run skipped them as `noTender`
and left them unconfirmed-nothing. Nothing is duplicated — every write is
"only if the column is empty" — and the audit trail records both presses with
what each did. That is the intended shape and it is why the carrying is not
one-shot.

### 2.4b — what the window still does not read, and one number to watch

**The cap on the penalty is lost.** The reading is `1% par jour`, and the
document goes on, on the line after the one cited: *"cumulé de dix pourcent
(10%) du montant total du CONTRAT."* The rule's `cap` pattern looks for
*plafonnée à X%* and this contract says *jusqu'à un maximum cumulé de*, on a
third line. Widening the window to three would reach it and would also reach a
line further into every other article, which is the trade this task measured
and declined. The honest fix is the cap's own alternative wording, not a wider
window — a rule reading further because its own words are richer is different
from a rule reading further because it is hopeful.

**A value on the line ABOVE its cue is still unread.** The window only looks
down. Nothing on this database needs it, and a table whose header row is the
label and whose cell below is the value is read correctly already, so this is
recorded rather than built: the first document that needs it will say what
shape it has.

**`readBelowCue` costs 0.15 and that number has never been calibrated.** It
was chosen so a below-cue reading lands under `REVIEW_THRESHOLD` (0.8) for
every rule whose base is 0.9 or less — which is all six — so nothing read this
way can ever auto-confirm. That is the property that matters and it holds. But
whether 0.55 rather than 0.6 or 0.5 is *right* for a penalty rate is a
question only a person confirming a few of them can answer, and it is worth
re-reading once screen 40 has been used on a real dossier.

**One proposal on this database is still zero public tenders.** The two fields
now read both come from a private *consultation restreinte*. Nothing here has
been tested against a real Algerian public RC, because none has arrived. Every
cue in the file is written for one, and 2.4a's finding stands: the first real
marché is the measurement, and it may move all of this again.

### 2.4a — the RFQ is not a règlement de consultation, and two things follow

**The premise of the task was wrong, and finding that out was the task.** 2.4a
was written expecting the seven files of the real RFQ to be "full of *caution
de soumission*, *date limite de dépôt des offres*, *délai de validité* and
*séance d'ouverture des plis*". They are not. Every cue in
`src/domain/intake/extract.ts` was searched against the stored page text of all
32 read dossiers, and **exactly two documents contain any cue at all**:

| File | Cue found | Proposed |
|---|---|---|
| `B_…Instructions aux Soumissionnaires.pdf` | `date limite de depot` | nothing |
| `F_…Projet de Contrat.pdf` | `penalites de retard` | nothing |

`RFQ-10023604-26 · Fourniture de Bureau` is a **private *consultation
restreinte*** — an introduction, instructions to bidders, a scope, commercial
requirements, a draft contract and invoicing instructions. It is not a public
marché. It has no *avis d'appel d'offres*, no *séance d'ouverture des plis* and
no *caution de soumission*, because a private client asking six suppliers for
office furniture holds none of those. The six fields `proposeFields` looks for
are the six facts on the front page of a **public** RC, and this reader has
never yet met one on this database. Thirty-one for thirty-one was not a broken
wire; it was a reader built for a document class that has not arrived.

**There is no submission deadline in this dossier, in any shape.** Every line
of all six readable files was scanned for a French date — named month or
numeric, any format — and there is **not one date anywhere**. The instructions
*refer* to "la date limite de depot de l'offre" and to "les cinq (5) jours qui
précédent la date limite de la soumission des offres", and never state it. The
deadline for this RFQ arrived in the covering email, not in the attachments.
So 2.4a's own "done when — a real French dossier proposes at least its
submission deadline" cannot be satisfied by this dossier by any reader that is
not inventing one, and a reader that answered here would be the exact failure
LAW 2 exists to prevent. That is written into `extract.test.ts` as a test that
asserts nothing is proposed from those two verbatim lines.

**What WAS taken: one cue, measured, one true positive, no false ones.** The
same file states, at 1.6.18, *"L'offre doit rester valable pour une période
minimale de 180 jours calendaires"* — that is `offerValidity`, stated as an
obligation on the bidder rather than labelled as a field, which is why none of
`delai de validite` / `validite des offres` / `duree de validite` sees it.
Adding `rester valable` and `demeurer valable` takes the whole database from
**0 proposals to 1**: `offerValidity = 180 jours` at 0.9, cited to page 4 of
that file, and *nothing else on the database gained anything*, which is the
number that matters — a widened cue that had lit up CVs and catalogues would
have been worse than none. The real sentence is the test fixture, and so is
the delivery clause it must not fire on.

**What was NOT taken, and is now task 2.4b: a cue in a heading never reaches
its value.** `F_…Projet de Contrat.pdf` says *penalités de retard* twice, both
times as an **article heading** — once in the table of contents with dot
leaders, once as "ARTICLE 13 – PENALITES DE RETARD" — and the rate is four
lines below it: *"retard comme suit : 1 % par jour du montant total du bon de
commande, jusqu'à un maximum…"*. `proposeFields` only ever looks for the value
inside the cue's own sentence, so a document that puts the label on one line
and the fact on the next is unreadable by construction. That is not a quirk of
this file — it is how **every** numbered French administrative document is laid
out, a public RC included, so it will cost more than one field the first time a
real marché arrives. It was not fixed here because a window over following
lines is a change to how every rule reads, needing its own false-positive
measurement against all 32 documents, and 2.4a's job was to find out what was
wrong rather than to rebuild the reader on the way past.

### 2.3 — four signals, and the four the audit named that were not taken

The audit lists seven signals available and unused: ZIP present, attachment
count, page count, *soumission*, *bordereau*, *BPU*, *DQE*. The queue's own
task named four of them and this took exactly those four. The rest were left,
and each for its own reason rather than as a batch.

**The three extra words are a change to the ROUTER, not to the hint.** There is
one list in this repository of words that announce a formal procedure, and it
is the matcher on the seeded tender rule — which is why the hint reads it
rather than keeping a second copy. Adding *soumission*, *bordereau*, *BPU* and
*DQE* to the hint alone would create the second list the design avoids; adding
them to the rule changes what the router auto-creates, which is a bigger act
than a suggestion and wants somebody watching a week of real mail first. The
honest place for it is a task of its own, and the words are worth it: three of
the seven files of the real RFQ on this database have *bordereau* or
*soumission* in the filename.

**Page count needs the reading to have happened.** It is a good signal — a
forty-page CCTP is not a quotation — and it is only available after 1.8 has
made a dossier, which happens minutes after the message arrives and sometimes
not at all. A hint that changes its mind while somebody is looking at the
screen is worse than one that never had the signal, so this wants the panel to
say *when* it read what it read, and that is a screen change.

**Nothing suggests the conversion on the deal, only on the message.** A deal
created from a message the hint fired on, by somebody who pressed the enquiry
button anyway, carries no trace of the suggestion. 2.5's next-step panel is
where that belongs — it is a check over `DealFacts` and it already has the
shape — rather than a second suggestion surface on screen 06.

**The dossier tag is a filename, and filenames lie.** `attachmentLooksLike`
matches `cahier|charges|cctp|dossier|appel`, so `dossier_technique.pdf` from a
supplier scores three points on a message that is not a tender at all. That is
the intended trade — the panel says what it noticed and a person disagrees in
one press — but the first false positive somebody meets is the measurement
that says whether the floor of 3 is right. Nothing about it should be tuned
before that happens.

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

### Where do five screens live, once the rail is eleven rows? (3.1)

**The eleven rows are decided and I am not going to guess the rest.** The queue
and the audit both name the same list — Today · Inbox · Deals · Offers ·
Orders+Deliveries · Sites · Invoices · Approvals · Companies · Compliance, with
Settings in the footer, Tenders as a facet of the deal list — and every screen
it names has a home: Week and Waiting on become tabs of Today, Scan and Quick
capture and Conversations become tabs of Inbox, Payments and Ageing go under
Invoices, Contacts and People under Companies.

**Five of today's rows are named nowhere in that list**, and a rail that drops a
row without giving it a home is the fault 3.4 just spent a commit fixing. Here
they are, with what I would do and why I have not:

| Row | What I would do | Why it is a question and not a default |
|---|---|---|
| **Sourcing** | Keep it as a twelfth row | This is the one that matters. It is a weekly work screen — "what am I waiting on from suppliers, everywhere" — and the whole of wave 2 treats it as a step of the run. Burying it behind Deals is a decision about how a morning starts in Adrar, and only you know whether somebody opens it every day or only from a deal. |
| **Personnel requests** | A tab of Companies, beside People | Fits the "Companies absorbs Contacts and People" row exactly. Low risk, but it is your fourth-most-used screen or your fortieth and I cannot tell. |
| **Reports** | A tab of Compliance, or the footer beside Settings | It is a control screen rather than a work screen, so it belongs with Compliance or in the footer. Both are defensible and they read differently. |
| **Dashboard** | Retire into Reports (3.5) | 3.5 already says it duplicates Today and Reports, and 3.5 is doing this one. |
| **Files** | Retire into Settings (3.5) | Same — 3.5 is doing this one. |

**One paragraph from you unblocks it**: keep Sourcing as a row or fold it into
Deals, and say where Personnel requests and Reports go. Everything else is
mechanical — a tab strip on four parent screens, one new `NAV_GROUPS`, and the
routes all stay where they are so no saved link breaks.

Worth knowing before you answer: 3.4 added Approvals, so the rail went to 25
rows, and 3.5 has since taken it to 23 — Dashboard onto Reports, Files onto the
settings hub — without touching any of the five above.

### Two French words for the same thing, twice (3.3)

The English is now one word per concept: **Deal** and **Site**, decided on
8 September and carried out on the 9th. The French was left exactly as it was,
because that decision settled the English words and said French stays idiomatic
— and the French has the same drift the English just lost, in two places.

1. **The record is *Affaire* in the nav and *Consultation* on two columns.**
   `nav.deals` says *Affaires*. `offer.fromWhich` and `scorecard.column.deal`
   head a column naming the same record *Consultation*, and the whole
   `deal.discard.*` block says *consultation* — "Mettre cette consultation à la
   corbeille". **Is the French word for the record *Affaire* everywhere?**
   The complication is that *consultation* is also the name of a PROCEDURE —
   `tenders.procedure.consultation`, a consultation restreinte — so the word
   has to stay there whatever is decided about the record, and a sweep would
   break it. That is why nothing was changed on a guess.

2. **Payments is *Règlements* in the nav and *Encaissements* as the page
   title.** The screen records money coming in against invoices.
   **Which one?** *Encaissement* is narrower and more exact; *Règlements* is
   what the nav has taught anybody who has used the system.

Neither is urgent and neither is a bug. Both are the kind of thing that is
cheap to fix in one pass and expensive to notice six months later, when half
the office says one word and half says the other.

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

**Now twenty tasks and one screen, and the restart is still the whole of it.**
The run of 9 September added 2.3, 2.4a, 2.4b, 2.4, 2.4c and 2.5 on top of
wave 1's six. A later run the same day closed wave 2 and most of wave 3:

- **2.7** — screen 08's five forms, so a tender folder can be worked at all.
- **2.6** — a numbered run on screens 06 and 08 saying where a deal or a folder
  has got to, sharing screen 85's stepper.
- **2.8** — screen 42 tells the truth about where its lines came from.
- **3.4** — six screens that had no way in have one.
- **3.2** — six empty screens say what to do next, with a button.
- **3.3** — every English screen says **Deal** and **Site**. This is the one
  that changes the most words on the most screens, and it is the one worth
  five minutes with the built app.
- **3.5** — the rail is 23 rows; Dashboard lives on Reports, Files on Settings.
- **3.6, first of four** — Tenders is on the shared table, with filters, a
  column menu, sorting and export it did not have.

2.7 also carries **migration 0059**, which is already applied to the dev
database: two nullable columns on `company_credential`, so a build serving the
old code against the new schema is harmless either way round.
`pnpm build` was run again at the end of that run and succeeded — 136 pages, no
errors — so the build on disk carries every one of the tasks above. Nothing has
changed about what is needed: **double-click
`restart-erp.cmd`** and say yes, then `Restart-ScheduledTask -TaskName "SUPSERV
worker"` in the same Administrator window, then `pnpm smoke`. Until then port
3000 serves the build from before 1.4.

What is worth looking at first once it is up, because it is new and nobody has
used it: screen 40 now offers to put what you confirm onto the deal, and screen
06 opens with a numbered run naming the next thing to do. The three RFQ files
that propose a field are `B_…Instructions aux Soumissionnaires` (offer
validity), `C_…EtenduedesFournitures_` (delivery time) and `F_…Projet de
Contrat` (late penalty).

**And then screen 08**, which changed more than any other screen in this repair
and which nothing but a person can check. Open a tender, expand a piece backed
by a company paper, and file the CNAS attestation with its expiry — the folder
should go from red to green as you save it, and the numbered run at the top of
the column should move on to the next thing. Nothing in the gate can tell you
whether that reads right; it can only tell you it compiles.

**Watch for one thing in particular after 3.3.** It rewrote 78 English strings
and renamed 87 message-key references across 16 files. `messages.test.ts`
proves every key still resolves, so nothing can be missing — but a sentence can
be *wrong* while resolving perfectly, and the place to notice that is a screen,
not a test. If any English copy reads oddly, it is that commit (`979c3ff`) and
it is one string to fix.

Twenty tasks have shipped and **none of them is live**. Port 3000 still serves
the build from before 1.4: a commit is not a deployment. `pnpm build` has been
run and succeeded, so the only thing left needs Abdou's own machine and
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
| 2026-09-09 | 2.1 | `2ec873f` | An RFQ becomes a tender in one press. `makeTender` had been written, transactional, guarded against double conversion, seeding `tender_piece` from the procedure and writing an audit entry, since the tender module was built — with **zero callers outside `tests/`**. There was no `/tenders/new`, no `actions.ts` under `tenders/[id]`, and no create affordance anywhere, so screen 07 was structurally empty for ever and its own empty state instructed a workflow that did not exist. This is the caller. The form sits on screen 06 and asks for the procedure — **the five values read out of `PROCEDURES` in `dossier.ts`, not a list retyped in a component**, so a sixth would reach the select, `seedFor` and the label in one move or in none — the place of deposit, the séance d'ouverture, the caution as an amount *or* a percent (whichever the cahier des charges wrote; converting needs an estimate nobody has made), and how long our offer must stand. Its copy names the owner's own distinction between "a simple RFQ" and "a real tender", because `seedFor` already expresses it: an RFQ and a consultation start their folder without the caution, the qualification and the casier judiciaire, so four permanent red rows never appear on screen 08 to teach somebody to ignore red. On success it lands on `/tenders/[id]` — the pipeline is the point of the press. **`unmakeTender` makes a wrong press reversible**, which is the half that took the thinking: a misclassification that can only be undone with SQL is not a feature. It refuses on four things, each read off `src/db/schema/tender.ts` rather than guessed — a deposit (`submitted_at` / `deposit_receipt_ref`: "no document in this system records that a man carried an envelope to a counter in Adrar"), a caution **requested or received** (the schema calls both "facts nobody can infer: the bank takes days", and a request in flight is a week of somebody's time), an imported bordereau's provenance (`bpu_source` — the lines survive on the deal, the record of which file forty-two prices came from would not), and a folder piece carrying a file or a hand-typed `label` (the seed writes neither, so either means a person read the cahier des charges). It deliberately does **not** refuse on the untouched seed, which would mean no conversion was ever undoable. `unmakeRefusalFor` is pure and consulted twice — once by the page to grey the button with the sentence, once inside the transaction to actually say no — because `Button`'s `disabledReason` sets `aria-disabled`, not `disabled`, so a greyed submit still submits. The row goes rather than gaining a `deleted_at`: `tender` has no deletion columns and giving it three would mean every reader here and in `bpu-store.ts` filtering forever to keep a row that says only "this deal answers a procedure" — precedent is `removePiece`, which has removed rather than hidden since the module was written, and what the HARD RULE asks for is an audit entry that outlives the record, so the whole row and every piece key go into `before`. The action is `unmake`, not `delete`: "Tender · Deleted" reads as though a deal went missing. Both actions ask **`offers.issue`** — the same as `decideAction` and `lostAction` beside them, because classifying a deal is the same judgement as deciding to pursue it; not `records.delete` even for the undo, since nothing leaves the world and gating the correction harder than the press that caused it would leave a Commercial in Adrar waiting for the office. `tenders.none` now names the button in both languages instead of describing a workflow. `tests/unit/tender-conversion.test.ts` pins all five refusals, the seed claim the form's copy makes, and that every procedure and every refusal has a sentence in EN and FR — template-literal key families `messages.test.ts` cannot see. **Not seen in a browser**: port 3000 still serves an older build. |
| 2026-09-09 | 2.2 | `4d78af7` | The deal says what it is. `deals/[id]/page.tsx` contained the word "tender" **nought times**, so even with 2.1 shipped a deal answering a formal procedure looked exactly like one that was not, and nothing led to its folder. The header now carries an accent badge naming the procedure — "Tender · AONR", not merely that it is one — and the tab row gains links to `/tenders/[id]` and to **`/tenders/[id]/bpu`**, screen 42, the bordereau import, which was reachable from nowhere but itself and is where a tender's prices are actually entered. **The completeness is read, not recomputed**: `getTender` has already run the pure `dossier()` over this tender's pieces, the company's papers and the closing date, so the card shows that object — the bar, the three sections as ready-of-total, and screen 08's own blocking sentence while it can still be acted on. A second arithmetic here could disagree with screen 08 about the same folder, and a stored percentage would still read 100 in September after the CASNOS attestation expired in August. **`/deals/[id]/items` (screen 73) is linked too** — it has existed since the item-list hole was filled and nothing in the codebase pointed at it, so correcting a quantity read wrong from an email meant knowing the URL. Four tests hold it, including one that fails the day screen 42 is again linked from nothing but itself. `tender.onDeal.*` in EN and FR. **Not seen in a browser**: port 3000 still serves an older build; `pnpm build` has been run so the build on disk is current, and the restart needs Administrator. |
| 2026-09-09 | 2.3 | `2d5252d` | The screen says what it noticed. Four signals were being computed and thrown away: the router reads the subject for *consultation · avis · appel d'offres* and discards that reading whenever an earlier rule wins, `attachmentLooksLike` writes `tender_dossier` on the row where nothing but a badge ever reads it, and a dossier arrives as a zip and is expanded without anybody asking what an archive on an enquiry usually means. So an RFQ that is plainly an appel d'offres opened as a plain enquiry. `tenderHint()` reads all four off one message and returns a reading rather than a verdict — which signals fired, and whether they add up. The two strong ones each carry it alone because each is somebody ELSE's word rather than our inference: the subject was typed by the authority announcing the procedure, and `tender_dossier` is the filename the sender chose. The two weak ones carry it only together — an archive by itself is a supplier's photographs as often as a dossier, and four attachments by itself is a catalogue. The procedure words are read off the seeded tender rule rather than retyped, and a test walks that rule's own list, so a word added on screen 38 is gained here and the two lists cannot drift. LAW 2 is the whole design: it writes nothing, `route()` and `classified_as` are untouched, it fires only where a person is looking, the panel prints every signal so somebody can disagree with one of them rather than with the machine, and the button is the same reclassify the select box above it already performs — after which the primary button changes from an enquiry to a tender and a person still presses the thing that creates. Quiet when the router already said tender; speaks on `needsReview`, which is where a real dossier lands when its subject is a reference number and nothing else. Attachments counted off what the MESSAGE carried, never what came out of a zip, so the archive is one signal and its contents are not eight more. Twelve tests. |
| 2026-09-09 | 2.4a | `e9a2a38` | The answer, and neither candidate was right about why. The wire is fine: `ingestDocument` calls `proposeFields` on the pages it just read and inserts every proposal into `extraction_field`, so the pipeline does not end a function short — running it by hand over the stored page text of all 32 read dossiers reproduced **0 fields** exactly. The line-break theory is wrong too: every cue was searched again with each document's whitespace collapsed to single spaces and not one cue appeared that had not appeared already. It is the cues, and the reason is that **`RFQ-10023604-26 · Fourniture de Bureau` is a private *consultation restreinte*, not a public marché** — introduction, instructions to bidders, scope, commercial requirements, draft contract, invoicing instructions, with no *avis d'appel d'offres*, no *séance d'ouverture des plis* and no *caution de soumission*, because a private client asking six suppliers for office furniture holds none of those. The six fields `proposeFields` looks for are the six facts on the front page of a PUBLIC règlement de consultation, and this reader has not yet met one on this database; exactly two of the 32 documents contain any cue at all. **And there is no submission deadline in this dossier in any shape** — every line of all six readable files was scanned for a French date, named month or numeric, and there is not one date anywhere: the instructions *refer* to "la date limite de depot de l'offre" and never state it, because it came in the covering email. So 2.4a's own done-when cannot be met by this dossier by any reader that is not inventing one, and that is now a test asserting nothing is proposed from those two verbatim lines. One cue was taken, on evidence: the same file says at 1.6.18 "L'offre doit rester valable pour une période minimale de 180 jours calendaires", which is `offerValidity` stated as an obligation rather than labelled as a field — adding `rester valable` and `demeurer valable` takes the whole database from **0 proposals to 1** (`offerValidity = 180 jours`, 0.9, cited to page 4) with **nothing else on the database gaining anything**, which is the number that matters. The real sentence is the fixture, and so is the delivery clause it must not fire on. What was not taken is now **2.4b**: a cue in a heading never reaches its value, which makes every numbered French administrative document — a public RC included — unreadable wherever the label and the fact sit on different lines. |
| 2026-09-09 | 2.4b | `6a72b02` | A cue in a heading reaches the value under it. `proposeFields` only ever looked inside the cue's own sentence, so a numbered French document — which says the label and then says the fact, over lines a PDF text layer has already broken — was unreadable by construction, public règlement de consultation included. The window is **two lines, measured rather than chosen**: the rate in `F_RFQ-…_Projet de Contrat.pdf` sits eleven lines below "ARTICLE 13 – PENALITES DE RETARD", and a window that spanned eleven would reach halfway into the next article and read whatever number it found there — a guess with a citation attached. It does not need to, because the document repeats its own words: clause 13.3 ends "…paiera au CLIENT des pénalités de" and the very next line opens "retard comme suit : 1 % par jour". What is crossed is a line break, not a paragraph. **The citation follows the value, not the cue** — a person confirming a rate has to see the rate on the page they are sent to, and a citation pointing at a heading is a field nobody can check, the one thing screen 40 may not produce — while `articleAbove` still names the article, so it reads "p12 · article 13" and quotes the line that states the rate. `readBelowCue` says the heading is above the line and costs 0.15, which puts every below-cue reading under the 0.8 auto-confirm threshold for all six rules. Two guards, both from real text: **dot leaders** mean a table of contents, where the line under one heading is the next heading, so such a line never looks below itself; and a **heading plus the clause under it that restates the value** is one reading arrived at twice, not two candidates — hits are made distinct by rule, page and line with the direct reading winning, without which "the document says this more than once" would have been permanently on, that being the commonest layout there is. **Measured over the 32 stored dossiers, before and after: 1 proposal → 2**, the new one `latePenalty = 1% par jour` at 0.55 with its caveat, cited to page 12 article 13; **nothing else on the database gained anything** — no CV, catalogue, invoice or company profile proposes something it did not before, which is the false-positive count the task asked for and it is zero. Six tests, every fixture verbatim from the real file. |
| 2026-09-09 | 2.4 | `a4c57f2` | The last arrow. Six facts a person had checked against the page they came from stopped at `extraction_field`, which nothing outside screen 40 reads — so a deadline confirmed on Tuesday was still not on the deal on Friday, and `deal.required_validity_days` and `deal.late_penalty` had **no writer anywhere in `src/app`**, meaning the checks in `sourcing-store.ts` and `offer/submit.ts` that compare a supplier's answer against what the client requires had been comparing against null, silently, on every deal there has ever been. `intake_dossier.deal_id` (migration 0058, one additive column) and `commitDossierToDeal`. **LAW 2 governs the whole module**: it reads `status IN (confirmed, corrected) AND confirmed_at IS NOT NULL` and nothing else, and a test proves a dossier of proposed and rejected rows leaves the deal untouched. The mapping: deadline → `deal.deadline_at`; penalty → `deal.late_penalty` **verbatim**, because it is contractual language; validity → **both** `deal.required_validity_days` (what screen 67 checks a supplier against) and `tender.offer_validity_days` (what screen 08 reads), since writing one leaves the other screen empty, which is the shape of bug this task exists to end; place, opening session and bid bond → `tender`. **Three refusals, each rather than a guess.** A column that already has a value is left alone and reported as `alreadySet` — the deadline on the deal may have been typed by somebody who read the covering email, this dossier is one attachment of seven, and the newest reading is not automatically the truest, so the screen shows what it did not write and a person settles it. A deal with no tender row skips the three tender fields as `noTender` rather than failing the carry, because losing all six over three is worse and "Make this a tender" is one press away. A validity in months is refused as `unitNotDays` rather than multiplied by thirty: the column counts days, and an invisible assumption inside the figure that decides whether our offer still stands is not worth the convenience. A **corrected** value arrives in the format the person typed rather than as ISO, because the box is prefilled with `display` — so `dateFrom` reads ISO first and falls back to `readFrenchDateTime`, and 15/10 does not become the tenth of something; a test pins it. On screen 40 the deal is **not picked from a list**: `intake_message.committed_entity` already holds it, written by screen 02 the moment somebody turned the message into a deal, so the panel names the deal and offers, and it appears only once something has been confirmed. Gated on `offers.issue` on top of `inbox.view` — the same permission 2.1 chose for "Make this a tender", because both change what the company commits itself to, and a server action is a public endpoint a triager must not set a deadline through. Eight integration tests. |
| 2026-09-09 | 2.4c | `64fe4ef` | The seventh field. `deal.required_delivery_days` was the one column 2.4's done-when named that still had no writer, and the gap was upstream: `FIELD_KEYS` had six entries and none was a delivery time, so nothing ever proposed one — while `requestFor` in `sourcing-store.ts` selects that column on every sourcing request and screen 67 compares each supplier's promised lead time against it. **A check that cannot fail is a check nobody knows is off**, and that one had been comparing against null on every deal there has ever been. `deliveryTime` is the seventh key with its own rule, kept apart from `offerValidity` in the VOCABULARY rather than in a rule ordering somebody could break by moving a line — *validité* and *livraison* are different words. They are opposite obligations: a validity is how long OUR price stands, a delivery time is how fast the CLIENT requires the goods, and reading one as the other would put a lead time into the field screen 12 uses to decide whether our offer has expired. What the rule reads is a NUMBER and a person confirms the meaning: *"inférieur ou égal à 15 jours"* is a maximum the client set, which is what the column holds, and *"à partir de 15 jours"* is the opposite claim in nearly the same words — no regular expression should be trusted to tell those apart on a document that decides a penalty. Base 0.8, under a validity's 0.9, because a contract mentions delivery in a dozen clauses and one of them is the requirement. **Weeks are converted and months are still refused**: a week is seven days everywhere and always, which is exactly what a month is not — one is arithmetic, the other an assumption. The extract test that asserted nothing was read from the real delivery clause becomes the boundary between the two rules; that assertion was true and was only half the point, since the requirement was sitting on the page unread and the column had no writer because of it. **Measured over the 32 stored dossiers: 2 proposals → 3.** The new one is `deliveryTime = 15 jours` at 0.65 with `readBelowCue`, cited to page 3 of `C_RFQ-…_EtenduedesFournitures_.pdf` on the line that states it — 2.4b's window reaching under a heading with no new mechanism. Nothing else gained anything: three of the six readable RFQ files now each propose one field, and the other 29 documents propose nothing, as they should. |
| 2026-09-09 | 2.5 | `68ac49e` | The deal names the next thing to do. Eight cards rendered at once in the order somebody happened to write them, every one equally loud, so a person opening an enquiry had to read all eight to find the one waiting on them — and the answer is usually one line. `dealChecks` returns `submitChecks`' shape and **imports `CheckState` rather than redeclaring it**, so screens 12, 18 and 06 cannot drift into meaning different things by the same four names. The order is the run itself — decide, know what was asked for, know when it is due, get prices, put an offer out, hear back, invoice — and `nextStep` takes a blocker before a warning before a note, which is the one line the header prints with the button that does it. **LAW 1 throughout**: computed from `DealFacts`, which `getDeal` already builds on every load, plus four columns the page has in its hands; no new query and no column, because a stored `progress` would be a second opinion that goes wrong the first time somebody issues an offer from a screen that forgot to update it. Three judgements worth naming: **asking suppliers warns rather than blocks**, since a price on file from last month is a legitimate way to build an offer and an ERP that refuses to quote without a fresh sourcing round is one people work around in Word — and it stops asking once an offer exists; **waiting on the client is a note, not a failure**, the same reasoning screen 12 gives "proof of submission — pending"; and **a closed deal gets one line saying how it ended** rather than a list of everything it never did, all of which would be true and none of it anything to do. Two links are deliberately absent and both are recorded under Known gaps. The offer check points at the **draft** when there is one, because LAW 5 says a draft is not an offer out and sending somebody to a form that makes a second one is how you get two drafts. Every check carries its own `detail` including the failing one — the sentences are ICU `select` and `plural`, which throw rather than degrade when their argument is absent, so a check that supplied it only on success would have crashed the deal page on exactly the deals the panel exists for; a test walks every shape and asserts it. Twelve unit tests. |
| 2026-09-09 | 2.7 | `39633bd` | Screen 08 gets its five presses. `markSubmitted`, `recordCaution`, `addPiece`, `removePiece` and `saveCredential` were written, transactional and tested when the tender module was built and had no caller outside `tests/`, so the folder could only be read. **`saveCredential` is the one that mattered, and the reason is `pieceState`**: a credential-backed piece is `missing` until the company paper behind it has a scan ON FILE, so nine of the nineteen rows a new tender seeds could go red and stay red with nothing anywhere in the ERP able to file one — the screen would have been all red the day it first had data, for a reason nobody could act on. The form is on the red row rather than behind a link to a settings screen: the person who finds out that the CASNOS attestation expires four days before the deposit is the person holding the folder. Filing a scan needed somewhere to put it and something to serve it with, so **migration 0059** adds `file_name` and `file_type` to `company_credential` and `credential` becomes the fifth kind in `FILE_KINDS` — the id is the credential KEY and not a uuid, because the key is the primary key of that table, so a link printed on a tender page keeps resolving to whatever is current rather than to the scan that was current when the page was written. `NEEDS.credential` is `null`, the same decision `serving.ts` makes for an item datasheet: the company's own attestation is a record, and whoever is assembling a folder at eight in the morning is exactly who needs to open it. **Two permissions, not one.** The four presses about THIS tender are `offers.issue`, the same as "Make this a tender" on screen 06 — a Commercial who cannot tick off the pieces of the tender he is depositing keeps the list on paper instead. Filing a company paper is `settings.company` and deliberately narrower: that row is held once and read by every open folder at once, so one wrong expiry date turns nine folders green together, which is the class of fact the RC and the NIF are. Both controls grey with a sentence rather than disappearing. **Three things tightened on the way past rather than left.** `removePiece` wrote `{ removedPiece: <uuid> }` into the audit entry of a row it had just deleted — the id of something that no longer exists, which outlives nothing anybody can read, while the HARD RULE's words are "an audit entry that outlives the record"; the row is now read inside the transaction and its key, label, section and file go into `before` first, and a piece that is not this tender's is refused instead of deleting nothing and logging that it had. `saveCredential`'s upsert replaced the whole row, so a save with no file chosen would have blanked `file_id` and taken every folder that paper backs from ready to missing because somebody corrected a reference number — absent now means keep, `null` means take it off, and they are different presses. And both piece presses are refused after a deposit, in the action as well as greyed on the screen, because `disabledReason` sets `aria-disabled` and a greyed submit still submits. Eleven unit tests in `tender-folder.test.ts`, holding the three lists that have to agree — what the actions can redirect with, what the page will print, and what both message files have words for: an action refusing with a code the page does not allow lands on a screen showing nothing at all, so the press looks as though it worked, the folder is unchanged, and nobody is told. What is still open is under Known gaps. |
| 2026-09-09 | 2.6 | `8f31b2e` | Both weekly runs are numbered, and neither stores a thing. Screen 85's pattern — numbered computed steps, done ones green with no button, the one holding everything up with a primary button — is now `src/components/ui/stepper.tsx`, shared by screens 06 and 08 so the three cannot drift into three ideas of what a step is. **The enquiry half is not a second panel.** 2.5 had already put a next-step list on screen 06 and a second one beside it about the same run is the clutter this wave exists to remove, so `dealChecks` grew the two rungs the audit's run named and the checks did not carry. **Prices in**: an offer is built from `price_quote` rows, so "no prices yet" is the real answer to why the next step cannot be taken, and until this counted them the panel could only tell somebody with nothing to price with to go and make an offer. It is deliberately NOT `suppliersAsked` under another name — a price a man gave over a counter in Adrar is a price and nobody was asked for it, so a deal can pass this step having failed the one above, and a test pins exactly that pair. **Bon de livraison**: a NOTE and not a warning, which is the judgement worth reading twice — plenty of won deals are invoiced with no BL at all, a service having nothing to deliver and collected goods leaving with a signature on somebody else's copy, so an amber row on every service deal SUPSERV has ever done is how a panel teaches people to stop reading it. Both counts live on `DealFacts` and are counted in `factsFor`, which is the queue's own instruction and LAW 1's reason: a fact the page fetches for itself is a fact the deal list cannot see. **Neither joins `stageOf`** — "delivered" would be a stage most won deals skip, and a shop-counter price cannot mean sourcing because sourcing means somebody was asked — and two tests refuse it. **The tender half** is new work on a page that had no stepper and, until 2.7 an hour earlier, no actions either: `tenderSteps` computes folder → BPU priced → caution → submitted in the same shape, importing the same `CheckState` as screens 12, 18 and 06. Four judgements in it: an EMPTY folder warns while an incomplete one blocks, because "this consultation asks for no papers" is an answer somebody gives by leaving it alone; no bordereau is a note since not every tender has one, while an imported and part-priced one blocks, an unpriced line being what the desk reads as an omission; the bond appears only when the cahier des charges asked for one, read from the tender's own amount or percentage and NOT from whether the folder carries a `caution` piece — `seedFor` leaves that piece out of an RFQ, so reading it off the folder would make a numbered step appear and disappear as somebody edits pieces, renumbering the deposit under it — and asked-for-not-back warns rather than blocks, because the bank takes days and nobody can go faster; and a DEPOSITED tender reads as finished rather than as a list of failures, the same way screen 06 treats a closed deal, since the folder is what was handed over and what was missing at that moment is already in `markSubmitted`'s audit entry. **Numbering changes what a bug costs**, which is why two of the new tests are about order alone: before this a check in the wrong place read oddly, and now it prints a 3 above a 2. The number is the row's index in the rendered run — screen 85's own `i + 1` — so a step that does not apply costs no gap. `NO_COUNTS` replaces four copies of the same object literal; the compiler found all four when `DealFacts` grew, which is the cheap version of that lesson, and screen 56's timeline was one of them and spreads it now rather than naming counts one by one. Twenty-nine unit tests across three files. What is still open — screen 85 being the odd one out, and the `bpu()` call screen 08 now makes — is under Known gaps. |
| 2026-09-09 | 2.8 | `e5ca970` | The bordereau says where it came from on a deal that is not a tender. `importBpu` updated the `tender` row unconditionally; on a plain enquiry there is no such row, so the update matched nothing, returned cleanly, and the filename went nowhere — screen 42's header went on saying the lines had been typed, about forty-two figures that came out of a spreadsheet. Not an unreachable path: `bpu()` leftJoins the tender and the page only 404s on a missing deal, so screen 42 has always worked on a plain enquiry. **The provenance was never actually lost, only unreachable by the header**, and that is what decided the fix: `commitBpuBatch` writes one `import_batch` row per sheet with the filename, the deal and the moment it was imported, and screen 42's own Sources tab has been listing them all along. `importedFrom` reads the newest of them — `becomes: deal_line`, `status: imported`, newest first — and `bpu()` falls back to it when the tender column is null. **No new column**: the two `tender` columns turn out to be a cache of that batch, and they are still written, because `unmakeRefusalFor` refuses to undo a tender conversion once a BPU has been imported and that refusal reads them. A fallback rather than a replacement, so a deal whose lines were imported before `import_batch` carried them keeps whatever the tender row remembers, and so a tender costs no extra query. `importBpu` now also knows which of the two happened and says so — `{ imported, provenanceOn: "tender" | "batch" }` — with `provenanceOn` written into the audit entry beside the filename, where it answers "where did these forty-two lines come from" whatever later happens to the tender row, including the conversion being undone, which deletes it. Deliberately **not** a refusal: importing a bordereau onto a plain enquiry is a legitimate thing to do, and refusing it would remove a working path in order to fix a header. Four integration tests — both branches the done-when named, plus the two batches that must NOT be mistaken for the source: an erratum, which is a different sheet answering a different question, and a batch abandoned at the mapping step, which is a file somebody opened and thought better of. Either one claiming to be where the bordereau came from would be worse than a header that says nothing. |
| 2026-09-09 | 3.4 | `159f69b` | Six routes that existed, worked, and could be reached only by typing a URL. Two of them are the ones that exist ONLY to make gaps visible — screen 31 says what this system does and does not do and why there are no module switches, screen 46 says the website intake form is the one way in that is not built and names what it would need — so a screen about what is missing was itself missing from every menu, which is a joke the system was playing on itself. They go on the settings hub in **a group of their own** rather than appended to `control`, because nothing on either can be changed: they answer "what is here", not "how is it set up". That hub's own opening paragraph had already asked for it — "a setting that exists in the design and nowhere in the app should still be visible, or nobody knows it is missing". `/deliveries/new` gets a primary button on Deliveries, greyed with the reason for a role that cannot issue one: the screen that STARTS a delivery was missing from the screen that lists them. `/candidates` gets a button on People, the other half of that screen. **The two phone-bar-only routes are treated differently, on purpose**, and the phone bar is `md:hidden` so on a laptop neither existed at all. Approving is a DESTINATION somebody opens between two other things, so it joins the rail's control group — and 3.1 keeps Approvals as one of its eleven rows, so it is arriving early rather than moving twice. The counter price is not a destination: `src/mobile.ts` is explicit that there are four phone jobs and this is one of them, so it gets a button on Sourcing, the screen about gathering prices, where capturing one on a laptop is the exception rather than the shape of the screen. No new screens, no new domain code, nothing that can be pressed twice — six links and their copy in both languages. What this does NOT do is stop the next one: nothing in the gate checks that a route is linked from anywhere, and all six were found by a person reading the tree. That check, and the fact that the rail is 25 rows now on the wave that exists to cut it to eleven, are under Known gaps. |
| 2026-09-09 | 3.2 | `f6e285f` | Six empty screens that now say what to do. Tenders, Sourcing, Offers, Orders, Deliveries and Payments had zero primary buttons between them, and five of the six answered an empty screen with a grey sentence in a corner — "No requests recorded." is true, and it does not say what a request is, where one starts, or what would appear here once one existed. `StateBlock` was drawn for exactly this on screen 34 and its `action` slot had never been used outside an error page. **Three of the six are judgements rather than defaults.** **Orders gets TWO buttons**: a client's order arrives against an offer we sent and is recorded from the deal, a purchase order goes out to a supplier once their price has been chosen, from the sourcing comparison — this list holds both kinds and its own facets say so, so a single primary would be the wrong one about half the time, which is the failure `dealChecks` avoids by giving its invoice check no link at all. **Payments gets NONE**: the recorder is on the same screen, above the list it is rendered inside, so a button would scroll somebody four inches to a control they can already see — what was missing was the sentence saying so and where to find what is still owed. **Deliveries reuses `/deliveries/new`**, which 3.4 had linked an hour earlier and which had no way in at all before that, and it greys with the same reason the header button does for a role that cannot issue one. Offers changed least and matters most as a precedent: it already had the right words in hand-written markup that reproduced `StateBlock` line for line — same heading size, same 460px measure, same centring — and stopped one element short of it, and two copies of a component is how the third comes to look slightly different. On Deliveries and Payments the block REPLACES the card rather than sitting inside it, because `StateBlock` draws its own border and one bordered box centred inside another is the look of a component used where it does not belong. `tenders.none` needed no fixing — 2.1 had already made "open the deal and press Make this a tender" a true instruction — so it reads as the body here. The other ~54 are three different problems wearing one number, and which of them is worth a sweep is under Known gaps. |
| 2026-09-09 | 3.3 | `979c3ff` | Deals and Sites, in English, everywhere. **Not one English string in `en.json` says "enquiry" any more** — 78 of them did — and the Chantier screens say Site rather than Project across nav, titles, body copy, empty states and errors. French is untouched and the routes do not move. **The two words the queue left to judge are decided.** *Sourcing* stays Sourcing for *Approvisionnement*: it is the standard English procurement word, the route is already `/sourcing`, the nav already says it, and the screen is exactly what the word means. And **"Ageing and relances" becomes "Ageing and reminders"** — a French word sitting inside an English sentence on two screens, which is a gap in a translation rather than a translation; English now reads Payments beside Ageing and reminders, one word each. **`project` was deliberately NOT swept by regex**, and that is the care this needed: it is a real English word in this file meaning a job title ("Project manager"), a research project, and the repository folder a storage path falls back to. Only the 36 strings under an explicit key list moved, and the storage one was renamed to "Fallback inside the repository" so no English string here uses the word for two things. Six English strings still contain *project* or *chantier* and every one is right — a role name, two job titles, a French trade placeholder, "a research project", and "A projection". Twenty-three more were rewritten BY HAND rather than substituted, because the right English was a judgement: an email template acknowledges a REQUEST and not a record (French says *demande* there and *affaire* for the record, and English draws the same line), the Inbox creates the deal, a person is put on a site. **The static keys moved too** — the `enquiry` and `newEnquiry` namespaces became `deal` and `newDeal`, plus twelve individual keys, 87 references across 16 files — and `messages.test.ts` is what made that safe, resolving every literal key used in the interface and the literal prefix of every key built from a value. It earned its keep on the first run: it caught a property-access reference in `tender-conversion.test.ts` that a literal rewrite could not see. **Seven keys stay, and they are the honest limit of a copy pass**: `inbox.type/facet/action.*` and `capture.shape.*` are built from `intake_message.classified_as` and the capture enum, `emailTemplates.name/when.*` from `email_template.key`, `assistantSafety.tool.*` from the assistant's tool name. Renaming any of them is a migration over data, not a copy change, and none is user-visible — a person reads the value, and every value now says deal. So the done-when's grep reads 7 rather than 0; the seven are tabulated under Known gaps with what each would cost. The French drift the English just lost — *Affaire* against *Consultation*, *Règlements* against *Encaissements* — is a question under Needs Abdou rather than a guess taken here. |
| 2026-09-09 | 3.5 | `259fc32` | Two rows demoted, neither deleted. **Dashboard** leaves the rail and lives on Reports: it answered the question Today answers and the question Reports answers and did neither as well, and three competing answers to "what should I look at" is how a person stops trusting all three. It had no other link anywhere in the app, so that one link is the whole of what taking the row away owed it. **Files** leaves the rail and sits beside Storage on the settings hub with a count, for a sharper reason than the dashboard's: a file browser is not a destination inside an ERP. `src/domain/files` is explicit that there is no `file` table and there is not going to be one — every file already belongs to the message, dossier, import, item or company paper that brought it in, and that is where a person looks for it — so what screen 60 is genuinely for is "the bytes are somewhere, where", which is a storage question. It was already reachable from `/settings/storage`; this makes it one click from Settings rather than two. **`/week` needed nothing at all**: the task names it and it turns out it was never in the rail, because Today has linked it since it was built — written down rather than quietly skipped, since the next person to read the task would otherwise go looking for what changed. The rail is **23 rows**: 3.4 took it to 25 by promoting Approvals off the phone bar, this takes it to 23, and 3.1 is what takes it to about 11 — blocked on one paragraph about where five screens live, Sourcing above all. Nothing here pre-empts any of those five. |
| 2026-09-09 | 3.6 (1/4) | `38f6b10` | Tenders on the shared table. Screen 07's raw `<table>` had no filters, no saved views, no column menu, no sort and no way to export what is on screen — every one of which `DataTable` has had since screen 79 was built, on four screens out of fifty-seven, while CLAUDE.md says reuse and never rebuild. `tenders-list.tsx` follows `deals-list.tsx` exactly and **the shape is the point: every field that crosses to the client is already formatted** — a date is the string that will be printed, a badge is a tone and a label rather than a rule about a deadline — so `getFormatter` and `deadlineDisplay`'s arithmetic stay on the server where the locale and the deal's facts already are. A client component recomputing "closing soon" would be a second opinion about the one figure this screen exists to be trusted about. Two decisions that hold for the remaining three: **the facet chips stay above the table** rather than becoming `filterFields`, because they are counted server-side by `tenderCounts` and they live in the URL, and a filter panel answering the same question a second way would be two controls arguing over one list; and **the empty state is rendered on the server and handed in**, because 3.2 gave this screen a `StateBlock` with a real button an hour earlier and `DataTable` draws its `emptyState` in place of the rows — passing that block in keeps one empty state on the screen instead of one above the table and one inside it. Submission method becomes an optional column, off by default: it matters on the day and it is the column somebody scrolls past on every other day, which is what the columns menu is for. Three screens left, named in the task, and Payments is the awkward one — its table is rendered inside the `RecordPayment` form, so the form's shape has to be settled first. |
