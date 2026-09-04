# The situation is the invoice

**Date:** 4 September 2026
**Status:** decided and built

## What was found

Screens 15 and 16 — projects — were read-only. `project`, `situation_detail`,
`project_caution` and `project_crew` existed, `progressOf` computed financial
progress and retention over the situations, the catalogue had `situation` as
a kind since phase 3, and there was no screen that could open a project,
raise a situation, record a réception or a caution. The module displayed
data nobody could enter. For a company whose year is mostly travaux billed
to a wilaya, that was the biggest hole left, and the one the competitor
study of 2 September pointed at.

## Decisions

**A situation is a `document` of kind `situation` whose lines point at the
contract's lines.** The project names its DQE contractuel — the client's
order when they sent one, otherwise the offer they accepted
(`project.contract_document_id`) — and every situation line carries
`source_line_id` to a line of that document. That is the same link a bon de
livraison and a facture partielle already use, and it is what turns the
wilaya's form into arithmetic: *quantité marché* is the contract line,
*cumul précédent* is the sum over the situations issued before, *période*
is the only column a person types, *cumul* is the sum. Nothing cumulative is
stored (LAW 1); an issued situation cannot change, so the sums cannot drift
(LAW 5).

**The engine issues it like any other document, and draws it differently.**
`render` attaches a `situation` block — marché, period, cumulative rows,
travaux précédemment certifiés — and `toPdf` draws the "partie
co-contractant" layout when it is there: identity block, maître de
l'ouvrage, opération, marché n°, the nine-column bordereau with pagination,
then travaux cumulés − précédemment certifiés = présente situation, TVA,
TTC, retenue, remboursement d'avance, net à payer, the amount in words, and
the three signatures. The document is the one the client's engineer signs;
there is no separate invoice to raise for works billed this way.

**The retention's base is the contract's fact, not a company setting.**
`computeTotals` now takes `retentionPct` AND `retentionBase` (`excl` or
`incl`) and withholds nothing unless both are given. Both bases are seen on
Algerian décomptes; the CCAP of the marché says which. So the base lives on
the project (`retention_base`), is read off the CCAP by the person opening
it, and a situation with a retention cannot be raised while it is null. The
retention never reduces the VAT base — it is a withholding of payment, not a
discount — and comes off the net à payer beside an advance being recovered.
The `invoice.retentionTreatment` rule on screen 85 stays as it was: this
does not decide the treatment on ordinary invoices.

**One draft at a time, in order.** `saveSituation` rewrites the open draft
rather than opening another; n° 3 cannot exist while n° 2 is a draft; and the
engine refuses to issue a situation whose predecessor is unissued, because
its cumul précédent would change the day the predecessor went out. The
builder (screen 47) refuses situations outright — it rewrites lines without
the contract link — and the edit route sends them to the project's own
screen.

**The two dates the client controls are recorded, not derived.** Submitted
is the day the paper left; approved is the day their engineer signed it,
with a name. Both are recorded on an issued situation only, in that order.
The state machine in `progress.ts` was already built around them.

**Over-execution is flagged, not refused.** A cumulative quantity past the
marché's is marked with an asterisk on the form and counted on the draft.
The work was done; the client's engineer strikes it or an avenant covers
it. Refusing it would make the system the arbiter of a contract dispute.

**The 58 wilayas are a datalist, not a select.** `src/domain/wilayas.ts`
carries the list of loi 19-12; `WilayaList` renders it under any free-text
wilaya field. The columns stay free text because "Adrar centre" and "In
Salah (base ENAGEO)" are things people actually write.

## Not done, and why

- **Avenants** — a second contract document would be the honest model
  (lines added, prices changed), and the situation would cover both. Not
  built until a real avenant is on the table.
- **Révision des prix** by formula, **pénalités de retard**, **DGD** — each
  needs its own text (the CCAG's formula, the marché's penalty clause) and a
  person to confirm it. The `deal.latePenalty` column exists; nothing
  computes on it.
- **Crew** forms — `addCrew` exists; a form is an afternoon and was not the
  blocker.

## Proof

`tests/unit/situation.test.ts` (the arithmetic, both retention bases),
`tests/unit/wilayas.test.ts`, and `tests/integration/situation-flow.test.ts`
— a marché from the client's order to the third situation, issued in
order, submitted, approved, received, with the third's PDF left in
`.logs/situation-3.pdf` to be read by eye.
