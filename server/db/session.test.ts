import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";
import { sessionUserIsCurrent } from "../session";
import { setUserActive, setUserRole, upsertUserFromClaims } from "../users";

test("a session matching the stored epoch is current", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    assert.equal(await sessionUserIsCurrent(db, user.id, user.sessionEpoch), true);
  });
});

test("a role change makes an existing session stale", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    const admin = await upsertUserFromClaims(db, { oid: "oid-2", email: "b@segsolar.com", name: "B" });
    await setUserRole(db, admin.id, "admin", admin.id);
    await setUserRole(db, user.id, "admin", admin.id);
    assert.equal(await sessionUserIsCurrent(db, user.id, user.sessionEpoch), false);
  });
});

test("a deactivated user is never current", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, { oid: "oid-2", email: "b@segsolar.com", name: "B" });
    await setUserRole(db, admin.id, "admin", admin.id);
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    const deactivated = await setUserActive(db, user.id, false, admin.id);
    assert.equal(await sessionUserIsCurrent(db, user.id, deactivated.sessionEpoch), false);
  });
});
