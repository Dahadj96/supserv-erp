import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every column this database has, as the code names it.
 *
 * Drizzle declares a table as `export const project = pgTable("project", { … })`
 * and every column inside it as `propName: type("db_name")`. Both names matter
 * and they are not the same string: the code reads `project.penaltyPerMille`
 * and Postgres knows `penalty_per_mille`.
 */
const SCHEMA_DIR = "src/db/schema";

/*
  TWO OR FOUR SPACES, because there are two shapes of table and this only ever
  read one of them.

    pgTable("project", { … })                    <- columns at two spaces
    pgTable(                                     <- Biome wraps the three-arg
      "document",                                   form, so its columns sit
      { … },                                        at four, and its NAME is
      (t) => [index(…)],                            not on the pgTable line
    )

  The three-argument form is how a table declares its indexes, so the tables
  that were invisible were exactly the ones somebody had bothered to index:
  `document`, `document_line`, `audit_entry`, `payment_allocation`,
  `numbering_series`, `party_role` — twenty-one of sixty-eight, a third of the
  schema and most of its centre.

  `pnpm audit:schema` reported "0 disconnected, every column of ours is both
  written and read" the whole time. It was reading 545 of 716 columns and none
  of the document table's twenty-four, which is why `document.series_id` —
  written by nothing, read by the yearly-reset query — sailed through a gate
  built to catch precisely that. A reviewer found it by reading the code.

  The depth check below is what keeps this honest at four spaces: a nested
  `{ precision, scale }` sits at depth three and an index callback carries no
  `name: type(` at all.
*/
const COLUMN = /^ {2,4}(\w+):\s*(?:\w+)\(/;

export function readSchemaColumns(root = process.cwd()) {
  const dir = join(root, SCHEMA_DIR);
  const out = [];

  for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const file = `${SCHEMA_DIR}/${name}`;
    const lines = readFileSync(join(dir, name), "utf8").split(/\r?\n/);

    let table = null;
    let depth = 0;

    for (const line of lines) {
      if (!table) {
        // The name comes on this line or the next one — see COLUMN above. A
        // regex that demanded it here skipped the table entirely and, because
        // `table` stayed null, every column in it with it.
        const start = line.match(/^export const (\w+) = pgTable\((?:\s*"([^"]+)")?/);
        if (!start) continue;
        table = { variable: start[1], name: start[2] ?? null };
        // The pgTable line opens `(` and usually `{` too, so it is counted
        // like any other: the column object sits at depth 2 from here.
        depth = 0;
      } else if (table.name === null) {
        // The wrapped form: the very next line carries the name.
        const named = line.match(/^\s*"([^"]+)"/);
        if (named) table.name = named[1];
      } else if (depth === 2) {
        // Depth 2 is inside the column object: `pgTable(` is one, `{` is two.
        // Counting is what keeps a nested `{ precision, scale }` or an index
        // callback from being read as a column of its own.
        const column = line.match(COLUMN);
        if (column) {
          out.push({
            file,
            table: table.name,
            variable: table.variable,
            prop: column[1],
            declaration: line,
          });
        } else if (out.length > 0 && out[out.length - 1].table === table.name) {
          // A declaration prettier wrapped over several lines — `.notNull()`
          // and `.defaultNow()` land under the name they belong to.
          out[out.length - 1].declaration += `\n${line}`;
        }
      }

      depth += (line.match(/[{[(]/g) ?? []).length - (line.match(/[}\])]/g) ?? []).length;
      if (depth <= 0) table = null;
    }
  }

  return out;
}

/** Everything that is not a schema file: where a column is used or not used. */
export function readCorpus(root = process.cwd()) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(path);
      } else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name) && !path.startsWith(SCHEMA_DIR)) {
        files.push({ path, text: readFileSync(join(root, path), "utf8") });
      }
    }
  };
  /*
    THE APPLICATION ONLY. Not `tests/`, and that is the whole point: a column
    whose only writer is a fixture is a column no screen can set. `closedAt`
    passed a naive version of this audit because `projectState({ closedAt: … })`
    appears twice in a unit test — the same column that made it impossible for
    any marché to leave its warranty.
  */
  for (const dir of ["src", "scripts", "drizzle"]) {
    try {
      walk(dir);
    } catch {
      // A directory that does not exist is not a finding.
    }
  }
  return files;
}
