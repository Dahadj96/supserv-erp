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

const COLUMN = /^ {2}(\w+):\s*(?:\w+)\(/;

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
        const start = line.match(/^export const (\w+) = pgTable\(\s*"([^"]+)"/);
        if (!start) continue;
        table = { variable: start[1], name: start[2] };
        // The pgTable line opens `(` and usually `{` too, so it is counted
        // like any other: the column object sits at depth 2 from here.
        depth = 0;
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
