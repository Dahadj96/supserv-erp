# ACCEPTANCE — is the plan finished?

`docs/PLAN.md` §7 ends every phase with a **Done when** sentence. This file
answers each one by naming the tests that prove it, and by naming what is not
proved rather than leaving it to be assumed.

`tests/unit/acceptance-map.test.ts` reads this file and fails if any test cited
here has been renamed or deleted. A map nobody checks against the thing it
describes drifts — that lesson is already written into `docs/SCREENS.md`, and
it applies twice as hard to a document whose entire purpose is to say the work
is done.

**Not proved here** sections are load-bearing. Every one of them is a thing a
person still has to do by hand, or a claim no automated test can make.

---

## Phase 0 — Shell and the interface layer

> a person can sign in, switch to Français, and see an empty Deals list that
> explains itself.

- `tests/unit/route-auth.test.ts` :: "serves nothing without a session except the sign-in flow"
- `tests/unit/route-auth.test.ts` :: "checks the session in every route handler itself, since a handler has no layout"
- `tests/integration/users.test.ts` :: "lands the role and names who gave it"
- `tests/integration/users.test.ts` :: "takes a role away, and the row goes rather than holding an empty string"
- `tests/unit/messages.test.ts` :: "has the same keys in French and English"
- `tests/unit/messages.test.ts` :: "resolves every literal key used in the interface"
- `tests/unit/messages.test.ts` :: "resolves the literal prefix of every key built from a value"
- `tests/unit/intl-fallback.test.ts` :: "is never blank"
- `tests/unit/screen-coverage.test.ts` :: "every screen that should have a route has one"
- `tests/unit/screen-coverage.test.ts` :: "every nav entry goes somewhere"
- `tests/integration/setup.test.ts` :: "refuses to let anything be issued while a blocking step is open"

**Not proved here.** The Entra sign-in round trip. It leaves this machine, goes
to Microsoft, and comes back — no test in this repository can perform it, and
one that mocked it would be testing the mock. It is checked by signing in.

---

## Phase 1 — Records and search

> TOUATGAZ is findable by four spellings and two duplicate rows merge into one
> without losing a document.

- `tests/integration/search.test.ts` :: "puts an exact code match first"
- `tests/integration/search.test.ts` :: "names the alias when the alias is what matched"
- `tests/integration/search.test.ts` :: "does not blame an alias when the legal name matched"
- `tests/integration/search.test.ts` :: "hides a soft-deleted company without losing it"
- `tests/integration/search-people-items.test.ts` :: "finds an item by what the supplier calls it, and says which alias matched"
- `tests/integration/merge.test.ts` :: "merges, and the invoice survives with its number"
- `tests/integration/merge.test.ts` :: "adds both alias lists together — aliases are never a choice"
- `tests/integration/merge.test.ts` :: "still finds the retired reference, and lands on the survivor"
- `tests/integration/merge.test.ts` :: "refuses to merge a record that was already merged away"
- `tests/integration/merge-preview.test.ts` :: "treats aliases as a union, never a sum"
- `tests/integration/item.test.ts` :: "remembers across enquiries — a different client, the same words"

Proved end to end.

---

## Phase 2 — Capture

> a TouatGaz consultation email becomes a deal with a confirmed deadline, and
> none of the twelve expire unread.

- `tests/integration/inbox.test.ts` :: "puts the thing with a deadline at the top, whenever it arrived"
- `tests/integration/inbox.test.ts` :: "names what is expiring rather than counting it"
- `tests/integration/inbox.test.ts` :: "marks a deadline nobody has confirmed as unconfirmed"
- `tests/integration/inbox.test.ts` :: "treats a person's classification as certain"
- `tests/integration/inbox.test.ts` :: "says which actions have somewhere to write, and what the rest are missing"
- `tests/integration/text-layer.test.ts` :: "goes from a PDF to proposed fields with citations, end to end"
- `tests/integration/text-layer.test.ts` :: "refuses to pretend a scan was read"
- `tests/integration/scan-folder.test.ts` :: "reads a scanned PDF and moves it out of the way"
- `tests/integration/import.test.ts` :: "imports, allocates references, and makes the trade name findable"
- `tests/integration/import.test.ts` :: "undoes to the bin, not to nothing"

**Not proved here.** The fetch from the real mailbox. `MS_MAILBOX_SCOPE_CONFIRMED`
is still false and the application permission has not been scoped, so nothing
has ever read a message out of Microsoft 365 into this database. Everything
downstream of that first read is tested; the read is not, and it is not honest
to say phase 2 is finished until a real consultation email has come through it.
See `docs/MAILBOX-ACCESS.md`.

---

## Phase 3 — The document engine

> the same offer renders in French for a client and English for a supplier,
> from one template family, with the right signature block.

- `tests/integration/engine.test.ts` :: "takes the language from the counterparty, not from anybody signed in"
- `tests/integration/engine.test.ts` :: "pulls the company identity from master data, never from a template"
- `tests/integration/engine.test.ts` :: "allocates the number and freezes the document"
- `tests/integration/engine.test.ts` :: "refuses to issue the same document twice"
- `tests/integration/engine.test.ts` :: "never allocates the same number twice, even under a race"
- `tests/integration/engine.test.ts` :: "reserves no number on a preview"
- `tests/integration/pdf.test.ts` :: "renders the same document in English for a counterparty who reads English"
- `tests/integration/pdf.test.ts` :: "prints the four identifiers décret 05-468 requires"
- `tests/integration/pdf.test.ts` :: "prints the bank domiciliation"
- `tests/integration/pdf.test.ts` :: "prints the amount in words"
- `tests/integration/reprint.test.ts` :: "gives back the ORIGINAL document after the company moves and renews its RC"
- `tests/integration/document-types.test.ts` :: "gives every accounting document a reserved number"

Proved end to end.

---

## Phase 4 — Sell side, end to end

> an RFQ with items pasted from an email body reaches a sent offer with a
> complete annexe technique, and every price says where it came from.

- `tests/integration/offer-build.test.ts` :: "turns the pasted list into lines, keeping the client's references"
- `tests/integration/offer-build.test.ts` :: "carries a supplier's answer onto the offer as the cost"
- `tests/integration/offer-build.test.ts` :: "records how many lines arrived with a real cost behind them"
- `tests/integration/offer-build.test.ts` :: "leaves a line with no cost unpriced rather than inventing one"
- `tests/integration/sourcing.test.ts` :: "creates a request drafted, not sent"
- `tests/integration/sourcing.test.ts` :: "keeps a bounced address distinguishable from a silence"
- `tests/integration/sourcing.test.ts` :: "compares the two quotes line by line"
- `tests/integration/deal.test.ts` :: "moves to offer out when an offer is issued, and not before"
- `tests/unit/prices.test.ts` :: "is written, verbal, or ours"
- `tests/unit/prices.test.ts` :: "counts what is priced, what is doubled up, and what is not touched"
- `tests/unit/prices.test.ts` :: "calls a line verbal-only when there is nothing written to fall back on"
- `tests/unit/technical.test.ts` :: "blocks submission when the client asked and there are gaps"
- `tests/unit/technical.test.ts` :: "does not block when the client never asked"
- `tests/unit/technical.test.ts` :: "says where the files it holds came from"
- `tests/unit/technical.test.ts` :: "refuses to build an annex with nothing in it"

---

## Phase 5 — Money

> proforma → invoice → payment → statement runs without a spreadsheet, and
> “overdue” is computed, never stored.

- `tests/integration/convert.test.ts` :: "creates a draft facture with no number"
- `tests/integration/convert.test.ts` :: "leaves the proforma exactly as it was"
- `tests/integration/convert.test.ts` :: "refuses to convert the same proforma twice"
- `tests/integration/delivery.test.ts` :: "refuses to deliver against something the client never agreed to"
- `tests/integration/bill.test.ts` :: "raises a draft facture for the delivered quantities"
- `tests/integration/bill.test.ts` :: "does not offer the same quantity twice"
- `tests/integration/payments.test.ts` :: "computes the balance from allocations, with no column to disagree"
- `tests/integration/payments.test.ts` :: "puts the part-paid invoice in over-90 at its remaining balance"
- `tests/integration/payments.test.ts` :: "derives paid, part-paid and draft from the rows, not from a status column"
- `tests/integration/payments.test.ts` :: "drafts a chase and sends nothing"

Proved end to end.

---

## Phase 6 — Organisation

> two people run the company for a week without opening OneDrive.

- `tests/integration/notes.test.ts` :: "is read by Today from HERE, not copied into a second list"
- `tests/integration/notes.test.ts` :: "drops out of what is due once it is marked done"
- `tests/integration/approvals.test.ts` :: "blocks the action until somebody decides"
- `tests/integration/approvals.test.ts` :: "clears the action once the Gérant approves"
- `tests/integration/approvals.test.ts` :: "lists what is still waiting apart from what has been decided"
- `tests/integration/deletion.test.ts` :: "never a blank 404 — the old link explains itself"
- `tests/integration/deletion.test.ts` :: "restores it, and search finds it again"
- `tests/unit/week.test.ts` :: "shows nothing this page could show that Today could not"
- `tests/unit/week.test.ts` :: "holds client deadlines and compliance expiry fixed"
- `tests/unit/waiting.test.ts` :: "counts from the ask when nobody has chased"
- `tests/unit/waiting.test.ts` :: "restarts the clock when somebody chases"
- `tests/unit/waiting.test.ts` :: "does not mark a bounced address as quiet too long"
- `tests/unit/files.test.ts` :: "keeps raw correspondence away from lecture and chantier"
- `tests/unit/files.test.ts` :: "cannot be broken out of by a filename"
- `tests/unit/files.test.ts` :: "downloads HTML rather than running it"

**Not proved here.** Finished documents are not filed anywhere yet.
`storageFor("final")` throws, screen 66 reports SharePoint as `notConnected`,
and it waits on the `Files.ReadWrite.All` permission. Working files — fetched
attachments, scans, workbooks — are on this machine and are covered above. So
the sentence is true of the working half of a week and not yet of the archive.

---

## Phase 7 — Control and the assistant

> the assistant can answer “what is late and why” with citations, and cannot
> change anything without a human pressing approve.

- `tests/integration/assistant-late.test.ts` :: "finds a deadline that has already passed, and says how long ago"
- `tests/integration/assistant-late.test.ts` :: "cites a screen where the same row can be seen"
- `tests/integration/assistant-late.test.ts` :: "says how much it examined, so silence can be told from emptiness"
- `tests/integration/assistant-late.test.ts` :: "changes nothing"
- `tests/integration/assistant-proposals.test.ts` :: "creates no relance"
- `tests/integration/assistant-proposals.test.ts` :: "refuses one with no citations"
- `tests/integration/assistant-proposals.test.ts` :: "creates a relance, in draft, unsent"
- `tests/integration/assistant-proposals.test.ts` :: "records the decision as the PERSON, not the assistant"
- `tests/unit/assistant.test.ts` :: "never deletes, even what it may write"
- `tests/unit/assistant.test.ts` :: "keeps the applier in src/domain, where writes are allowed"
- `tests/unit/assistant.test.ts` :: "never lets the assistant do more than the person"
- `tests/unit/assistant.test.ts` :: "has no tool implementing any of them"
- `tests/unit/transitions.test.ts` :: "refuses an undeclared one, and says which"
- `tests/unit/transitions.test.ts` :: "has no edge from issued to draft, from anywhere"
- `tests/unit/transitions.test.ts` :: "issuing is guarded by the STATUS, not by the number"
- `tests/unit/transitions.test.ts` :: "declares each one, or exempts it on purpose"
- `tests/unit/audit.test.ts` :: "shows a nested object as JSON rather than as a type name"
- `tests/unit/audit.test.ts` :: "names every entity in both languages"
- `tests/integration/compliance-profile.test.ts` :: "turns a warning into a refusal the moment somebody puts a name to it"

Proved end to end.

---

## What is not a phase, and is still not done

These are not acceptance criteria and no test can close them. They are here
because a document called ACCEPTANCE that omitted them would be a document that
tells you what you want to hear.

1. **Day one has never been run.** `company_identity`, `bank_account`,
   `vat_rate` and `numbering_series` are all empty, so nothing can be issued at
   all. `/fr/setup`, four forms. The gate that enforces this is tested; the
   forms have never been filled in.
2. **The ERP is not registered as a service.** See the box at the top of
   `docs/RUNBOOK.md`. One command, as Administrator.
3. **The backup is on the same disk as the database.** §5b of the RUNBOOK.
4. **The mailbox has never been read.** Phase 2, above.
5. **SharePoint is not connected.** Phase 6, above.
6. **Ten screens are parked** until after the first release — `docs/SCREENS.md`
   lists which, and that was a decision, not an omission.
