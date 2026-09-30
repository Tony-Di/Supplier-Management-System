import assert from "node:assert/strict";
import { test } from "node:test";

import "../pgTypes";
import { withTestDatabase } from "../testDb";

const BUSINESS_TABLES = [
  "drawing_items", "drawing_sets", "files", "id_counters", "incoming_defects", "inspections", "items", "models",
  "price_changes", "projects", "purchase_prices", "quote_case_links", "quotes", "score_weights", "source_assignments", "suppliers",
];

const insertModel = `INSERT INTO models (id, name, product_family, status, notes) VALUES ('model-1001', 'BTA', 'Solar Module', 'Active', '')`;
const insertDrawingSet = (modelId: string) =>
  `INSERT INTO drawing_sets (id, model_id, name, revision, status, effective_date, maintained_by)
   VALUES ('dwgset-1001', '${modelId}', 'BTA packaging', '1.0', 'Active', '2026-01-01', 'Process Engineering')`;

test("creates every business table", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
    const tables = rows.map((row) => row.tablename as string);
    for (const table of BUSINESS_TABLES) assert.ok(tables.includes(table), table);
  });
});

test("seeds the default score weights as numbers", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT sample_quality, incoming_quality, pricing, responsiveness, scope_fit, setup FROM score_weights WHERE id = 1",
    );
    assert.deepEqual(rows, [{ sample_quality: 25, incoming_quality: 20, pricing: 20, responsiveness: 15, scope_fit: 10, setup: 10 }]);
  });
});

test("a date comes back as the stored day", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    const { rows } = await client.query("SELECT effective_date FROM drawing_sets");
    assert.equal(rows[0].effective_date, "2026-01-01");
  });
});

test("a reference to a missing record is refused when the transaction commits", async () => {
  await withTestDatabase(async (client) => {
    await client.query("BEGIN");
    await client.query(insertDrawingSet("model-9999"));
    await assert.rejects(client.query("COMMIT"), /foreign key/);
  });
});

test("deleting a drawing set deletes its items", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    await client.query(`INSERT INTO items (id, item_code, item_name, type, used_for_models, uom, status)
      VALUES ('item-1001', 'PAL-01', 'Pallet', 'Pallet', '{model-1001}', 'pcs', 'Active')`);
    await client.query(`INSERT INTO drawing_items (id, drawing_set_id, position, item_id, revision, status, drawing_source)
      VALUES ('dwgitem-1001', 'dwgset-1001', 0, 'item-1001', '1.0', 'Active', 'Package PDF')`);
    await client.query("DELETE FROM drawing_sets WHERE id = 'dwgset-1001'");
    const { rows } = await client.query("SELECT count(*)::int AS count FROM drawing_items");
    assert.equal(rows[0].count, 0);
  });
});

test("a quote may point at a drawing item that no longer exists", async () => {
  await withTestDatabase(async (client) => {
    await client.query(insertModel);
    await client.query(insertDrawingSet("model-1001"));
    await client.query(`INSERT INTO items (id, item_code, item_name, type, used_for_models, uom, status)
      VALUES ('item-1001', 'PAL-01', 'Pallet', 'Pallet', '{model-1001}', 'pcs', 'Active')`);
    await client.query(`INSERT INTO suppliers (id, name, status, type, country, region, capable_items, primary_contact, email, phone, payment_terms, has_w9, has_payment_info, notes)
      VALUES ('sup-1001', 'Legacy Paper', 'Active', 'Manufacturer', 'United States', '', '{Pallet}', '', '', '', '', false, false, '')`);
    await client.query("BEGIN");
    await client.query(`INSERT INTO quotes (id, supplier_id, quote_type, quote_reason, model_id, item_id, drawing_set_id, drawing_item_id,
        quote_date, effective_from, currency, uom, unit_price, moq, lead_time, extra_cost_type, extra_cost_amount, status, notes)
      VALUES ('q-1001', 'sup-1001', 'Standalone', 'New Quote', 'model-1001', 'item-1001', 'dwgset-1001', 'dwgitem-9999',
        '2026-02-10', '2026-02-10', 'USD', 'pcs', 12.5, '100', '14 days', 'None', 0, 'Received', '')`);
    await client.query("COMMIT");
    const { rows } = await client.query("SELECT unit_price FROM quotes");
    assert.equal(rows[0].unit_price, 12.5);
  });
});
