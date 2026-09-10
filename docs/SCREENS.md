# SCREENS → ROUTES → PHASE

86 screens in the Figma file `p0zcsZTobPL8zZAeYhyYBt`, page **v4 - Complete**.

Every task maps to at least one row here. If you cannot find the screen for what
you are about to build, stop and ask — do not invent an interface.

`(pattern)` = built once in `src/components/`, used by many screens.
`(reference)` = a design document drawn as a screen; it has no route.

| # | Screen | Route | Phase |
|---|---|---|---|
| 01 | Login | `/sign-in` | **0** |
| 02 | Inbox | `/inbox` | **2** |
| 03 | Dashboard (Gerant) | `/dashboard` | **5** |
| 04 | Dashboard (Commercial) | `/dashboard` | **5** |
| 05 | Deals | `/deals` | **4** |
| 06 | Enquiry detail | `/deals/[id]` | **4** |
| 07 | Tenders | `/tenders` | **4** |
| 08 | Tender dossier | `/tenders/[id]` | **4** |
| 09 | Sourcing | `/sourcing` | **4** |
| 10 | Supplier RFQ composer | `/deals/[id]` | **4** |
| 11 | Offers | `/offers` | **4** |
| 12 | Offer builder | `/offers/[id]/build` | **4** |
| 13 | Orders | `/orders` | **5** |
| 14 | Deliveries | `/deliveries` | **5** |
| 15 | Projects | `/projects` | **5** |
| 16 | Project detail | `/projects/[id]` | **5** |
| 17 | Invoices | `/invoices` | **5** |
| 18 | Invoice preview | `/documents/[id]` | **3** |
| 19 | Payments | `/payments` | **5** |
| 20 | Ageing and relances | `/payments/ageing` | **5** |
| 21 | Companies | `/companies` | **1** |
| 22 | Company detail | `/companies/[id]` | **1** |
| 23 | Supplier scorecard | `/companies/[id]/scorecard` | **4** |
| 24 | Candidates | `/candidates` | **1** |
| 25 | Candidate detail | `/candidates/[id]` | **1** |
| 26 | Personnel requests | `/personnel-requests` | **5** |
| 27 | Compliance | `/compliance` | **7** |
| 28 | Reports | `/reports` | **7** |
| 29 | Settings | `/settings` | **0** |
| 30 | Users and roles | `/settings/users` | **0** |
| 31 | Modules | `/settings/modules` | **0** |
| 32 | Audit log | `/settings/audit` | **7** |
| 33 | Notifications | `/notifications` | **6** |
| 34 | Empty, loading and error states | `(pattern)` | **0** |
| 35 | Component states | `(pattern)` | **0** |
| 36 | Overlays and patterns | `(pattern)` | **0** |
| 37 | Flow map | `(reference)` | — |
| 38 | Intake channels | `/settings/channels` | **2** |
| 39 | Dossier intake | `/inbox/dossier` | **2** |
| 40 | Extraction review | `/inbox/dossier/[id]/review` | **2** |
| 41 | Scan station | `/inbox/scan` | **2** |
| 42 | BPU import and pricing | `/tenders/[id]/bpu` | **4** |
| 43 | Assistant in context | `/assistant` | **7** |
| 44 | Assistant proposals | `/assistant/proposals` | **7** |
| 45 | Assistant permissions and safety | `/settings/assistant` | **7** |
| 46 | Website intake forms | `/settings/forms` | **2** |
| 47 | Document builder | `/documents/[id]/edit` | **3** |
| 48 | Proforma to invoice | `/documents/[id]/convert` | **5** |
| 49 | Delivery note builder | `/deliveries/[id]` | **5** |
| 50 | Document types | `/settings/document-types` | **3** |
| 51 | People | `/people` | **1** |
| 52 | Standardisation | `(reference)` | — |
| 53 | Language and localisation | `/settings/language` | **0** |
| 54 | The same screen in French | `(proof)` | — |
| 55 | Today | `/today` | **6** |
| 56 | Deal timeline | `/deals/[id]/timeline` | **6** |
| 57 | Conversations | `/conversations` | **6** |
| 58 | Waiting on | `/waiting-on` | **6** |
| 59 | Email templates and snippets | `/settings/email-templates` | **6** |
| 60 | Files | `/files` | **6** |
| 61 | Quick capture | `/capture` | **2** |
| 62 | Move in from Excel and OneDrive | `/settings/import` | **2** |
| 63 | Week ahead | `/week` | **6** |
| 64 | State machines | `(reference)` | **7** |
| 65 | Approvals | `/approvals` | **6** |
| 66 | Storage and files | `/settings/storage` | **6** |
| 67 | Sourcing request | `/sourcing/[id]` | **4** |
| 68 | Supplier order | `/purchase-orders/[id]` | **4** |
| 69 | Compliance profile | `/settings/compliance` | **7** |
| 70 | Document engine | `(reference)` | **3** |
| 71 | Document templates | `/settings/templates` | **3** |
| 72 | New invoice | `/invoices/new` | **5** |
| 73 | Item list builder | `/deals/[id]/items` | **1** |
| 74 | Price capture | `/deals/[id]/prices` | **4** |
| 75 | Which name goes on the offer | `(pattern)` | **1** |
| 76 | Contacts | `/contacts` | **1** |
| 77 | Item technical file | `/items/[id]/technical` | **4** |
| 78 | Technical coverage | `/deals/[id]/technical` | **4** |
| 79 | Filtering, views and bulk actions | `(pattern)` | **0** |
| 80 | Menus, pickers and shortcuts | `(pattern)` | **0** |
| 81 | My profile and preferences | `/settings/profile` | **0** |
| 82 | Search | `/search` | **1** |
| 83 | Deleted and restore | `/settings/bin` | **6** |
| 84 | Merge duplicates | `/companies/merge` | **1** |
| 85 | Day one | `/setup` | **0** |
| 86 | On the phone | `(responsive)` | **2** |

## Supporting routes

Routes that exist on disk and are not screens in the Figma file. Every one of
them serves a screen that is — a creation form the list screen links to, a step
of a wizard, a detail view of a row. They are listed because the coverage check
runs in both directions: a route nobody wrote down here fails the test, so
nothing gets built into this ERP without a line saying what it is for.

| Route | Serves |
|---|---|
| `/companies/new` | 21 Companies — the create form |
| `/companies/[id]/edit` | 22 Company detail — the edit form |
| `/companies/duplicates` | 84 Merge duplicates — the finder that feeds it |
| `/contacts/new` | 76 Contacts — the create form |
| `/deals/new` | 05 Deals — the create form |
| `/deals/[id]/edit` | 06 Deal — the edit form (V4). A deal had no edit path at all, so a deadline read off a PDF was unfixable for the life of the enquiry |
| `/items` | 77 Item technical file — the catalogue, and the only door to it. The upload form shipped complete with nothing anywhere linking to it (V0) |
| `/deliveries/new` | 14 Deliveries — the create form |
| `/documents/new` | 47 Document builder — picking a kind before there is a draft |
| `/inbox/[id]` | 02 Inbox — one item, opened |
| `/prices/new` | 74 Price capture — the phone half, at a supplier's counter, with no enquiry open |
| `/projects/new` | 15 Projects — open one on an enquiry the client said yes to |
| `/projects/[id]/situation` | 16 Project detail — the next situation, typed against the marché's bordereau |
| `/projects/[id]/amendment` | 16 Project detail — the avenant, typed against the same bordereau |
| `/compliance/expiring` | 27 Compliance — the other half: every expiry date the company holds, ordered by date, each row naming the tenders, sites and deals it would break |
| `/settings/backup` | 66 Storage and files — the backup half: when it runs, where it goes, whether the last one was proved restorable, and the two things a person may do about it |
| `/settings/clear` | 83 Deleted — the one act that fills it: everything typed before a chosen moment, previewed then binned |
| `/settings/compliance/one-pager` | 69 Compliance profile — the printable sheet |
| `/setup/identity` | 85 Day one — step 1 |
| `/setup/bank` | 85 Day one — step 2 |
| `/setup/vat` | 85 Day one — step 3 |
| `/setup/numbering` | 85 Day one — step 4 |

## By phase

- **Phase 0** — Shell and the interface layer: 01, 29, 30, 31, 34, 35, 36, 53, 79, 80, 81, 85
- **Phase 1** — Records and search: 21, 22, 24, 25, 51, 73, 75, 76, 82, 84
- **Phase 2** — Capture: 02, 38, 39, 40, 41, 46, 61, 62, 86
- **Phase 3** — The document engine: 18, 47, 50, 70, 71
- **Phase 4** — Sell side, end to end: 05, 06, 07, 08, 09, 10, 11, 12, 23, 42, 67, 68, 74, 77, 78
- **Phase 5** — Money: 03, 04, 13, 14, 15, 16, 17, 19, 20, 26, 48, 49, 72
- **Phase 6** — Organisation: 33, 55, 56, 57, 58, 59, 60, 63, 65, 66, 83
- **Phase 7** — Control and the assistant: 27, 28, 32, 43, 44, 45, 64, 69
- **Parked — after the first release**: none

Ten screens left that list on 30 Aug, and the parked list is now empty.

**68** was parked as "tenders module depth", which it is not: a supplier order
is the leg between an offer that was won and an invoice that can be defended,
and without it the client delivery date is a guess and the margin is whatever
the supplier decides to bill. See
`docs/DECISIONS/2026-08-30-the-supplier-order-was-not-a-parked-screen.md`.

**07 and 08** because `/tenders` had been a live link in the sidebar the whole
time, and because tenders are how this company gets most of its work. The
dossier screen answers one question — will this folder be accepted at the desk
on the day it is deposited — and the state it exists for is a paper that is
valid today and expired on the morning of the deposit. See
`docs/DECISIONS/2026-08-30-the-date-that-decides-is-not-today.md`.

**15 and 16** because `/projects` was the second dead link in the same rail, and
because for a company doing travaux the period between winning the work and the
last invoice being paid is most of the year — situations waiting for a
signature, retention nobody goes back for, bank guarantees lapsing quietly.

**23** because it needed no schema at all. Every figure on a supplier scorecard
is arithmetic over rows that already exist — who was asked, who answered, whose
price ended up on an offer, and whether that offer was won — which is the whole
argument for a scorecard over a `rating` field somebody sets once and never
revisits.

**24, 25 and 26** because `/personnel-requests` was the third dead link, and
because a candidate turned out not to be a new kind of record at all: screen
24's own breadcrumb reads "People / Candidates". Three columns on `person` and
two small tables. The rule the whole module turns on is the one screens 08 and
16 already follow — a welding attestation valid this morning and expired on the
day a man is due on site does not make him a warning, it makes the crew one
short.

**42** last, and it was the one screen still on the parked list. It is not an
import screen with a pricing table bolted on. The bordereau IS the deal's
lines — `deal_line` already holds the client's own number, reference,
designation, quantity and unit — so importing one is importing deal lines, and
the screen's real subject is what happens a fortnight later when the buyer
issues an ERRATUM against thirty-one lines that have already been priced.
Re-importing is correct and throws every price away; ignoring it means bidding
against the wrong quantities. So the incoming file is diffed on the client's
line number, a quantity change keeps its price and a redesignation does not,
and the prices a redesignation invalidates are stamped stale rather than
deleted. See `docs/DECISIONS/2026-08-30-an-erratum-is-not-a-re-import.md`.

- **Reference only, no route**: 37, 52, 54
