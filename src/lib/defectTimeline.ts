import { type IncomingDefectRecord } from "../types";
import { isIncomingDefectComplete } from "./defects";

export function incomingDefectTimeline(defect: IncomingDefectRecord) {
  const poNumber = defect.poNumber ?? "PO";
  const poQty = defect.poQty ?? (defect.receivedQty ?? 0) + defect.defectQty;
  const firstReceivedQty = defect.receivedQty ?? Math.max(poQty - defect.defectQty, 0);
  const events = [`${defect.defectDate} received ${poNumber} ${firstReceivedQty} pcs`];
  if (defect.materialReturned) events.push(`${defect.returnDate ?? defect.defectDate} returned ${defect.defectQty} pcs`);
  if (defect.defectAction === "Request Credit") events.push(`${defect.defectDate} credit requested`);
  for (const [index, receipt] of (defect.replacementReceipts ?? []).entries()) {
    events.push(`${receipt.receivedDate} replacement ${index + 1} received ${receipt.receivedQty} pcs ${receipt.result.toLowerCase()}`);
  }
  if (isIncomingDefectComplete(defect) && defect.defectAction === "Request Replacement") events.push("PO complete");
  return events.join(" / ");
}

export function incomingDefectActionLabel(defect: IncomingDefectRecord) {
  if (isIncomingDefectComplete(defect)) {
    return defect.defectAction === "Request Replacement" ? "Replacement Completed" : "Credit Requested";
  }
  return defect.defectAction;
}
