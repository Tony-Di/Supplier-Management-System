import assert from "node:assert/strict";
import { test } from "node:test";

import { incomingDefectSchema, quoteSchema } from "./schemas";

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

test("replacement receipt dates are checked too", () => {
  const defect = { supplierId: "sup-1001", itemId: "item-1001", defectDate: "2026-04-01", defectQty: 5, defectAction: "Request Credit" };
  assert.equal(incomingDefectSchema.safeParse(defect).success, true);
  const receipts = [{ receivedDate: "April 10", receivedQty: 5, result: "Accepted" }];
  assert.equal(incomingDefectSchema.safeParse({ ...defect, replacementReceipts: receipts }).success, false);
});
