import { checkCreationButtons } from "./lib/creation-buttons.mjs";

/**
 * Press every primary button that navigates, and say where it lands.
 *
 *   node scripts/audit-buttons.mjs      # lists the dead ends, exits 1 if any
 *
 * The sibling of `smoke-routes.mjs`, against the half it cannot see. That one
 * asks whether a route answers; this asks whether anything in the interface
 * POINTS at it, and whether the page it points at will render with what the
 * link carries. `/deliveries/new` answered perfectly on the day it gave the
 * owner a 404.
 *
 * `tests/unit/creation-buttons.test.ts` holds the same check inside the gate.
 * This exists so a person can read the list.
 */
const buttons = checkCreationButtons();
const broken = buttons.filter((b) => !b.ok);

console.log(`${buttons.length} primary buttons that navigate\n`);
for (const button of buttons) {
  const where = `${button.file}:${button.line}`;
  if (button.ok) {
    console.log(`  ok    ${(button.href ?? "").padEnd(38)} ${where}`);
  } else {
    console.log(`  DEAD  ${(button.href ?? "<expression>").padEnd(38)} ${where}`);
    console.log(`        ${button.why}`);
  }
}

if (broken.length === 0) {
  console.log("\nevery one of them opens a screen that renders");
  process.exit(0);
}
console.log(`\n${broken.length} button(s) land on nothing`);
process.exit(1);
