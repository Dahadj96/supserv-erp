-- LAW 5, IN THE DATABASE.
--
-- "An issued document is immutable. Numbers are allocated at issue, never on a
--  draft, never reused. Cancelling writes an avoir. Enforce this with database
--  triggers, not application code."
--
-- A survey done for task 0.8 found that the last sentence had never been
-- carried out. Before this migration the whole of that enforcement was:
--
--   · `document_kind_number_once` — a partial unique index, migration 0037.
--     Real, and it is the half that stops a number being REUSED.
--   · five application guards — `saveDraft`, `recomputeTotals`,
--     `discardDocument`, `render`'s `assertTransition`, and `billFrom`'s
--     `status !== 'issued'`. Every one of them correct, and every one of them
--     bypassed by the next `db.update(document)` somebody writes.
--
-- The only trigger in the whole schema was `payment_allocation_within_payment`
-- (migration 0021), which is about money and not about paper. The comment on
-- `document_link.relation` claiming "a proforma may NEVER carry `settles` —
-- enforced by trigger" described a trigger that does not exist; the schema now
-- says so out loud instead.
--
-- WHAT THIS FREEZES, and it is deliberately the columns that are PRINTED:
-- the number and the series it came from, what kind of paper it is, who it is
-- for, the dates on it, and every figure. Those are what a client holds a copy
-- of, and none of them may move after issue by any route at all.
--
-- WHAT IT DELIBERATELY DOES NOT FREEZE:
--
--   `render_snapshot` — because it is not only the freeze. `markSubmitted`
--   (src/domain/offer/store.ts, screen 12) records the deposit of an offer
--   into it — the place, the hour, the receipt reference — and that is a fact
--   about an envelope handed over at a bureau des achats AFTER the document
--   was issued, not a change to the document. Freezing it would break screen
--   12 and would be freezing the wrong thing.
--
--   `status`, but only along the one road the state machine already declares:
--   `issued -> credited` and `issued -> written_off`. That is
--   `MACHINES.document` in src/domain/control/transitions.ts, and it is what
--   makes an avoir possible at all.
--
--   DELETE. Not because an issued document may be deleted — nothing in `src`
--   deletes one, `discardDocument` refuses on `number is null and locked_at is
--   null`, and CLAUDE.md forbids a hard DELETE in any migration — but because
--   the integration suite tears its own fixtures down with real DELETEs
--   against `<database>_test`, and a trigger that made the test suite
--   unteardownable would be traded for a rule the application already keeps.
--   Written down in docs/FIX-QUEUE.md under Known gaps rather than left to be
--   rediscovered.
--
-- The gate is `locked_at`, which the schema already calls "set at issue,
-- immutable from then on" and which three application guards already read. A
-- row that has never been through the engine is a draft and may change freely.
CREATE OR REPLACE FUNCTION document_stays_issued() RETURNS trigger AS $$
BEGIN
  -- Never issued: a draft is meant to be edited, and this is the row the
  -- builder rewrites on every save.
  IF old.locked_at IS NULL THEN RETURN new; END IF;

  IF new.status IS DISTINCT FROM old.status
     AND NOT (old.status = 'issued' AND new.status IN ('credited', 'written_off')) THEN
    RAISE EXCEPTION
      'an issued document does not change state: % -> % (LAW 5)', old.status, new.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF new.number          IS DISTINCT FROM old.number
  OR new.series_id       IS DISTINCT FROM old.series_id
  OR new.kind            IS DISTINCT FROM old.kind
  OR new.party_id        IS DISTINCT FROM old.party_id
  OR new.locale          IS DISTINCT FROM old.locale
  OR new.currency        IS DISTINCT FROM old.currency
  OR new.fx_rate         IS DISTINCT FROM old.fx_rate
  OR new.issued_on       IS DISTINCT FROM old.issued_on
  OR new.due_on          IS DISTINCT FROM old.due_on
  OR new.settlement      IS DISTINCT FROM old.settlement
  OR new.global_discount_pct IS DISTINCT FROM old.global_discount_pct
  OR new.advance_deducted    IS DISTINCT FROM old.advance_deducted
  OR new.retention_pct       IS DISTINCT FROM old.retention_pct
  OR new.stamp_duty      IS DISTINCT FROM old.stamp_duty
  OR new.totals::text    IS DISTINCT FROM old.totals::text
  OR new.template_id     IS DISTINCT FROM old.template_id
  OR new.template_version IS DISTINCT FROM old.template_version
  OR new.locked_at       IS DISTINCT FROM old.locked_at
  THEN
    RAISE EXCEPTION
      'an issued document is immutable — correct it with an avoir (LAW 5)'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The thirty-day bin is for a draft that should never have existed. An
  -- issued document has a number a series has counted and a client holds a
  -- copy of, so it never goes quiet — LAW 5 and the schema comment on
  -- `document.deleted_at` both say so, and now the table does too.
  IF new.deleted_at IS DISTINCT FROM old.deleted_at THEN
    RAISE EXCEPTION
      'an issued document is never binned — the correction is an avoir (LAW 5)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS document_immutable_once_issued ON "document";--> statement-breakpoint

CREATE TRIGGER document_immutable_once_issued
  BEFORE UPDATE ON "document"
  FOR EACH ROW EXECUTE FUNCTION document_stays_issued();
