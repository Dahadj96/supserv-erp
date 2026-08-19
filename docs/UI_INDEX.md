# SUPSERV ERP — UI v4, COMPLETE

**Figma file:** https://www.figma.com/design/p0zcsZTobPL8zZAeYhyYBt
**Page:** `v4 - Complete`  ·  36 frames  ·  built 18 August 2026

Every gap and every fix from the audit is now drawn. The old pages
(`Screens`, `v2 · Redesign`, `v3 · Simple Design System`) are left in place for
comparison but are superseded.

---

## THE 36 SCREENS

### Entry and overview
| # | Screen | What it answers |
|---|---|---|
| 01 | Login | Sign-in via Microsoft 365 (managed auth, tenant-pinned). No passwords stored. |
| 02 | **Inbox** | The new first screen. Classified mail, deadline countdown, triage in one click, and a "needs a human" bucket. |
| 03 | Dashboard — Gérant | Cash, deadlines, projects, compliance, data blocking work. |
| 04 | Dashboard — Commercial | Same shell, different tiles. No cost, margin or cash. |

### Work
| # | Screen | What it answers |
|---|---|---|
| 05 | Enquiries | Pipeline with stage, deadline, value, owner, row actions. |
| 06 | Enquiry detail | Items, client instructions verbatim, sourcing status, **go / no-go with reason**. |
| 07 | Tenders | AONR and consultations with submission method, caution and dossier readiness. |
| 08 | **Tender dossier** | The AONR checklist — administratif / technique / financier, each line tied to a document with expiry. |
| 09 | Sourcing | Reply rate, days waiting, best price, chase actions. |
| 10 | **Supplier RFQ composer** | One message per supplier, French template, supplier ranking by reply rate, reply-by buffer against the client deadline. |
| 11 | Offers | Amount HT / TTC, submitted via, validity, status, and a why-we-lost panel. |
| 12 | Offer builder | Lines with cost and margin (permission-gated), terms, **submission method and proof**, pre-submit checks. |
| 13 | Orders | Delivery due, delivered count, and the "delivered but not invoiced" flag. |
| 14 | **Deliveries** | Partial deliveries per BL, signed proof, what it unlocks for invoicing. |
| 15 | **Projects** | The works business: progress, situations, retenue, cautions. |
| 16 | **Project detail** | Situations / attachements, crew pulled from the CV bank, PV de réception, retenue de garantie, cautions. |

### Money
| # | Screen | What it answers |
|---|---|---|
| 17 | Invoices | Facture vs proforma, ageing, paid vs outstanding. |
| 18 | **Invoice preview** | The actual document with the décret 05-468 mentions — NIF, NIS, RC, AI, TVA 19%, droit de timbre, amount in words — and a hard blocker when the client NIF is missing. |
| 19 | Payments | Record partial payments, instrument, reference, proof; rules that apply per instrument. |
| 20 | **Ageing and relances** | 0–30 / 31–60 / 61–90 / 90+, per client, with full relance history and an escalation policy. |

### Relationships and people
| # | Screen | What it answers |
|---|---|---|
| 21 | Companies | With missing NIF flagged red — the thing blocking invoicing today. |
| 22 | Company detail | Legal identity, contacts, **how this client works** (submission channel, days to pay), credit risk. |
| 23 | **Supplier scorecard** | Reply rate, turnaround, win rate, **price history per reference** with change since last time. |
| 24 | Candidates | Discipline filters, certification expiry surfaced in the list. |
| 25 | **Candidate detail** | CV preview, extracted fields with a confidence flag, certifications with expiry, pipeline, matching requests. |
| 26 | **Personnel requests** | Open positions per project and the shortlist, with certification validity as a gate. |

### Control
| # | Screen | What it answers |
|---|---|---|
| 27 | Compliance | 23 documents, expiry-sorted, showing which bid each one blocks. |
| 28 | Reports | Revenue by client, why offers were lost, supplier performance, ageing. |
| 29 | Settings | Company legal identity (with the three unconfirmed fields flagged), banks, numbering, tax, reminders. |
| 30 | Users and roles | Users plus an **editable permission matrix**, 12 permissions × 5 roles. |
| 31 | Modules | Six plugins with dependencies, table and permission counts, enable/disable. |
| 32 | **Audit log** | Who changed what, filterable, immutable. |
| 33 | **Notifications** | Grouped by what they block, plus the bell dropdown and per-event preferences. |

### Specification boards
| # | Board | What it fixes |
|---|---|---|
| 34 | Empty, loading, error, no-permission | The four states every list needs — and day one, empty is the one everyone sees. |
| 35 | Component states | Buttons, inputs, selection, status tags, table mechanics — hover, focus, disabled, error. |
| 36 | Overlays and patterns | Toasts, type-to-confirm on destructive actions, side drawer, ⌘K command palette. |

---

## THE ELEVEN FIXES — WHERE EACH ONE LANDED

| Fix | Where |
|---|---|
| Empty / loading / error states | Board 34, with a rule strip per state |
| Notification bell in the topbar | Shell — bell with unread dot, dropdown drawn on 33 |
| Logo | Shell — SUPSERV wordmark and mark. *Still to swap for the real asset* |
| Table sort, pagination, row actions, bulk select, columns | Every table; specified on board 35 |
| KPIs link to their filtered list | Every KPI carries a chevron; deadlines and overdue receivables added |
| Role-conditional dashboard | 03 and 04, with a role switcher on both |
| Editable permission matrix + invite | 30 |
| Audit log and Numbering screens | 32 and 29 |
| Company legal identity as a blocker | 29 (flagged fields) and 18 (issue blocked) |
| Multi-currency + domiciliation | 10, 12, 18, 29 |
| French output documents | 10 (supplier RFQ), 18 (invoice), 29 (language setting) |

---

## NAVIGATION AS BUILT

```
Inbox (12)          ← first, badged
Dashboard
WORK           Enquiries · Tenders · Sourcing · Offers · Orders · Deliveries · Projects
MONEY          Invoices · Payments
RELATIONSHIPS  Companies · Contacts
PEOPLE         Candidates · Personnel requests
CONTROL        Compliance · Reports · Settings
```

Users & roles, Modules and Audit log sit inside Settings as tabs, so the sidebar
stays at 18 items.

---

## STILL OPEN

1. **The real logo.** `supserv.dz/assets/logo.png` is blocked from this sandbox.
   Drop the file in and I will place it in the shell and set the brand colour from it.
2. **Arabic.** French is set for outbound documents; Arabic is not yet drawn.
   It matters for official correspondence and should be decided before coding.
3. **The two-module question.** Works (projects) and Commerce (supply) are drawn
   as separate modules on one core, which screen 31 makes explicit. Confirm this
   before the schema is written.
4. **Mobile.** Everything here is 1440 desktop. Site staff recording a delivery
   or a situation will be on a phone — that is a separate, smaller set of screens.

---

# ADDED AFTER THE FLOW AUDIT — SCREENS 37 TO 46

The first 36 screens modelled what happens to a record once it exists. These ten
model **how it comes into existence** — which is where the real work is.

| # | Screen | What it closes |
|---|---|---|
| 37 | **Flow map** | Origins → pipeline → exits for all five flows, colour-coded by whether the UI can capture it. The Tenders band is almost entirely red — that is the argument for everything below. |
| 38 | **Intake channels** | Nine ways work reaches SUPSERV, only three of them live. Routing rules, and the safety rails those rules obey. |
| 39 | **Dossier intake** | Eleven files from three sources in three languages, auto-classified as RC / CPS / BPU / DQE / plan, with OCR confidence per file and the erratum flagged. |
| 40 | **Extraction review** | The trust screen. Source page on the left with the passage highlighted, extracted fields on the right with confidence and a page citation. Nothing becomes fact without a person confirming it. |
| 41 | **Scan station** | The printed binder. 44 pages, skew and rotation flagged, split into two documents with a language each, OCR confidence stated honestly — Arabic reads worse than French. |
| 42 | **BPU import and pricing** | 42 priceable lines imported without retyping, with the last price we paid shown beside each, and the four lines the erratum replaced. |
| 43 | **Assistant in context** | Answers with citations you can open, on the record you are looking at. Ends in a proposal that has not been applied. |
| 44 | **Assistant proposals** | Every write as a before/after diff waiting for a person. Nothing on the page has happened yet. |
| 45 | **Assistant permissions and safety** | Freely / With your approval / Never, as three columns. Plus what it may read per role, and the data-handling promises. |
| 46 | **Website intake forms** | A French quote form and a careers form for supserv.dz. Both land in the Inbox; neither creates anything by itself. |

## The capture pipeline these screens implement

```
CAPTURE → ASSEMBLE → DIGITISE → CLASSIFY → EXTRACT → REVIEW → COMMIT
```

Built once, it serves tenders, CVs, supplier quotes, invoices received, delivery
notes and bank statements. Step 6 — a human confirming each field against the
page it came from — is the whole reason it is safe to use extraction on a
document where one mistake voids a bid.

## The assistant safety model, in one line each

1. **It can never exceed the person using it.** No assistant account, no elevated rights.
2. **It proposes, it does not execute.** Every write is a diff waiting for approval.
3. **Deletion does not exist.** No tool for it, so no instruction can produce it.
4. **Everything is on the record**, and every answer cites its source.

## Still open after this round

- The real logo.
- Arabic UI (documents are French; the interface is English).
- Mobile screens for site staff.
- **New:** whether the assistant may record a payment with approval, or never.
  It is drawn as *off* — the one capability I would not turn on without you saying so.

---

# SCREENS 47 TO 52 — DOCUMENTS, AND THE DE-SPECIALISATION

## The correction that mattered most

The crew example was right, and it was a symptom rather than a one-off. Crew
could only be assigned from the CV bank — as if everyone who works on a site has
sent us a CV. A day labourer, a subcontractor's welder, a driver hired for a
week: none of them ever will.

**The rule now applied everywhere:** how a client behaves is *data the user
enters*. What a document is, and what the law requires of it, is *structure we
build*. Screen 52 lists every place those got mixed up and what each became.

Four things changed structurally:

| Was | Is now |
|---|---|
| Crew comes from Candidates | **Person** is the record. Name and trade is enough. A CV, an ID copy and a certification are optional documents attached to them. |
| Candidates is the only source of people | Four equal sources: a CV from any channel, typed in directly, a subcontractor's staff list, an import. |
| Everyone is a candidate | Employee · temporary · journalier · subcontractor staff · external — certification tracking applies to all. |
| Two document types, one screen | Ten document types, one builder. |

Three more became settings rather than code: submission method (SAP portal was
appearing as if it were a system concept because one client uses one), client
behaviour, and routing rules. The sidebar item is now **People**; Candidates is a
tab inside it.

## The document builders

| # | Screen | What it does |
|---|---|---|
| 47 | **Document builder** | One builder for all ten kinds. Lots with subtotals, free-text lines, optional lines excluded from the total, per-line TVA and remise, global remise, acompte and retenue deductions, droit de timbre on cash, multi-currency, page breaks, BPU import, copy from another document. |
| 48 | **Proforma → facture** | The conversion, with the full document chain from devis to payment. Shows what carries over unchanged, what changes, and the three things needing a decision. The proforma is kept, linked, and its number never reused. |
| 49 | **Bon de livraison** | Partial deliveries against an order — ordered / already delivered / this delivery / remaining. Colisage, transport, destination, and the two signature blocks with a reserves field. |
| 50 | **Document types** | The standard Algerian set with series, legal value, allowed conversions, and the décret 05-468 mandatory mentions the system refuses to issue without. TVA 19% / 9%, exonération with attestation, timbre on cash. |
| 51 | **People** | The generalisation made concrete. Source and relationship columns, and an Add person form where only name and trade are required. |
| 52 | **Standardisation** | The audit itself: where the UI was client-specific, what it became, and the test to apply to anything new. |

## The ten document types

Devis · Facture proforma · Bon de commande client · Bon de livraison · Facture ·
Facture d'acompte · Situation / attachement · Facture d'avoir · Relevé de
factures · Bon de réception fournisseur.

Rules that hold for every client: a number is reserved on issue and never on a
draft; a number is never reused even if the document is cancelled; a facture is
never edited, only credited by an avoir; a proforma is never paid.

## Still too narrow — stated plainly

- Only DZD invoicing is fully drawn. EUR and USD exist, but the import paperwork
  around domiciliation bancaire is thin.
- The interface is English and the documents are French. **Arabic is not drawn at
  all**, and for a system aimed at the Algerian market that is the largest
  remaining gap.
- Mobile, for site staff recording a delivery or a situation.
- The real logo.

---

# SCREENS 53 AND 54 — LANGUAGE

The French buttons you spotted on the document screens were not a typo. They
exposed a missing decision, which is now made.

| # | Screen | What it settles |
|---|---|---|
| 53 | **Language and localisation** | Interface language per person; document and email language per counterparty; the rules the system enforces; what is never translated; coverage per language. |
| 54 | **The same screen in French** | Screen 47 rendered for Yacine. Same screen, same data, French interface — and the document still French because the client is Algerian. If it were dormakaba the document would be English with the interface untouched. |

## The three axes

| Axis | Follows | Example |
|---|---|---|
| Interface | the person signed in | Yacine in French, Abderrahmane in English |
| Documents and messages | the counterparty | Invoice to Baladna in French, quotation to dormakaba in English |
| Stored content | whoever typed it | "Vanne papillon DN80" stays as written |

**Enforced:** an invoice to an Algerian client may be French or Arabic, never
English. Amount in words is generated in the document language. Number and date
formats on a document follow the document language, not the reader.

**Never translated:** legal names · NIF, NIS, RC, AI · item references · the
original email or file · numbers already issued.

## What was fixed in this pass

304 interface strings across screens 17, 18, 47, 48, 49 and 50 moved from French
to English, leaving document content — line designations, subtotal labels, the
printed invoice body — in French where it belongs. Screen 49 is now "Delivery
note builder"; the document it produces is still a bon de livraison.

---

# SCREENS 55 TO 63 — ONE OR TWO PEOPLE, NOT EXHAUSTED

Scope for this round: perfect the sell side, communication and organisation.
Purchase side, accounting, QMS and HSE are deferred to later module updates.

The design target changed. Not "a complete ERP" but "a person can run this
company from one screen without keeping the rest in their head."

| # | Screen | What it removes from your day |
|---|---|---|
| 55 | **Today** | Grouped by what it costs you to ignore it, not by when it arrived. One button per row. **It ends** — "that is everything for today" — so you can stop. |
| 56 | **Deal timeline** | Every email, file, call, document and money event for one piece of business, in one stream, with a composer at the bottom. This is the answer to "lost in email". |
| 57 | **Conversations** | Everything ever said to a client or supplier, both directions, with the reply language chosen from the counterparty. |
| 58 | **Waiting on** | Twelve things sitting with other people, days quiet, chases sent, next auto-chase. Deliberately kept off Today. |
| 59 | **Templates** | Ten email templates in FR and EN plus snippets. Nothing written twice. |
| 60 | **Files** | The system owns the OneDrive structure and creates it. One "Unfiled" pile is the only tidying you ever do. |
| 61 | **Quick capture** | One box for a pasted email, a photo of a paper, a scanned dossier, a phone note. Fifteen seconds, attached to the right record. |
| 62 | **Move in** | Your four Excel files and three OneDrive folders, mapped and imported. Nothing of yours is moved or deleted. |
| 63 | **Week ahead** | See a crowded Thursday on Monday. Everything here also appears on Today when its day comes — it is not a second list to manage. |

## Navigation, rebuilt around the daily loop

```
Today (7)          ← what needs you now
Inbox (12)         ← what came in
Conversations (9)  ← what was said
Waiting on         ← where the ball is elsewhere
Deals              ← the work itself
Dashboard
WORK               Tenders · Sourcing · Offers · Orders · Deliveries · Projects
MONEY              Invoices · Payments
COMPANIES & PEOPLE Companies · Contacts · People · Personnel requests
CONTROL            Compliance · Files · Reports · Settings
```

**Enquiries became Deals.** A deal carries the enquiry, the sourcing, the offer,
the order, the delivery, the invoice and the whole conversation — one object to
open instead of six. The individual lists stay for when you want to see all
offers or all invoices at once.

The new sidebar was rebuilt once and propagated to all 57 shell screens with the
active item preserved.

## The four habits this is designed to kill

| Today | With this |
|---|---|
| Reading the mailbox to find out what to do | Today, ordered by consequence |
| "Did they ever answer me?" | Waiting on, with days quiet and one-click chase |
| Hunting a file across OneDrive | It was filed when it arrived |
| A paper or a phone call that never gets recorded | Quick capture, fifteen seconds |

## Deferred, on purpose

Purchase orders to suppliers and accounts payable · general ledger and G50 ·
QMS records (non-conformance, internal audit, management review) · HSE ·
stock · treasury. All listed in the plan as later modules.

---

# SCREENS 64 TO 72 — STATE MODEL, PROCUREMENT, AND THE DOCUMENT ENGINE

| # | Screen | Why it exists |
|---|---|---|
| 64 | State machines | Ten entities, stored vs derived, and the two errors found by audit |
| 65 | Approvals | Nine gates that block rather than record |
| 66 | Storage and files | SharePoint for final, object storage for working, never personal OneDrive |
| 67 | Sourcing request | The sourcing operation as its own numbered record, with conflict detection |
| 68 | Supplier order | Supplier PO, goods received, three-way match — the missing leg |
| 69 | Compliance profile | Legal claims moved out of UI copy into attributed, confirmable rules |
| 70 | **Document engine** | One service, five callers. No module renders a PDF itself. |
| 71 | Templates | 18 templates, 4 families, 2 languages, with every data binding shown |
| 72 | New invoice | The Finance entry point — pre-filled from an order, or start blank |

## The document engine

```
template + record + counterparty + locale + purpose
        → ENGINE →
PDF · SharePoint file · link on the record · draft email · audit entry
```

**The engine owns:** company identity and logo from master data, numbering and
reservation, language and formatting, amount in words, compliance checks, filing
and registration.

**A module may never:** render its own PDF, hard-code the company address or RC,
invent its own numbering, decide language from the signed-in user, or write to
SharePoint directly.

The document catalogue grew from 10 types to **19** across four families —
Commercial, Procurement, Operations (work order, service report, PV de réception,
delivery note) and Administrative (attestation, official letter, tender forms).

## One point held rather than adopted

A review proposed the invoice lifecycle as *Draft → Preview → Issue → PDF →
Draft email → Sent → Paid / Partially paid / Overdue / Cancelled*.

That mixes three things the previous review correctly asked us to separate.
**Preview, PDF and draft email are actions**, available at any point. **Overdue is
derived** from due date and balance — storing it means a nightly job keeps it
true, and it drifts. **Cancelled is a credit note**, not a status change on an
issued document.

The lifecycle stays: `draft → issued → part paid → paid`, terminal `credited` and
`written off`.

Numbering is a setting, not an argument. `SUP/{YYYY}/{####}` is the default;
`INV-{YYYY}-{####}` is one field in Document types.

---

# Round 12 — Fiches techniques (screens 77–78)

Two screens, answering the whole of the technical-datasheet problem.

## 77 — Item technical file  *(`120:2`)*

The header says the thing that decides everything else:
**"attached to the item, not to one enquiry."** ITM-0412 has been quoted in six
deals. A datasheet found once for it is present in all six and in every future
one. Nobody hunts for the same PDF twice.

Six files, each carrying **where it came from**, because the source changes what
the file is allowed to be used for:

| File | Badge | Meaning |
|---|---|---|
| `fiche_technique_TOA_A-2120.pdf` | From the supplier | goes in the annexe technique |
| `photo_officielle_A-2120.jpg` | Manufacturer | goes in the offer |
| `photo_chergui_18-08.jpg` | We photographed it | evidence, dated, place named |
| `image_client_ampli.png` | The client sent this · **Locked** | the record of what was asked |
| `certificat_CE_A-2120.pdf` | From the supplier | conformity |
| `schema_raccordement.pdf` | Manufacturer | installation |

**Three kinds of picture, and they are not interchangeable** — the panel that
stops the three from being blurred together:

- **What the client sent.** What they asked for. Locked, like their wording. If
  what you deliver does not look like this, the argument is about this file.
- **What the supplier or maker published.** What will actually arrive. Use it on
  the offer and in the annexe.
- **What you photographed in a shop.** Evidence you saw it, at that shop, on that
  date. Useful when a verbal price is disputed, or when no official photo exists.

**Identify from an image** (right rail) — the client sends a photo, not a name.
The system reads text off it — `TOA · A-2120 · 120W` — and matches ITM-0412, with
a second fuzzy candidate ITM-0388. Stated plainly on the screen: *reading the
brand and model off the picture is far more reliable than matching on
appearance.* Nothing is committed until **Confirm the match**.

## 78 — Technical coverage  *(`120:408`)*

Per deal: 14 items, 9 complete, 3 missing, 2 not applicable.

**"Did the client ask for them?"** is a stored answer, not a guess — *Yes,
required with the offer* / *No, but we keep them anyway* / *Not stated*. When the
answer is Yes, a missing datasheet **blocks submission**. When it is No, the same
gap is a note.

**"Not applicable" is a real answer**, and it is not the same as "we could not
find it":

- **Not applicable** — câble HP, boulonnerie, main-d'œuvre. Generic goods and
  services no manufacturer documents. Marked once, with a reason, counts as
  complete.
- **Nothing found** — a real product that should have a datasheet and we do not
  have it. A gap. Blocks the annex if the client asked for one.

**How files arrive** maps every real route to the same destination:

| Route | Lands as |
|---|---|
| Supplier attaches a PDF | filed to the item |
| Supplier sends a photo | filed to the item |
| You photograph it in a shop | Quick capture on your phone (screen 61) |
| Client sends a picture | locked, kept on this deal |
| You find it on a maker's site | paste the link or the file |
| Nobody has one | mark not applicable, with a reason |

**Annexe technique** — 14 pages, one per item, French, SUPSERV letterhead, built
by the same document engine as every other issued document, numbered and filed
against the deal. Not a folder of loose PDFs attached to an email. Currently
**Blocked — 3 items missing**.

## Fix applied this round

Screen 78's item column was truncating names at 74px. Rebalanced the fixed
columns (tick columns 52→42, source 184→150, status 130→112) so the FILL item
column grew to 156px. All 14 item names now read in full.

---

# Round 13 — The final audit (screens 79–86)

The whole file was audited programmatically: 86 frames, 11 461 text nodes, every
button label checked against whether a screen existed behind it. Nine capabilities
were named on a screen and never drawn. All nine are now built.

## 79 — Filtering, views and bulk actions  *(`127:2`)*

“Filters” was a button on **ten** list screens with nothing behind it. This is the
one panel behind all of them.

- **The filter panel** — applied filters as removable chips, eight fields, and the
  combination written in plain words underneath: *AND between fields, OR inside
  one.* Nobody should have to guess how two filters combine.
- **Saved views** — a named question, not a query. *Closing this week*, *Waiting
  on a supplier*, *Nothing sent yet*, *Annex incomplete*. Private until shared.
- **Columns**, **Sort**, **Pagination**, and a **bulk action bar** that appears on
  selection.

The bulk bar draws a hard line: assign, tag, mark waiting and export are offered;
**send, issue, cancel and delete never are.** Anything that leaves the building or
cannot be undone happens one record at a time.

**Four rules that keep filtering honest:** the count always shows “14 of 342”; the
filter lives in the address so a link can be pasted into an email; an empty result
shows the filters that caused it, not a blank page; and a row hidden by permission
says so and names the permission.

## 80 — Menus, pickers and shortcuts  *(`129:2`)*

The avatar sat in the top right of all 86 screens with nothing behind it.

- **The avatar menu** — and inside it the control the whole language architecture
  was missing: **English / Français / العربية (not yet)**. With the note that
  matters: changing your language changes nothing a client sees.
- **The row ⋯ menu** for an invoice — open, preview, send, record a payment, copy
  link, duplicate, export, and *Cancel — creates an avoir*. **There is no Delete.**
- **The date range picker** — presets, two months, and the rule that a range is
  always a range of *one named date*. Invoice date, due date, payment date,
  delivery date and creation date are five different questions.
- **Keyboard** — twelve shortcuts, on `?`.
- **What a disabled button owes you** — hover a greyed *Issue the invoice* and it
  says: client has no NIF (décret 05-468), no delivery note linked (your own rule),
  with a button that fixes the first. **Never a grey button with no reason.**
- **File preview** — with provenance travelling alongside it.

## 81 — My profile and preferences  *(`130:2`)*

The page the language rule had no home in.

Interface language, date and number format, first day of the week (Sunday), time
zone, landing page. **Two email signatures — French and English** — because the
signature follows the *email*, not you: a French email carries the French block
even when your interface is in English.

Plus sign-in, sessions, notification channels, and **When you are away** — work
assigned to you also appears on your stand-in's Today. Nothing is reassigned, so
when you return it is still yours; it was simply not invisible while you were gone.

Closing panel: **what is yours, what is the company's, and what is neither** — a
client's document language is a fact about them, not a preference of yours.

## 82 — Search  *(`130:406`)*

The search box was on 86 screens; only ⌘K existed.

“touatgaz” → 41 results, scoped by type, each saying **why it matched**. Search
looks in four places: records, documents we generated, files we received
(including text read off a scan), and email bodies.

*One company, many spellings* — GROUPEMENT TOUATGAZ, Touat Gaz, TouatGaz JV, GTG.
All four find it, because aliases live on the record. Without that, half of the 41
results would never be found.

**What search will never do:** show a record you cannot open (margin, cost and
salary stay out of your index — a search must not become a way around a
permission); guess what is in a picture; or search a file nobody filed.

## 83 — Deleted and restore  *(`133:2`)*

Screen 38 promised nothing is auto-deleted and screen 45 removed the assistant's
delete tool. Neither said what happens when a **person** deletes.

**Three words that are not the same:**

- **Discard** — a draft nobody outside ever saw. Bin, restorable 30 days.
- **Archive** — a finished real record. Stops appearing in lists; every document
  pointing at it still works.
- **Cancel** — an issued document. Never deleted. An avoir is created, the
  original keeps its number, both stay in the audit log for good.

Six things may never be deleted by anybody, including the Gérant and the
assistant: an issued document, a recorded payment, an audit entry, a sent or
received email, a number in a series, a tender dossier after deposit.

And a dead link inside your own system tells you what used to be there and what
replaced it. **Never a blank 404.**

## 84 — Merge duplicates  *(`133:437`)*

Six duplicate companies came in from the Excel move-in on screen 62 and every list
since has had two rows for one client.

Field by field, left kept, right merged in — with the detail that matters:
**aliases are never a choice, they are added together.** The other email becomes a
contact rather than being thrown away. Payment terms come from the *newer* record
because it came off the last signed contract.

**A merge is not a delete.** CL-0031 is retired, not removed. Every document ever
issued under it keeps its number and still resolves.

One merge screen, four entities — companies, contacts, items, people.

## 85 — Day one  *(`134:2`)*

Eleven things to set before the first document can be issued; the first four block
everything. Company identity (RC, NIF, NIS, article d'imposition — décret 05-468),
logo, TVA rates, numbering series. Then bank/RIB, droit de timbre, payment terms,
roles, mailbox, storage, and the Excel move-in.

**No fake seed data.** A system that ships with sample companies teaches people to
ignore what is on screen.

## 86 — On the phone  *(`134:437`)*

Eighty-five screens are 1440 wide. These four are 390.

1. **In a shop, photographing a product** — camera, where you are, what it is read
   off the label. Works with no signal; sends when back on the network.
2. **At the counter, writing down a price** — marked **Verbal · No document**, with
   who said it and when. On the offer it shows as unconfirmed until a document
   backs it.
3. **Approving from anywhere** — approve an offer, confirm a payment match. A
   decision, not data entry. That is why it fits on a phone.
4. **Reading, not writing** — Today, and *Call M. Kaddour*. A phone is for phoning.

**Why only four:** a phone is better at being in the room — capture and decision,
seconds of input. It is worse at fourteen lines of pricing and a 38-page cahier
des charges. Capture and approve on the phone; build and decide on the laptop.

## Also fixed this round

`59 - Templates` and `71 - Templates` shared a name while holding different things.
Now **59 — Email templates and snippets** and **71 — Document templates**.
