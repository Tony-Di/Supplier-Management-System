import assert from "node:assert/strict";
import { test } from "node:test";

import { runMigrations } from "../../scripts/migrate";
import { withTestDatabase } from "../testDb";

test("creates the users table", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = current_schema()",
    );
    const columns = rows.map((row) => row.column_name).sort();
    assert.deepEqual(columns, [
      "active", "created_at", "email", "entra_oid", "id", "last_login_at", "name", "role", "session_epoch",
    ]);
  });
});

test("rejects a second user with the same entra oid", async () => {
  await withTestDatabase(async (client) => {
    await client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "a@segsolar.com", "A"]);
    await assert.rejects(
      client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "b@segsolar.com", "B"]),
      /duplicate key/,
    );
  });
});

test("records which migrations ran", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
    assert.ok(rows.some((row) => row.filename === "001_auth.sql"));
  });
});

test("the selection rules migration keeps effective requotes and renames retired statuses", async () => {
  await withTestDatabase(async (client) => {
    await client.query(`INSERT INTO suppliers (id, name, status, type, country, region, capable_items, primary_contact, email, phone, payment_terms, has_w9, has_payment_info, notes)
      VALUES ('sup-1', 'Legacy Paper', 'Active', 'Manufacturer', 'United States', '', '{Pallet}', '', '', '', '', false, false, '')`);
    await client.query("INSERT INTO models (id, name, product_family, status, notes) VALUES ('model-1', 'BTA', 'Solar Module', 'Active', '')");
    await client.query("INSERT INTO items (id, item_code, item_name, type, used_for_models, uom, status) VALUES ('item-1', 'PAL-01', 'Pallet', 'Pallet', '{model-1}', 'pcs', 'Active')");
    await client.query(`INSERT INTO drawing_sets (id, model_id, name, revision, status, effective_date, maintained_by)
      VALUES ('dwgset-1', 'model-1', 'BTA packaging', '1.0', 'Active', '2026-01-01', 'Process Engineering')`);
    const quotes: Array<[string, string, string, string | null]> = [
      ["q-requote", "Requote", "Received", null],
      ["q-cwo", "Change Work Order", "Under Review", null],
      ["q-void-requote", "Requote", "Received", "Void"],
      ["q-review", "New Quote", "Under Review", null],
      ["q-rejected", "New Quote", "Not Selected", null],
      ["q-selected", "New Quote", "Selected", null],
    ];
    for (const [id, reason, status, recordState] of quotes) {
      await client.query(
        `INSERT INTO quotes (id, record_state, supplier_id, quote_type, quote_reason, model_id, item_id, drawing_set_id, drawing_item_id,
           quote_date, effective_from, currency, uom, unit_price, moq, lead_time, extra_cost_type, extra_cost_amount, status, notes)
         VALUES ($1, $2, 'sup-1', 'Standalone', $3, 'model-1', 'item-1', 'dwgset-1', 'dwgitem-1',
           '2026-02-10', '2026-02-10', 'USD', 'pcs', 12, '100', '14 days', 'None', 0, $4, '')`,
        [id, recordState, reason, status],
      );
    }

    await runMigrations(client);

    const { rows } = await client.query("SELECT id, status, status_basis FROM quotes ORDER BY id");
    assert.deepEqual(rows, [
      { id: "q-cwo", status: "Selected", status_basis: "Migration" },
      { id: "q-rejected", status: "No Further Action", status_basis: null },
      { id: "q-requote", status: "Selected", status_basis: "Migration" },
      { id: "q-review", status: "Received", status_basis: null },
      { id: "q-selected", status: "Selected", status_basis: null },
      { id: "q-void-requote", status: "Received", status_basis: null },
    ]);
    const audit = await client.query("SELECT entity_id, actor_label, source, entity_label, before, after FROM audit_logs WHERE entity_id = 'q-cwo'");
    assert.deepEqual(audit.rows, [{
      entity_id: "q-cwo",
      actor_label: "System",
      source: "System",
      entity_label: "Legacy Paper / PAL-01",
      before: { status: "Under Review" },
      after: { status: "Selected", statusBasis: "Migration" },
    }]);
    const audited = await client.query("SELECT entity_id FROM audit_logs ORDER BY entity_id");
    assert.deepEqual(audited.rows.map((row) => row.entity_id), ["q-cwo", "q-rejected", "q-requote", "q-review"]);
  }, { through: "005_supplier_other_files.sql" });
});
