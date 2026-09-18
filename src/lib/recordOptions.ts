import type { AppData } from "../api";
import type { EditTarget } from "../uiTypes";

export function isUsableRecord<T extends { recordState?: string }>(record: T | undefined): record is T {
  return Boolean(record) && record?.recordState !== "Void";
}

/** Picker data only. Historical records and score calculations use the full store. */
export function availableRecordOptions(data: AppData): AppData {
  const items = data.items.filter(isUsableRecord);
  const itemIds = new Set(items.map((item) => item.id));
  return {
    ...data,
    suppliers: data.suppliers.filter(isUsableRecord),
    models: data.models.filter(isUsableRecord),
    items,
    drawingSets: data.drawingSets.filter(isUsableRecord).map((set) => ({ ...set, drawingItems: set.drawingItems.filter((item) => itemIds.has(item.itemId)) })),
    projects: data.projects.filter(isUsableRecord),
    quotes: data.quotes.filter(isUsableRecord),
    inspections: data.inspections.filter(isUsableRecord),
    incomingDefects: data.incomingDefects.filter(isUsableRecord),
    priceChanges: data.priceChanges.filter(isUsableRecord),
    purchasePrices: data.purchasePrices.filter(isUsableRecord),
    sourceAssignments: data.sourceAssignments.filter(isUsableRecord),
    quoteCaseLinks: data.quoteCaseLinks.filter(isUsableRecord),
  };
}

export function voidedReferenceMessage(data: AppData, target: EditTarget): string | undefined {
  const record = target.record as unknown as Record<string, unknown>;
  const references = [
    ["supplierId", "suppliers", "Supplier"], ["modelId", "models", "Model"],
    ["itemId", "items", "Item"], ["drawingSetId", "drawingSets", "Drawing set"],
    ["projectId", "projects", "Case"], ["relatedQuoteId", "quotes", "Quote"],
    ["sourceQuoteId", "quotes", "Quote"], ["previousQuoteId", "quotes", "Quote"],
    ["linkedQuoteId", "quotes", "Quote"],
  ] as const;
  for (const [field, collection, label] of references) {
    if (!record[field]) continue;
    if (data[collection].some((candidate) => candidate.id === record[field] && candidate.recordState === "Void")) {
      return `${label} is voided. This record remains available for history, but the server does not allow saving edits with a voided reference.`;
    }
  }
  return undefined;
}
