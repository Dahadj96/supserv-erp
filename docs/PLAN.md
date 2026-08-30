# SUPSERV ERP — THE BUILD PLAN (v4)

**Derived from the finished UI, not from intentions.**
86 screens · SARL SUPSERV · Adrar, Algeria · August 2026

Version 3 was written before the interface was complete, so it described a system
we intended to build. This version describes the system that is now drawn, screen
by screen, and it is the last document written before code.

Where v3 and v4 disagree, v4 wins — because v4 was checked against the artwork.

---

## 0. WHAT THE FINAL AUDIT FOUND

The UI was audited programmatically: every frame, every one of 11 461 text nodes,
every button label cross-checked against whether a screen existed behind it.

**Nine things were named on a screen but never drawn.** All nine are now built.

| Gap found | Evidence | Now |
|---|---|---|
| The filter panel | “Filters” was a button on **ten** list screens with nothing behind it | 79 |
| Column chooser, sort, bulk bar, pagination | Described as text on screen 35, never drawn | 79 |
| Saved views | Not mentioned anywhere, yet unusable without | 79 |
| The avatar menu | Present in the topbar of all 86 screens, dead | 80 |
| **The per-person language switch** | Screen 53 defines the rule; no control existed | 80 + 81 |
| Row ⋯ menu, date range picker, keyboard map | Named on 35, never drawn | 80 |
| Why a disabled button is disabled | Nothing said it must explain itself | 80 |
| My profile / preferences | No page — so the language rule had no home | 81 |
| Full search results | Search box on 86 screens, only ⌘K existed | 82 |
| Deletion and restore | 38 says “nothing is auto-deleted”, 45 removes the assistant’s delete tool — nothing described a **human** deleting | 83 |
| Merge duplicates | Named on 21, 25, 62 — never built, and 62 imports 6 duplicates | 84 |
| Day-one setup | 52 admits it is needed, no wizard existed | 85 |
| Mobile | Staff photograph products in shops; every screen was 1440 wide | 86 |

**Two bugs fixed.** `59 - Templates` and `71 - Templates` shared a name while
holding different things (email vs document). Now `59 - Email templates and
snippets` and `71 - Document templates`.

**One thing deliberately not fixed:** the SUPSERV logo. The sandbox cannot reach
supserv.dz. The wordmark is a placeholder in all 86 frames and must be swapped
once before any screenshot leaves the building.

---

## 1. THE SHAPE OF THE SYSTEM

Four layers. Nothing in a higher layer may be re-implemented in a lower one.

```
  ┌─ CAPTURE ────────────────────────────────────────────────┐
  │ email · portal · web form · scan · phone camera · manual │
  │ 38 39 40 41 46 61 62 86                                  │
  └──────────────────────┬───────────────────────────────────┘
  ┌─ RECORDS ────────────▼───────────────────────────────────┐
  │ party · person · item · deal · tender · project          │
  │ 05 06 07 08 15 16 21 22 51 73 76 77 84                   │
  └──────────────────────┬───────────────────────────────────┘
  ┌─ DOCUMENTS ──────────▼───────────────────────────────────┐
  │ one engine · one table · nineteen kinds                  │
  │ 12 18 47 48 49 50 70 71 72 78                            │
  └──────────────────────┬───────────────────────────────────┘
  ┌─ CONTROL ────────────▼───────────────────────────────────┐
  │ permissions · audit · compliance · numbering · storage   │
  │ 27 29 30 32 45 64 65 66 69 83                            │
  └──────────────────────────────────────────────────────────┘
```

The interface layer (79 80 81 82 34 35 36) sits across all four and is built
**once**, not per module. That is the single largest saving in the whole plan and
the reason the audit mattered.

---

## 2. THE SIX LAWS

Every screen obeys these. If code and a law disagree, the code is wrong.

**1. Store a state only when a person or an event changes it. Compute it when
time or arithmetic changes it.**
`overdue` is not a status — it is `due_on < today AND balance > 0`. `won` lives on
the offer as accepted, and the deal reads it. Two bugs were found by audit that
broke this rule; both are fixed in the artwork.

**2. Nothing becomes a fact until a person confirms it against the source.**
Extraction, OCR, image identification and assistant proposals all stop at a review
step with a citation — page number and snippet. `extraction.confirmed_at IS NULL`
means downstream code may not read it. Screens 40, 44, 77.

**3. One document engine. No module renders its own PDF.**
Template + record + counterparty + locale + purpose → PDF, filed copy, link, email
draft, audit entry. Nineteen document kinds, one code path. Screen 70.

**4. Three language axes, never confused.**
Interface follows the *person* (81). Documents and emails follow the
*counterparty* (party.doc_locale). Text a human typed stays in the language they
typed it. A French client gets French paperwork from an English-speaking employee
without either of them thinking about it.

**5. An issued document is immutable. Correction is a new document.**
Numbers are allocated at issue, never on a draft, never reused. Cancelling writes
an avoir. Nobody, including the Gérant, including the assistant, deletes one.
Screens 48, 83.

**6. The assistant proposes; it never executes, and it cannot delete.**
Not “is forbidden to” — *has no tool*. Absence, not permission. It inherits the
signed-in user’s rights exactly; there is no service account. Screen 45.

---

## 3. DATA MODEL

Carried forward from v3 where the artwork confirmed it, extended where the new
screens demand it. **New in v4 is marked ▲.**

### 3.1 Parties, people, items

```sql
create table party (
  id uuid primary key,
  code text unique not null,                       -- CL-0001, SU-0011
  legal_name text not null, trade_name text,
  nif text, nis text, rc text, ai text,
  address text, wilaya text, country text default 'DZ',
  doc_locale text not null default 'fr',           -- law 4
  email_locale text not null default 'fr',
  currency text not null default 'DZD',
  payment_terms text,
  superseded_by uuid references party(id),      -- ▲ merge: retired, never deleted
  archived_at timestamptz,                      -- ▲ archive ≠ delete
  deleted_at timestamptz, deleted_by uuid, delete_reason text,  -- ▲ 30-day bin
  created_at timestamptz not null default now()
);
create table party_alias (                       -- ▲ screen 82 + 84
  party_id uuid references party(id), alias text not null,
  source text,                                   -- typed|email|import|merge
  primary key (party_id, alias)
);
create table party_role (
  party_id uuid references party(id),
  role text check (role in ('client','supplier','authority','subcontractor','partner','prospect')),
  primary key (party_id, role)
);
create table person (
  id uuid primary key, full_name text not null, trade text not null,
  phone text, national_id text, wilaya text,
  source text check (source in ('cv','direct','subcontractor','import')) not null,
  relationship text check (relationship in ('employee','temporary','daily','subcontractor','external')) not null,
  employer_party_id uuid references party(id),    -- null = SUPSERV
  superseded_by uuid references person(id),       -- ▲
  deleted_at timestamptz, deleted_by uuid, delete_reason text  -- ▲
);
create table person_certification (
  id uuid primary key, person_id uuid references person(id),
  kind text not null, number text, issued_by text, issued_on date, expires_on date
);
```

`candidate` is not a table. A CV is `person_application` pointing at a `person`.
A crew member attached to a project needs no CV — the user was explicit about this
and screen 51 enforces it.

### 3.2 Items and technical files ▲

Screens 73, 75, 77, 78 make the catalogue a first-class entity, and put the
technical file on the **item**, not on the enquiry line.

```sql
create table item (
  id uuid primary key, code text unique not null,     -- ITM-0412
  designation text not null, brand text, model text,
  unit text, kind text check (kind in ('good','service')),
  is_generic boolean not null default false,       -- câble, main-d'œuvre: no datasheet exists
  superseded_by uuid references item(id)
);
create table item_alias (                            -- screen 75
  item_id uuid references item(id), alias text not null,
  source text check (source in ('client','supplier','manufacturer','internal')),
  party_id uuid references party(id),                -- whose word this is
  prefer_on_offer boolean not null default false,
  primary key (item_id, alias)
);
create table item_media (                            -- screen 77
  id uuid primary key, item_id uuid references item(id),
  file_id uuid references source_file(id),
  media_kind text check (media_kind in ('datasheet','photo','certificate','diagram','manual')),
  provenance text check (provenance in ('supplier','manufacturer','our_photo','client')) not null,
  party_id uuid, captured_on date, captured_at_place text,
  deal_id uuid,                     -- non-null ONLY for provenance='client' — locked to that deal
  locked boolean not null default false
);
create table item_coverage (                         -- screen 78
  deal_id uuid, item_id uuid,
  requirement text check (requirement in ('required','kept_anyway','not_stated')),
  status text check (status in ('complete','missing','not_applicable')),
  not_applicable_reason text,
  primary key (deal_id, item_id)
);
```

**The rule that makes this pay:** a datasheet attaches to the item and serves
every future deal. The *client’s reference image* is the one exception — it is
locked to the deal, because it records what that client asked for.

### 3.3 Documents — one table, nineteen kinds

Unchanged from v3 and confirmed by screens 47–50 and 70–72.

```sql
create table document (
  id uuid primary key,
  kind text not null,          -- quote|proforma|invoice|advance_invoice|progress_statement|
                               -- credit_note|delivery_note|statement|client_po|goods_receipt|
                               -- supplier_rfq|purchase_order|comparison|work_order|
                               -- service_report|pv_reception|attestation|letter|technical_annex
  number text,                 -- null until issued
  series_id uuid references numbering_series(id),
  party_id uuid references party(id) not null,
  locale text not null,        -- resolved from party, overridable per document
  currency text not null default 'DZD', fx_rate numeric(14,6),
  issued_on date, due_on date, valid_days int,
  status text not null,        -- draft|issued|part_paid|paid|credited|written_off
  global_discount_pct numeric(6,3) default 0,
  advance_deducted numeric(16,2) default 0,
  retention_pct numeric(6,3) default 0,
  stamp_duty numeric(16,2) default 0,
  totals jsonb not null,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
create table document_line (
  id uuid primary key, document_id uuid references document(id) on delete cascade,
  position int not null,
  line_kind text not null,        -- item|section|text|subtotal|page_break
  is_option boolean not null default false,
  item_id uuid references item(id),
  reference text, designation text, note text,
  designation_source text,        -- ▲ screen 75: client|supplier|manufacturer|internal
  unit text, qty numeric(16,4), unit_price numeric(16,4),
  discount_pct numeric(6,3) default 0,
  vat_rate numeric(5,2), vat_exempt_ref text,
  total_excl numeric(16,2)
);
create table document_link (
  from_document uuid, to_document uuid,
  relation text check (relation in ('converted_to','covers','credits','settles')),
  primary key (from_document, to_document, relation)
);
create table numbering_series (
  id uuid primary key, kind text not null, pattern text not null,   -- SUP/{YYYY}/{####}
  reset text not null default 'yearly', next_value int not null default 1,
  reserve_on text not null default 'issue'
);
```

Four database-level invariants (triggers, not application code):
1. `number` is assigned on issue and never on a draft.
2. A number is never reused, even after cancellation.
3. `locked_at` set ⇒ immutable. Correction is a credit note.
4. A proforma can never carry a `settles` relation.

### 3.4 Capture and pricing

```sql
create table intake_item (
  id uuid primary key, channel text not null,     -- email|portal|web_form|scan|whatsapp|manual|upload
  external_ref text, from_name text, from_address text,
  subject text, received_at timestamptz not null,
  classified_as text, confidence numeric(4,3),
  deadline_at timestamptz,                        -- the most valuable field extracted
  status text not null default 'new',
  dismissed_reason text
);
create table source_file (
  id uuid primary key, intake_item_id uuid, owner_type text, owner_id uuid,
  filename text not null, mime text, pages int, bytes bigint,
  detected_kind text, detected_locale text,
  ocr_status text, ocr_confidence numeric(4,3),
  storage_url text not null, sharepoint_id text
);
create table extraction (
  id uuid primary key, source_file_id uuid references source_file(id),
  field text not null, value text, confidence numeric(4,3) not null,
  page int, snippet text,                          -- the citation shown in review
  confirmed_by uuid, confirmed_at timestamptz      -- the trust boundary
);
create table price_quote (                         -- ▲ screens 74, 86
  id uuid primary key, item_id uuid, deal_id uuid,
  source text check (source in ('supplier_email','supplier_proforma','shop_visit','phone','internal_costing')),
  party_id uuid, price numeric(16,4), currency text default 'DZD',
  is_verbal boolean not null default false,        -- shown as unconfirmed on the offer
  evidence_file_id uuid, captured_by uuid, captured_at timestamptz,
  captured_place text, valid_until date
);
```

A price with `is_verbal = true` and no `evidence_file_id` is usable, and is
labelled as unconfirmed everywhere it appears. This is the shop-counter case and
it is normal, not an error.

### 3.5 Interface state ▲ — the layer the audit exposed

```sql
create table user_preference (                     -- screen 81
  user_id uuid primary key,
  ui_locale text not null default 'fr',            -- THE language switch
  date_format text, number_format text, week_starts_on int,
  time_zone text default 'Africa/Algiers',
  landing_page text default 'today',
  signature_fr text, signature_en text,
  away_until date, cover_user_id uuid
);
create table notification_pref (
  user_id uuid, event text, in_app boolean, email boolean,
  quiet_from time, quiet_to time, digest_at time,
  primary key (user_id, event)
);
create table saved_view (                          -- screen 79
  id uuid primary key, entity text not null, name text not null,
  filter jsonb not null, sort jsonb, columns jsonb,
  owner_id uuid, shared boolean not null default false,
  is_default_for uuid
);
create table table_preference (
  user_id uuid, entity text, columns jsonb, sort jsonb, page_size int default 25,
  primary key (user_id, entity)
);
create table blocking_rule (                       -- ▲ screen 80 + 69
  code text primary key,                           -- invoice.client_nif_missing
  applies_to text not null, message_key text not null,
  authority text,                                  -- 'décret 05-468' | 'company policy'
  confirmed_by text, confirmed_on date,            -- null ⇒ warn, do not block
  fix_route text
);
```

`blocking_rule` is the table that makes screen 80 true: **no grey button without a
reason.** Every disabled control resolves to one or more rule codes; the popover
renders their messages, names the authority, and offers `fix_route`. Rules with
`confirmed_by IS NULL` warn instead of blocking — that is screen 69’s compliance
profile, and it is why the system never asserts a law on its own authority.

### 3.6 Control

```sql
create table audit_entry (
  id bigserial primary key, at timestamptz not null default now(),
  actor_id uuid, actor_kind text,                  -- user|assistant|system
  entity text not null, entity_id uuid, action text not null,
  before jsonb, after jsonb, reason text, source_screen text
);
create table assistant_proposal (
  id uuid primary key, user_id uuid not null, thread_id uuid,
  summary text not null, rationale text,
  changes jsonb not null,                          -- [{entity,id,field,before,after}]
  citations jsonb,                                 -- every claim points at a source
  risk text not null, status text not null default 'pending',
  decided_by uuid, decided_at timestamptz
);
create table merge_log (                           -- ▲ screen 84
  id uuid primary key, entity text not null,
  kept_id uuid not null, retired_id uuid not null,
  field_choices jsonb not null, moved_counts jsonb not null,
  merged_by uuid, merged_at timestamptz, reversible_until timestamptz
);
```

**No table has a hard `DELETE`.** Soft delete + 30-day bin + audit entry that
outlives the record. Screen 83 is the specification.

---

## 4. WHAT IS STORED AND WHAT IS COMPUTED

The list that stops the classic ERP bug — a nightly job keeping a status “true”.

| Computed, never stored | From |
|---|---|
| Invoice overdue, days overdue | `due_on`, `balance` |
| Invoice balance | issued total − payments allocated |
| Deal won / lost | the linked offer’s accepted / rejected |
| Ageing bucket | `due_on` |
| Days open, days to pay | timestamps |
| Technical coverage % | `item_coverage` rows |
| Supplier reply rate, average delay | message history |
| “Waiting on” | last outbound message with no inbound reply |

| Stored, because a person or event changed it | Screen |
|---|---|
| Offer accepted / rejected | 11, 12 |
| Document issued, cancelled | 17, 48 |
| Payment recorded, allocated | 19 |
| Delivery confirmed | 14, 49 |
| Extraction confirmed | 40 |
| Client requirement for fiches techniques | 78 |
| Merge decision, “not a duplicate” | 84 |

---

## 5. PERMISSIONS

Six roles out of the box; permissions are the unit, roles are bundles.

| Permission | Gérant | Commercial | Achats | Chantier | Compta | Lecture |
|---|---|---|---|---|---|---|
| `offers.margin.view` | ✓ | ✓ | — | — | ✓ | — |
| `offers.issue` | ✓ | ✓ | — | — | — | — |
| `invoices.issue` | ✓ | — | — | — | ✓ | — |
| `invoices.cancel` | ✓ | — | — | — | — | — |
| `payments.record` | ✓ | — | — | — | ✓ | — |
| `purchase.order.issue` | ✓ | — | ✓ | — | — | — |
| `people.salary.view` | ✓ | — | — | — | ✓ | — |
| `settings.company` | ✓ | — | — | — | — | — |
| `users.manage` | ✓ | — | — | — | — | — |
| `records.delete` | ✓ | own drafts | own drafts | — | — | — |
| `merge.execute` | ✓ | ✓ | ✓ | — | — | — |

Three rules that are not negotiable:

- The assistant holds **exactly** the caller’s permissions. No elevation, ever.
- A permission never hides the existence of a thing. Screen 79: the Margin column
  stays listed and greyed; the list says “3 rows hidden — offers.margin.view”.
- Search never becomes a way around a permission. Cost, margin and salary are
  excluded from the index per user. Screen 82.

---

## 6. STACK

Unchanged from v3 — the artwork gave no reason to move.

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 + TypeScript | one deploy, server components suit document rendering |
| DB | PostgreSQL (Supabase) | RLS matches the permission model exactly |
| ORM | Drizzle | migrations you can read in a diff |
| Auth | Supabase Auth + Entra ID | the Microsoft 365 account already exists |
| Mail | Microsoft Graph | shared mailbox → Inbox, drafts back out |
| PDF | Playwright → PDF from HTML templates | one engine, screen 70 |
| OCR | Azure AI Document Intelligence | French + Arabic, tables, confidence per field |
| Files | SharePoint (final) + object storage (working) | screen 66 |
| i18n | next-intl, ICU messages | plural and gender for FR |
| CSS | **Logical properties from line one** | Arabic RTL later costs nothing |

---

## 7. BUILD ORDER

Eight phases. Each ends with something a person can use on a real day.

> Every **Done when** below is answered in `docs/ACCEPTANCE.md`, which names the
> tests that prove it and — where nothing proves it — says so. A test reads that
> file and fails if any citation has been renamed away, so "the plan is
> finished" is checkable rather than remembered.

**Phase 0 — Shell and the interface layer (2 weeks)**
Screens 79 80 81 34 35 36 85.
Auth, roles, layout, the filter panel, saved views, the column chooser, the avatar
menu with the language switch, empty/loading/error states, toasts, confirmations,
`blocking_rule`, the day-one wizard.
*Nothing else is built until this exists — every later screen consumes it.*
Done when: a person can sign in, switch to Français, and see an empty Deals list
that explains itself.

**Phase 1 — Records and search (2 weeks)**
21 22 51 73 75 76 82 84 + party, party_alias, person, item, item_alias.
Done when: TOUATGAZ is findable by four spellings and two duplicate rows merge
into one without losing a document.

**Phase 2 — Capture (2 weeks)**
02 38 39 40 41 46 61 62 86.
Mailbox → Inbox, upload, scan, OCR, extraction review with citations, the Excel
move-in, the phone quick-capture.
Done when: a TouatGaz consultation email becomes a deal with a confirmed deadline,
and none of the twelve expire unread.

**Phase 3 — The document engine (2 weeks)**
70 71 50 47 18 + document, document_line, numbering_series.
One engine, templates, numbering, locale resolution, PDF, SharePoint filing,
email draft, audit entry.
Done when: the same offer renders in French for a client and English for a
supplier, from one template family, with the right signature block.

**Phase 4 — Sell side, end to end (3 weeks)**
05 06 11 12 09 10 67 74 77 78 + item_media, item_coverage, price_quote.
Enquiry → item list → prices from three sources → offer → technical annex.
Done when: an RFQ with items pasted from an email body reaches a sent offer with a
complete annexe technique, and every price says where it came from.

**Phase 5 — Money (2 weeks)**
17 72 48 19 20 49 14 + payments, ageing, relances, delivery notes.
Done when: proforma → invoice → payment → statement runs without a spreadsheet,
and “overdue” is computed, never stored.

**Phase 6 — Organisation (2 weeks)**
55 56 57 58 63 65 33 59 60 66 83.
Today, timeline, conversations, waiting-on, approvals, notifications, templates,
files, storage, deletion and restore.
Done when: two people run the company for a week without opening OneDrive.

**Phase 7 — Control and the assistant (2 weeks)**
27 32 69 45 43 44 28 64.
Compliance profile with attributed rules, audit log, state machines enforced in
code, the assistant with its proposal/approval loop.
Done when: the assistant can answer “what is late and why” with citations, and
cannot change anything without a human pressing approve.

**Later, deliberately parked:** tenders module depth (07 08 42), projects and
situations (15 16), recruitment (24 25 26), supplier scorecard (23), website
forms (46 beyond capture), Arabic UI.

---

## 8. RULES THAT KEEP IT LEAN

1. **No module renders a PDF.** One engine or it is not merged.
2. **No screen writes its own list UI.** One table component, one filter panel.
3. **No status column that a clock could change.**
4. **No hard delete, anywhere, in any migration.**
5. **No legal claim in UI copy.** It goes in `blocking_rule` with an authority and
   a confirmer, or it is not asserted.
6. **No fake seed data.** The lists stay empty until something real is in them.
7. **Logical CSS properties only.** `margin-inline-start`, never `margin-left`.
8. **Every disabled control resolves to a rule code.** No exceptions.

---

## 9. STILL OPEN — DECISIONS ONLY YOU CAN MAKE

1. **Which design is authoritative.** Three pasted reviews referenced
   `ENQ-2026-0041`, `SR-2026-0018`, `OFF-2026-0031`, suppliers Cortel and BR
   Système. A programmatic search confirms **none of these exist in this
   86-screen file.** Two designs are in circulation. This must be settled before
   line one of code. *(Flagged four times now.)*
2. **The accounting boundary.** Does this system feed your comptable’s software,
   or does it become the ledger? Everything up to the invoice is decided. The
   general ledger is not.
3. **The four unconfirmed compliance rules** — droit de timbre threshold, retenue
   de garantie treatment, TVA on services rendered abroad, proforma validity.
   They warn today. Your accountant turns them into blocks.
4. **The logo.** One file, and 86 frames stop saying “S”.
5. **Arabic.** Built to accept it, not drawn. Say when.

---

## 10. THE ONE-LINE VERSION

*Capture everything that arrives, turn it into records a person confirmed, issue
documents from a single engine in the counterparty’s language, and never let the
system claim a fact, a law, or a deletion on its own authority.*
