# Owner's review — 10 September 2026

Abdou's own walk through the running ERP. **This is the authoritative brief.**
Where it disagrees with `docs/UX-SCAN-2026-09-09.md`, this document wins: that
one was read off the code, this one was read off the screen by the person who
has to use it.

His closing standard, which is the acceptance test for all of it:

> A user can see the next action, complete it, and continue without searching
> another module or entering the same information again.

---

## 1 · Concrete problems, first

| Priority | What he observed | What needs to change |
|---|---|---|
| **Critical** | New delivery opens a 404. | Repair the route and provide a source-order selector. **Add a navigation test for every primary creation button.** |
| **Critical** | New invoice opens "New document" with Quotation selected, among 22 types. | Open an invoice-specific form with Invoice already selected. Carry the originating order, client and lines forward. |
| **High** | Every Today *Reply* link points at the general inbox. | Open the exact message or thread, with its relevant action immediately available. |
| **High** | Newsletters appear under "People are waiting on you". A cloudHQ PDF tutorial is classified as an RFQ. | Separate unread, unclassified, and genuinely actionable. Require an explicit reason before anything is promoted to Today. |
| **High** | Inbox *Classify* and *Link to invoice* are disabled, yet classification works through a different control inside the message. | Make the row action open the interface that works. Explain any real prerequisite. |
| **High** | A deal says its missing deadline can only be set at creation or by a confirmed document. | Allow authorised editing of deadline, owner, submission method and reference, with change history. |
| **High** | Offer pricing is split between an offer screen and a separate document builder. | One editor: quantities, costs, selling prices, margin, tax — then preview. |
| **High** | The document editor discards rows without a description or quantity. | Preserve incomplete draft rows and highlight what is missing. **Never silently discard entered work.** |
| **High** | Invoices shows zero while Reports and Compliance see an invoice draft. Companies shows two while New deal offers five clients. | Investigate filters, archived-record handling and data sources. **Every count must reconcile with its destination list.** |

> "These are reasons someone can feel stuck even when much of the underlying
> functionality exists."

---

## 2 · The deal is the main workspace

"What happens next" is the beginning of the right answer — make it the
organising principle of the screen.

At the top: client, enquiry reference, owner, deadline, current stage. **One**
specific next action — "Request supplier prices", "Complete 1 missing price",
"Record client order". What is blocking, with a direct fix. A short progress
strip: enquiry → sourcing → quotation → order → delivery → payment.

Below: tabs — Overview · Items & pricing · Documents · Messages · Activity.

Today one deal page exposes qualification, tender conversion, loss, deletion,
supplier requests, offer creation and implementation notes at once. **Those
belong to different moments.** Show what the current stage needs; put the
exceptional actions in a secondary menu.

Keep the alternative paths: a direct order must not require inventing an earlier
quotation, and a tender needs its own submission checklist.

---

## 3 · Reduce the navigation burden

23 destinations with their own scrollbar; the rail eats width while the business
tables are cramped.

| Area | Contents |
|---|---|
| My work | Today, assigned actions, waiting for replies, approvals |
| Inbox | Messages, classification, uploads, capture |
| Sales | Enquiries/deals, tenders, quotations, client orders |
| Purchasing | Supplier requests, comparisons, purchase orders |
| Operations | Deliveries, sites, personnel requests |
| Finance | Invoices, payments, receivables |
| Directory | Companies, contacts, workforce |
| Administration | Settings, compliance configuration, backups |

**Show navigation according to the person's work** — an accountant arrives at
receivables and invoices, a commercial at enquiries and quotations. Keep global
search. Put Capture behind one consistently reachable button instead of making
each intake method its own destination.

---

## 4 · Rebuild Today around trustworthy actions

Today claims "20 things" and "~100 minutes" and the visible items explain
neither the estimate nor the urgency. It ends with a green completion message
while work is still listed above it.

Every task must answer: **what must I do, for which record, by when, and why
does it matter.** For example:

> **Complete quotation pricing**
> Client · enquiry reference · due tomorrow
> One item has no selling price
> **[ Complete pricing ]**

Filters: Mine · Team · Overdue · Due today · Waiting. Support explicit
follow-up dates and assignment beside the automatically derived actions.

**Empty states must be accurate.** "No deliveries recorded", not "Every signed
copy is on file". "No personnel requests recorded", not "Every position
filled". "No tracked supplier requests", not "Nobody owes you an answer".
**Absence of records does not establish completion.**

---

## 5 · Layout and wording

Consistent, but too much space goes to explanation while the controls are
squeezed.

- Give the width to line-item tables. The offer screen already scrolls
  horizontally for a single item.
- Secondary totals and help go **below** the table when the window is narrow.
- Keep the next action and the save status visible.
- Replace "Do it" and "Fix it" with the actual verb.
- Name drafts: "Draft quotation · client · enquiry reference", not "no number
  yet".
- "Everything that happened" → **Activity**. "Prices gathered" → **Supplier
  prices**. "They went elsewhere" → **Mark lost**.
- Architectural explanation belongs in help or admin documentation.

> Users do not need *"Overdue is computed from the due date, not stored."*
> They need **"Overdue invoices"** and the amount to collect.

The same goes for "phase 5", "phase 6", `.env`, database behaviour and internal
doc paths. Several screens carry development notes that are stale or contradict
modules already visible.

---

## 6 · Module gaps

| Area | Recommended change |
|---|---|
| Inbox / Conversations | One message workspace with triage and conversation views. Unread, needs classification, needs reply, completed as distinct states. |
| Sourcing | *Request prices* directly, with a deal selector. No suppliers → *Add supplier* in context. |
| Orders | Separate client orders from supplier purchase orders, including their creation actions. |
| Deliveries | Carry ordered quantities forward; show delivered, remaining, proof-of-receipt. Validate against real partial-delivery cases. |
| Finance | Create from the relevant order/delivery without retyping. Explain unavailable proforma/export actions or remove the placeholders. |
| Contacts | A contact name links to the company. Open a contact record with its company and communication history. |
| People | The name must open a usable record; the row offers Remove and no profile link. *Add person* becomes a clear primary action. |
| Personnel requests | A direct creation action, or a direct route to the site where the request originates. |
| Scan station | Separate scanner administration from ordinary upload. Distinguish the employee's computer from the machine hosting the ERP. |
| Reports | Period filters, and drill-through whose records reconcile with the totals. |
| Setup | Distinguish required setup, optional setup and operational readiness. No blanket "ready" while important configuration is missing. |

---

## 7 · Backup status

The page says "Never taken" while listing dumps and archives. Those are
different conditions. Show: latest backup files created; latest successful
verification; whether database and attachments form a **complete restore set**;
whether a copy exists off the machine.

*(The "Never taken" line was a defect found and fixed on 10 September — PowerShell
writes JSON with a byte-order mark, `JSON.parse` threw, and the catch reported
"never". The remaining asks in this section — the restore-set question and the
off-machine question — are real and still open. His note that backups fall back
to the ERP's own disk is correct and unfixed.)*

---

## Implementation order — his, and it stands

1. **Restore trust** — broken routes, wrong defaults, disabled core actions,
   inconsistent counts, misleading completion messages.
2. **Complete one commercial journey** — enquiry → supplier prices → quotation
   → client order → delivery → invoice → payment, with context carried forward.
3. **Simplify the interface** — navigation, stage-specific deal workspace,
   unified editor, concise wording.
4. **Finish the secondary workflows** — staffing, scanner intake,
   administration, reporting.

> Before expanding further, test that journey with representative employees.
> Give them realistic tasks without coaching. Include changing a deadline,
> correcting a classification, receiving a partial delivery, and recording a
> partial payment.
