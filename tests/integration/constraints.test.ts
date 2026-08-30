import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";

/**
 * The shape of the schema, asked of the database rather than of the source.
 *
 * This file exists because of one afternoon. `price_quote` required a subject —
 * `item_id` or `deal_line_id` — and `deal_line_id` is `ON DELETE SET NULL`. So
 * screen 06 correcting a pasted line, which happens several times a week, tried
 * to write a row with neither and Postgres refused the whole correction. The
 * confirm button threw and the message named a constraint.
 *
 * Nothing in the source made that visible. Both halves are correct on their own
 * and only the COMBINATION is a bug, and it lives in two files that never
 * mention each other. So it is asked of `pg_constraint`, where both halves are
 * in the same place.
 */

type Row = Record<string, string>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute<Row>(query);
  return result as unknown as Row[];
}

describe("a delete must not be able to break a constraint", () => {
  /**
   * A foreign key that sets a NOT NULL column to null on delete is a delete
   * that cannot succeed. There is no case where this is intended.
   */
  it("never sets a NOT NULL column to null when the row it points at is deleted", async () => {
    const found = await rows(sql`
      select c.conrelid::regclass::text as tbl, a.attname as col, c.conname as fk
      from pg_constraint c
      join lateral unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.confdeltype = 'n' and a.attnotnull
      order by 1, 2
    `);

    expect(found.map((row) => `${row.tbl}.${row.col} (${row.fk})`)).toEqual([]);
  });

  /**
   * A CHECK over a column some delete will null out is a delete that fails
   * whenever the other columns in that CHECK happen to be null too.
   *
   * Allowed only where the application guarantees one of the other branches is
   * always filled in, and the guarantee is written down here beside it. A new
   * pairing failing this test is not a formality: it is a screen that will 500
   * for a person doing something ordinary.
   */
  it("only lets a delete null a checked column where something else always holds", async () => {
    const found = await rows(sql`
      with set_null as (
        select c.conrelid::regclass::text as tbl, a.attname as col
        from pg_constraint c
        join lateral unnest(c.conkey) as k(attnum) on true
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'f' and c.confdeltype = 'n'
      ),
      checks as (
        select c.conrelid::regclass::text as tbl, c.conname as chk,
               pg_get_constraintdef(c.oid) as def
        from pg_constraint c
        where c.contype = 'c' and c.conrelid > 0
      )
      select checks.chk
      from checks
      join set_null on set_null.tbl = checks.tbl
                   and checks.def ~ ('\\m' || set_null.col || '\\M')
      group by checks.chk
      order by checks.chk
    `);

    /**
     * `price_quote_has_a_subject` — `deal_line_id` goes null when screen 06
     * replaces an enquiry's lines, and `deal_id` goes null when the enquiry
     * itself is deleted. `designation` is the branch that holds: `addQuote`
     * copies the line's words onto every price it writes, and migration 0035
     * backfilled the rows written before it did. The words alone are the
     * subject, which is why deleting the enquiry is safe too.
     */
    const allowed = ["price_quote_has_a_subject"];

    expect(found.map((row) => row.chk)).toEqual(allowed);
  });

  /**
   * The one the pairing above protects, exercised rather than reasoned about.
   */
  it("holds a price whose line and enquiry have both gone", async () => {
    const [row] = await rows(sql`
      select
        (select count(*) from pg_constraint
          where conname = 'price_quote_has_a_subject')::text as present,
        pg_get_constraintdef(oid) as def
      from pg_constraint where conname = 'price_quote_has_a_subject'
    `);

    expect(row?.present).toBe("1");
    expect(row?.def).toContain("designation");
  });
});
