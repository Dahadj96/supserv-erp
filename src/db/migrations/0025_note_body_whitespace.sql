-- Fixes the check added in 0024, which did not do what it said.
--
-- `btrim(body)` with no second argument trims SPACES ONLY. A body of "  \n "
-- survived it as "\n", length 1, and the constraint passed — so an empty note
-- could be written after all, and it sat on the timeline looking like something
-- was said. The integration test that drives this constraint directly is what
-- found it; the domain check in front of it uses JavaScript `trim()`, which
-- does handle newlines, so nothing reached the database this way through the
-- app.
--
-- Named characters rather than a regex so it is obvious what is being trimmed:
-- space, tab, newline, carriage return, and the vertical tab and form feed that
-- arrive when somebody pastes out of Word.
ALTER TABLE "note" DROP CONSTRAINT IF EXISTS "note_body_not_empty";
--> statement-breakpoint
-- Anything already written that way is not a note. There should be none in a
-- real database; this is here so the constraint can be added at all.
DELETE FROM "note" WHERE length(btrim("body", E' \t\n\r\v\f')) = 0;
--> statement-breakpoint
ALTER TABLE "note" ADD CONSTRAINT "note_body_not_empty"
  CHECK (length(btrim("body", E' \t\n\r\v\f')) > 0);
