# The assistant does not guess

Date: 2026-08-28
Screens: 43, 44, 45 — the assistant
Status: in force for the read half; the model question is open and is yours

## The question phase 7 forced

PLAN §7 sets the acceptance test:

> the assistant can answer "what is late and why" with citations, and cannot
> change anything without a human pressing approve.

The word "assistant" pulls hard towards a language model. Before writing one in,
it is worth asking what the model would actually be doing.

## The decision

**No model is called to answer "what is late".**

Lateness is arithmetic over a date and a balance. `gather()` already produces
every fact the Today screen stands on — a deadline on a deal, an overdue
invoice, a delivery note nobody billed, a message nobody answered — and every
item carries the `href` of the screen it came from. So the answer is a filter, a
sort, and the link the screen already uses.

A model asked to do the same job would:

- **sometimes be right.** Which is the problem. Arithmetic is always right, and
  "overdue by 12 days" is not a judgement call.
- **always be unverifiable.** The citation would be generated alongside the
  claim rather than being the source of it. A number that comes with a link the
  same process invented is worse than a number with no link, because it looks
  checked.
- **require the company's correspondence to leave this machine.** Real mail from
  `contact@supserv-dz.com`, prices, margins, CVs. That is a decision with a
  contractual and a legal dimension, and it is not one a build session makes on
  a Thursday evening.

So the read half is deterministic and finished. Screen 45 says so on the page.

## What is deliberately still open

**Whether a model sits behind the PROPOSE half.** Drafting a relance in
somebody's own words is the kind of job a model is genuinely good at and
arithmetic is not.

That question is yours, and it has three parts worth separating:

1. **Which model, and where does it run?** A hosted API means client
   correspondence leaves Adrar. A local model on this machine does not, and this
   machine is a mini PC.
2. **What does it get shown?** A relance needs an invoice number, an amount, a
   date and a client name. It does not need the mailbox.
3. **Who reads the output before it goes out?** Answered already, by LAW 6 and
   by `docs/DECISIONS/2026-08-28-the-erp-does-not-send.md`: the ERP does not
   send, so a person reads every draft in Outlook regardless.

Nothing in the current design blocks any of those answers. The registry has a
`propose` kind, and a proposal is a row.

## How LAW 6 is enforced rather than asserted

`src/assistant/registry.ts` is the list the runtime uses, not a description of
it. Three things hold it down:

- **Two kinds only** — `read` and `propose`. There is no `execute`.
- **`NEVER`** — six things named specifically, implemented nowhere, and a test
  that fails if any of them appears as a tool. "The assistant is safe" is
  marketing; "there is no tool that issues a document, and here is the test"
  is checkable.
- **The identity rule** — `assistantPermissions(role)` gives it exactly the
  caller's permissions minus `records.delete`. No service account, no
  elevation. A Commercial asking about margins gets what a Commercial would get
  by opening the screen.

And the load-bearing one: `tests/unit/assistant.test.ts` reads the source of
every file under `src/assistant` and fails if it finds `db.insert`, `db.update`
or `db.delete`. A tool that wrote to a business table would pass the type check
and the permission check, and quietly break the only law that makes an assistant
safe to point at a real company's data. It does not pass that.

## The one thing this cannot protect against

A person approving a proposal without reading it. Screen 44 shows the whole
proposed text and what it would touch, and the approval is recorded with a name
and a timestamp. That is as far as software goes.
