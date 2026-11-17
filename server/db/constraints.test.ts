import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";
import type { ZodTypeAny } from "zod";

import { runMigrations } from "../../scripts/migrate";
import "../pgTypes";
import {
  drawingSetSchema,
  incomingDefectSchema,
  inspectionSchema,
  itemSchema,
  modelSchema,
  priceChangeSchema,
  projectSchema,
  purchasePriceSchema,
  quoteSchema,
  sourceAssignmentSchema,
  supplierSchema,
} from "../schemas";
import { withTestDatabase } from "../testDb";

/** The values a schema field accepts, whatever default or optional wrapper sits around its enum. */
function allowedValues(schema: ZodTypeAny): string[] {
  let current = schema;
  while (current._def.innerType) current = current._def.innerType;
  assert.ok(Array.isArray(current._def.values), "expected an enum field");
  return [...current._def.values];
}

const drawingItemSchema = drawingSetSchema.shape.drawingItems._def.innerType.element;
const incomingDefectFields = incomingDefectSchema.innerType().shape;

// Every value check in migration 007 that has a request schema behind it.
const VALUE_CHECKS: Array<[table: string, column: string, schema: ZodTypeAny]> = [
  ["suppliers", "record_state", supplierSchema.shape.recordState],
  ["suppliers", "status", supplierSchema.shape.status],
  ["suppliers", "type", supplierSchema.shape.type],
  ["models", "status", modelSchema.shape.status],
  ["items", "status", itemSchema.shape.status],
  ["items", "uom", itemSchema.shape.uom],
  ["drawing_sets", "status", drawingSetSchema.shape.status],
  ["drawing_items", "status", drawingItemSchema.shape.status],
  ["drawing_items", "drawing_source", drawingItemSchema.shape.drawingSource],
  ["projects", "type", projectSchema.shape.type],
  ["projects", "case_reason", projectSchema.shape.caseReason],
  ["projects", "status", projectSchema.shape.status],
  ["quotes", "quote_type", quoteSchema.shape.quoteType],
  ["quotes", "quote_reason", quoteSchema.shape.quoteReason],
  ["quotes", "extra_cost_type", quoteSchema.shape.extraCostType],
  ["quotes", "status", quoteSchema.shape.status],
  ["quotes", "status_basis", quoteSchema.shape.statusBasis],
  ["source_assignments", "role", sourceAssignmentSchema.shape.role],
  ["inspections", "result", inspectionSchema.shape.result],
  ["inspections", "disposition", inspectionSchema.shape.disposition],
  ["incoming_defects", "defect_type", incomingDefectFields.defectType],
  ["incoming_defects", "defect_action", incomingDefectFields.defectAction],
  ["price_changes", "source_type", priceChangeSchema.shape.sourceType],
  ["price_changes", "reason", priceChangeSchema.shape.reason],
  ["price_changes", "status", priceChangeSchema.shape.status],
  ["purchase_prices", "source_type", purchasePriceSchema.shape.sourceType],
];

async function checkDefinition(client: PoolClient, table: string, name: string): Promise<string | undefined> {
  const { rows } = await client.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema() AND t.relname = $1 AND c.conname = $2`,
    [table, name],
  );
  return rows[0]?.definition as string | undefined;
}

const insertSupplier = (id: string) =>
  `INSERT INTO suppliers (id, name, status, type, country, region, capable_items, primary_contact, email, phone, payment_terms, has_w9, has_payment_info, notes)
   VALUES ('${id}', 'Legacy Paper', 'Active', 'Manufacturer', 'United States', '', '{Pallet}', '', '', '', '', false, false, '')`;
const insertModel = (id: string, status: string) =>
  `INSERT INTO models (id, name, product_family, status, notes) VALUES ('${id}', 'BTA', 'Solar Module', '${status}', '')`;
const insertItem = (id: string, code: string, recordState: string | null = null) =>
  `INSERT INTO items (id, record_state, item_code, item_name, type, used_for_models, uom, status)
   VALUES ('${id}', ${recordState ? `'${recordState}'` : "NULL"}, '${code}', 'Pallet', 'Pallet', '{}', 'pcs', 'Active')`;

test("each value check allows exactly what its request schema allows", async () => {
  await withTestDatabase(async (client) => {
    for (const [table, column, schema] of VALUE_CHECKS) {
      const definition = await checkDefinition(client, table, `${table}_${column}_check`);
      assert.ok(definition, `${table}.${column} has no check`);
      const inDatabase = [...definition.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1].replace(/''/g, "'"));
      assert.deepEqual(inDatabase.sort(), allowedValues(schema).sort(), `${table}.${column}`);
    }
  });
});

test("a value outside the list is refused, and a missing record state is not", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel("model-1", "Active"));
    await assert.rejects(client.query(insertModel("model-2", "Retired")), /models_status_check/);
    await assert.rejects(client.query("UPDATE models SET record_state = 'Deleted' WHERE id = 'model-1'"), /models_record_state_check/);
  });
});

test("a negative price is refused", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertSupplier("sup-1"));
    await client.query(insertModel("model-1", "Active"));
    await client.query(insertItem("item-1", "PAL-01"));
    await assert.rejects(
      client.query(`INSERT INTO price_changes (id, supplier_id, model_id, item_id, source_type, old_price, new_price, currency, effective_date, reason, status)
        VALUES ('pc-1', 'sup-1', 'model-1', 'item-1', 'Manual', 10, -1, 'USD', '2026-03-01', 'Other', 'Pending')`),
      /price_changes_amounts_check/,
    );
  });
});

test("two usable items cannot share an Item Code, but a voided one can keep it", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertItem("item-1", "PAL-01"));
    await assert.rejects(client.query(insertItem("item-2", " pal-01 ")), /items_item_code_unique/);
    await client.query(insertItem("item-3", "PAL-01", "Void"));
    await client.query("UPDATE items SET record_state = 'Void' WHERE id = 'item-1'");
    await client.query(insertItem("item-4", "PAL-01", "Active"));
  });
});

test("the migration skips only the checks existing rows do not satisfy", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel("model-1", "Retired"));
    await client.query(insertItem("item-1", "PAL-01"));
    await client.query(insertItem("item-2", "pal-01"));

    const applied = await runMigrations(client);

    assert.ok(applied.includes("007_business_constraints.sql"));
    assert.equal(await checkDefinition(client, "models", "models_status_check"), undefined);
    assert.ok(await checkDefinition(client, "models", "models_record_state_check"));
    assert.ok(await checkDefinition(client, "items", "items_status_check"));
    const { rows } = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'items_item_code_unique'");
    assert.equal(rows.length, 0);
    const kept = await client.query("SELECT id, status FROM models");
    assert.deepEqual(kept.rows, [{ id: "model-1", status: "Retired" }]);
  }, { through: "006_quote_selection_rules.sql" });
});

test("a record carries when it was created and last changed", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel("model-1", "Active"));
    const created = (await client.query("SELECT created_at, updated_at FROM models")).rows[0];
    assert.ok(created.created_at instanceof Date);
    assert.deepEqual(created.updated_at, created.created_at);

    // now() is the transaction's start time, so the change needs a later transaction to show.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.query("UPDATE models SET notes = 'changed' WHERE id = 'model-1'");
    const changed = (await client.query("SELECT created_at, updated_at FROM models")).rows[0];
    assert.deepEqual(changed.created_at, created.created_at);
    assert.ok(changed.updated_at > created.updated_at);
  });
});

test("existing records take their times from the audit trail", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel("model-1", "Active"));
    await client.query(insertModel("model-2", "Active"));
    await client.query(insertModel("model-3", "Active"));
    const audit = (id: string, action: string, timestamp: string) =>
      client.query(
        "INSERT INTO audit_logs (timestamp, actor_label, action, entity_type, entity_id, entity_label) VALUES ($1, 'Dev User', $2, 'Model', $3, 'BTA')",
        [timestamp, action, id],
      );
    await audit("model-1", "Create", "2026-01-05T10:00:00Z");
    await audit("model-1", "Edit", "2026-02-01T09:30:00Z");
    // Created before the audit trail existed: only its edit is known.
    await audit("model-2", "Edit", "2026-03-01T08:00:00Z");

    await runMigrations(client);

    const { rows } = await client.query("SELECT id, created_at, updated_at FROM models ORDER BY id");
    assert.deepEqual(rows, [
      { id: "model-1", created_at: new Date("2026-01-05T10:00:00Z"), updated_at: new Date("2026-02-01T09:30:00Z") },
      { id: "model-2", created_at: null, updated_at: new Date("2026-03-01T08:00:00Z") },
      { id: "model-3", created_at: null, updated_at: null },
    ]);
  }, { through: "006_quote_selection_rules.sql" });
});
