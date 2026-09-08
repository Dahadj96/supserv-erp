# The first RFQ had nowhere to go

**Date:** 5 September 2026
**Status:** built, NOT YET VERIFIED — needs `pnpm check`, `pnpm build`, `pnpm walk`

## What was wrong

Found by the Gérant, testing the ERP on real mail. A conversation classified as
an RFQ; the button to open it grey; no reason on the screen. His words: *"I
still see it as unusable."*

He was right, and he had also worked out why: there were no companies in the
system yet.

`commitEnquiry` refuses without a client, and says so in its own comment:

> `deal.partyId` is required and always will be: an enquiry with no client is
> not an enquiry, it is a note. So this refuses rather than inventing a company
> from an email domain, which is how "SARL Gmail" ends up in a CRM.
>
> **When the sender is not matched, screen 02 already has the answer one step
> earlier — link them to a company as a contact first, and then this works.**

That last sentence was not true. `commitContact` also requires a `partyId`, and
screen 02 only ever rendered its "add as contact under —" form inside
`{item.partyId ? … : null}` — when the company was **already** matched. There
was no path anywhere in the inbox from a message to a company that does not
exist yet.

So an ERP with an empty company list could not open its first enquiry by any
route. Not a rare state: it is the state every ERP is in on day one, and it is
the state this one was in when its owner opened it.

The only explanation offered was `title="…"` on the greyed button —
`inbox.blocked.senderHasNoCompany`, a sentence that exists, is translated, and
is delivered by a tooltip nobody hovers. And the redirect it would have fallen
back to (`?error=companyRequired`) went to a page that never read
`searchParams`, so that sentence had no way of appearing either.

## Decisions

**The screen asks the question instead of refusing.** Where the grey button
was, there is now a field with the company's name in it and one button:
*Create the company and open the enquiry*. One press does both halves, because
they are one decision — splitting them is what produced a signpost pointing at
a step that did not exist.

**The name is suggested, not invented.** `companyNameFromEmail` takes the
domain — `commercial@touatgaz.dz` suggests `TOUATGAZ` — and free-mail domains
suggest nothing, because `gmail.com` is not a company. It lands in a field the
person reads, edits and submits. That is what keeps `createParty`'s rule
intact: the system still never creates a company from a guess. Somebody read a
word and pressed a button.

**Look-alikes first.** Anything already on file that resembles the suggestion is
offered above the field, as *Use TOUATGAZ (CL-0003)*. This screen is the
easiest place in the whole ERP to create a duplicate company, and a duplicate
here is the expensive kind: the facture goes out under one spelling and the
relance under the other. Screen 84 exists to clean that up; better not to make
it.

**The name is all that is asked for.** `createParty` already argues this and the
argument is unchanged: *"A company arrives from an email long before anyone has
its NIF, and refusing to record it until the paperwork is complete is how people
end up keeping a second list in Excel. The rule bites at invoice time instead."*
`blocking_rule` carries `invoice.client_nif_missing`, which names the décret and
blocks the invoice — the moment the law actually cares.

**A role mailbox becomes the company's address; a person's does not.**
`commercial@touatgaz.dz` still reaches the company when whoever reads it leaves.
`m.belkacem@` is one man's, and a facture sent there in 2028 goes nowhere.
`nameFromEmail` already draws exactly that line — it returns null for role
mailboxes — so the two readings stay one list rather than two that drift.

**No contact is created.** The sender is a person at that company and it is
tempting to make the record while we are here. But the job title would be
invented, and once the message has a company, screen 02's existing "add as
contact under —" appears by itself. That is the step the old comment promised;
it exists now because the company does.

**The page reads `?error=` at last.** Every refusal the action can produce has a
sentence in both languages under `message.error.*`.

## What was rejected

**Creating the company silently from the domain.** The comment warning about
"SARL Gmail" is right, and this does not do it. What changed is that the person
is now asked, on the screen where the question arises, instead of being sent
somewhere that could not answer it.

**Requiring the NIF and RC up front.** An RFQ arrives before anybody knows them.
Demanding them here would mean the enquiry gets answered in Word.

**Leaving the grey button and adding a link to /companies/new.** It works, and
it costs the person the thing they were doing: they leave the message, type a
company, come back, find the message again. Two of those steps exist only
because the software could not ask a question in place.

## Still open

The wider defect this uncovered: **`disabledReason` renders only as a `title`
tooltip**, in a component whose own doc comment says every disabled control must
say why. There are 42 of them across 24 screens. This change removes the one
that blocked the first RFQ; it does not fix the mechanism, and that is the next
commit.
