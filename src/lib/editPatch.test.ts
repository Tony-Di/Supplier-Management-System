import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEditPatch } from "../modals/record/editHelpers";
import type { IncomingDefectRecord, Quote, Supplier } from "../types";

const quote = { id: "q1", recordState: "Active", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" } as Quote;

function editForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

test("a quote edit sends the reason for a changed Effective To", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "2026-05-31", changeReason: "Supplier notice" }));
  assert.equal(patch.effectiveTo, "2026-05-31");
  assert.equal(patch.changeReason, "Supplier notice");
});

test("a quote edit without a reason sends none", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "2026-06-30", changeReason: "" }));
  assert.equal("changeReason" in patch, false);
});

test("an emptied optional field is sent as null so the server clears it", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveTo: "", changeReason: "Open-ended again" }));
  assert.equal(patch.effectiveTo, null);
  assert.equal(JSON.parse(JSON.stringify(patch)).effectiveTo, null);
});

test("a field that is not in the form is not sent", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ notes: "Checked" }));
  assert.equal("effectiveTo" in patch, false);
  assert.equal("voidReason" in patch, false);
});

test("editing a quote's effective date clears Valid Until", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ effectiveFrom: "2026-02-01" }));
  assert.equal(patch.validUntil, null);
});

test("selecting on previous orders sends the basis and the PO number", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ status: "Selected", previousOrdersConfirmed: "on", statusReference: " PO-77 " }));
  assert.deepEqual([patch.status, patch.statusBasis, patch.statusReference], ["Selected", "Previous Orders", "PO-77"]);
});

test("a quote edit without the previous-orders confirmation sends no basis", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, editForm({ status: "Selected" }));
  assert.equal("statusBasis" in patch, false);
});

test("an emptied ERP vendor ID is sent as null", () => {
  const supplier = { id: "sup-1", recordState: "Active", capableItems: [], otherFileIds: [] } as unknown as Supplier;
  const patch = buildEditPatch({ endpoint: "suppliers", record: supplier }, editForm({ erpVendorId: "", capableItemsJson: "[]" }));
  assert.equal(patch.erpVendorId, null);
});

test("a supplier's Since date is sent as entered, and as null once emptied", () => {
  const supplier = { id: "sup-1", recordState: "Active", capableItems: [], otherFileIds: [] } as unknown as Supplier;
  const edit = (supplierSince: string) =>
    buildEditPatch({ endpoint: "suppliers", record: supplier }, editForm({ supplierSince, capableItemsJson: "[]" })).supplierSince;
  assert.equal(edit("2025-12-06"), "2025-12-06");
  assert.equal(edit(""), null);
});

const supplierWithFiles = {
  id: "sup-1",
  recordState: "Active",
  capableItems: [],
  hasW9: true,
  hasPaymentInfo: true,
  w9FileId: "file-1",
  paymentInfoFileId: "file-2",
  otherFileIds: ["file-3", "file-4"],
} as unknown as Supplier;

function supplierEditForm(fields: Record<string, string> = {}) {
  return editForm({ hasW9: "true", hasPaymentInfo: "true", capableItemsJson: "[]", ...fields });
}

test("choosing Missing for a supplier document clears its file", () => {
  const patch = buildEditPatch({ endpoint: "suppliers", record: supplierWithFiles }, supplierEditForm({ hasW9: "false" }));
  assert.equal(patch.w9FileId, null);
  assert.equal("paymentInfoFileId" in patch, false);
});

test("a ticked other document is removed and the rest are kept", () => {
  const form = supplierEditForm();
  form.append("removeOtherFileId", "file-3");
  assert.deepEqual(buildEditPatch({ endpoint: "suppliers", record: supplierWithFiles }, form).otherFileIds, ["file-4"]);
});

test("switching a defect to Request Credit clears its replacement quantity", () => {
  const defect = { id: "def-1", recordState: "Active", defectAction: "Request Replacement", defectQty: 5, replacementQty: 5 } as unknown as IncomingDefectRecord;
  const patch = buildEditPatch(
    { endpoint: "incoming-defects", record: defect },
    editForm({ defectAction: "Request Credit", defectQty: "5", poQty: "", receivedQty: "", replacementReceiptsJson: "[]", materialReturned: "false" }),
  );
  assert.equal(patch.replacementQty, null);
  assert.equal(patch.poQty, null);
  assert.equal(patch.receivedQty, null);
  assert.equal(patch.actionCompleted, true);
});

test("an unfinished replacement sends a null completion date", () => {
  const defect = { id: "def-1", recordState: "Active", defectAction: "Request Replacement", defectQty: 5 } as unknown as IncomingDefectRecord;
  const patch = buildEditPatch(
    { endpoint: "incoming-defects", record: defect },
    editForm({ defectAction: "Request Replacement", defectQty: "5", replacementQty: "5", poQty: "", receivedQty: "", replacementReceiptsJson: "[]", materialReturned: "false" }),
  );
  assert.equal(patch.actionCompleted, false);
  assert.equal(patch.actionCompletedDate, null);
  assert.equal(patch.replacementQty, 5);
});
