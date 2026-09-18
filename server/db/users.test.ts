import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";
import { deleteUser, listUsers, setUserActive, setUserRole, upsertUserFromClaims } from "../users";

const alice = { oid: "oid-alice", email: "Alice@segsolar.com", name: "Alice" };
const bob = { oid: "oid-bob", email: "bob@segsolar.com", name: "Bob" };

test("creates a user on first sign-in with the default role", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, alice);
    assert.equal(user.role, "user");
    assert.equal(user.active, true);
    assert.equal(user.email, "alice@segsolar.com");
  });
});

test("returns the same row on the next sign-in and refreshes the name", async () => {
  await withTestDatabase(async (db) => {
    const first = await upsertUserFromClaims(db, alice);
    const second = await upsertUserFromClaims(db, { ...alice, name: "Alice Zhou" });
    assert.equal(second.id, first.id);
    assert.equal(second.name, "Alice Zhou");
  });
});

test("matches on the oid even when the email changed", async () => {
  await withTestDatabase(async (db) => {
    const first = await upsertUserFromClaims(db, alice);
    const renamed = await upsertUserFromClaims(db, { ...alice, email: "alice.zhou@segsolar.com" });
    assert.equal(renamed.id, first.id);
    assert.equal((await listUsers(db)).length, 1);
  });
});

test("a role change bumps the session epoch", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    const target = await upsertUserFromClaims(db, bob);
    const promoted = await setUserRole(db, target.id, "admin", admin.id);
    assert.equal(promoted.role, "admin");
    assert.equal(promoted.sessionEpoch, target.sessionEpoch + 1);
  });
});

test("an admin cannot deactivate their own account", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    await assert.rejects(() => setUserActive(db, admin.id, false, admin.id), /your own account/);
  });
});

test("the last active admin cannot be demoted", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    const other = await upsertUserFromClaims(db, bob);
    await assert.rejects(() => setUserRole(db, admin.id, "user", other.id), /one active admin/);
  });
});

test("an admin cannot delete their own account", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    await assert.rejects(() => deleteUser(db, admin.id, admin.id), /your own account/);
  });
});
