# The date that decides is not today

**30 Aug 2026.** Screens 07 and 08 come off the parked list. Two reasons, and
the second is the interesting one.

## Why now

`/tenders` has been a live link in the sidebar since phase 0. It returned 404.
That is the same class of problem the coverage check found this morning in
`/dashboard`, `/sourcing` and `/orders`, and it is worse here, because tenders
are how this company gets most of its work: SADEG, ANBT, GCB, URBACON. An
enquiry from a private client is a nice week; an AONR is the year.

## A tender is a deal

There is no tender list beside the deal list. `tender` is one row per deal that
is answering a formal procedure, holding the four things a deal does not have —
the procedure, the place of deposit, the bid bond, and that the envelope was
actually carried to the counter. The client, the subject, the deadline, the
lines, the stage, the outcome and the offer all stay on the deal and are read by
exactly the code that already reads them.

So screen 07 is `listDeals` with a join, and a tender that turns out to be an
ordinary consultation loses nothing by having been recorded as an enquiry.

## The state this whole screen exists for

    A CASNOS attestation, valid today, expiring 30 August.
    A tender closing 2 September.
    A folder that is otherwise perfect.

Every other screen in this system calls that document valid. It **is** valid.
The bid is thrown out at the desk anyway, because the date that decides is not
today — it is the day the envelope is opened.

`expiresBeforeDeposit` is its own state for that reason, and it is checked
*before* the thirty-day expiry warning. Both are true of the same paper. Calling
it "expires soon" would be accurate and would put the row that ends the bid
below four amber rows that do not.

Nothing about a piece is stored. Ready, missing, expiring, expired and
expires-before-deposit are computed from the paper's expiry against this
tender's closing time, so a folder that was 100 % in July stops being 100 % in
September with nobody touching a row. A stored percentage would still say 100.

## The company's papers are held once

CNAS, CASNOS, the extrait de rôle, the casier judiciaire, the statuts, the
certificat de qualification. Every tender asks for the same ones and each has
ONE expiry date.

`company_credential` holds them once and `tender_piece` points at them by key. A
CNAS attestation renewed in March must not leave eleven tenders pointing at the
February one, and it would, because nobody goes back through old folders.

## What the folder is NOT

It is not a list of what Algerian law requires.

PLAN §8 rule 5: *"No legal claim in UI copy. It goes in `blocking_rule` with an
authority and a confirmer, or it is not asserted."* — and "a tender requires an
attestation CNAS" is exactly such a claim. It is also not reliably true: what is
required is whatever THIS buyer wrote in THIS cahier des charges, and SADEG and
ANBT ask for different folders for the same kind of work.

So `tender_piece` rows are seeded from a default when a tender is created and
are that tender's own list from then on. A person adds what the dossier asks for
and removes what it does not; `added_by` records who said so. The screen says
"asked for", never "required", and the default is only the folder SUPSERV has
carried to every marché in Adrar — a good starting point and not an authority.

A consultation starts without the bid bond, the qualification certificate and
the casier judiciaire, because a consultation is a buyer asking three companies
for a price and four permanent red rows on a screen where nothing is wrong is
how people learn to ignore red rows.

## Depositing an incomplete folder is allowed, and costs a sentence

`markSubmitted` refuses while anything is blocking. `force` gets past it and
requires a reason.

That combination is deliberate. A company does sometimes deposit an incomplete
folder on purpose — to be seen to have bid, to hold a relationship — and a
system that made that impossible would be worked around within a month. What it
must not be is silent: the reason goes in the log, and so does the list of what
was blocking at the moment of the deposit, frozen. Six months later the question
"did we know?" has an answer.

## The percentage is floored

The frame prints 78 % over 7 of 9, which is 77.7 rounded up. It is floored here.
The one number on this screen that everybody reads should not flatter a folder
that will be refused.
