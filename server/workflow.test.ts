import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quote, SampleInspection } from "../src/types";
import { createContext } from "./context";
import { ValidationError } from "./errors";
import { sampleStore } from "./testFixtures";
import { demoteConflictingSourceRoles, ensureNoSupplierLinks, entityLabel, syncQuoteStatusesFromInspections } from "./workflow";

function inspectedQuote(status: Quote["status"], inspection: Partial<SampleInspection>, statusBasis?: Quote["statusBasis"]) {
  const store = sampleStore();
  Object.assign(store.quotes[0], { status, statusBasis });
  Object.assign(store.inspections[0], inspection);
  const ctx = createContext(store, new Map(), undefined);
  syncQuoteStatusesFromInspections(ctx);
  return { quote: store.quotes[0], ctx };
}

const pass = { result: "Pass", disposition: "Accepted" } as const;
const closedFail = { result: "Fail", disposition: "No Further Action" } as const;

test("a passed sample selects a quote that asked for it and records a system change", () => {
  const { quote, ctx } = inspectedQuote("Sample Requested", pass);
  assert.deepEqual([quote.status, quote.statusBasis], ["Selected", "QC Pass"]);
  const entry = ctx.auditEntries.find((candidate) => candidate.entityType === "Quote");
  assert.deepEqual([entry?.entityLabel, entry?.source, entry?.actorUserId], ["Legacy Paper / PAL-01", "System", null]);
});

test("a sample closed as failed ends the quote", () => {
  assert.deepEqual(Object.values(pick(inspectedQuote("Sample Requested", closedFail).quote)), ["No Further Action", "QC Closed Fail"]);
  assert.deepEqual(Object.values(pick(inspectedQuote("Sample Requested", { result: "Conditional", disposition: "No Further Action" }).quote)), ["No Further Action", "QC Closed Fail"]);
});

test("a rejected round that needs another sample leaves the quote waiting", () => {
  assert.equal(inspectedQuote("Sample Requested", { result: "Fail", disposition: "Re-sample Required" }).quote.status, "Sample Requested");
  assert.equal(inspectedQuote("Sample Requested", { result: "Conditional", disposition: "Re-sample Required" }).quote.status, "Sample Requested");
  assert.equal(inspectedQuote("Sample Requested", { result: "Not Submitted", disposition: "Pending" }).quote.status, "Sample Requested");
});

test("a buyer's decision is never changed by a sample result", () => {
  for (const status of ["Received", "No Further Action", "Expired"] as const) {
    const { quote, ctx } = inspectedQuote(status, pass);
    assert.equal(quote.status, status);
    assert.equal(ctx.auditEntries.length, 0);
  }
  assert.equal(inspectedQuote("Selected", closedFail, "Existing Supplier").quote.status, "Selected");
});

test("a quote selected by a pass goes back to waiting when the pass is voided or changed", () => {
  assert.deepEqual(Object.values(pick(inspectedQuote("Selected", { ...pass, recordState: "Void" }, "QC Pass").quote)), ["Sample Requested", undefined]);
  assert.deepEqual(Object.values(pick(inspectedQuote("Selected", { result: "Fail", disposition: "Re-sample Required" }, "QC Pass").quote)), ["Sample Requested", undefined]);
});

test("a quote ended by a failed sample goes back to waiting when that result changes", () => {
  assert.deepEqual(Object.values(pick(inspectedQuote("No Further Action", { result: "Fail", disposition: "Re-sample Required" }, "QC Closed Fail").quote)), ["Sample Requested", undefined]);
});

function pick(quote: Quote) {
  return { status: quote.status, statusBasis: quote.statusBasis };
}

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
