import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(client: PoolClient, directory = defaultDirectory): Promise<string[]> {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.filename as string));
  const pending = readdirSync(directory).filter((name) => name.endsWith(".sql") && !applied.has(name)).sort();

  for (const filename of pending) {
    await client.query(readFileSync(join(directory, filename), "utf8"));
    await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
  }
  return pending;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pool } = await import("../server/db.js");
  const client = await pool.connect();
  try {
    const applied = await runMigrations(client);
    console.log(applied.length === 0 ? "No pending migrations." : `Applied: ${applied.join(", ")}`);
  } finally {
    client.release();
    await pool.end();
  }
}
