import { config } from "dotenv";
config({ path: ".env.local" });

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const FOLDER = "./drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

type JournalEntry = { idx: number; when: number; tag: string };
type SnapshotIndex = { name: string; columns: string[]; isUnique: boolean };
type Snapshot = {
  tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, SnapshotIndex> }>;
};
type DbTable = { columns: Set<string>; indexes: Map<string, string> };
type Diff = { problems: string[]; missingIndexes: { table: string; index: SnapshotIndex }[] };

const indexSignature = (unique: boolean, columns: string[]) => `${unique ? "unique" : "index"}(${columns.join(",")})`;

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function dbSchema(c: Client): Promise<Map<string, DbTable>> {
  const tables = await c.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'"
  );
  const schema = new Map<string, DbTable>();
  for (const row of tables.rows) {
    const name = String(row.name);
    const cols = await c.execute(`PRAGMA table_info("${name}")`);
    const idx = await c.execute(`PRAGMA index_list("${name}")`);
    const indexes = new Map<string, string>();
    for (const i of idx.rows) {
      const info = await c.execute(`PRAGMA index_info("${String(i.name)}")`);
      indexes.set(String(i.name), indexSignature(Number(i.unique) === 1, info.rows.map((r) => String(r.name))));
    }
    schema.set(name, { columns: new Set(cols.rows.map((r) => String(r.name))), indexes });
  }
  return schema;
}

// Indexes match on name or on what they enforce: a UNIQUE column constraint shows up as
// sqlite_autoindex_* instead of drizzle's <table>_<col>_unique name.
function diff(snapshot: Snapshot, db: Map<string, DbTable>): Diff {
  const result: Diff = { problems: [], missingIndexes: [] };
  for (const [table, def] of Object.entries(snapshot.tables)) {
    const actual = db.get(table);
    if (!actual) {
      result.problems.push(`missing table ${table}`);
      continue;
    }
    for (const col of Object.keys(def.columns)) if (!actual.columns.has(col)) result.problems.push(`missing column ${table}.${col}`);
    for (const col of actual.columns) if (!(col in def.columns)) result.problems.push(`unexpected column ${table}.${col}`);
    const signatures = new Set(actual.indexes.values());
    for (const index of Object.values(def.indexes)) {
      if (!actual.indexes.has(index.name) && !signatures.has(indexSignature(index.isUnique, index.columns))) {
        result.missingIndexes.push({ table, index });
      }
    }
  }
  for (const table of db.keys()) if (!(table in snapshot.tables)) result.problems.push(`unexpected table ${table}`);
  return result;
}

// The production DB was created before migrations were tracked (no rows in __drizzle_migrations),
// so the migrator would replay 0000 and fail. Record the already-applied migrations first, but only
// when tables and columns match a migration snapshot exactly. Indexes that snapshot expects but the DB
// lacks are created (additive; a unique index fails loudly on duplicate rows instead of guessing).
async function baselineUntrackedDatabase(c: Client) {
  await c.execute(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
  const tracked = await c.execute(`SELECT count(*) AS n FROM ${MIGRATIONS_TABLE}`);
  if (Number(tracked.rows[0].n) > 0) return;

  const db = await dbSchema(c);
  if (db.size === 0) return;

  const journal = JSON.parse(readFileSync(`${FOLDER}/meta/_journal.json`, "utf8")) as { entries: JournalEntry[] };
  const results = journal.entries.flatMap((entry) => {
    const path = `${FOLDER}/meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    if (!existsSync(path)) return [];
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
    return [{ entry, ...diff(snapshot, db) }];
  });

  const match = results.filter((r) => r.problems.length === 0).at(-1);
  if (!match) {
    const closest = [...results].sort((a, b) => a.problems.length - b.problems.length)[0];
    throw new Error(
      `Database has tables but no migration history, and its schema matches no snapshot. Closest: ${closest.entry.tag}\n- ${closest.problems.join("\n- ")}`
    );
  }

  for (const { table, index } of match.missingIndexes) {
    const cols = index.columns.map((col) => `\`${col}\``).join(", ");
    await c.execute(`CREATE ${index.isUnique ? "UNIQUE " : ""}INDEX IF NOT EXISTS \`${index.name}\` ON \`${table}\` (${cols})`);
    console.log(`Created missing index ${index.name} on ${table}(${index.columns.join(", ")})`);
  }

  const applied = journal.entries.filter((e) => e.idx <= match.entry.idx);
  await c.batch(
    applied.map((e) => ({
      sql: `INSERT INTO ${MIGRATIONS_TABLE} ("hash", "created_at") VALUES (?, ?)`,
      args: [createHash("sha256").update(readFileSync(`${FOLDER}/${e.tag}.sql`, "utf8")).digest("hex"), e.when],
    })),
    "write"
  );
  console.log(`Baselined untracked database at ${match.entry.tag} (${applied.length} migrations recorded as applied)`);
}

await baselineUntrackedDatabase(client);
await migrate(drizzle(client), { migrationsFolder: FOLDER });
console.log("Migrations applied successfully");
client.close();
