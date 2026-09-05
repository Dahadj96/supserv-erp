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
- `tests/integration/document-types.test.ts` :: "gives every accounting document WE issue a reserved number"

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

Screen 68 joined this phase on 30 Aug — it was parked as "tenders module depth"
and is nothing of the sort. The margin an offer is priced on is fiction until
what the supplier bills is compared with what they quoted:

- `tests/unit/purchase-match.test.ts` :: "values a repriced line on what was BILLED, not on what was ordered"
- `tests/unit/purchase-match.test.ts` :: "calls a partial delivery billed correctly EXPLAINED, not a mismatch"
- `tests/unit/purchase-match.test.ts` :: "refuses to explain an invoice for more than arrived"
- `tests/unit/purchase-match.test.ts` :: "does not call the total a match when the full order was billed before it arrived"
- `tests/unit/purchase-match.test.ts` :: "never goes below zero, however much is held"
- `tests/integration/purchase-order.test.ts` :: "counts what arrived per line, through source_line_id"
- `tests/integration/purchase-order.test.ts` :: "does not collapse two lines that read exactly the same"
- `tests/integration/purchase-order.test.ts` :: "reads what has been paid off the bank, not off the terms"
- `tests/integration/purchase-order.test.ts` :: "says the client can be invoiced for what arrived, and not in full"
- `tests/integration/purchase-order.test.ts` :: "writes nothing"

Screens 07 and 08 joined it the same day. `/tenders` had been a dead link in the
sidebar since phase 0, and tenders are how this company gets most of its work:

- `tests/unit/tender-dossier.test.ts` :: "EXPIRES BEFORE DEPOSIT — valid today, useless on the day it matters"
- `tests/unit/tender-dossier.test.ts` :: "does not soften that into 'expiring soon' just because it is within thirty days"
- `tests/unit/tender-dossier.test.ts` :: "does not round a folder that will be refused up to the next number"
- `tests/unit/tender-dossier.test.ts` :: "does not carry a bid bond into a consultation"
- `tests/integration/tender.test.ts` :: "marks the CASNOS attestation as expiring before the deposit"
- `tests/integration/tender.test.ts` :: "leaves the CNAS attestation merely expiring, because it survives the day"
- `tests/integration/tender.test.ts` :: "changes its mind when the paper is renewed, with nothing else touched"
- `tests/integration/tender.test.ts` :: "holds the company's papers once, not once per tender"
- `tests/integration/tender.test.ts` :: "refuses while a piece would have the bid thrown out"
- `tests/integration/tender.test.ts` :: "allows it with a reason, and freezes what was blocking at the time"

Screen 23 the same day, and it needed no schema — every figure is arithmetic
over sourcing rows that already existed:

- `tests/unit/scorecard.test.ts` :: "keeps a bounced message out of the reply rate entirely"
- `tests/unit/scorecard.test.ts` :: "leaves an undecided enquiry out of both halves"
- `tests/unit/scorecard.test.ts` :: "counts only lines where somebody else also quoted"
- `tests/unit/scorecard.test.ts` :: "does not split an article the supplier renamed halfway through the year"
- `tests/unit/scorecard.test.ts` :: "does not blame a supplier for an enquiry we walked away from"

Screen 42 last, and it was the only screen still on the parked list. The
sentence it has to earn is not "a spreadsheet can be imported" — it is that a
bordereau which has been priced for three weeks survives an erratum:

- `tests/unit/bpu.test.ts` :: "reports the QUANTITY when a line changed in two ways at once"
- `tests/unit/bpu.test.ts` :: "reports a reworded line as reworded, not as a delete and an add"
- `tests/unit/bpu.test.ts` :: "keeps the price when only the quantity moved"
- `tests/unit/bpu.test.ts` :: "drops the price when the words changed"
- `tests/unit/bpu.test.ts` :: "covers the priced lines and says how many are not"
- `tests/unit/bpu.test.ts` :: "refuses to call a price with no cost behind it infinitely profitable"
- `tests/unit/bpu.test.ts` :: "says nothing rather than nought when nothing has been bought before"
- `tests/unit/bpu-columns.test.ts` :: "gives a target to the first heading that claims it, not the last"
- `tests/unit/bpu-columns.test.ts` :: "reads the four ways a quantity is written in the same folder"
- `tests/unit/bpu-columns.test.ts` :: "returns null for something unreadable rather than a nought it invented"
- `tests/unit/bpu-columns.test.ts` :: "skips a section heading in silence, because forty of them are not forty problems"
- `tests/integration/bpu.test.ts` :: "refuses a second file against lines that already exist"
- `tests/integration/bpu.test.ts` :: "keeps the price on a line whose quantity moved and expires it on one reworded"
- `tests/integration/bpu.test.ts` :: "stops counting a stale price as a cost"
- `tests/integration/bpu.test.ts` :: "leaves the lines as the buyer numbered them"
- `tests/integration/bpu.test.ts` :: "refuses until somebody says in writing that they know"
- `tests/integration/bpu.test.ts` :: "writes an internal costing only where no cost is held"
- `tests/integration/bpu.test.ts` :: "keeps a discarded erratum as evidence that it arrived"

And from an actual spreadsheet — a workbook built in the test with a title row
above the table, a section heading in the middle of it, a `TOTAL` at the bottom,
quantities written four different ways, and a column nobody asked for:

- `tests/integration/bpu-import.test.ts` :: "finds the header row under the title and proposes the columns"
- `tests/integration/bpu-import.test.ts` :: "reads the quantities however the buyer wrote them"
- `tests/integration/bpu-import.test.ts` :: "passes over the section headings and reports only the total row"
- `tests/integration/bpu-import.test.ts` :: "writes nothing until the mapping is confirmed"
- `tests/integration/bpu-import.test.ts` :: "turns the confirmed mapping into the deal's lines, and remembers it"
- `tests/integration/bpu-import.test.ts` :: "uses the mapping this client already confirmed instead of guessing again"
- `tests/integration/bpu-import.test.ts` :: "lists every file that has been read for this enquiry"

The bytes go through storage and are read TWICE — once to propose the mapping,
once to apply the confirmed one — which is the arrangement screen 62 uses and
for the same stated reason: a preview and an import that parse separately can
quietly disagree about what was in the file.

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

Screens 15 and 16 joined this phase on 30 Aug. `/projects` was the second dead
link in the same rail, and for a company doing travaux the period between
winning the work and the last invoice being paid is most of the year:

- `tests/unit/project.test.ts` :: "counts only what the client has signed as progress"
- `tests/unit/project.test.ts` :: "holds retention on approved situations only"
- `tests/unit/project.test.ts` :: "reports the gap between work done and work billed"
- `tests/unit/project.test.ts` :: "is in WARRANTY once accepted while the client still holds the retention"
- `tests/unit/project.test.ts` :: "projects off the provisional acceptance until then, and says so"
- `tests/unit/project.test.ts` :: "EXPIRES BEFORE ACCEPTANCE — the client can call it in"
- `tests/unit/project.test.ts` :: "is EXPIRED, not gone, when the ticket has run out under a man still working"
- `tests/integration/project.test.ts` :: "reads the payments off the allocations, not off the situation"
- `tests/integration/project.test.ts` :: "names the situation that has been waiting for a signature"
- `tests/integration/project.test.ts` :: "brings the SOONEST-expiring certification through, not the latest"
- `tests/integration/project.test.ts` :: "is stored with a name against it, and shows the gap"

On 4 September the module stopped being read-only: a project is opened on the
enquiry the client said yes to, and the situations are raised against its
bordereau in the wilaya's own "partie co-contractant" layout — see
`docs/DECISIONS/2026-09-04-the-situation-is-the-invoice.md`:

- `tests/unit/situation.test.ts` :: "adds the period to what the earlier situations claimed, line by line"
- `tests/unit/situation.test.ts` :: "flags a cumulative quantity past the marché's rather than refusing it"
- `tests/unit/situation.test.ts` :: "withholds nothing until somebody has said what it is taken on"
- `tests/unit/situation.test.ts` :: "takes 5 % of the HT when the CCAP says so, without touching the VAT"
- `tests/unit/situation.test.ts` :: "takes it on the TTC when the CCAP says that instead"
- `tests/unit/wilayas.test.ts` :: "are fifty-eight, numbered 01 to 58 without a gap or a repeat"
- `tests/integration/situation-flow.test.ts` :: "is a draft whose lines point at the marché's and whose retention is 5 % of the HT"
- `tests/integration/situation-flow.test.ts` :: "is edited on its own screen, not in the builder"
- `tests/integration/situation-flow.test.ts` :: "is issued with a number of ours, then submitted, then approved — in that order"
- `tests/integration/situation-flow.test.ts` :: "carries n° 1's quantities as cumul précédent"
- `tests/integration/situation-flow.test.ts` :: "refuses to issue a situation whose predecessor is still a draft"
- `tests/integration/situation-flow.test.ts` :: "records the provisoire, then the définitive, and never the other way round"

And later the same day, the marché that changes — an avenant is the twentieth
document kind, its lines say which line of the marché each one replaces, and
a situation already issued is read against the bordereau as it stood the day
it went out. See `docs/DECISIONS/2026-09-04-a-marche-that-changed.md`:

- `tests/integration/situation-flow.test.ts` :: "refuses an avenant that changes nothing, and a new price with no price"
- `tests/integration/situation-flow.test.ts` :: "carries only what the paper says: one quantity moved, one prix nouveau"
- `tests/integration/situation-flow.test.ts` :: "changes nothing while it is a draft, and cannot be edited in the builder"
- `tests/integration/situation-flow.test.ts` :: "moves the marché once it is issued, by its own arithmetic"
- `tests/integration/situation-flow.test.ts` :: "leaves the situations already issued exactly as the client signed them"
- `tests/integration/situation-flow.test.ts` :: "is what the next situation bills against, and what its form names"

And on 5 September the rest of the marché's life: an avenant that carries no
price at all but moves the délai, and the pénalités de retard that run from
it — computed, never applied, and never computed at all until somebody has
read the clause off the CCAP. See
`docs/DECISIONS/2026-09-05-the-delai-and-what-it-costs.md`:

- `tests/unit/penalty.test.ts` :: "is not computed at all — no rate, no ceiling, no base"
- `tests/unit/penalty.test.ts` :: "says which fact is missing rather than showing zero"
- `tests/unit/penalty.test.ts` :: "carries a penalty of zero, and says so rather than saying nothing"
- `tests/unit/penalty.test.ts` :: "counts the days to the réception and applies the rate to the HT"
- `tests/unit/penalty.test.ts` :: "applies it to the TTC when that is what the CCAP says"
- `tests/unit/penalty.test.ts` :: "stops at the ceiling, and says it stopped"
- `tests/unit/penalty.test.ts` :: "counts to today and says the figure is not settled"
- `tests/integration/situation-flow.test.ts` :: "refuses an avenant that carries nothing at all — no price, no date"
- `tests/integration/situation-flow.test.ts` :: "computes no penalty at all while nobody has read the CCAP"
- `tests/integration/situation-flow.test.ts` :: "computes one against the signed délai once the clause is typed"
- `tests/integration/situation-flow.test.ts` :: "is a date and a reason, and carries no money"
- `tests/integration/situation-flow.test.ts` :: "moves the délai once issued, and the penalty stops with it"
- `tests/integration/situation-flow.test.ts` :: "names both avenants on the next situation's form"

And the page that closes it — the décompte final, where nothing is typed: the
situations added up, less the advance, the retention, what has been paid and
what the clause allows. See
`docs/DECISIONS/2026-09-05-the-page-that-closes-a-marche.md`:

- `tests/unit/final-account.test.ts` :: "refuses to draw one at all with no situations"
- `tests/unit/final-account.test.ts` :: "refuses while a situation is still a draft"
- `tests/unit/final-account.test.ts` :: "refuses while a situation is issued and unsigned"
- `tests/unit/final-account.test.ts` :: "refuses before the work has been accepted"
- `tests/unit/final-account.test.ts` :: "adds up the situations and nothing else"
- `tests/unit/final-account.test.ts` :: "counts the advance recovered and the retention withheld separately"
- `tests/unit/final-account.test.ts` :: "leaves the balance the client still owes"
- `tests/unit/final-account.test.ts` :: "shows the retention as money to come back, not money lost"
- `tests/unit/final-account.test.ts` :: "takes the penalty off the balance, and only when it is known"
- `tests/integration/situation-flow.test.ts` :: "waits for the client's signature on every one of them"
- `tests/integration/situation-flow.test.ts` :: "adds up the four situations and nothing else"
- `tests/integration/situation-flow.test.ts` :: "is written as a draft nobody typed, naming the papers it adds up"
- `tests/integration/situation-flow.test.ts` :: "cannot be edited by hand, because every figure on it is computed"
- `tests/integration/situation-flow.test.ts` :: "is issued under a number of ours, and closes the marché"

And screens 24, 25 and 26 — `/personnel-requests` was the third dead link in
the rail, and a certification that lapses before a man is due on site is the
same rule for the third time:

- `tests/unit/recruitment.test.ts` :: "is flagged when it expires between today and the start"
- `tests/unit/recruitment.test.ts` :: "does NOT count a confirmed man whose ticket lapses, when the site needs one"
- `tests/unit/recruitment.test.ts` :: "counts him anyway on a site that requires no certification"
- `tests/unit/recruitment.test.ts` :: "is LATE once the start date has passed with nobody on site"
- `tests/integration/recruitment.test.ts` :: "takes the SOONEST-expiring certification, not the latest"
- `tests/integration/recruitment.test.ts` :: "counts him again the moment the certificate is renewed"
- `tests/integration/recruitment.test.ts` :: "keeps the row, the trade and every certification when they are hired"
- `tests/integration/recruitment.test.ts` :: "refuses a rejection with no reason, the same rule the go/no-go card follows"

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

1. ~~**Day one has never been run.**~~ **Closed on 1 September** by
   `scripts/day-one.ts`, which filled the identity, the logo, three VAT rates
   and twelve numbering series from the company's own sent invoices, templates
   and OneDrive — `canIssue=true` on the application database. Still open: the
   bank account (a RIB is an account number, and it is typed by the Gérant on
   `/fr/setup/bank`, not by a script), and the stamp-duty rule on
   `/fr/settings/compliance`, which waits for the accountant's name.
2. **The ERP is not registered as a service.** See the box at the top of
   `docs/RUNBOOK.md`. One command, as Administrator.
3. **The backup is on the same disk as the database.** §5b of the RUNBOOK.
4. **The mailbox has never been read.** Phase 2, above.
5. **SharePoint is not connected.** Phase 6, above.
6. ~~**Ten screens are parked** until after the first release.~~ **Closed on 30
   August.** All eighty-six screens in the map are now routed and present, and
   the parked list in `docs/SCREENS.md` is empty. Twelve of the eighty-six are
   patterns, references and overlays with no route by design, which is what
   they always were.
7. ~~**No test uploads a real spreadsheet.**~~ **Closed on 30 August** by
   `tests/integration/bpu-import.test.ts`, which builds a workbook and reads it
   through storage exactly as the screen does. `src/domain/import/sheet.ts` —
   the header-row detection, the blank-line handling, the trailing-column trim —
   is now exercised against a file rather than reasoned about.
8. ~~**No screen has been rendered signed in.**~~ **Closed on 30 August.**
   `pnpm smoke:in` signs itself in as Gérant and asks all 84 screens for their
   HTML, expecting the sidebar around it; all 84 answer with it. The session is
   minted by Better Auth's own `internalAdapter` and signed with its own
   `makeSignature`, against the test database, and the seeded user is removed
   whether the run passes or fails. There is no back door in the application —
   remove the script and Entra is still the only way in.

   What it proves is that every screen renders with an EMPTY database. It does
   not exercise a screen with real records in it, and it clicks nothing: no
   form is submitted, no server action runs. The stores behind those actions
   are tested directly, and the actions themselves are not.
9. ~~**Nothing had walked the whole chain.**~~ **Closed on 2 September** by
   `tests/integration/a-to-z.test.ts`: one enquiry driven from the client on
   file to the second facture paid, through the functions the screens call,
   with the real letterhead. The walk found what eighty-six screens tested one
   at a time could not — an offer priced on screen 12 printed "Total HT 0,00";
   no enquiry could ever be won because nothing could record the client's
   order; a client's order could not be delivered or billed against; screen 48
   threw the payment method away; the PDF crashed on an arrow in a
   designation. All five are closed and pinned by that file. And beyond it:
   `mayIssue` refused thirteen of the nineteen document kinds to everybody,
   the Gérant included — a devis and a bon de livraison could not be issued
   from any screen. `tests/unit/issue-permission.test.ts` pins every kind in
   the catalogue to a permission.
10. ~~**The actions themselves are not tested.**~~ **Half closed on 2
   September**, closed on 4 September. `pnpm audit:actions` reads every server
   action and refuses the build if one does not check the session and a
   permission (or say, in words the script accepts, that it writes only the
   caller's own rows). It found 39 that checked the session and nothing else;
   all 39 now do, and `lecture` — read-only — can no longer add a note, a
   contact or a line anywhere.

   What it could not do was prove a check is the RIGHT one, and that gap had a
   hole in it. `tests/unit/action-permissions.test.ts` now reads the permission
   each of the 100 actions actually names and holds the list against a table
   with a reason on every line. Writing it down found two:

   - **`lecture` could rewrite the price of any line on any draft offer.**
     `setLineAction` guarded its margin branch and let the "type a price"
     branch reach the write with no check at all. The audit script passed it
     because the function contains a `can(...)` somewhere.
   - **Compta could reprice a commercial's offer and import a tender's BPU.**
     Seven actions across screens 12 and 42 were guarded by
     `offers.margin.view` — a permission that says a person may SEE cost.
     Writing to an offer is `offers.issue`; both are now required, and a
     fourth assertion refuses any action guarded by a see-this permission
     alone.
11. ~~**Nobody has looked at a screen on the laptop it runs on.**~~ **Closed on
   2 September** by `pnpm shots`: every screen, at 1366 × 768 and 1920 × 1080,
   photographed with a full enquiry on it and measured — text under 11.5px,
   anything past the right edge, anything clipped, a navigation rail that runs
   off the bottom, a message key printed raw, a free-text field under 140px.
   The first pass found 292 pieces of 9.5px text per screen, the rail cut at
   "Sociétés" on the laptop, the builder's designation field 60px wide, and
   three untranslated keys. The type scale was raised once, in
   `globals.css`; the rail scrolls; the builder is one column under 1536px;
   `tests/unit/messages-compile.test.ts` compiles both catalogues. The last pass
   flags nothing but the ten-pixel count in the bell.
12. ~~**The buy side could be read and not driven.**~~ **Closed on 2
   September** by `tests/integration/buy-a-to-z.test.ts`: two suppliers
   asked, both answer, the order goes to the cheaper one at their price
   (`orderFromAnswer`), the goods arrive short (`receiveGoods`), their
   facture arrives for more than arrived at a higher price
   (`recordSupplierInvoice`), the match holds the difference, we pay what
   is safe to pay (`recordPayment` with `direction: "out"`), the rest
   arrives. Screen 68 had none of those writes, and its money panel mixed HT
   rows with TTC payments — "safe to pay" came out short by the VAT. Screen 67
   has "Order from them"; screen 68 has the three forms.

13. ~~**Projects could be read and not driven.**~~ **Closed on 4
   September** by `tests/integration/situation-flow.test.ts`: the project is
   opened on the client's order (`/projects/new?deal=`), the situations are
   raised against its bordereau (`/projects/[id]/situation`), issued in
   order under `SIT-{YYYY}-{###}`, submitted and approved with a name, the
   réceptions recorded; the PDF is the wilaya's "partie co-contractant"
   form with the cumulative columns, the retenue de garantie on the base the
   CCAP names, and the net à payer in words.

   **Finished on 5 September.** The avenant is the twentieth document kind and
   composes the marché without touching what was signed; an avenant de
   prolongation moves the délai and carries no price at all; the pénalités de
   retard are computed and never applied, and never computed until somebody has
   read the clause off the CCAP; and the décompte final closes the marché from
   the situations themselves, with nothing on it typed. Only the **révision des
   prix** is still open, and it will stay open until somebody types the ONS
   index values off the bulletin: a révision computed from indices this system
   guessed would be a claim with no authority behind it.
14. ~~**"What did this cost last time?" was answered from memory.**~~
   **Closed on 4 September** by `tests/integration/price-history.test.ts`:
   June's offer sold galets at 4 800 on a supplier's 4 000; September's
   enquiry for the same wording, with nobody asked yet, builds with June's
   cost carried as `previous_offer` — said so in orange on screen 12 — and
   the line shows "vendu 4 800 à ENAGEO le …" under its designation. The key
   is the wording (`significantWords`, all of them, unaccented), because the
   item catalogue is empty; the day lines are matched to items it becomes a
   join.

15. ~~**The retenue de garantie was being chased as an unpaid invoice.**~~
   **Found and closed on 5 September.** Screens 19 and 20 read what a client
   owes from a document's TTC. On a situation de travaux that is not what the
   paper asks for: the client keeps back the retention under the CCAP, and the
   net à payer is what they transfer. So a situation paid to the centime showed
   a balance equal to the retention, aged into the over-90 column, and could be
   named on screen 20's banner as the most neglected invoice in the company —
   with the relance machinery ready to chase a wilaya for money their own
   contract says they may hold. `Owing.owedNow` is what the paper asks for; on
   an ordinary invoice it IS the TTC and nothing changed. See
   `docs/DECISIONS/2026-09-05-the-retention-was-being-chased.md`:

   - `tests/unit/ageing.test.ts` :: "is settled when the client has paid what it asked for"
   - `tests/unit/ageing.test.ts` :: "does not become a debt because the retention is still held"
   - `tests/unit/ageing.test.ts` :: "still shows what is actually late when part of the net is unpaid"
   - `tests/unit/ageing.test.ts` :: "leaves every ordinary invoice exactly as it was"
   - `tests/unit/ageing.test.ts` :: "keeps a retention-holding situation out of the ageing report"
   - `tests/unit/invoice-state.test.ts` :: "calls a situation paid when the client has paid what it asked for"
   - `tests/integration/situation-flow.test.ts` :: "is issued with a number of ours, then submitted, then approved — in that order"
16. ~~**Nobody has counted what a screen costs.**~~ **Closed on 5 September**
   by `tests/integration/query-budget.test.ts`. Nothing was slow — six people
   on a mini PC with Postgres on the same machine — which is exactly why it was
   worth measuring: screen 16 composed the marché three times and screen 15
   once per project, so a list of thirty marchés was two hundred queries.
   `db` now counts queries and each heavy read is held to a ceiling with the
   measured number beside it. Screen 16: 14 → 9. Screen 15: 12 → 7, and it no
   longer grows with the number of projects. The décompte: 34 → 14, and 5 when
   the page passes the project it already has.

17. ~~**No marché could ever leave WARRANTY.**~~ **Found and closed on 5
   September.** `reception_report` has converted to `retention_release` in the
   catalogue since the catalogue was written, and the kind did not exist — the
   test that checks conversions carried it in a `knownGaps` set with a note
   saying the list was meant to shrink. So nothing could record the retenue de
   garantie coming back: `project.closedAt` was read in three places and
   written in none, `retentionHeld` is the sum of what the issued situations
   withheld and an issued situation cannot change, and `projectState` closed a
   marché only when that figure reached zero. On the test marché it is 138 260
   DZD the ERP would have drawn as outstanding for ever.

   Screen 16e writes the demande de restitution — one line per situation, no
   VAT, blocked until the PV de réception définitive — and `retention_release`
   is in the ledger, so once issued the money ages and is chased like anything
   else owed. The marché closes when the money ARRIVES, not when the letter
   goes out. `knownGaps` is now empty. See
   `docs/DECISIONS/2026-09-05-asking-for-the-retention-back.md`:

   - `tests/integration/situation-flow.test.ts` :: "will not be written before the réception définitive"
   - `tests/integration/situation-flow.test.ts` :: "is due the day the PV définitif is signed, not a year after it"
   - `tests/integration/situation-flow.test.ts` :: "lists what each situation withheld, and charges no VAT on any of it"
   - `tests/integration/situation-flow.test.ts` :: "cannot be edited by hand, because every figure on it is a situation's"
   - `tests/integration/situation-flow.test.ts` :: "is issued under a number of ours and then chased like anything else owed"
   - `tests/integration/situation-flow.test.ts` :: "leaves the marché in warranty while the demand sits unanswered"
   - `tests/integration/situation-flow.test.ts` :: "closes the marché the day the money arrives"
   - `tests/unit/project.test.ts` :: "closes the marché on the outstanding figure, not on the held one"
   - `tests/unit/project.test.ts` :: "is due the day the PV définitif is signed, because that is when the warranty ended"
   - `tests/integration/document-types.test.ts` :: "only ever converts into a kind that exists"

   It also uncovered a second thing, which is why it is written here rather
   than as a line in item 13: `retentionRelease` returned *PV définitif +
   warranty months*. The délai de garantie runs from the réception PROVISOIRE
   and the définitive is what ENDS it, so screen 16 put the money a second year
   out and told the Gérant to wait on a demand he was already entitled to send.

   Still open, and named here so it is not mistaken for done: the **`RG` and
   `DEC` numbering series do not exist on the application database.** Screen 50
   creates each of them once, and a pattern cannot be changed after the first
   document carries it, so nobody but the Gérant should type them.

18. **Nothing could see a column the application is not joined to.** The bug
   above was found by accident. `pnpm audit:schema` — added on 5 September —
   parses every column Drizzle declares and asks whether the application reads
   it and whether the application writes it, deliberately not counting
   `tests/`: a column whose only writer is a fixture is a column no screen can
   set, which is exactly how `closed_at` passed unnoticed. See
   `docs/DECISIONS/2026-09-05-columns-nothing-is-joined-to.md` and
   `tests/unit/schema-columns.test.ts`, which holds the parser to finding the
   columns at all — a reader that finds none reports a clean database.

   The first run found **56 of 569 columns disconnected**. That is a ratchet,
   not a gate: the script is in `pnpm check` and fails when the number grows,
   and every commit that lowers it lowers the line in the file. The list is
   printed in full on every run, so it is read rather than admired.

   **54 today.** The two closed are `project.physical_by` and `physical_at`:
   who gave the physical estimate and when, written since `setPhysicalProgress`
   was first called and shown on no screen, while the schema's own comment said
   screen 16 printed them. The page's best number is one subtraction — work
   done less work billed — and a subtraction between a figure computed this
   morning and one a chef de chantier gave in June is not a number to act on.
   Screen 16 now names the person and the day, and says so in orange once the
   estimate is older than a billing cycle.

   - `tests/unit/project.test.ts` :: "carries the name and the day off the row"
   - `tests/unit/project.test.ts` :: "still shows the estimate when the person has left the company"
   - `tests/unit/project.test.ts` :: "calls an estimate stale once it is older than the billing cycle"
   - `tests/unit/project.test.ts` :: "says the estimate is undated rather than inventing a day for it"
   - `tests/integration/project.test.ts` :: "is stored with a name against it, and shows the gap"
   - `tests/integration/project.test.ts` :: "says nothing at all about an estimate nobody has made"
   - `pnpm walk` :: "the estimate carries the name of whoever made it"

   The walk also stopped lying while this was being written. Signed out, every
   route answers **200 with the sign-in page** — which carries the whole message
   catalogue in its payload, so `content()` contains every string the walk looks
   for. Two checks reported green on the sign-in screen before a `page.fill`
   timed out on a form that was never going to be there. It now refuses to keep
   walking when it is signed out.

   **50 today.** The audit's second catch, and a bigger one:
   `person_certification` was read by four screens and written by nothing in
   the application. See item 19.

19. ~~**A man's tickets could not be typed in.**~~ **Found and closed on 5
   September**, by the audit above. `person_certification` is read by screen
   25's table, by screen 51's list (the soonest-expiring ticket on every row),
   by screens 24/26 (a confirmed welder stops counting when his habilitation
   lapses before the start date) and by screen 16's crew panel (whether a man
   may work tomorrow). There was **no insert anywhere in `src/`** — every write
   in the repository was a test fixture. Four screens read a table nothing
   could fill.

   And `is_verified` was a `boolean not null default false` rendered as a badge
   that nothing could set, so every habilitation in the company read "Non
   contrôlée" for ever. A signal that never changes is worse than no signal: it
   teaches people to stop reading it. It is now `verified_by` + `verified_at`,
   and "checked" is computed — LAW 2, a fact with a confirmer against it — with
   the check withdrawable, because one given in error with no way back is how a
   wrong fact becomes permanent. While a ticket is unchecked the row says who
   typed it in, which is the one moment that answers a question somebody has:
   who do I ask for the original. See
   `docs/DECISIONS/2026-09-05-a-mans-tickets.md`.

   - `tests/integration/recruitment.test.ts` :: "records one against the person, with who typed it"
   - `tests/integration/recruitment.test.ts` :: "takes a ticket with no expiry, because a diploma does not have one"
   - `tests/integration/recruitment.test.ts` :: "refuses a ticket that expired before it was issued"
   - `tests/integration/recruitment.test.ts` :: "is not checked until somebody says they have seen the original"
   - `tests/integration/recruitment.test.ts` :: "lets a check be withdrawn, because one given in error must not be permanent"
   - `tests/integration/recruitment.test.ts` :: "refuses to check a ticket that does not exist"

   It also found a hole in the action audits. `pnpm audit:actions` and
   `tests/unit/action-permissions.test.ts` share one reader, and it listed the
   files with `git grep -l` — **tracked files only**. Both new server actions
   were invisible to both until somebody staged them, which is after the review
   and not before. The reader now passes `--untracked`.

20. ~~**A merge could not be put back.**~~ **Found and closed on 5 September**,
   by the same audit. `merge_log` had eight columns and the application read
   none of them. The one that mattered was **`reversible_until`**: a promise
   made in the schema, about the one operation in this ERP that quietly
   rewrites a record other people rely on, that nothing could keep.

   Screen 84 SUGGESTS duplicate pairs, so somebody will eventually confirm one
   they should not have. That merge took a company's payment terms, its
   address, possibly its legal name, and retired the other record behind a
   `superseded_by` pointer — and there was no way back. The first person to
   notice is usually the client, on a facture with the wrong name.

   It is cheap to reverse only because `domain/merge.ts` repoints nothing: a
   merge is the kept row's fields, the aliases it added, one contact possibly
   created, and a pointer. What nobody had written down was what those fields
   were BEFORE. `merge_log.reverses` holds that and nothing else. Thirty days,
   on the kept company's page, `merge.execute` — the permission that made it.
   See `docs/DECISIONS/2026-09-05-putting-a-merge-back.md`.

   - `tests/integration/merge.test.ts` :: "offers the undo on the surviving record, naming what was merged in"
   - `tests/integration/merge.test.ts` :: "says nothing once the thirty days are up"
   - `tests/integration/merge.test.ts` :: "puts the fields back, drops the aliases it added, and frees the company"
   - `tests/integration/merge.test.ts` :: "keeps the log row, marked reversed — the merge still happened"
   - `tests/integration/merge.test.ts` :: "will not be put back twice"
   - `tests/integration/merge.test.ts` :: "finds both companies again, separately"

   Ratchet **50 → 45**. And a bug worth writing down, found by its own test:
   the "is there a newer merge on this record?" guard compared a row to its own
   stored timestamp and refused every undo. Postgres keeps microseconds; a
   JavaScript `Date` keeps milliseconds; read back, a row is newer than itself.

   **45 → 26, and not by fixing anything.** Three runs in, the list itself
   turned out to be wrong in four ways. Better Auth's four tables are
   its own to write and read — its schema file says so in its first line. A
   column with a database default is written by Postgres, so `defaultNow()` is
   not "never written". A name six tables share was being credited to all six
   by one `.deletedBy` anywhere, so wiring up ONE would have silently cleared
   five findings — an audit reporting success it has not earned, which is the
   exact failure it exists to catch; it is now attributed by file, after the
   strict alternative was tried and took the count to 132 by flagging ninety
   columns that are read perfectly well. And "who did it and when", recorded on
   the row beside an `audit_entry` that carries the same actor and the same
   moment, is printed as its own list of 33 rather than counted.

   What is counted is the two classes that have each already cost this ERP a
   feature: a column nothing mentions at all, and a column something READS that
   nothing can write. `closed_at`, `is_verified` and `reversible_until` were
   every one of them the second kind. The biggest group left is
   `user_preference` — nine columns and a whole table nothing has touched.

21. **Nothing asked the two routes that answer with bytes.** Every SCREEN is
   protected by one thing: the `(app)` layout checks the session and each page
   under it inherits that, which `pnpm smoke` proves for all 89 routes in the
   map. A route handler has no layout above it, and neither of the two is in
   `docs/SCREENS.md`: `/api/files/[id]` returns an invoice a client sent us and
   `/api/documents/[id]/pdf` returns one we are about to send. Both are one
   forgotten line from being readable by anybody who can reach the tunnel.

   Both were already right — the check is what was missing, in two places:

   - `tests/unit/api-routes.test.ts` reads every `route.ts` under `src/app/api`
     and holds each one to asking who is calling, refusing with a **401 in
     words** (not a redirect: these answer to things that are often not
     browsers, and a 302 to a sign-in page is delivered as the file), and
     keeping its bytes out of shared caches. Better Auth's own endpoint is the
     one exemption, and it is named. A new handler joins the list the moment
     somebody writes it.
   - `pnpm smoke` now asks both of them over HTTP, signed out, and expects 401.

   Read gates are deliberately few in this ERP — `inbox.view` and
   `offers.margin.view` are the only two, and `src/auth/can.ts` says why at
   length: at six people, records are curated and permissioned individually,
   and raw correspondence is not a record. So "any session" is the right answer
   for the PDF route, and "the permission that owns the file" is the right
   answer for the file route, which is what it does.

22. **`user_preference` had ten columns and one of them worked.** Ratchet
   **26 → 17**, by dropping the nine. Nothing wrote them, nothing read them,
   and screen 81's own comment already said so: it "writes `ui_locale` and
   nothing else".

   Each had an answer that made it unnecessary rather than unbuilt. Dates and
   numbers are formatted from the locale, which is the column that stayed. The
   company is in Adrar and the week starts on Sunday for all of it. Nobody has
   asked to land anywhere other than Aujourd'hui. And a relance is DRAFTED here
   and sent from somebody's own mail client — `markRelanceSent` says it in one
   line, "recorded, not performed" — so a signature stored here would be a
   second one, going out of date from the day it was typed.

   Absence cover (`away_until`, `cover_user_id`) was the one with a real
   workflow behind it, and it is notification routing that nobody has designed.
   When it is designed the columns come back with the code that reads them,
   which is the whole rule: **wired up or dropped**.

23. ~~**A datasheet had nowhere to go.**~~ **Found and closed on 5 September.**
   Ratchet **17 → 13**. `item_media` was read in three places — screen 77's
   table, screen 78's "datasheet held" badge, and `hasDatasheet` — and inserted
   in none. Every row in the repository came from a test fixture.

   So screen 77's table was always empty, screen 78 said *no datasheet* about
   every item in the catalogue for ever, and a tender asking for a **fiche
   technique** had nowhere to keep the answer — the same PDF chased from the
   supplier again for the next tender, which is the exact cost that screen
   exists to remove. Its `file_id` pointed at a table `src/domain/files` opens
   by saying will never exist.

   The row owns its bytes now, as the fourth owner in the files view beside an
   attachment, a dossier and an import. Screen 77 attaches one; screen 60 lists
   them; `/api/files/item:<id>` serves them under the same rules as everything
   else — with `NEEDS` widened to `Permission | null` so that "everybody signed
   in may read a manufacturer's datasheet" is a decision somebody made rather
   than a gap. See `docs/DECISIONS/2026-09-05-the-datasheet-had-nowhere-to-go.md`.

   - `tests/integration/item.test.ts` :: "says what it is and where it came from, and neither is guessed"
   - `tests/integration/item.test.ts` :: "can be opened — the row carries the id the files route takes"
   - `tests/integration/item.test.ts` :: "puts the bytes where the row says they are"
   - `tests/integration/item.test.ts` :: "refuses a kind or a provenance nobody declared"
   - `tests/integration/item.test.ts` :: "refuses an empty file and one over ten megabytes"

   Two columns went the other way in the same commit. `item_media.locked` said
   "a picture the client sent is locked to the deal it arrived on", which
   `deal_id` already says — two columns that must agree are one that can be
   wrong. And `price_quote.evidence_file_id` was written as `null` by both of
   its callers: nothing here can attach a file to a captured price, and what a
   price has to say for itself is `is_verbal`, `captured_from` and
   `captured_place`.

24. ~~**Thirteen columns nothing was joined to.**~~ **Found and closed on 5 September.**
   Ratchet **13 → 0 — the audit is a gate now, not a ceiling.** A column this
   ERP adds and does not use fails the build the day it is added.

   Nine of the thirteen were one table. `saved_view` described screen 79's
   saved views in a shape they do not have: `SavedViews` renders them,
   `DataTable` takes them, and the deals list defines two — *Closing this
   week*, *Nothing sent yet* — in code, with translated names, because they
   ship with the application. What no screen offers is **saving** one, so
   nothing ever wrote the table or read it. It comes back the day a list has a
   "save this question" control, with the code that writes it.

   The other four were decisions nobody had written down.
   `numbering_series.reserve_on` held `'issue'` on every row: LAW 5 is not a
   per-series setting, and `document_type.numbering` already says which kinds
   take a number of ours. `import_batch.source_kind` offered `onedrive`, which
   needs a Graph permission the app registration does not have and nothing here
   proposes asking for. `intake_attachment.sha256` waits on a fetcher that is
   not built — `storageFor().put()` already returns the digest, so it is one
   line on the day that fetcher lands. `payment.bank_account_id` asked which of
   our accounts a payment landed in, and there is one. `party.country` was
   `'DZ'` on every row and no address in this ERP is assembled from parts.
   `tender_piece.provided_at` restated `file_id` — a piece is provided when it
   HAS a file, LAW 1. `delivery_detail.departs_at` recorded an hour nobody
   signed for, and `.site_contact_id` demanded that the man taking delivery at
   In Salah be an address-book record first, which is how `site_contact_name`
   beside it ends up blank.

   One went the other way. `merge_log.field_choices` was written on every merge
   and read by nothing, which made *who decided this?* — the reason the column
   exists — a question only answerable with psql. The undo banner on screen 82
   names them now: "TOUATGAZ was merged in" and "TOUATGAZ was merged in and
   took the payment terms" are different things to be told when you are
   deciding whether to put it back.
   See `docs/DECISIONS/2026-09-05-the-last-thirteen.md`.

   - `tests/integration/merge.test.ts` :: "names the fields the merge took, not just that there was one"
   - `tests/unit/schema-columns.test.ts` :: "finds the columns at all — a parser that found none would pass everything"
   - `tests/unit/schema-columns.test.ts` :: "does not mistake a column's options for columns of their own"
   - `tests/unit/schema-columns.test.ts` :: "keeps each column's own declaration, so a database default can be seen"
   - `tests/unit/schema-columns.test.ts` :: "looks at the application and not at the tests"
   - `pnpm audit:schema` :: 550 columns across 48 tables, **0 disconnected, ceiling 0**

   The second list that audit prints — thirty-four columns *recorded on the row
   and shown on no screen* — is deliberately outside the gate. `decided_by`,
   `confirmed_at`, `delete_reason` are written and never displayed, and that is
   correct: they are what makes an answer defensible six months later, not what
   a screen shows today.

25. ~~**Forty-three fields on three forms the audit could not follow.**~~ **Found and closed on 5 September.**
   `pnpm audit:forms` printed *271 fields on 79 forms, 43 not followed* above
   the sentence *every field a person can fill in is read by the action it
   posts to*. The sentence was true about 271 of them. The other forty-three
   were not checked at all, and they were not a random forty-three: the
   **company form** (15 fields, the form this ERP is used through most), the
   **document builder** (21, including every line of a devis, `theirNumber`,
   `retentionPct`, `advanceDeducted`) and **recording a payment** (7, including
   the amount). The three forms where a value typed, submitted and silently
   dropped costs the most.

   One reason: all three are components handed their action as a prop, so the
   reader saw `<form action={action}>` and could not say what `action` was. A
   count printed beside a green sentence is a number nobody reads.

   It follows the prop now — to the component's own name, then to every screen
   that renders it. `CompanyForm` is rendered twice, by `companies/new` with
   `createCompany` and by `companies/[id]/edit` with `updateCompany`, and both
   are checked: a field the first reads and the second drops is invisible until
   somebody edits a company and watches their change disappear. **Not followed
   is a failure now, not a number** — the count is nought and the script exits
   1 if it is not.
   See `docs/DECISIONS/2026-09-05-the-forms-it-could-not-follow.md`.

   Nothing was dropped: all forty-three are read. That answer was not knowable
   before. To show the check can fail, `name="paymentTerms"` on the company
   form was renamed `name="payment_terms"` — the audit named it, on both
   actions, and went green when it was put back.

   - `tests/unit/form-fields.test.ts` :: "follows every form there is — nothing is reported green by being unreadable"
   - `tests/unit/form-fields.test.ts` :: "follows a form's action through the prop it arrives on, to every screen that passes one"
   - `tests/unit/form-fields.test.ts` :: "is read by the action it posts to"
   - `pnpm audit:forms` :: 329 fields on 80 forms, **0 not followed**

26. ~~**Day one offered a series for a document kind this ERP does not have, and not for the two a marché needs.**~~ **Found and closed on 5 September.**
   Screen 85's numbering step offered five kinds typed into the screen:
   `invoice, offer, delivery_note, proforma, credit_note`. **`offer` is not a
   kind this ERP has** — the catalogue calls a devis `quotation` — so a Gérant
   could finish day one having created a numbering series nothing would ever
   look at, and find out on the morning they issued their first devis.

   The omission cost more than the mistake. `final_account` (the décompte that
   closes a marché) and `retention_release` (asking for the retenue de garantie
   back) were not on the list at all, so a company doing marchés publics could
   not set them up on day one and met the refusal on the day it needed the
   document. The standing instruction for a fortnight — "create the DEC and RG
   series on screen 50" — was a step somebody had to remember, on a screen the
   wizard never mentions. `seriesInput.kind` was `z.string().min(2)`: any word
   at all.

   The kinds come from the catalogue now. `SEED_TYPES` already carries
   `pattern: string | null`, null exactly when the document arrives with the
   counterparty's number on it — a bon de commande client, an avenant, a
   supplier invoice. `SERIES_KINDS` is the rest, and it is both what the select
   offers and what the validator accepts: one derived list, not two that can
   disagree. Three refusals with their own words — `kindUnknown`,
   `kindIsTheirs`, `kindTaken` — because reporting any of them as "something in
   the form was not accepted" sends somebody to look at their pattern. The
   suggested pattern is shown beside each kind and never filled in: the shape
   is the Gérant's decision and it is frozen from the first document that
   carries it.
   See `docs/DECISIONS/2026-09-05-a-series-for-a-kind-that-does-not-exist.md`.

   **One series per kind, said by the database** — migration 0050,
   `numbering_series_kind_uq`. Every reader joins on `kind` and takes one row,
   so two rows for `invoice` is two shapes of invoice number in one year and
   the allocator takes whichever Postgres hands back first. It found something
   immediately: the **test database held thirty-five `final_account` series and
   twenty-three `retention_release` ones**, put there by two tests calling
   `.onConflictDoNothing()` with no unique constraint to conflict on. Fifty-six
   duplicate rows, any of which could have been the one a number came from.

   - `tests/integration/setup.test.ts` :: "refuses a kind the catalogue does not have"
   - `tests/integration/setup.test.ts` :: "refuses a kind that carries the counterparty's number"
   - `tests/integration/setup.test.ts` :: "refuses a second series for a kind that already has one"
   - `tests/integration/setup.test.ts` :: "offers the two a marché needs, and never the ones that are theirs"
   - `tests/unit/setup-errors.test.ts` :: "$name only produces keys that resolve"

27. ~~**A bon de livraison could not be raised against the client's own order, and could be raised against a bon de livraison.**~~ **Found and closed on 5 September.**
   One rule, kept in two halves that did not agree. Screen 18 decided whether
   to show *Record a delivery* from a list typed into the page —
   `["quotation", "proforma", "invoice", "situation"]` — and `client_order` was
   not in it. That is the client's own bon de commande: the one document that
   IS their agreement, what `ORDER_KINDS` calls winning, and the kind
   `src/documents/conversion.ts` says in its own words the deliveries and the
   factures should hang off "rather than off an offer that may have been
   revised twice since". The button was missing on exactly the kind the flow is
   built around.

   Behind the button, nothing asked at all. `/deliveries/new?source=<id>` took
   whatever id was in the query string, and `startDelivery` checked that the
   source was ISSUED and never checked what it was. So a bon de livraison
   against a bon de livraison was one typed URL away, and so was one against a
   credit note or a purchase order.

   `DELIVERABLE_KINDS` lives in `src/domain/delivery/lines.ts` now, with
   `client_order` at the head of it, and all three ask the same question: the
   button, the page, and `startDelivery`. `quotation` and `proforma` stay on
   purpose — a small company in Adrar is told yes on the telephone and the
   lorry leaves the same afternoon, and a system that demands the bon de
   commande first is a system people work around. The page refuses in a
   sentence rather than a 404, because the person got there from a link.
   See `docs/DECISIONS/2026-09-05-delivering-against-the-right-paper.md`.

   - `tests/integration/delivery.test.ts` :: "refuses to deliver against a bon de livraison, whatever the id in the URL says"
   - `tests/integration/delivery.test.ts` :: "delivers against the client's own bon de commande — the kind the button did not offer"
   - `tests/integration/delivery.test.ts` :: "refuses to deliver against something the client never agreed to"

28. ~~**The catalogue could never be corrected, and its "Becomes" column disagreed with the engine.**~~ **Found and closed on 5 September.**
   `ensureTypesExist()` inserted with `onConflictDoNothing()`. Every field on
   `document_type` — family, legal value, numbering, `converts_to`, languages,
   position — is owned by `SEED_TYPES` in code and could only ever be written
   once, so a row recorded in August kept August's answer for ever while the
   catalogue in the repository went on being edited. Screen 50 printed the old
   one beside a *Write down the types* button that did nothing and then said
   *Everything was already written down* — true about the rows, false about
   what was in them.

   It upserts now, and `active` is deliberately not in the update: **the code
   owns what a kind IS, the person owns whether it is switched on.** The count
   means NEW, because with an upsert every row is written every time and "22
   types written down" on every press for ever is not information.

   The same column claimed conversions the engine will not do and hid two it
   will. `quotation` and `proforma` both omitted `client_order` — recording the
   client's own order, the one thing that moves an enquiry to won — while the
   catalogue offered `invoice → credit_note` and `purchase_order →
   goods_receipt`, which nothing implements. Rendered as a plain
   comma-separated list, that reads as a list of buttons.

   The column may say MORE than the engine does and never less: a bon de
   commande client does become a bon de livraison, and somebody records that
   delivery on screen 49 rather than pressing anything. So the paper flow stays
   and the screen marks it — the conversions screen 48 will do are in ink, the
   rest grey with a star and a line under the table saying they are done by
   hand. See `docs/DECISIONS/2026-09-05-what-a-document-becomes.md`.

   - `tests/integration/document-types.test.ts` :: "never hides a conversion the engine will actually do"
   - `tests/integration/document-types.test.ts` :: "corrects a row when the catalogue changes its mind, and leaves what is switched on alone"
   - `tests/integration/document-types.test.ts` :: "is idempotent — pressing the button twice writes nothing the second time"
   - `tests/integration/document-types.test.ts` :: "only ever converts into a kind that exists"

29. ~~**A document kind called `offer`, which this ERP does not have.**~~ **Found and closed on 5 September.**
   The catalogue calls a devis `quotation` and has since the day it was
   written. The word `offer` was in the source five times anyway: day one's
   numbering dropdown (closed as item 26), `ISSUE_PERMISSION` in
   `src/auth/can.ts` — the map whose own comment calls it "deliberately
   exhaustive" — screen 28's offers chart, `SOLD_KINDS` in the price history,
   and a merge test fixture.

   **None of them threw.** `WHERE kind = 'offer'` matches no rows and returns
   an empty result; a permission nobody can reach looks like a decision
   somebody made; a sixth name in a list of six reads as one of the six.

   Screen 28 is the one that mattered. It has said **"Aucune offre émise"**
   since it was built, to a company that issues them every week. A report that
   is confidently wrong is worse than one that is missing, because somebody
   acts on it. An offer is a devis OR a proforma — the company sends whichever
   the client asked for — and `domain/deal/deal.ts` had already reached that
   answer for the pipeline, so the report agrees with it rather than inventing
   a third. `issuedByMonth` takes kinds, plural: the single-kind signature is
   what made the bug expressible.
   See `docs/DECISIONS/2026-09-05-a-kind-called-offer.md`.

   The general fix is a scan. Every `.ts` and `.tsx` under `src` is read for
   arrays of nothing but lowercase quoted words; any with two or more real
   kinds in it is taken as a list of kinds, and a member the catalogue does not
   have fails the build. `CHAIN` is the one named exception — `payment` is a
   step in screen 48's chain and not a document this system issues — written
   into the test so a second exception is a decision somebody makes in writing.
   `ISSUE_PERMISSION` is checked in both directions: a kind with no entry
   fails, and an entry for a kind that does not exist fails.

   - `tests/unit/document-kinds.test.ts` :: "names no kind the catalogue does not have"
   - `tests/unit/document-kinds.test.ts` :: "says who may issue every kind, and nobody who may issue one that is not there"
   - `tests/unit/document-kinds.test.ts` :: "finds the lists it is meant to find"
   - `tests/unit/document-kinds.test.ts` :: "read the source at all — a scanner that found no files would pass everything"
