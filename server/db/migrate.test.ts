import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";

test("creates the users table", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = current_schema()",
    );
    const columns = rows.map((row) => row.column_name).sort();
    assert.deepEqual(columns, [
      "active", "created_at", "email", "entra_oid", "id", "last_login_at", "name", "role", "session_epoch",
    ]);
  });
});

test("rejects a second user with the same entra oid", async () => {
  await withTestDatabase(async (client) => {
    await client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "a@segsolar.com", "A"]);
    await assert.rejects(
      client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "b@segsolar.com", "B"]),
      /duplicate key/,
    );
  });
});

test("records which migrations ran", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
    assert.ok(rows.some((row) => row.filename === "001_auth.sql"));
  });
});
