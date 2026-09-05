# The forms it could not follow

**Date:** 5 September 2026
**Status:** built — `pnpm audit:forms` follows every form, 0 not followed

## What was wrong

`pnpm audit:forms` printed this, and it read as green:

```
271 fields on 79 forms, 43 not followed
every field a person can fill in is read by the action it posts to
```

The second line was true about 271 fields. The forty-three in the first line
were not checked at all, and they were not a random forty-three. They were
three forms:

- **the company form** — fifteen fields, and it is the form this ERP is used
  through more than any other;
- **the document builder** — twenty-one, including every line of a devis and
  `theirNumber`, `retentionPct`, `advanceDeducted`;
- **recording a payment** — seven, including the amount.

The three places where a value typed, submitted and silently dropped costs the
most. The reader could not follow them for one reason: they are components
handed their action as a prop.

```tsx
<form action={action}>          // company-form.tsx — what is `action`?
<CompanyForm action={createCompany.bind(null, locale)} />   // new/page.tsx
```

A static reader that stops at `action={action}` cannot say. So it said "not
followed", counted it, and moved on — and a count printed beside a green
sentence is a number nobody reads.

## Decisions

**Follow the prop to whoever passes it.** The reader now works out which
component the `<form` is inside — the nearest `export function` above it —
searches the application for `<CompanyForm`, and pulls the action out of that
tag. From there it is an ordinary imported action and the existing machinery
applies.

**Every call site, not the first.** `CompanyForm` is rendered twice, by
`companies/new` with `createCompany` and by `companies/[id]/edit` with
`updateCompany`. Both are checked, and each field is a row against each. That
is the bug worth catching: a field that `createCompany` reads and
`updateCompany` drops is invisible until somebody edits a company and watches
their change disappear.

**Not followed is now a failure, not a number.** The count is nought and the
script exits 1 if it is not. A new form whose action nobody can name has to be
made followable, or the reader has to be taught how — the same rule
`pnpm audit:schema` reached this morning: wired up or dropped.

**Braces are counted when reading a JSX tag.** The first version stopped at the
first `>`, which cuts a tag in half the moment a prop holds an arrow function.

## What it found

Nothing dropped. All forty-three fields are read by the actions those screens
pass, both of the company form's two.

That is the answer worth having, and it was not knowable before. To prove the
check can actually fail, `name="paymentTerms"` was renamed to
`name="payment_terms"` on the company form: the audit named it, on both
`createCompany` and `updateCompany`, and went green again when it was put back.

## What was rejected

**Reading the JSX properly, with a parser.** The whole value of these three
audits is that they are a hundred lines each and can be read in a sitting. A
TypeScript program that resolves prop types would be right more often and
consulted less often.

**Allow-listing the three forms.** That is what "43 not followed" already was,
without anybody having decided it.
