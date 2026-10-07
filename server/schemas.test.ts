import assert from "node:assert/strict";
import { test } from "node:test";

import { incomingDefectSchema, quoteSchema, supplierSchema } from "./schemas";

const quote = {
  supplierId: "sup-1001",
  modelId: "model-1001",
  itemId: "item-1001",
  drawingSetId: "dwgset-1001",
  drawingItemId: "dwgitem-1001",
  quoteDate: "2026-02-10",
  effectiveFrom: "2026-02-10",
  unitPrice: 12,
  moq: "100",
  leadTime: "14 days",
};

test("dates must be written as YYYY-MM-DD", () => {
  assert.equal(quoteSchema.safeParse(quote).success, true);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveFrom: "02/10/2026" }).success, false);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveTo: "2026-2-1" }).success, false);
  assert.equal(quoteSchema.safeParse({ ...quote, effectiveTo: "" }).success, false);
});

test("a quote takes only the five statuses of the selection rules", () => {
  for (const status of ["Received", "Sample Requested", "Selected", "No Further Action", "Expired"]) {
    assert.equal(quoteSchema.safeParse({ ...quote, status }).success, true, status);
  }
  for (const status of ["Under Review", "Not Selected"]) {
    assert.equal(quoteSchema.safeParse({ ...quote, status }).success, false, status);
  }
});

test("replacement receipt dates are checked too", () => {
  const defect = { supplierId: "sup-1001", itemId: "item-1001", defectDate: "2026-04-01", defectQty: 5, defectAction: "Request Credit" };
  assert.equal(incomingDefectSchema.safeParse(defect).success, true);
  const receipts = [{ receivedDate: "April 10", receivedQty: 5, result: "Accepted" }];
  assert.equal(incomingDefectSchema.safeParse({ ...defect, replacementReceipts: receipts }).success, false);
});

test("a supplier's Since date is optional and written as YYYY-MM-DD", () => {
  assert.equal(supplierSchema.parse({ name: "Woodridge" }).supplierSince, undefined);
  assert.equal(supplierSchema.parse({ name: "Woodridge", supplierSince: "2025-12-06" }).supplierSince, "2025-12-06");
  assert.equal(supplierSchema.safeParse({ name: "Woodridge", supplierSince: "12/06/2025" }).success, false);
});

test("a supplier has no other documents by default and at most two", () => {
  assert.deepEqual(supplierSchema.parse({ name: "Woodridge" }).otherFileIds, []);
  assert.deepEqual(supplierSchema.parse({ name: "Woodridge", otherFileIds: ["file-1", "file-2"] }).otherFileIds, ["file-1", "file-2"]);
  assert.equal(supplierSchema.safeParse({ name: "Woodridge", otherFileIds: ["file-1", "file-2", "file-3"] }).success, false);
});
