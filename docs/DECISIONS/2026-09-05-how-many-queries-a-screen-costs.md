# How many queries a screen costs

**Date:** 5 September 2026
**Status:** decided and built

## What was found

Nothing was slow. That is exactly why this was worth doing.

The ERP runs on a mini PC in an office in Adrar: six people, one Postgres in
Docker on the same machine, a round trip measured in fractions of a
millisecond. A screen making ninety queries opens in a fifth of a second and
nobody notices — until the disk is busy, or the page is opened over the tunnel
from a phone, or the register has three years of documents in it instead of
three months.

Adding avenants, the délai and the décompte final in one day had quietly built
the classic shape: one function calling another that re-reads what the caller
already had. Screen 16 composed the marché in `getProject`, again on the page
itself, and a third time inside the décompte — and each composition cost one
round trip PER AVENANT on top of six for the bordereau. Screen 15 was worse:
`amendmentDeltas` called `contractOf` once per project, so a list of thirty
marchés was two hundred queries to draw a table.

## Decisions

**The count is a measurement, not a feeling.** `db` carries a query counter,
`queryCount()` / `resetQueryCount()`, and `tests/integration/
query-budget.test.ts` holds each heavy read to a ceiling with the measured
number written in the comment beside it. A change that doubles the work now
fails a test rather than being noticed in a year on a slower disk. The budgets
are deliberately not tight to the unit — a query added for a good reason should
not fail — but they are tight enough that a read accidentally done twice does.

**Composition is pure, and the query is separate.** `composeLines` applies the
avenants to a bordereau with the rows already in hand and reports, in ONE pass,
both what each avenant changed and what it added to the value. `contractOf`
used to re-compose from scratch once per avenant to work out each one's delta;
now it composes once.

**`amendmentDeltas` reads in bulk.** Four queries for one project or for
thirty: the projects with an avenant, every marché's bordereau, every avenant,
every avenant's lines — then the same arithmetic in memory. It is the one
function both screen 15 and screen 16 use to say what is under contract today,
so it had to be the one that scales.

**A caller that has the project passes it.** `nextFinalAccount(id, loaded)`.
`getProject` is nine queries; the décompte panel needed the penalty and the PV
date, both of which the page already had. Passing them is not a
micro-optimisation, it is half the page.

**And there is a cheap way to ask WHICH document the marché is.**
`contractDocumentIdOf` — one query, sometimes two — for callers that only need
to link something to it. `contractOf` reads the whole bordereau and every
avenant, and using it to learn an id was six round trips for a uuid.

## The measure

For one project with ten prices, two situations and three avenants:

| Read | Before | After |
|---|---|---|
| `getProject` — screen 16 | 14 | 9 |
| `listProjects` — screen 15 | 12 | 7 |
| `nextSituation` — 16b | 12 | 9 |
| `nextAmendment` — 16c | 11 | 8 |
| `nextFinalAccount` — 16d | 34 | 14 |
| …with the project already loaded | — | 5 |

Screen 15's number is the one that matters most: it no longer grows with the
number of projects on the page.

## What was rejected

**React's `cache()` around `contractOf`.** It would have deduped the three
calls on screen 16 in one line, and it would have made the measurement lie: the
work is still done three times in a script, a job or a server action, and the
budget test — which runs outside a React request — would have gone on reporting
the old number while the page reported a better one. Doing less work is doing
less work.

**Tightening the budgets to the measured number.** A ceiling with no room is a
test that fails on the next honest change and teaches people to raise it
without reading it.
