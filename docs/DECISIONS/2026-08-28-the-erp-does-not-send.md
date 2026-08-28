# The ERP does not send email

Date: 2026-08-28
Screen: 59 — Email templates and snippets
Status: in force

## The question screen 59 forced

Screen 59 draws a template library. A template library implies a send button,
and a send button implies `Mail.Send` — an application permission that would let
the ERP write email as `contact@supserv-dz.com`, and as any other mailbox the
Exchange scope is later widened to.

That is not a small addition to what the ERP holds today. `Mail.Read`, scoped to
one mailbox, means the worst case of a bug is that the ERP reads something it
should not. `Mail.Send` means the worst case is that a client receives something
nobody wrote.

## The decision

**A template produces text. A person sends it.**

Screen 59 renders the subject and body, resolves what it can, and stops. The
text is copied into Outlook and sent by a human under their own name, from their
own mailbox, into their own Sent Items.

This is the same shape screen 57 took eight days earlier
(`2026-08-27-conversations-are-read-only.md`) and for the same reason: the ERP
holds `Mail.Read`, and read means read.

It is also what LAW 6 already says. *The assistant proposes, never executes.* An
email that leaves the building is an execution. The law does not carve out an
exception for a template just because a human wrote the words a month earlier —
the thing being approved is this email, to this client, today.

## What is deliberately given up

Sent mail does not appear in Conversations, because it never passed through the
ERP. A relance the ERP suggested and a person sent is invisible to the ERP until
the client replies. That is a real cost and it is accepted: the alternative buys
a complete thread history with a permission that can write to the outside world
unattended.

If that cost ever becomes intolerable, the honest fix is `Mail.ReadWrite` and a
DRAFT — the ERP writes the draft into the person's own Drafts folder, and they
press send in Outlook. That keeps the human in the loop and still records the
message. It is a smaller ask than `Mail.Send`, and it is the next conversation
to have, not this one.

## Two things the screen does not do either

**It does not seed wording.** Every body arrives blank. `ensureTemplatesExist`
made this call first, for document templates: a seed that invented French
commercial wording nobody wrote would be the same mistake as a seed that
invented a legal rule. It is worse here, because an email is sent by a person
who assumes a human wrote it. What the seed provides is the LIST — the fifteen
moments this company writes the same thing twice — each one blank and saying so.

**It does not evaluate anything.** The placeholder vocabulary is a closed list
of `{group.field}` names in `src/domain/email/placeholders.ts`. No conditions,
no loops, no function calls, no lookup by arbitrary key. This is the rule
`routing_rule` follows — structured data, never a string to evaluate — and it is
here for the same reason: this text is edited from a settings screen, and a
template language with an evaluator is a way to run code by saving a form.

Saving refuses a name outside the vocabulary. `{client.nom}` is a typo that
would otherwise sit in a template for a year and then go out in an email as
literal braces.

## Nothing unresolved becomes blank

`render` leaves an unresolved placeholder visible and reports why: `unknown` (a
typo), `noRecord` (a real field, no record in hand), or `empty` (a real field on
a real record with no value). None of them collapses to an empty string.

A relance that silently loses the invoice number reads perfectly well and is
worthless. One that still says `{invoice.number}` gets fixed before it is sent.
