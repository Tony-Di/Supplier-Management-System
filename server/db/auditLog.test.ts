import assert from "node:assert/strict";
import { test } from "node:test";

import { appendAuditEntry, countAuditEntries, listAuditEntries } from "../auditLog";
import { withTestDatabase } from "../testDb";
import { upsertUserFromClaims } from "../users";

const entry = {
  timestamp: "2026-09-18T10:00:00.000Z",
  actorUserId: null,
  actorLabel: "System",
  action: "Create",
  entityType: "Quote",
  entityId: "q-1001",
  entityLabel: "LEGACY / 27.002.011.052",
  after: { unitPrice: 36.2 },
  source: "UI" as const,
};

test("appends and reads back an entry", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, entry);
    const [stored] = await listAuditEntries(db, { entityType: "Quote", entityId: "q-1001" });
    assert.equal(stored.entityLabel, "LEGACY / 27.002.011.052");
    assert.deepEqual(stored.after, { unitPrice: 36.2 });
  });
});

test("records the acting user", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "Alice" });
    await appendAuditEntry(db, { ...entry, actorUserId: user.id, actorLabel: "Alice" });
    const [stored] = await listAuditEntries(db, { actorUserId: user.id });
    assert.equal(stored.actorLabel, "Alice");
  });
});

test("keeps the label after the user is deleted", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "Alice" });
    await appendAuditEntry(db, { ...entry, actorUserId: user.id, actorLabel: "Alice" });
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    const [stored] = await listAuditEntries(db, { entityId: "q-1001" });
    assert.equal(stored.actorLabel, "Alice");
    assert.equal(stored.actorUserId, null);
  });
});

test("returns newest first and respects the limit", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, { ...entry, timestamp: "2026-09-18T10:00:00.000Z", entityId: "q-1" });
    await appendAuditEntry(db, { ...entry, timestamp: "2026-09-18T11:00:00.000Z", entityId: "q-2" });
    const entries = await listAuditEntries(db, { limit: 1 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entityId, "q-2");
  });
});

test("reports how much the trail occupies", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, entry);
    const usage = await countAuditEntries(db);
    assert.equal(usage.rows, 1);
    assert.ok(usage.bytes > 0);
  });
});
