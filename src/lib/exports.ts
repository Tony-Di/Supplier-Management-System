import { type AppData } from "../api";
import { type IncomingDefectRecord, type Quote } from "../types";
import { supplierName, itemCode, itemById, priceChangeForQuote, modelName, drawingSetName, projectName, quoteExportReference, fileLabel } from "./lookups";
import { incomingDefectCurrentReceivedQty } from "./defects";
import { incomingDefectActionLabel, incomingDefectTimeline } from "./defectTimeline";
import { csvCell, todayDateString, formatMoney, formatDecimalPrice } from "./format";
import { sourceRoleForQuote, quoteCaseLabel } from "./sourcing";

export function exportIncomingDefectHistory(appData: Pick<AppData, "items" | "suppliers">, records: IncomingDefectRecord[]) {
  const headers = [
    "PO Number",
    "Date",
    "Supplier",
    "Item",
    "PO Qty",
    "Current Received Qty",
    "Defect Qty",
    "Action",
    "Timeline",
  ];
  const rows = records.map((defect) => [
    defect.poNumber ?? "",
    defect.defectDate,
    supplierName(appData, defect.supplierId),
    itemCode(appData, defect.itemId),
    defect.poQty ?? "",
    incomingDefectCurrentReceivedQty(defect) || "",
    defect.defectQty,
    incomingDefectActionLabel(defect),
    incomingDefectTimeline(defect),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `incoming-defect-history-${todayDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportQuotes(appData: Pick<AppData, "drawingSets" | "files" | "items" | "models" | "priceChanges" | "projects" | "quoteCaseLinks" | "quotes" | "sourceAssignments" | "suppliers">, records: Quote[]) {
  const headers = [
    "Quote ID",
    "Supplier",
    "ERP Vendor ID",
    "Payment Terms",
    "Item Code",
    "Item Description",
    "Item Type",
    "Model",
    "Packaging Set",
    "Quote Type",
    "Case Link",
    "Case",
    "Quote Reason",
    "Quote Status",
    "Source Role",
    "Effective From",
    "Effective To",
    "Current Open Price",
    "Previous Quote",
    "Price Change",
    "Unit Price",
    "Currency",
    "UOM",
    "MOQ",
    "Lead Time",
    "Extra Cost Type",
    "Extra Cost Amount",
    "Attachment",
    "Notes",
  ];
  const rows = records.map((quote) => {
    const supplier = appData.suppliers.find((candidate) => candidate.id === quote.supplierId);
    const item = itemById(appData, quote.itemId);
    const sourceRole = sourceRoleForQuote(appData, quote) ?? "";
    const priceChange = priceChangeForQuote(appData, quote.id);
    return [
      quote.id,
      supplier?.name ?? supplierName(appData, quote.supplierId),
      supplier?.erpVendorId ?? "",
      supplier?.paymentTerms ?? "",
      item?.itemCode ?? itemCode(appData, quote.itemId),
      item?.itemName ?? "",
      item?.type ?? "",
      modelName(appData, quote.modelId),
      drawingSetName(appData, quote.drawingSetId),
      quote.quoteType,
      quoteCaseLabel(appData, quote),
      quote.projectId ? projectName(appData, quote.projectId) : "Standalone",
      quote.quoteReason,
      quote.status,
      sourceRole,
      quote.effectiveFrom ?? quote.quoteDate,
      quote.effectiveTo ?? "",
      quote.effectiveTo ? "No" : "Yes",
      quote.previousQuoteId ? quoteExportReference(appData, quote.previousQuoteId) : "",
      priceChange ? `${priceChange.effectiveDate}: ${formatMoney(priceChange.oldPrice)} -> ${formatMoney(priceChange.newPrice)} (${priceChange.status})` : "",
      formatDecimalPrice(quote.unitPrice),
      quote.currency,
      quote.uom,
      quote.moq,
      quote.leadTime,
      quote.extraCostType ?? "None",
      quote.extraCostAmount ?? "",
      quote.attachmentFileId ? fileLabel(appData, quote.attachmentFileId) : "",
      quote.notes,
    ];
  });
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quote-export-${todayDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
