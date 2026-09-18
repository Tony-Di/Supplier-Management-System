import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { Pool, type PoolClient } from "pg";
import type { Express } from "express";

import { runMigrations } from "../scripts/migrate";

const connectionString = process.env.DATABASE_URL_TEST;

export const databaseAvailable = Boolean(connectionString);

/**
 * Runs `fn` with a client bound to a freshly created, isolated schema that has
 * every migration applied. The schema is dropped afterwards. Use this for
 * repository-level tests that talk to Postgres directly.
 */
export async function withTestDatabase(fn: (client: PoolClient) => Promise<void>) {
  if (!connectionString) throw new Error("DATABASE_URL_TEST is not set. Run npm test for the offline suite.");
  const pool = new Pool({ connectionString });
  const schema = `test_${randomUUID().replace(/-/g, "")}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await runMigrations(client);
    await fn(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
}

interface QueryExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Truncates every application table (anything migrations created, other than
 * schema_migrations itself) in the current search_path, resetting identities.
 * Exported so tests can prove reset behaviour without going through
 * withTestApp, and so withTestApp can reuse it between tests.
 */
export async function resetTestDatabase(executor: QueryExecutor): Promise<void> {
  const { rows } = await executor.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename as string}"`).join(", ");
  await executor.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

interface TestAppContext {
  createApp: () => Express;
  pool: Pool;
}

// server/db.ts's pool is a module-level singleton, and dynamic import()
// caches modules per process — every withTestApp call in the same test file
// gets back the same Pool instance. It can only be ended once, so rather
// than ending it inside withTestApp itself (which would break any later
// withTestApp call in the same file — node:test's `after` runs after the
// *current* test when registered from inside a test body, not after the
// whole file), this hook is registered unconditionally at module load time,
// which is when node:test attaches it to the file's root suite. It reads
// `appPool` when it eventually runs, once every test in the file is done.
let appPool: Pool | undefined;

after(async () => {
  if (appPool) await appPool.end();
});

/**
 * Runs `fn` against the real Express app (server/app.ts), wired to the
 * sourcing_test database's public schema instead of the development
 * database. Integration tests (Task 6, 9, 10) exercise the app over HTTP,
 * and the app's module-level pool (server/db.ts) is built from DATABASE_URL
 * at import time — so DATABASE_URL is redirected to DATABASE_URL_TEST here,
 * before server/db.ts or server/app.ts are ever imported (dynamically, and
 * only here — never statically), so the app never talks to the development
 * database.
 *
 * Migrations are applied (idempotently) and every application table is
 * truncated before each call, so every test starts from an empty database.
 */
export async function withTestApp(fn: (context: TestAppContext) => Promise<void>): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL_TEST is not set. Run npm test for the offline suite.");

  process.env.DATABASE_URL = connectionString;

  const { pool } = await import("./db");
  appPool = pool;
  const client = await pool.connect();
  try {
    await runMigrations(client);
    await resetTestDatabase(client);
  } finally {
    client.release();
  }

  const { createApp } = await import("./app");

  await fn({ createApp, pool });
}
