import { type AppData, type DeleteEndpoint } from "../api";

export function canDeleteRecord(appData: Pick<AppData, "drawingSets" | "incomingDefects" | "inspections" | "items" | "priceChanges" | "projects" | "purchasePrices" | "quoteCaseLinks" | "quotes">, endpoint: DeleteEndpoint, id: string) {
  if (endpoint === "suppliers") {
    return (
      !appData.projects.some((project) => project.supplierIds.includes(id)) &&
      !appData.quotes.some((quote) => quote.supplierId === id) &&
      !appData.quoteCaseLinks.some((link) => link.supplierId === id) &&
      !appData.inspections.some((inspection) => inspection.supplierId === id) &&
      !appData.incomingDefects.some((defect) => defect.supplierId === id) &&
      !appData.priceChanges.some((change) => change.supplierId === id) &&
      !appData.purchasePrices.some((purchase) => purchase.supplierId === id)
    );
  }
  if (endpoint === "models") {
    return (
      !appData.items.some((item) => item.usedForModels.includes(id)) &&
      !appData.drawingSets.some((drawingSet) => drawingSet.modelId === id) &&
      !appData.projects.some((project) => project.modelIds.includes(id)) &&
      !appData.quotes.some((quote) => quote.modelId === id) &&
      !appData.quoteCaseLinks.some((link) => link.modelId === id) &&
      !appData.inspections.some((inspection) => inspection.modelId === id) &&
      !appData.incomingDefects.some((defect) => defect.modelId === id) &&
      !appData.priceChanges.some((change) => change.modelId === id) &&
      !appData.purchasePrices.some((purchase) => purchase.modelId === id)
    );
  }
  if (endpoint === "items") {
    return (
      !appData.drawingSets.some((drawingSet) => drawingSet.drawingItems.some((drawingItem) => drawingItem.itemId === id)) &&
      !appData.projects.some((project) => project.itemIds.includes(id)) &&
      !appData.quotes.some((quote) => quote.itemId === id) &&
      !appData.quoteCaseLinks.some((link) => link.itemId === id) &&
      !appData.inspections.some((inspection) => inspection.itemId === id) &&
      !appData.incomingDefects.some((defect) => defect.itemId === id) &&
      !appData.priceChanges.some((change) => change.itemId === id) &&
      !appData.purchasePrices.some((purchase) => purchase.itemId === id)
    );
  }
  if (endpoint === "drawing-sets") {
    return (
      !appData.projects.some((project) => project.drawingSetId === id) &&
      !appData.quotes.some((quote) => quote.drawingSetId === id) &&
      !appData.inspections.some((inspection) => inspection.drawingSetId === id)
    );
  }
  if (endpoint === "projects") {
    return !appData.quotes.some((quote) => quote.projectId === id) && !appData.quoteCaseLinks.some((link) => link.projectId === id) && !appData.inspections.some((inspection) => inspection.projectId === id);
  }
  if (endpoint === "quotes") {
    return (
      !appData.quotes.some((quote) => quote.previousQuoteId === id) &&
      !appData.quoteCaseLinks.some((link) => link.quoteId === id) &&
      !appData.inspections.some((inspection) => inspection.relatedQuoteId === id) &&
      !appData.priceChanges.some((change) => change.sourceQuoteId === id || change.previousQuoteId === id) &&
      !appData.purchasePrices.some((purchase) => purchase.linkedQuoteId === id)
    );
  }
  if (endpoint === "purchase-prices") return true;
  return true;
}

export function isPublishedRecord(record: { recordState?: "Draft" | "Active" | "Void" }) {
  return (record.recordState ?? "Active") !== "Draft";
}

export function markRecordVoid(data: AppData, endpoint: DeleteEndpoint, id: string, reason: string): AppData {
  const keyByEndpoint = {
    suppliers: "suppliers",
    models: "models",
    items: "items",
    "drawing-sets": "drawingSets",
    projects: "projects",
    quotes: "quotes",
    inspections: "inspections",
    "incoming-defects": "incomingDefects",
    "price-changes": "priceChanges",
    "purchase-prices": "purchasePrices",
  } satisfies Record<DeleteEndpoint, keyof AppData>;
  const key = keyByEndpoint[endpoint];
  const records = data[key];
  if (!Array.isArray(records)) return data;
  return {
    ...data,
    [key]: records.map((record) =>
      "id" in record && record.id === id ? { ...record, recordState: "Void", voidReason: reason } : record,
    ),
  };
}
