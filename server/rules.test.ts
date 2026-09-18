import assert from "node:assert/strict";
import { test } from "node:test";

import { isUsableRecord, latestInspection, qcAllowsSourceRole } from "./rules";

test("an active record can be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Active" }), true);
});

test("a draft record can be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Draft" }), true);
});

test("a record without a lifecycle state can be referenced", () => {
  assert.equal(isUsableRecord({}), true);
});

test("a voided record cannot be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Void" }), false);
});

test("a missing record cannot be referenced", () => {
  assert.equal(isUsableRecord(undefined), false);
});

const inspections = [
  { id: "ins-1", recordState: "Active" as const, supplierId: "sup-1", itemId: "item-1", drawingSetId: "dwg-1", relatedQuoteId: "q-1", sampleRound: 1, sampleReceivedDate: "2026-08-01", result: "Fail" },
  { id: "ins-2", recordState: "Active" as const, supplierId: "sup-1", itemId: "item-1", drawingSetId: "dwg-1", relatedQuoteId: "q-1", sampleRound: 2, sampleReceivedDate: "2026-08-20", result: "Pass" },
  { id: "ins-3", recordState: "Active" as const, supplierId: "sup-2", itemId: "item-1", drawingSetId: "dwg-1", sampleRound: 1, sampleReceivedDate: "2026-08-05", result: "Pass" },
  { id: "ins-4", recordState: "Void" as const, supplierId: "sup-3", itemId: "item-1", drawingSetId: "dwg-1", sampleRound: 1, sampleReceivedDate: "2026-08-06", result: "Pass" },
];

test("takes the newest sample round for the supplier and item", () => {
  assert.equal(latestInspection(inspections, { supplierId: "sup-1", itemId: "item-1" })?.id, "ins-2");
});

test("ignores inspections for another supplier", () => {
  assert.equal(latestInspection(inspections, { supplierId: "sup-2", itemId: "item-1" })?.id, "ins-3");
});

test("ignores voided inspections", () => {
  assert.equal(latestInspection(inspections, { supplierId: "sup-3", itemId: "item-1" }), undefined);
});

test("ignores inspections against another drawing set", () => {
  assert.equal(latestInspection(inspections, { supplierId: "sup-1", itemId: "item-1", drawingSetId: "dwg-2" }), undefined);
});

test("finds nothing when the supplier has no inspection at all", () => {
  assert.equal(latestInspection(inspections, { supplierId: "sup-9", itemId: "item-1" }), undefined);
});

test("a passed inspection allows a source role", () => {
  assert.equal(qcAllowsSourceRole({ result: "Pass" }), true);
});

test("a conditional inspection allows a source role", () => {
  assert.equal(qcAllowsSourceRole({ result: "Conditional" }), true);
});

test("a failed inspection does not allow a source role", () => {
  assert.equal(qcAllowsSourceRole({ result: "Fail" }), false);
});

test("no inspection does not allow a source role", () => {
  assert.equal(qcAllowsSourceRole(undefined), false);
});
