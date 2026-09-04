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
   September.** `pnpm audit:actions` reads every server action and refuses
   the build if one does not check the session and a permission (or say, in
   words the script accepts, that it writes only the caller's own rows). It
   found 39 that checked the session and nothing else; all 39 now do, and
   `lecture` — read-only — can no longer add a note, a contact or a line
   anywhere. What it cannot do is prove a check is the RIGHT one.
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
   CCAP names, and the net à payer in words. Still open on the public-works
   chain, each waiting on a text and a person to confirm it: avenants,
   révision des prix, pénalités de retard, DGD.
