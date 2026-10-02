import { type EditTarget } from "../../uiTypes";
import { caseTypeForReason } from "../../lib/sourcing";
import { type AppData } from "../../api";
import { type PackagingItemType, type IncomingDefectRecord } from "../../types";
import { isIncomingDefectComplete } from "../../lib/defects";
import { todayDateString } from "../../lib/format";
import { supplierName, itemCode } from "../../lib/lookups";

export function buildEditPatch(target: EditTarget, form: FormData) {
  const patch: Record<string, unknown> = {
    recordState: String(form.get("recordState") ?? target.record.recordState ?? "Active"),
  };
  const setString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "");
  };
  // null, not undefined: JSON drops undefined, and the server keeps a field it never receives.
  const setOptionalString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "") || null;
  };
  const setNumber = (name: string) => {
    if (form.has(name)) patch[name] = Number(form.get(name) ?? 0);
  };

  for (const field of ["name", "status", "type", "uom", "country", "primaryContact", "email", "phone", "paymentTerms", "region", "notes", "itemCode", "itemName", "productFamily", "revision", "effectiveDate", "effectiveFrom", "moq", "leadTime", "extraCostType", "owner", "result", "disposition", "inspector", "reason", "caseReason", "poNumber", "orderDate", "buyer", "sourceType", "sampleReceivedDate", "defectDate", "defectType", "defectAction", "maintainedBy"]) {
    setString(field);
  }
  for (const field of ["voidReason", "erpVendorId", "supplierSince", "targetCloseDate", "signedDate", "effectiveTo", "returnDate"]) setOptionalString(field);
  for (const field of ["unitPrice", "extraCostAmount", "problemPhotos", "sampleRound", "oldPrice", "newPrice", "quantity", "defectQty"]) setNumber(field);
  if (target.endpoint === "quotes" && form.has("effectiveFrom")) {
    patch.quoteDate = String(form.get("effectiveFrom") ?? "");
    patch.validUntil = null;
  }
  if (target.endpoint === "quotes") {
    const changeReason = String(form.get("changeReason") ?? "").trim();
    if (changeReason) patch.changeReason = changeReason;
  }
  if (target.endpoint === "projects") {
    const supplierIdsJson = String(form.get("supplierIdsJson") ?? "[]");
    const itemIdsJson = String(form.get("itemIdsJson") ?? "[]");
    const modelId = String(form.get("modelId") ?? "");
    patch.modelIds = modelId ? [modelId] : target.record.modelIds;
    patch.drawingSetId = String(form.get("drawingSetId") ?? target.record.drawingSetId);
    patch.supplierIds = JSON.parse(supplierIdsJson) as string[];
    patch.itemIds = JSON.parse(itemIdsJson) as string[];
    patch.type = caseTypeForReason(String(patch.caseReason ?? target.record.caseReason) as AppData["projects"][number]["caseReason"]);
  }
  if (target.endpoint === "suppliers") {
    patch.hasW9 = String(form.get("hasW9") ?? "false") === "true";
    patch.hasPaymentInfo = String(form.get("hasPaymentInfo") ?? "false") === "true";
    patch.capableItems = JSON.parse(String(form.get("capableItemsJson") ?? "[]")) as PackagingItemType[];
  }
  if (target.endpoint === "items") {
    patch.usedForModels = JSON.parse(String(form.get("usedForModelsJson") ?? "[]")) as string[];
  }
  if (target.endpoint === "drawing-sets" && form.has("drawingItemsJson")) {
    patch.drawingItems = JSON.parse(String(form.get("drawingItemsJson") ?? "[]"));
  }
  if (target.endpoint === "incoming-defects") {
    const replacementReceipts = JSON.parse(String(form.get("replacementReceiptsJson") ?? "[]")) as NonNullable<IncomingDefectRecord["replacementReceipts"]>;
    const optionalNumber = (name: string) => (String(form.get(name) ?? "") ? Number(form.get(name)) : undefined);
    const defectAction = patch.defectAction as IncomingDefectRecord["defectAction"];
    const poQty = optionalNumber("poQty");
    const receivedQty = optionalNumber("receivedQty");
    const replacementQty = defectAction === "Request Replacement" ? Number(form.get("replacementQty") ?? form.get("defectQty") ?? 0) : undefined;
    patch.poQty = poQty ?? null;
    patch.receivedQty = receivedQty ?? null;
    patch.materialReturned = String(form.get("materialReturned") ?? "false") === "true";
    patch.replacementReceipts = replacementReceipts;
    patch.replacementQty = replacementQty ?? null;
    patch.actionCompleted = isIncomingDefectComplete({
      defectAction,
      defectQty: Number(patch.defectQty ?? 0),
      poQty,
      receivedQty,
      replacementQty,
      replacementReceipts,
    });
    patch.actionCompletedDate = patch.actionCompleted ? String(form.get("returnDate") ?? "") || todayDateString() : null;
    if (patch.materialReturned && !patch.returnDate) throw new Error("Return date is required when defect material has been returned.");
  }
  return patch;
}

export function editTitle(appData: Pick<AppData, "items" | "suppliers">, target: EditTarget) {
  if ("name" in target.record) return target.record.name;
  if ("itemCode" in target.record) return target.record.itemCode;
  if (target.endpoint === "quotes") return `${supplierName(appData, target.record.supplierId)} ${itemCode(appData, target.record.itemId)} quote`;
  return `${supplierName(appData, target.record.supplierId)} ${itemCode(appData, target.record.itemId)}`;
}
