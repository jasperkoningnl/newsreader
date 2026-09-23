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
type Snapshot = {
  tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, unknown> }>;
};

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function dbSchema(c: Client): Promise<Map<string, { columns: Set<string>; indexes: Set<string> }>> {
  const tables = await c.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'"
  );
  const schema = new Map<string, { columns: Set<string>; indexes: Set<string> }>();
  for (const row of tables.rows) {
    const name = String(row.name);
    const cols = await c.execute(`PRAGMA table_info("${name}")`);
    const idx = await c.execute(`PRAGMA index_list("${name}")`);
    schema.set(name, {
      columns: new Set(cols.rows.map((r) => String(r.name))),
      indexes: new Set(idx.rows.map((r) => String(r.name))),
    });
  }
  return schema;
}

function diff(snapshot: Snapshot, db: Awaited<ReturnType<typeof dbSchema>>): string[] {
  const problems: string[] = [];
  for (const [table, def] of Object.entries(snapshot.tables)) {
    const actual = db.get(table);
    if (!actual) {
      problems.push(`missing table ${table}`);
      continue;
    }
    for (const col of Object.keys(def.columns)) if (!actual.columns.has(col)) problems.push(`missing column ${table}.${col}`);
    for (const col of actual.columns) if (!(col in def.columns)) problems.push(`unexpected column ${table}.${col}`);
    for (const index of Object.keys(def.indexes)) if (!actual.indexes.has(index)) problems.push(`missing index ${index}`);
  }
  for (const table of db.keys()) if (!(table in snapshot.tables)) problems.push(`unexpected table ${table}`);
  return problems;
}

// The production DB was created before migrations were tracked (no rows in __drizzle_migrations),
// so the migrator would replay 0000 and fail. Record the already-applied migrations first, but only
// when the live schema matches a migration snapshot exactly.
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
    return [{ entry, problems: diff(snapshot, db) }];
  });

  const match = results.filter((r) => r.problems.length === 0).at(-1);
  if (!match) {
    const closest = [...results].sort((a, b) => a.problems.length - b.problems.length)[0];
    throw new Error(
      `Database has tables but no migration history, and its schema matches no snapshot. Closest: ${closest.entry.tag}\n- ${closest.problems.join("\n- ")}`
    );
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
