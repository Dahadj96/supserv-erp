# A marché that changed

**Date:** 4 September 2026
**Status:** decided and built

## What was found

The situation chain built the same day billed against a marché that never
moves. Real ones move. A wilaya raises an avenant when a quantity turns out
wrong on site, when a price has to be added that nobody foresaw, or when the
delay is extended — and from that day the situations are raised *s/marché +
avenant n° 2*, against a bordereau that is no longer the one on the signed
order.

The ERP had nowhere to put that. The choices on the table were: retype the
whole bordereau as a second `client_order` and repoint the project at it; or
type the new figure into `project.amount_excl` by hand and leave the lines
wrong. The first breaks every situation already issued — their lines point at
the OLD document's lines, so their cumulative columns empty out. The second
means the bordereau on screen disagrees with the paper, which is how a
quantity gets mistyped into a situation the client then refuses.

## Decisions

**An avenant is the twentieth document kind, not a note on the marché.** The
client counts it, names it and files it separately — the situation form prints
"s/marché + avenant n° 2" — so it is a document, `family: sell`,
`legalValue: commitment`, `numbering: clientReference`, `convertsTo: []`, and
`offers.issue` is what it takes to issue one. Its number is theirs, typed off
the signed paper; LAW 5 allocates us nothing here for the same reason it
allocates nothing on a `client_order`.

**Its lines say what they replace.** An avenant line either carries
`source_line_id` to a line of the marché — replacing that line's quantity, or
its price, or both — or carries nothing, which appends a *prix nouveau* to the
bordereau. `contractOf(projectId)` composes the marché with its issued
avenants, oldest first, and the composed line **keeps the original line's id**.
That is the whole trick: situations already issued point at the marché's lines
through `source_line_id`, and giving a line a new identity under them would
empty the *cumul précédent* column on paper the client has already signed. An
avenant changes what a line says; it does not change which line it is.

**Each avenant's incidence is arithmetic, never typed.** What it added to the
marché is the bordereau's value after it less its value before — computed in
`contractOf` and, per document, in `amendmentImpact`. The project list, the
project page, the situation and the avenant's own PDF all read the same
figure, because a project reading 4 390 000 in one place and 4 730 000 in
another is a question somebody has to take to the Gérant.

**An issued situation is read against the marché as it stood the day it was
issued.** `situationOf` passes the document's own `issued_on` down to
`contractOf`, which drops every avenant signed after it. Re-printing situation
n° 1 in November therefore still shows the July quantities and no avenant
reference — LAW 5 applied to a fact the document does not itself store. A
draft is read against the marché as it stands now, which is the same marché
the screen writing it is showing.

**The avenant has its own screen, and the builder refuses it.** Screen 16c
lists the bordereau with two empty columns — the quantity this avenant makes
of the line, and the price — plus a block of blank rows for the prix nouveaux.
A blank cell is not a change, which is what nearly every line is: an avenant
that moves two quantities out of forty costs two numbers to record. The
builder (screen 47) refuses `amendment` outright, as it already refuses
`situation`, because it saves lines as typed and keeps no memory of which line
of the marché each one answers. Saved through it, an avenant meant to correct
two prices would come back as forty new ones.

## What was rejected

**A second `client_order` carrying the whole amended bordereau.** It is what a
company without this feature does in Excel, and it is why their situations
stop adding up: the old situations point at the old document.

**Storing the amended quantities on the marché's own lines.** LAW 5 — an
issued document cannot change — and it would also lose the avenant's identity,
which the client's file is ordered by.

**Storing the incidence as the avenant's `totals`.** Tempting, because that is
the figure a reader wants. But then a document's lines would not sum to its
own totals, which is an invariant every other kind holds and every reader
checks by hand. The avenant's totals are the value of the prices it states;
the three figures a reader wants — before, incidence, after — are printed
underneath them, computed.

## What this does not do yet

Révision des prix, pénalités de retard and the DGD still wait on an external
text and somebody to confirm it: the official index values for the révision
formula, the CCAP's own penalty rate and ceiling, and the décompte général et
définitif that closes the marché. Each of those is a rule with an authority
behind it, and the ERP does not print a legal claim without one.
