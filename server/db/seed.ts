import type { Express } from "express";
import type { Pool } from "pg";

import { expectJson, send, type Session } from "./http";

const BUSINESS_TABLES = [
  "files", "suppliers", "models", "items", "drawing_sets", "drawing_items", "projects", "quotes", "quote_case_links",
  "source_assignments", "inspections", "incoming_defects", "purchase_prices", "price_changes", "score_weights", "id_counters",
];

/** Every business row and the audit trail's size, to assert that a request changed nothing. */
export async function snapshotTables(pool: Pool) {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of BUSINESS_TABLES) snapshot[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
  snapshot.audit_logs = (await pool.query("SELECT count(*)::int AS count FROM audit_logs")).rows;
  return snapshot;
}

/** A model, an item, an active packaging set, a supplier, a case and one case-linked quote, created through the API. */
export async function seedSourcingCase(app: Express, session: Session) {
  const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
  const model = await post("/api/models", { name: "BTA", recordState: "Active" });
  const item = await post("/api/items", { itemCode: "PAL-01", itemName: "Pallet", type: "Pallet", usedForModels: [model.id], recordState: "Active" });
  const drawingSet = await post("/api/drawing-sets", {
    modelId: model.id,
    name: "BTA packaging",
    status: "Active",
    effectiveDate: "2026-01-01",
    recordState: "Active",
    drawingItems: [{ itemId: item.id }],
  });
  const supplier = await post("/api/suppliers", { name: "Legacy Paper", capableItems: ["Pallet"], recordState: "Active" });
  const project = await post("/api/projects", {
    name: "BTA 2026",
    modelIds: [model.id],
    drawingSetId: drawingSet.id,
    type: "New Supplier Development",
    supplierIds: [supplier.id],
    itemIds: [item.id],
    openDate: "2026-02-01",
  });
  const quote = await post("/api/quotes", {
    supplierId: supplier.id,
    projectId: project.id,
    quoteType: "Case-linked",
    modelId: model.id,
    itemId: item.id,
    drawingSetId: drawingSet.id,
    drawingItemId: drawingSet.drawingItems[0].id,
    quoteDate: "2026-02-10",
    effectiveFrom: "2026-02-10",
    unitPrice: 12,
    moq: "100",
    leadTime: "14 days",
  });
  return { model, item, drawingSet, supplier, project, quote };
}
