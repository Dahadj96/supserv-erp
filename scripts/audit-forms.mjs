import { readFormFields } from "./lib/form-fields.mjs";

/**
 * Every field on every form, and whether the action it posts to ever looks at
 * it.
 *
 * The sibling of `audit-actions.mjs`, against a different class of bug. That
 * one asks whether an action checks who is calling; this one asks whether a
 * field a person filled in goes anywhere. A name typed `theirNumber` on the
 * form and read `their_number` in the action submits cleanly, redirects
 * cleanly, and drops what somebody typed — and there is nothing on the screen
 * afterwards to say so.
 *
 *   node scripts/audit-forms.mjs        # lists the gaps, exits 1 if any
 */
const rows = readFormFields();
const forms = new Set(rows.map((r) => `${r.file}:${r.action}`));

// A field whose action could not be located is not "unread" — saying so would
// be a lie — but it is not green either, and for a fortnight it was printed as
// a number nobody read. Forty-three fields sat behind it, on the company form,
// the document builder and the payment recorder: the three forms in this ERP
// where a silently dropped value costs the most. The reader follows an action
// arriving as a prop now, so THE COUNT IS NOUGHT and this fails if it is not.
const followed = rows.filter((r) => r.read !== null);
const unfollowed = rows.filter((r) => r.read === null);
const dropped = followed.filter((r) => !r.read);

console.log(
  `${followed.length} fields on ${forms.size} forms, ${unfollowed.length} not followed`,
);

if (unfollowed.length > 0) {
  for (const row of unfollowed) {
    console.log(`  ${row.file} :: ${row.action}  — "${row.field}" goes somewhere nobody can name`);
  }
  console.log(`\n${unfollowed.length} field(s) on a form this cannot follow`);
  process.exit(1);
}
if (dropped.length === 0) {
  console.log("every field a person can fill in is read by the action it posts to");
  process.exit(0);
}
for (const row of dropped) {
  console.log(`  ${row.file} :: ${row.action}  — "${row.field}" is never read`);
}
console.log(`\n${dropped.length} to look at`);
process.exit(1);
