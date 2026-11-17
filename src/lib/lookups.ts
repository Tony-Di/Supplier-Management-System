import { type AppData } from "../api";
import { formatMoney } from "./format";
import { type Supplier, type DrawingSet, type SampleInspection, type PackagingItem, type Quote, type UploadedFileRecord } from "../types";

const indexes = new WeakMap<readonly object[], Map<string, unknown>>();

/**
 * The record with this ID in a collection. Tables look up a supplier, item or
 * model for every cell, so each collection is indexed once instead of being
 * searched each time. Collections are replaced, never changed in place, when
 * data reloads, which is what lets the index be kept per array.
 */
export function recordById<T extends { id: string }>(records: readonly T[], id: string | undefined): T | undefined {
  if (!id) return undefined;
  let index = indexes.get(records) as Map<string, T> | undefined;
  if (!index) {
    index = new Map();
    // The first record wins, as Array.find would have it.
    for (const record of records) if (!index.has(record.id)) index.set(record.id, record);
    indexes.set(records, index);
  }
  return index.get(id);
}

export function priceChangeForQuote(appData: Pick<AppData, "priceChanges">, quoteId: string) {
  return appData.priceChanges.find((change) => change.recordState !== "Void" && change.sourceQuoteId === quoteId);
}

export function quoteExportReference(appData: Pick<AppData, "items" | "quotes" | "suppliers">, quoteId: string) {
  const quote = recordById(appData.quotes, quoteId);
  return quote ? `${quote.effectiveFrom ?? quote.quoteDate} / ${supplierName(appData, quote.supplierId)} / ${itemCode(appData, quote.itemId)} / ${formatMoney(quote.unitPrice)}` : quoteId;
}

export function supplierName(appData: Pick<AppData, "suppliers">, id: string) {
  return recordById(appData.suppliers, id)?.name ?? "Unknown supplier";
}

export function projectName(appData: Pick<AppData, "projects">, id: string) {
  return recordById(appData.projects, id)?.name ?? "Unknown case";
}

export function supplierLocation(supplier: Supplier) {
  return [supplier.region, supplier.country].filter(Boolean).join(", ") || "Not set";
}

export function modelName(appData: Pick<AppData, "models">, id: string) {
  return recordById(appData.models, id)?.name ?? "Unknown model";
}

export function drawingSetName(appData: Pick<AppData, "drawingSets">, id: string) {
  return recordById(appData.drawingSets, id)?.name ?? "Unknown packaging set";
}

export function activeDrawingSetsForModel(sets: DrawingSet[], modelId: string, keepId?: string) {
  return sets.filter((set) =>
    set.modelId === modelId &&
    set.recordState !== "Void" &&
    (set.status === "Active" || set.id === keepId));
}

export function drawingItemForInspection(appData: Pick<AppData, "drawingSets">, inspection: SampleInspection) {
  return recordById(appData.drawingSets, inspection.drawingSetId)
    ?.drawingItems.find((drawingItem) => drawingItem.id === inspection.drawingItemId);
}

export function drawingFileLabel(appData: Pick<AppData, "files">, drawingItem?: DrawingSet["drawingItems"][number], drawingSet?: DrawingSet) {
  if (!drawingItem) return "-";
  if (drawingSet?.packageFileId) return fileLabel(appData, drawingSet.packageFileId);
  if (drawingItem.drawingSource === "Package PDF" && drawingSet?.packageFileName) return drawingSet.packageFileName;
  if (drawingItem.fileId) return fileLabel(appData, drawingItem.fileId);
  return drawingItem.fileName ?? "-";
}

export function itemById(appData: Pick<AppData, "items">, id: string): PackagingItem | undefined {
  return recordById(appData.items, id);
}

export function itemCode(appData: Pick<AppData, "items">, id: string) {
  const item = itemById(appData, id);
  return item ? item.itemCode : "Unknown item";
}

export function quoteLabel(appData: Pick<AppData, "quotes">, id?: string) {
  if (!id) return "-";
  const quote = recordById(appData.quotes, id);
  return quote ? `${quote.quoteDate} ${formatMoney(quote.unitPrice)}` : "Missing quote";
}

export function quoteExtraCostLabel(quote: Quote) {
  if (!quote.extraCostType || quote.extraCostType === "None") return "-";
  return `${quote.extraCostType}: ${formatMoney(quote.extraCostAmount ?? 0)}`;
}

export function purchasePriceLabel(appData: Pick<AppData, "purchasePrices">, id?: string) {
  if (!id) return "-";
  const purchase = recordById(appData.purchasePrices, id);
  return purchase ? `${purchase.poNumber} ${purchase.orderDate} ${formatMoney(purchase.unitPrice)}` : "Missing PO price";
}

export function fileLabel(appData: Pick<AppData, "files">, id?: string) {
  if (!id) return "-";
  const file = fileRecord(appData, id);
  return file?.fileName ?? "Missing file";
}

export function fileRecord(appData: Pick<AppData, "files">, id?: string) {
  if (!id) return undefined;
  return recordById(appData.files, id);
}

export function fileUrl(file: UploadedFileRecord) {
  return `/${file.storagePath.replace(/\\/g, "/")}`;
}

export function priceChangeReference(appData: Pick<AppData, "purchasePrices" | "quotes">, quoteId?: string, purchasePriceId?: string) {
  if (purchasePriceId) return purchasePriceLabel(appData, purchasePriceId);
  return quoteLabel(appData, quoteId);
}
