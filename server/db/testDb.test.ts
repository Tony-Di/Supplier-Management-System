import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";

import { runMigrations } from "../../scripts/migrate";
import { resetTestDatabase } from "../testDb";

// withTestApp redirects DATABASE_URL to DATABASE_URL_TEST and truncates the
// public schema of that database between tests (server/app.ts does not exist
// until Task 6, so we cannot drive this through withTestApp yet). This test
// proves the truncate-between-tests behaviour directly against the exported
// reset helper, against the same public schema withTestApp will use.
const connectionString = process.env.DATABASE_URL_TEST;

test("resetTestDatabase truncates application tables between test runs", async () => {
  if (!connectionString) throw new Error("DATABASE_URL_TEST is not set. Run npm test for the offline suite.");

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await runMigrations(client);
    await resetTestDatabase(client);

    await client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", [
      "reset-test-oid",
      "reset@segsolar.com",
      "Reset Test",
    ]);
    const before = await client.query("SELECT count(*)::int AS count FROM users");
    assert.equal(before.rows[0].count, 1);

    await resetTestDatabase(client);

    const after = await client.query("SELECT count(*)::int AS count FROM users");
    assert.equal(after.rows[0].count, 0);
  } finally {
    client.release();
    await pool.end();
  }
});
