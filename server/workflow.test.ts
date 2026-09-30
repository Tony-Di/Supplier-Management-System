import assert from "node:assert/strict";
import { test } from "node:test";

import { createContext } from "./context";
import { ValidationError } from "./errors";
import { sampleStore } from "./testFixtures";
import { demoteConflictingSourceRoles, ensureNoSupplierLinks, entityLabel, syncQuoteStatusFromInspection } from "./workflow";

test("a passed inspection selects its quote and records a system change", () => {
  const store = sampleStore();
  store.quotes[0].status = "Received";
  const ctx = createContext(store, new Map(), undefined);
  assert.equal(syncQuoteStatusFromInspection(ctx, store.inspections[0]), true);
  assert.equal(store.quotes[0].status, "Selected");
  const entry = ctx.auditEntries.find((candidate) => candidate.entityType === "Quote");
  assert.deepEqual([entry?.entityLabel, entry?.source, entry?.actorUserId], ["Legacy Paper / PAL-01", "System", null]);
});

test("a new Primary source demotes the existing Primary to Backup", () => {
  const store = sampleStore();
  const current = { ...store.sourceAssignments[0], id: "assign-1002", supplierId: "sup-1002" };
  store.sourceAssignments.push(current);
  const ctx = createContext(store, new Map(), undefined);
  demoteConflictingSourceRoles(ctx, current);
  assert.deepEqual(store.sourceAssignments.map((assignment) => assignment.role), ["Backup", "Primary"]);
  assert.equal(ctx.auditEntries[0].reason, "Demoted because another supplier was set as Primary");
});

test("a supplier with linked records cannot be deleted", () => {
  assert.throws(() => ensureNoSupplierLinks(sampleStore(), "sup-1001"), (error: Error) => error instanceof ValidationError && /quotes/.test(error.message));
});

test("labels name the supplier and item behind a record", () => {
  const store = sampleStore();
  assert.equal(entityLabel(store, "Inspection", store.inspections[0]), "Legacy Paper / PAL-01 / Round 2");
  assert.equal(entityLabel(store, "Quote", { supplierId: "sup-9999", itemId: "item-1001" }), "Unknown supplier / PAL-01");
});
