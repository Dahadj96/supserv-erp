# Not every `status` column is a state machine

Date: 2026-08-28
Screen: 64 — State machines (reference; no route)
Status: in force

## The count

Nine columns in this schema are called `status`. Screen 64 asks for state
machines "enforced in code", and the lazy reading of that is nine guards.

Two of the nine are not lifecycles, and guarding them would refuse legitimate
edits:

- **`intake_channel.status`** — `live | not_connected | not_built | considered`.
  Configuration. A person flips it in settings, in any direction, and
  `not_built → live` is a deployment rather than a transition.
- **`item_coverage.status`** — `complete | missing | not_applicable`. A computed
  fact, recomputed from the datasheets that exist. There is no "from".

The other seven are in `src/domain/control/transitions.ts`.

## What the declaration carries beyond the graph

**`unwritten`** — states the schema names that no code path produces. This is
not a to-do list. It is the difference between "the design says a document can
be credited" and "something in this codebase credits a document", and a test
checks it stays true.

Two of these were news:

- `document.credited` and `document.written_off` are read in a dozen places —
  `paidStateOf`, the invoice list's tones, the delivery and relance queries —
  and **written by nothing.** The avoir flow that would set `credited` does not
  exist yet.
- `intake_dossier.confirmed` is never written either. Confirmation happens per
  FIELD, in `extraction_field`, and nothing rolls it up onto the parent.

**`legacy`** — values in rows written before a rule changed. `document.paid` and
`part_paid` predate phase 5 moving paid-ness to arithmetic over
`payment_allocation`. They are read and never written, and `canGo` refuses to
move a row *out of* one: guessing what an old row meant is how old data acquires
a history it never had.

**`cyclic`** — `intake_message` never finishes, and that is correct. "An email
nobody can find again is worse than one nobody read", so a dismissed message
goes back to `needs_review`. Every other machine has to end somewhere and the
test enforces it, so the exception is a flag with a reason attached rather than
an absence nobody notices.

The schema comment on `intake_message.status` claims `archived` and `ignored`.
The code writes `dismissed`. The code wins; the two claimed values are recorded
as legacy.

## The bug it was built to find

`render()` refused a re-issue like this:

```ts
if (purpose === "issue" && record.number) throw new NotRenderable("alreadyIssued");
```

That asks the wrong question. A document kind whose `numbering` is
`clientReference` never gets a number of ours — and there is one: `client_order`,
which carries the **client's** reference. So `record.number` was null, the check
passed, and a client order could be issued as many times as somebody pressed the
button.

Every press rewrote `lockedAt` and `renderSnapshot`. The row would re-freeze
against whatever the master data said that day — silently, on a commitment
document the client already holds a copy of. LAW 5 says an issued document is
immutable; the guard protecting it was watching a side effect of issuance
instead of issuance.

It now asks the state:

```ts
assertTransition("document", record.status, "issued");
```

`MACHINES.document` has no edge from `issued` back to `draft` and never will.

### And the guard had the same bug, once

The first `assertTransition` returned early when `from === to`, reasoning that
re-saving a row without moving it is not a move. True of a row. False of an
**event** — and issuing is an event. So `issued → issued` was waved through and
`render()` issued the same document a second time anyway.

The integration test that has guarded LAW 5 since phase 3 caught it on the first
full run, which is the argument for writing the enforcement before believing it.
A self-edge is now declared like any other, and none of the seven machines
declares one.

## What is enforced at runtime, and what is not

`assertTransition` is wired into **`render()`** (LAW 5) today. `approval_request`
was already enforced — `checkDecision` returns `alreadyDecided` for anything not
`waiting` — and a test now asserts that rule and this graph say the same thing,
so neither can drift into decoration.

The remaining five are **declared but not yet guarded at runtime.** That is
stated plainly rather than implied: a module that looks like enforcement and is
not is worse than no module. What they do get is the static check below, which
is what actually stops the next one going wrong.

## The test that will keep earning

`tests/unit/transitions.test.ts` reads every `status: "..."` literal out of
`src/` and insists each is a declared state of some machine, or one of the seven
values explicitly exempted as non-lifecycle. A status invented in a store, with
no thought given to what it may become, fails there — not in six months when a
screen filters on it and finds nothing.
