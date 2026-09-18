import { randomUUID } from "node:crypto";
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

/**
 * Runs `fn` against the real Express app (server/app.ts), wired to the
 * sourcing_test database's public schema instead of the development
 * database. Later integration tests (Task 6, 9, 10) exercise the app over
 * HTTP, and the app's module-level pool (server/db.ts) is built from
 * DATABASE_URL at import time — so DATABASE_URL is redirected to
 * DATABASE_URL_TEST here, before server/db.ts or server/app.ts are ever
 * imported (dynamically, and only here — never statically), so the app
 * never talks to the development database.
 *
 * Migrations are applied (idempotently) and every application table is
 * truncated before each call, so every test starts from an empty database.
 *
 * server/app.ts does not exist until Task 6. Until then this throws a clear
 * error explaining that instead of a confusing module-not-found stack trace.
 */
export async function withTestApp(fn: (context: TestAppContext) => Promise<void>): Promise<void> {
  if (!connectionString) throw new Error("DATABASE_URL_TEST is not set. Run npm test for the offline suite.");

  process.env.DATABASE_URL = connectionString;

  const { pool } = await import("./db");
  const client = await pool.connect();
  try {
    await runMigrations(client);
    await resetTestDatabase(client);
  } finally {
    client.release();
  }

  // Imported through a computed specifier, not a string literal, so
  // TypeScript treats this as `Promise<any>` and does not try to resolve
  // module types for a file that does not exist yet (Task 6 adds it).
  const appModulePath = "./app";
  let appModule: { createApp: () => Express };
  try {
    appModule = await import(appModulePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cannot find module|err_module_not_found/i.test(message)) {
      throw new Error(
        "server/app.ts does not exist yet (added in Task 6). withTestApp cannot run integration tests until then.",
      );
    }
    throw error;
  }

  await fn({ createApp: appModule.createApp, pool });
}
