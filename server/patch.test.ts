import assert from "node:assert/strict";
import { test } from "node:test";

import { mergePatch } from "./patch";
import { incomingDefectSchema, supplierSchema } from "./schemas";

test("a null in the patch removes the field", () => {
  assert.deepEqual(mergePatch({ id: "q-1001", effectiveTo: "2026-06-30", notes: "" }, { effectiveTo: null }), {
    id: "q-1001",
    notes: "",
  });
});

test("other patch values replace the stored ones and absent keys are kept", () => {
  assert.deepEqual(mergePatch({ id: "sup-1001", name: "Old", phone: "1" }, { name: "New" }), {
    id: "sup-1001",
    name: "New",
    phone: "1",
  });
});

test("arrays are replaced whole", () => {
  assert.deepEqual(mergePatch({ itemIds: ["item-1001", "item-1002"] }, { itemIds: ["item-1003"] }), { itemIds: ["item-1003"] });
});

test("a missing or non-object patch leaves the record as it was", () => {
  const record = { id: "model-1001", name: "BTA" };
  assert.deepEqual(mergePatch(record, undefined), record);
  assert.deepEqual(mergePatch(record, ["name"]), record);
});

test("the stored record is not changed", () => {
  const record = { id: "q-1001", effectiveTo: "2026-06-30" };
  mergePatch(record, { effectiveTo: null });
  assert.equal(record.effectiveTo, "2026-06-30");
});

test("a defect switched to Request Credit passes validation once its replacement quantity is cleared", () => {
  const stored = {
    id: "def-1001",
    supplierId: "sup-1001",
    itemId: "item-1001",
    defectDate: "2026-09-01",
    defectQty: 5,
    defectAction: "Request Replacement",
    replacementQty: 5,
    notes: "",
  };
  assert.equal(incomingDefectSchema.safeParse(mergePatch(stored, { defectAction: "Request Credit", replacementQty: null })).success, true);
  // Without the null the old quantity stays and the schema rejects the edit.
  assert.equal(incomingDefectSchema.safeParse(mergePatch(stored, { defectAction: "Request Credit" })).success, false);
});

test("null for a required field is rejected, not stored", () => {
  const stored = { id: "sup-1001", name: "Legacy Paper", recordState: "Active" };
  assert.equal(supplierSchema.safeParse(mergePatch(stored, { name: null })).success, false);
});
