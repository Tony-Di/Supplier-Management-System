import { type IncomingDefectRecord } from "../types";
import { isWithinRecentDays } from "./score";

export function sumDefectQty(records: IncomingDefectRecord[], days?: number) {
  return records
    .filter((record) => !days || isWithinRecentDays(record.defectDate, days))
    .reduce((sum, record) => sum + record.defectQty, 0);
}

export function sumReturnedDefectQty(records: IncomingDefectRecord[], days?: number) {
  return records
    .filter((record) => record.materialReturned)
    .filter((record) => !days || isWithinRecentDays(record.returnDate ?? record.defectDate, days))
    .reduce((sum, record) => sum + record.defectQty, 0);
}

export function incomingDefectAcceptedReplacementQty(defect: Pick<IncomingDefectRecord, "replacementReceipts">) {
  return (defect.replacementReceipts ?? [])
    .filter((receipt) => receipt.result === "Accepted")
    .reduce((sum, receipt) => sum + receipt.receivedQty, 0);
}

export function incomingDefectCurrentReceivedQty(defect: Pick<IncomingDefectRecord, "receivedQty" | "replacementReceipts">) {
  return (defect.receivedQty ?? 0) + incomingDefectAcceptedReplacementQty(defect);
}

export function incomingDefectPendingQty(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  if (defect.defectAction !== "Request Replacement") return 0;
  const acceptedReplacementQty = incomingDefectAcceptedReplacementQty(defect);
  if (defect.poQty === undefined || defect.receivedQty === undefined) return Math.max((defect.replacementQty ?? defect.defectQty) - acceptedReplacementQty, 0);
  return Math.max(defect.poQty - incomingDefectCurrentReceivedQty(defect), 0);
}

export function isIncomingDefectComplete(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  if (defect.defectAction === "Request Credit") return true;
  return incomingDefectPendingQty(defect) === 0;
}

export function isIncomingDefectPendingReceive(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  return defect.defectAction === "Request Replacement" && !isIncomingDefectComplete(defect);
}
