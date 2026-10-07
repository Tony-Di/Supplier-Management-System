import type { DrawingItem, DrawingSet } from "../src/types";

/** A business table and the record fields it stores, one column each; `id` comes first. */
export interface TableDef {
  table: string;
  fields: readonly string[];
  /** Fields stored as jsonb. */
  json?: readonly string[];
  /** Fields stored as timestamptz and held as ISO strings in records. */
  timestamps?: readonly string[];
}

/** A record's values in its table's field order, with null for an absent field. */
export type Row = unknown[];

export type StoredDrawingItem = DrawingItem & { drawingSetId: string; position: number };

const lifecycle = ["recordState", "voidReason"];

export const TABLES = {
  files: {
    table: "files",
    fields: ["id", "fileName", "mimeType", "size", "uploadedAt", "purpose", "linkedRecordType", "linkedRecordId"],
    timestamps: ["uploadedAt"],
  },
  suppliers: {
    table: "suppliers",
    fields: [
      "id", ...lifecycle, "name", "erpVendorId", "status", "type", "country", "region", "capableItems", "primaryContact",
      "email", "phone", "paymentTerms", "hasW9", "hasPaymentInfo", "w9FileId", "paymentInfoFileId", "notes",
      "supplierSince", "otherFileIds",
    ],
  },
  models: { table: "models", fields: ["id", ...lifecycle, "name", "productFamily", "status", "notes"] },
  items: { table: "items", fields: ["id", ...lifecycle, "itemCode", "itemName", "type", "usedForModels", "uom", "status"] },
  drawingSets: {
    table: "drawing_sets",
    fields: ["id", ...lifecycle, "modelId", "name", "revision", "status", "effectiveDate", "maintainedBy", "packageFileId", "packageFileName"],
  },
  drawingItems: {
    table: "drawing_items",
    fields: ["id", "drawingSetId", "position", "itemId", "revision", "status", "drawingSource", "fileName", "fileId"],
  },
  projects: {
    table: "projects",
    fields: [
      "id", ...lifecycle, "name", "modelIds", "drawingSetId", "type", "caseReason", "status", "supplierIds", "itemIds",
      "owner", "openDate", "targetCloseDate",
    ],
  },
  quotes: {
    table: "quotes",
    fields: [
      "id", ...lifecycle, "supplierId", "projectId", "quoteType", "quoteReason", "previousQuoteId", "modelId", "itemId",
      "drawingSetId", "drawingItemId", "quoteDate", "effectiveFrom", "effectiveTo", "validUntil", "currency", "uom",
      "unitPrice", "moq", "leadTime", "extraCostType", "extraCostAmount", "status", "attachmentFileId", "notes",
    ],
  },
  quoteCaseLinks: {
    table: "quote_case_links",
    fields: ["id", ...lifecycle, "quoteId", "projectId", "supplierId", "itemId", "modelId", "linkType", "sampleRequirement"],
  },
  sourceAssignments: {
    table: "source_assignments",
    fields: ["id", ...lifecycle, "projectId", "modelId", "itemId", "supplierId", "sourceQuoteId", "role", "effectiveFrom", "notes"],
  },
  inspections: {
    table: "inspections",
    fields: [
      "id", ...lifecycle, "supplierId", "projectId", "relatedQuoteId", "modelId", "drawingSetId", "itemId", "drawingItemId",
      "sampleRound", "sampleReceivedDate", "inspectionDate", "inspector", "result", "disposition", "problemPhotos",
      "photoFileIds", "notes", "signedDate",
    ],
  },
  incomingDefects: {
    table: "incoming_defects",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "poNumber", "poQty", "defectType", "defectDate", "defectQty",
      "receivedQty", "defectAction", "replacementQty", "replacementReceipts", "actionCompleted", "actionCompletedDate",
      "materialReturned", "returnDate", "notes", "photoFileIds", "attachmentFileIds",
    ],
    json: ["replacementReceipts"],
  },
  priceChanges: {
    table: "price_changes",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "sourceQuoteId", "previousQuoteId", "sourcePurchasePriceId",
      "previousPurchasePriceId", "sourceType", "oldPrice", "newPrice", "currency", "effectiveDate", "reason", "status",
    ],
  },
  purchasePrices: {
    table: "purchase_prices",
    fields: [
      "id", ...lifecycle, "supplierId", "modelId", "itemId", "poNumber", "orderDate", "unitPrice", "quantity", "currency",
      "uom", "sourceType", "linkedQuoteId", "buyer", "notes",
    ],
  },
} satisfies Record<string, TableDef>;

export function columnName(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function toRow(def: TableDef, record: object): Row {
  const values = record as Record<string, unknown>;
  return def.fields.map((field) => values[field] ?? null);
}

/** A record from a row pg returned. A NULL column becomes an absent field. */
export function fromRow(def: TableDef, row: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of def.fields) {
    const value = row[columnName(field)];
    if (value === null || value === undefined) continue;
    record[field] = def.timestamps?.includes(field) ? (value as Date).toISOString() : value;
  }
  return record;
}

/** Drawing items as rows of their own table: each carries its set's ID and its place in the set. */
export function flattenDrawingItems(drawingSets: DrawingSet[]): StoredDrawingItem[] {
  return drawingSets.flatMap((drawingSet) =>
    drawingSet.drawingItems.map((drawingItem, position) => ({ ...drawingItem, drawingSetId: drawingSet.id, position })),
  );
}

/** Puts loaded drawing items back on their sets, in their stored order. */
export function attachDrawingItems(drawingSets: Array<Omit<DrawingSet, "drawingItems">>, drawingItems: StoredDrawingItem[]): DrawingSet[] {
  const bySet = new Map<string, DrawingItem[]>();
  for (const { drawingSetId, position: _position, ...drawingItem } of [...drawingItems].sort((a, b) => a.position - b.position)) {
    bySet.set(drawingSetId, [...(bySet.get(drawingSetId) ?? []), drawingItem]);
  }
  return drawingSets.map((drawingSet) => ({ ...drawingSet, drawingItems: bySet.get(drawingSet.id) ?? [] }));
}
