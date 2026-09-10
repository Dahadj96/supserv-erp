# Owner's second review — 10 September 2026, after using it

Abdou built a real deal end to end: a client email became a deal, he typed the
list of what they asked for, priced it, and tried to get a proforma out of the
other end. **This is the authoritative brief** and it outranks
`OWNER-REVIEW-2026-09-10.md`, which was written before he had tried the
commercial journey.

Every finding below was checked against the code before it became a task. That
matters more here than in the first review, because the answer is not what it
looks like from the screen.

---

## The headline: most of what he asked for is built, and cannot be reached

Six of the sixteen things he could not find **exist and work**. He could not
find them because nothing links to them, or because the one screen that offers
them is not the screen he was on.

| What he could not find | Where it actually is |
|---|---|
| Attaching a datasheet or photo to an item | `/items/[id]/technical` — a real upload form, fully wired. **Zero links to it anywhere in the app**, no nav entry, no item list. Reachable only by typing the URL. |
| Free text on a proforma ("valid 30 days") | `LINE_KINDS` already has `text` and `section`, and both are Add buttons on the builder. **But the PDF renderer drops the line kind**, so the sentence prints as a numbered table row with `0,00 / 0,00 / 0% / 0,00` beside it. |
| Typing a selling price instead of a margin | Screen 12 already does exactly this, per line, and typed price wins — `build/actions.ts:96-107`. He never saw it because the door into that screen is a single **margin** box on the deal page, so the first thing the system asks for is the thing he did not want to give. |
| An offer with no deal behind it | `document.deal_id` is nullable on purpose, and `/documents/new` creates one without asking for a deal. **`/offers` has no create button** and `/documents/new` is linked from exactly one place in the app. |
| A recycle bin | `/settings/bin` — five kinds listed, all five restorable. |
| The ERP reading the client's own files | Built earlier today (`767786f`) and **not yet serving**: the build is on disk and port 3000 is still on the old one. |

**That is the pattern the 8 September audit named, and it has not gone away:
the seam between the logic and the screen is where this system fails.** It is
also good news — six of his sixteen are wiring, not building.

---

## What is genuinely missing, and it is the dangerous half

### 1 · Deleting a deal leaves everything it touched behind

`discardDeal` (`src/domain/deletion.ts:147`) writes **one row**. It sets
`deleted_at` on the deal and writes an audit entry, and that is the whole
function. It does not touch `deal_line`, the draft documents hanging off it,
`sourcing_request`, `tender` or `price_quote`.

The foreign keys look like they would save you and do not:
`deal_line` is `ON DELETE cascade` and `price_quote.deal_id` is
`ON DELETE set null`, but both only fire on a hard row delete, which this
system never does. So a discarded deal leaves live lines, and unissued drafts
that still point at a deal nobody can open — and those drafts are **not** in
the bin either, because the bin lists a document only when the document's own
`deleted_at` is set.

He is right, and it is worse than he said.

### 2 · There is no delete on the deals list, and that is deliberate

`deals-list.tsx:140` says it outright: *"Only what is safe in bulk. No send,
issue, cancel or delete — ever."* The reasoning is sound for a bulk bar over
ticked rows. It is not a reason for a deal to have no row action at all — the
one he wanted is per-row, on the row he is looking at, with a confirmation.

### 3 · The bin never empties

`BIN_DAYS = 30` counts down on screen, and `deletion.ts:543` admits what
happens at zero: *"nothing purges at zero"*. There is no purge function
anywhere in `src/` — I searched `purge`, `hard delete`, `permanently`. So the
bin is a place things go and never leave. He asked for "delete them forever",
and that control does not exist.

### 4 · Only two records in the entire ERP have an edit screen

`find src/app -type d -name edit` returns exactly two: `companies/[id]/edit`
and `documents/[id]/edit`. **A deal cannot be edited at all** — not its
subject, not its client, not its deadline, not its owner. `db.update(deal)`
appears at seven sites and not one of them writes those fields. That is T6,
and it is larger than T6 says.

### 5 · A file cannot be attached to a document, or to a deal line

There is no `file` table and `src/domain/files/index.ts:12` says there is never
going to be one — files are a view over five owners: `attachment`,
`credential`, `dossier`, `import`, `item`. **A document is not one of them**,
and neither is a deal line. So the technical documents he wanted to send with
the offer have nowhere to attach, and the annexe technique the system already
knows how to judge (`annexeVerdict()` returns buildable / gaps / blocking) ends
at a permanently greyed button reading *"coming in phase 6"*.

### 6 · The ERP cannot produce an email, and that was a decision

`docs/DECISIONS/2026-08-28-the-erp-does-not-send.md` — *"A template produces
text. A person sends it."* The app holds `Mail.Read` only. There is no SMTP
client, no `.eml` writer, not one `mailto:` link. Fifteen email templates are
seeded, their bodies **empty on purpose**, and the only screen that reads them
is the settings preview.

**Abdou decided on 10 September to grant `Mail.ReadWrite`, drafts only.** The
ERP writes a draft into the Outlook Drafts folder with the PDF attached and the
addresses filled in, and never presses send. That decision unblocks both the
proforma and the supplier RFQ, and it needs a change in Entra that only he can
approve.

### 7 · The client's purchase order is the least supported path in the system

He is half right about the modelling and it is worth being exact, because the
fix is different depending on which half.

**The data model is correct.** `client_order` and `purchase_order` are two
distinct kinds. `client_order` is `family: "sell"`, `numbering:
"clientReference"` — *"the number is the CLIENT's. We never generate one"* —
and `purchase_order` is `family: "buy"` with our own `PO-{YYYY}-{####}`. The
database even excludes `client_order` from the number-uniqueness index because
that number belongs to somebody else.

**The screens conflate them.** `/orders` lists both in one table under one
"counterparty" column. A purchase order gets its own screen; a client order
gets none — *"the document IS the record"*. And there is no create path for a
client order except converting an offer we already issued.

**And the thing the business actually does is unsupported end to end.** A
client emails a PDF purchase order. Today:

- **Nothing classifies it.** The router's six rules match `PR`/`RFQ`,
  `consultation`/`avis`/`appel d'offres`, and `facture`/`règlement`/`virement`.
  There is no *bon de commande*, no *BC*, no *PO*, no *commande*. The whole
  outcome list — `candidate, enquiry, tender, supplierQuote, payment,
  needsReview` — **has no order in it**. A client's PO falls to the catch-all.
- **Nothing reads it.** `proposeFields` knows seven field types and every one
  is a French tender concept: submission deadline, opening session, place of
  deposit, bid bond, offer validity, late penalty, delivery time. No PO number,
  no client reference, and **no line items at all** — it returns one scalar per
  key.
- **A scan produces nothing.** `NeedsOcr` is thrown and caught by nothing. The
  OCR container has a Dockerfile and no server code.
- **The file has nowhere to live.** `intake_dossier` can point at a `deal`; it
  has no `document_id`. So the PDF that IS the order cannot be attached to the
  order.

### 8 · Sourcing sends nothing, and nothing comes back

Creating a supplier price request writes database rows and stops.
`ask-actions.ts:11` says so: *"Creates the request DRAFTED and sends nobody
anything."* Beyond that:

- **He cannot choose which items to ask about.** `excludedLineIds` exists on
  the table and `createRequest` accepts it — and no caller ever passes it, so
  every request implicitly asks about every line.
- **He cannot paste addresses.** The picker is checkboxes over companies
  already in the directory. `sourcing_response.sentTo` and `.personId` exist
  and are **dead columns** — nothing writes either.
- **The screen does not even give him the text.** A `supplierRfq` template is
  seeded and the sourcing screen never renders it. He is asked to write the
  emails himself, in Outlook, from a screen with names on it and no addresses.
- **Replies never come back.** The router has a `supplierQuote` rule, and
  committing one is blocked by design: *"Attaching a supplier's emailed quote
  to the right one needs a picker on this screen."* Nothing outside the
  sourcing screens ever writes a `sourcing_response`, and `sourcing_request`
  has no message or thread column to correlate on.

### 9 · Four screens to a proforma, and the first one asks the wrong question

`/deals/[id]` → `/offers/[id]/build` → `/documents/[id]/edit` →
`/documents/[id]`. Six if he converts the quotation to a proforma afterwards
rather than switching the kind radio in the builder.

Worse than the count is what each screen knows. Screen 12 has the cost, the
price and the margin. The builder has the text, the line order and the
conditions — and **shows no cost and no margin at all**. So the two halves of
one job are on two screens and neither shows the whole line.

---

## What he said, and what the code says — all sixteen

| # | His words | Verdict |
|---|---|---|
| 1 | No way to attach technical documents to the items | **Built, unreachable.** `/items/[id]/technical` works; nothing links to it |
| 2 | Flow is complicated, not one page | **True.** 4 screens, 6 if converted |
| 3 | Cannot add text under the proforma (validity, payment terms) | **Half built.** `text` lines exist and print wrong; `valid_days` is in the schema, read by three consumers, and has no input |
| 4 | No way to send it to Outlook as a draft | **Missing, by decision.** Now reversed — `Mail.ReadWrite`, drafts only |
| 5 | The ERP does not understand what they asked for | **Fixed today, not yet live** (`767786f`). Line-item extraction from a PO is still missing |
| 6 | Cannot delete the proforma | **Built, one place only** — the document's own page, not the deal, not `/invoices` |
| 7 | Cannot delete a deal from the deals list | **True and deliberate.** Bulk bar refuses; no row action exists |
| 8 | Deleting a deal should take its lines, orders, invoices | **Missing entirely.** `discardDeal` writes one row |
| 9 | No recycle bin | **Built, undiscoverable, and it never empties** |
| 10 | Not many ways to edit | **True.** Two edit screens in the whole app; a deal has none |
| 11 | The purchase order is backwards | **Model right, screens wrong, intake missing** |
| 12 | Cannot send an RFQ to a list of suppliers | **Missing.** No email, no addresses, no item selection |
| 13 | Replies should come back automatically | **Missing.** Blocked on a picker that was never built |
| 14 | Cannot create an offer without a deal | **Built, no button** |
| 15 | Want to type the price and see the margin | **Already works** — on the screen the margin box hides |
| 16 | No technical documents on the offer | **Missing.** No file can attach to a document |

---

## The order of work — his, with the first block chosen on 10 September

1. **Delete, edit and the bin.** His choice, and the right one: nothing else is
   safe to test until he can undo his own mistakes.
2. **One page from deal to proforma** — one workspace, price or margin either
   way, conditions as real text, technical documents attached.
3. **The client's purchase order** — classify it, read it, attach it.
4. **Supplier RFQ out, and prices back in.**

Wave V in `docs/FIX-QUEUE.md` is that, task by task.
