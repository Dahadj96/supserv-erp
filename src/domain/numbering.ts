import type { Decimal } from "decimal.js";

/**
 * LAW 5. Three rules, and all three are enforced in the database by trigger —
 * not here, because application code can be bypassed and a numbering gap cannot
 * be explained to a tax inspector.
 *
 *   1. A number is allocated at ISSUE. Never on a draft.
 *   2. A number is NEVER reused, even after cancellation.
 *   3. Once issued, the document is immutable. Correction is a credit note.
 */
export function renderPattern(pattern: string, value: number, when: Date): string {
  return pattern
    .replace("{YYYY}", String(when.getFullYear()))
    .replace("{YY}", String(when.getFullYear()).slice(-2))
    .replace("{MM}", String(when.getMonth() + 1).padStart(2, "0"))
    .replace(/\{(#+)\}/g, (_, hashes: string) => String(value).padStart(hashes.length, "0"));
}

/** SQL that belongs in the first migration. Kept here so it is not forgotten. */
export const NUMBERING_TRIGGER_SQL = `
-- 1 + 2: allocate on issue, never reuse
create or replace function allocate_document_number() returns trigger as $$
declare pat text; nxt int;
begin
  if new.status = 'issued' and old.status = 'draft' then
    if new.number is not null then
      raise exception 'a draft must not carry a number';
    end if;
    update numbering_series
       set next_value = next_value + 1
     where id = new.series_id
    returning pattern, next_value - 1 into pat, nxt;
    new.number := render_pattern(pat, nxt, coalesce(new.issued_on, current_date));
    new.locked_at := now();
  end if;
  return new;
end $$ language plpgsql;

-- 3: issued documents are immutable
create or replace function forbid_edit_after_issue() returns trigger as $$
begin
  if old.locked_at is not null then
    raise exception 'document % is issued and cannot be edited — create a credit note', old.number;
  end if;
  return new;
end $$ language plpgsql;
`;
