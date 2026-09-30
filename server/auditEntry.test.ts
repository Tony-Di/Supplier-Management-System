import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAuditEntry } from "./auditEntry";
import type { User } from "./users";

const user = { id: 7, name: "Ann Lee", email: "ann@segsolar.com", role: "user", active: true } as User;

test("an edit records only the fields that changed, never the id", () => {
  const entry = buildAuditEntry(user, "Edit", "Supplier", "sup-1001", "Legacy Paper", { id: "sup-1001", name: "Old", phone: "1" }, { id: "sup-1001", name: "New", phone: "1" });
  assert.deepEqual([entry.before, entry.after], [{ name: "Old" }, { name: "New" }]);
  assert.deepEqual([entry.actorUserId, entry.actorLabel, entry.source], [7, "Ann Lee", "UI"]);
});

test("a system change stays anonymous even when a user's request caused it", () => {
  const entry = buildAuditEntry(user, "Edit", "Case", "proj-1001", "BTA 2026", undefined, { name: "BTA 2026" }, "Auto sync", "proj-1001", "System");
  assert.deepEqual([entry.actorUserId, entry.actorLabel], [null, "System"]);
  assert.equal(entry.linkedRecordId, "proj-1001");
});

test("long lists are shortened and a blank reason is dropped", () => {
  const ids = Array.from({ length: 10 }, (_, index) => `item-${index}`);
  const entry = buildAuditEntry(user, "Create", "Case", "proj-1001", "BTA 2026", undefined, { itemIds: ids }, "  ");
  assert.deepEqual((entry.after as { itemIds: string[] }).itemIds, [...ids.slice(0, 8), "+2 more"]);
  assert.equal(entry.reason, undefined);
});
