# Asking for the retenue de garantie back

**Date:** 5 September 2026
**Status:** built — screen 16e, document kind 22

## What was wrong

`reception_report` has converted to `retention_release` in the catalogue since
the catalogue was written. The kind did not exist. `document-types.test.ts`
carried it in a `knownGaps` set with a note saying the list was meant to
shrink, and for months it did not.

The consequence was not cosmetic. Nothing in this ERP could record the retenue
de garantie coming back, and three things followed from that:

- `project.closedAt` was read in three places and written in none.
- `projectState` closed a marché only when `retentionHeld` reached zero, and
  `retentionHeld` is the sum of what the issued situations withheld — an issued
  situation cannot change, so it never fell.
- Therefore **no marché could ever leave WARRANTY**. On a 5 180 000 DZD marché
  that is 138 260 DZD nobody has a screen for, on a project the ERP will keep
  drawing as unfinished for ever.

## Decisions

**The demand is a document, and it is written because somebody asks.** No
client volunteers the retention. `saveRetentionRelease` writes a draft, the
Gérant issues it, and it carries a number of ours (`RG/{YYYY}/{###}`). The
paper is titled *demande de restitution*, not *levée*: the levée is what the
client grants, and the paper says which of the two it is.

**One line per situation, and no VAT on any of them.** The client's accountant
ticks this off against their own file, and "retenue de garantie — 138 260" is a
figure they would have to take on trust. The tax was paid on the situations the
money was withheld from; charging it again would charge the client twice for
one tax.

**It is money OWED, so it goes in the ledger.** `retention_release` is in
`INVOICE_KINDS` and `BILLED_KINDS`. Once issued it ages, it is chased, and a
payment can be allocated against it like anything else. Before this it would
have been remembered by whoever remembered it, which is how five per cent of a
marché goes missing. Note the pair with the decision of the same day: the
retention is deliberately *not* chased while it sits inside a situation, and
deliberately *is* chased once this paper exists. Lawfully held, then owed.

**The marché closes when the money ARRIVES, not when the letter goes out.**
`retentionReturned` sums payment allocations against issued releases, not the
releases themselves. `Money` gained `retentionReleased` and
`retentionOutstanding`; `projectState` reads outstanding. A demand sitting
unanswered on a wilaya's desk for eight months is precisely the state screen 15
exists to show, and calling the marché closed because we asked would hide it.

**Blocked before the réception définitive.** That PV is what entitles us to the
money; a demand sent before it is a demand the client files. The four refusals
are `noRetention`, `noDefinitive`, `allAsked`, `noContract`, and each one says
in the panel why nothing can be sent.

**And the release date was wrong, which this uncovered.** `retentionRelease`
returned `PV définitif + warranty months`. But the délai de garantie runs from
the réception PROVISOIRE and the définitive is what ENDS it. Adding the warranty
again put the money a second year out and told the Gérant to sit on a demand he
was already entitled to send — while screen 16e, reading the same PV, unblocked
the button. Now: définitive signed → due that day; not yet → provisoire +
warranty, labelled a projection. How long the wilaya then takes to pay is the
ageing screen's business, from the date the demand was issued.

## What was rejected

**A délai réglementaire on the release date.** Décret 15-247 gives the
administration a period to restitute after the réception définitive. Putting
that period on screen 16 would be a legal claim in the UI, and the rule is that
none is made without an authority and a confirmer. The screen states a date
somebody recorded and nothing more.

**Editing the demand in the document builder.** `saveDraft` refuses it
(`retentionIsComputed`), for the third time after `situation`, `amendment` and
`final_account`. Every figure on it belongs to a situation, and a hand-typed
one is a sum asked for that no situation supports — found by the client's
accountant, not by us.

**Closing the marché on the demand being issued.** Simpler, one fewer query,
and it would have converted "we asked" into "we were paid" on every screen in
the company.
