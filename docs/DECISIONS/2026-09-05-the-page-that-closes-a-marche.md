# The page that closes a marché

**Date:** 5 September 2026
**Status:** decided and built

## What was found

A marché could now be opened, billed in situations, amended, extended and
measured for lateness. It could not be **closed**. The last thing a company
does on a marché de travaux is submit a *projet de décompte final*: every
situation added up, less the advance recovered, less the retention withheld,
less what has already been paid, less whatever penalties the client applies —
and the balance that remains.

Every one of those figures was already a fact in this system. Nobody could get
them onto one page, so the page got made in Excel, from figures retyped off
four PDFs.

## Decisions

**The décompte final is the twenty-first kind, and nothing on it is typed.**
`finalAccountOf` is pure: situations in, a balance out. `saveFinalAccount`
gathers them and writes the draft. The form on screen 16 carries one field —
the date on the paper. There is no second field, because a second field is a
figure somebody could type differently from the situations behind it.

**Its lines are the situations, named the way the client's own file names
them.** "Situation n° 2 du 02/09/2026 — SIT-2026-080". A décompte a wilaya's
accountant can check is one that says which papers it adds up; a single line
reading "travaux" is a figure they have to take on trust.

**It refuses to be drawn while anything is open.** A situation still a draft, a
situation issued and unsigned, or work not yet accepted — each blocks it and
each says so in its own words. A final account that left work out would not be
final, which is the only thing it is for.

**The builder refuses it outright**, as it already refuses a situation and an
avenant, and for the strongest version of that reason: every figure on the page
is arithmetic over other documents, and editing one by hand would sign a total
that no longer matches the papers behind it. Screen 47 sends the person back to
the project, where it is drawn again from scratch.

**Two new figures on `Totals`.** `penalty` and `alreadyPaid` are optional and
belong to this one kind. `computeTotals` never sets them: a penalty is what the
CCAP allows the client to apply, and money received is a fact of the payment
register — neither is arithmetic over lines. They print after the total and
before the net, which is the order a reader subtracts in.

**And it is settled at its balance, not its TTC.** The sentence in words says
"Arrêté le présent décompte au solde de", because nobody is owed the total of
the works: they are owed what is left after four subtractions. The same rule
the situation already followed with its net à payer.

## What was rejected

**Calling it the décompte général et définitif.** That paper is drawn by the
service contractant and notified to us. This is the *projet de décompte final*
the entreprise submits — the document a company is actually expected to
produce, and the one that otherwise gets made in Excel. Recording their DGD
when it comes back is a different, smaller thing.

**Letting a person adjust a figure "just this once".** Every argument for it is
an argument for a décompte that disagrees with the situations it adds up. If a
figure is wrong, the situation is wrong, and that is where it gets fixed.

**Creating the numbering series automatically.** A pattern cannot be changed
after the first document carries it, so screen 50 asks the Gérant once, and
until it exists the button says exactly that rather than failing at issue.
