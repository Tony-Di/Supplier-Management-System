import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";

import { withTestApp } from "../testDb";
import { call, expectJson, send, signIn } from "./http";
import { seedSourcingCase, snapshotTables } from "./seed";

test("a rejected edit changes nothing", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { project } = await seedSourcingCase(app, session);
    const before = await snapshotTables(pool);
    assert.equal(before.projects.length, 1);

    const response = await send(app, session, "PATCH", `/api/projects/${project.id}`, { drawingSetId: "dwgset-9999" });
    assert.equal(response.status, 400);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

/** A case quote waiting for its sample, an earlier Selected price for the same supplier and item, and a helper to record its inspection. */
async function seedSampledQuote(app: Parameters<typeof signIn>[0], session: Awaited<ReturnType<typeof signIn>>, pool: Pool) {
  const seed = await seedSourcingCase(app, session);
  const { id: _seedQuoteId, ...quoteFields } = seed.quote;
  const earlier = await expectJson(
    send(app, session, "POST", "/api/quotes", { ...quoteFields, quoteDate: "2026-01-10", effectiveFrom: "2026-01-10", unitPrice: 10 }),
    201,
  );
  await pool.query("UPDATE quotes SET status = 'Selected' WHERE id = $1", [earlier.id]);
  await expectJson(send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "Sample Requested" }), 200);
  const inspect = (fields: Record<string, unknown>) =>
    expectJson(
      send(app, session, "POST", "/api/inspections", {
        supplierId: seed.supplier.id,
        projectId: seed.project.id,
        relatedQuoteId: seed.quote.id,
        modelId: seed.model.id,
        drawingSetId: seed.drawingSet.id,
        itemId: seed.item.id,
        drawingItemId: seed.drawingSet.drawingItems[0].id,
        sampleReceivedDate: "2026-02-15",
        ...fields,
      }),
      201,
    );
  return { seed, earlier, inspect };
}

test("passing an inspection stores the quote as Selected with its price change", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, earlier, inspect } = await seedSampledQuote(app, session, pool);
    const inspection = await inspect({ result: "Not Submitted" });

    await expectJson(send(app, session, "PATCH", `/api/inspections/${inspection.id}`, { result: "Pass" }), 200);

    const { rows: [quote] } = await pool.query("SELECT status, status_basis, previous_quote_id FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(quote, { status: "Selected", status_basis: "QC Pass", previous_quote_id: earlier.id });
    const { rows: changes } = await pool.query("SELECT source_quote_id, previous_quote_id, old_price, new_price FROM price_changes");
    assert.deepEqual(changes, [{ source_quote_id: seed.quote.id, previous_quote_id: earlier.id, old_price: 10, new_price: 12 }]);
    const { rows: [closed] } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [earlier.id]);
    assert.notEqual(closed.effective_to, null);
  });
});

test("a quote the buyer drops after its sample passed stays dropped", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, inspect } = await seedSampledQuote(app, session, pool);
    const inspection = await inspect({ result: "Pass" });

    const dropped = await expectJson(send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "No Further Action" }), 200);
    assert.equal(dropped.status, "No Further Action");
    await expectJson(send(app, session, "PATCH", `/api/inspections/${inspection.id}`, { notes: "Checked again" }), 200);
    const { rows } = await pool.query("SELECT status FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(rows, [{ status: "No Further Action" }]);
  });
});

test("voiding the passing inspection puts the quote back to waiting and reopens the earlier price", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, earlier, inspect } = await seedSampledQuote(app, session, pool);
    const inspection = await inspect({ result: "Pass" });

    await expectJson(send(app, session, "POST", `/api/inspections/${inspection.id}/void`, { reason: "Entered against the wrong quote" }), 200);

    const { rows: [quote] } = await pool.query("SELECT status, status_basis FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(quote, { status: "Sample Requested", status_basis: null });
    const { rows: [reopened] } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [earlier.id]);
    assert.equal(reopened.effective_to, null);
    const { rows: changes } = await pool.query("SELECT record_state FROM price_changes");
    assert.deepEqual(changes, [{ record_state: "Void" }]);
  });
});

test("a new supplier's quote cannot be set to Selected by hand", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "Selected" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Request a sample first/);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("a supplier that passed QC for the item can have a requote set to Selected by hand", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, inspect } = await seedSampledQuote(app, session, pool);
    await inspect({ result: "Pass" });
    const { id: _seedQuoteId, ...quoteFields } = seed.quote;
    const requote = await expectJson(
      send(app, session, "POST", "/api/quotes", { ...quoteFields, quoteReason: "Requote", quoteDate: "2026-08-01", effectiveFrom: "2026-08-01", unitPrice: 14 }),
      201,
    );
    const selected = await expectJson(send(app, session, "PATCH", `/api/quotes/${requote.id}`, { status: "Selected", statusBasis: "QC Pass" }), 200);
    assert.deepEqual([selected.status, selected.statusBasis], ["Selected", "Existing Supplier"]);
  });
});

test("previous orders select a quote for a supplier with a Since date, and only when confirmed", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp({ previousOrderSelection: true });
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/suppliers/${seed.supplier.id}`, { supplierSince: "2023-04-01" }), 200);

    const unconfirmed = await send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "Selected" });
    assert.equal(unconfirmed.status, 400);
    assert.match((await unconfirmed.json()).message, /supplied this item before/);

    await expectJson(
      send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "Selected", statusBasis: "Previous Orders", statusReference: " PO-77 " }),
      200,
    );
    const { rows } = await pool.query("SELECT status, status_basis, status_reference FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(rows, [{ status: "Selected", status_basis: "Previous Orders", status_reference: "PO-77" }]);
  });
});

test("previous orders are refused once that entry point is switched off", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp({ previousOrderSelection: false });
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/suppliers/${seed.supplier.id}`, { supplierSince: "2023-04-01" }), 200);
    const response = await send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "Selected", statusBasis: "Previous Orders" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Request a sample first/);
    const me = await (await call(app, "/api/auth/me", { cookie: session.cookie })).json();
    assert.deepEqual(me.features, { previousOrderSelection: false });
  });
});

test("a status the system set is kept when an edit sends another basis", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, inspect } = await seedSampledQuote(app, session, pool);
    await inspect({ result: "Pass" });
    await expectJson(send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { notes: "MOQ confirmed", statusBasis: "Previous Orders" }), 200);
    const { rows } = await pool.query("SELECT status, status_basis FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(rows, [{ status: "Selected", status_basis: "QC Pass" }]);
  });
});

test("a source role is refused for a quote that is not Selected, even after its sample passed", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { seed, inspect } = await seedSampledQuote(app, session, pool);
    const role = { projectId: seed.project.id, modelId: seed.model.id, itemId: seed.item.id, supplierId: seed.supplier.id, sourceQuoteId: seed.quote.id, role: "Primary", effectiveFrom: "2026-03-01" };
    await inspect({ result: "Pass" });
    await expectJson(send(app, session, "PATCH", `/api/quotes/${seed.quote.id}`, { status: "No Further Action" }), 200);

    const refused = await send(app, session, "POST", "/api/source-assignments", role);
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).message, /must be Selected/);
  });
});

test("a supplier's Since date is stored and an edit can clear it", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const supplier = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Woodridge", supplierSince: "2025-12-06" }), 201);
    const select = () => pool.query("SELECT supplier_since FROM suppliers WHERE id = $1", [supplier.id]);
    assert.deepEqual((await select()).rows, [{ supplier_since: "2025-12-06" }]);

    await expectJson(send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { supplierSince: null }), 200);
    assert.deepEqual((await select()).rows, [{ supplier_since: null }]);
  });
});

test("two edits to one record at the same time both take effect", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const supplier = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Legacy Paper", recordState: "Active" }), 201);
    const [first, second] = await Promise.all([
      send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { phone: "555-0100" }),
      send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { region: "TX" }),
    ]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    const { rows } = await pool.query("SELECT phone, region FROM suppliers WHERE id = $1", [supplier.id]);
    assert.deepEqual(rows, [{ phone: "555-0100", region: "TX" }]);
  });
});

test("opening the app writes nothing, even when a sync pass would change data", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    await expectJson(
      send(app, session, "POST", "/api/inspections", {
        supplierId: seed.supplier.id,
        projectId: seed.project.id,
        relatedQuoteId: seed.quote.id,
        modelId: seed.model.id,
        drawingSetId: seed.drawingSet.id,
        itemId: seed.item.id,
        drawingItemId: seed.drawingSet.drawingItems[0].id,
        sampleReceivedDate: "2026-02-15",
        result: "Pass",
      }),
      201,
    );
    // A passed inspection whose quote still asks for a sample: the old bootstrap sync rewrote this on read.
    await pool.query("UPDATE quotes SET status = 'Sample Requested' WHERE id = $1", [seed.quote.id]);
    const before = await snapshotTables(pool);

    for (const path of ["/api/bootstrap", "/api/scorecard", `/api/projects/${seed.project.id}/comparison`, "/api/files", "/api/score-settings"]) {
      await expectJson(send(app, session, "GET", path), 200);
    }
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("a new quote cannot name the quote that closed its price", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    await pool.query("UPDATE quotes SET status = 'Selected' WHERE id = $1", [seed.quote.id]);
    const { id: _seedQuoteId, ...quoteFields } = seed.quote;
    const quote = await expectJson(send(app, session, "POST", "/api/quotes", { ...quoteFields, effectiveFrom: "2026-01-10", quoteDate: "2026-01-10", closedByQuoteId: seed.quote.id }), 201);
    const { rows } = await pool.query("SELECT closed_by_quote_id FROM quotes WHERE id = $1", [quote.id]);
    assert.deepEqual(rows, [{ closed_by_quote_id: null }]);
  });
});

test("an edit can clear a quote's Effective To", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { quote } = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: "2026-06-30", changeReason: "Supplier notice" }), 200);
    await expectJson(send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: null, changeReason: "Open-ended again" }), 200);
    const { rows } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [quote.id]);
    assert.deepEqual(rows, [{ effective_to: null }]);
  });
});

test("a defect can be switched from replacement to credit", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { supplier, item } = await seedSourcingCase(app, session);
    const defect = await expectJson(
      send(app, session, "POST", "/api/incoming-defects", {
        supplierId: supplier.id,
        itemId: item.id,
        defectDate: "2026-04-01",
        defectQty: 5,
        defectAction: "Request Replacement",
        replacementQty: 5,
      }),
      201,
    );
    await expectJson(send(app, session, "PATCH", `/api/incoming-defects/${defect.id}`, { defectAction: "Request Credit", replacementQty: null }), 200);
    const { rows } = await pool.query("SELECT defect_action, replacement_qty, action_completed FROM incoming_defects WHERE id = $1", [defect.id]);
    assert.deepEqual(rows, [{ defect_action: "Request Credit", replacement_qty: null, action_completed: true }]);
  });
});

test("editing a packaging set to drop an item a quote uses still saves", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { drawingSet, quote } = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/drawing-sets/${drawingSet.id}`, { drawingItems: [] }), 200);
    const { rows } = await pool.query("SELECT id FROM drawing_items WHERE id = $1", [quote.drawingItemId]);
    assert.deepEqual(rows, []);
  });
});

test("an edit can clear a packaging set's package file name", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { drawingSet } = await seedSourcingCase(app, session);
    await expectJson(send(app, session, "PATCH", `/api/drawing-sets/${drawingSet.id}`, { packageFileName: "BTA packaging.pdf" }), 200);
    await expectJson(send(app, session, "PATCH", `/api/drawing-sets/${drawingSet.id}`, { packageFileName: null }), 200);
    const { rows } = await pool.query("SELECT package_file_name FROM drawing_sets WHERE id = $1", [drawingSet.id]);
    assert.deepEqual(rows, [{ package_file_name: null }]);
  });
});

test("deleting an unused packaging set deletes its items and nothing else", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
    const model = await post("/api/models", { name: "BTC 620", recordState: "Active" });
    const item = await post("/api/items", { itemCode: "STR-01", itemName: "Strap", type: "Strapping", usedForModels: [model.id], recordState: "Active" });
    const unused = await post("/api/drawing-sets", {
      modelId: model.id,
      name: "BTC packaging",
      status: "Active",
      effectiveDate: "2026-03-01",
      recordState: "Active",
      drawingItems: [{ itemId: item.id }],
    });

    await expectJson(send(app, session, "DELETE", `/api/drawing-sets/${unused.id}`), 200);

    const { rows: sets } = await pool.query("SELECT id FROM drawing_sets");
    assert.deepEqual(sets, [{ id: seed.drawingSet.id }]);
    const { rows: items } = await pool.query("SELECT drawing_set_id FROM drawing_items");
    assert.deepEqual(items, [{ drawing_set_id: seed.drawingSet.id }]);
    const { rows: quotes } = await pool.query("SELECT id FROM quotes");
    assert.deepEqual(quotes, [{ id: seed.quote.id }]);
  });
});

test("a deleted record's ID is not issued again", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const first = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "First" }), 201);
    await expectJson(send(app, session, "DELETE", `/api/suppliers/${first.id}`), 200);
    const second = await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Second" }), 201);
    assert.deepEqual([first.id, second.id], ["sup-1001", "sup-1002"]);
  });
});

test("a reference to a missing file is refused with 400 and nothing is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "POST", "/api/suppliers", { name: "Legacy Paper", w9FileId: "file-9999" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /refers to a record that does not exist/);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("a supplier's other documents are stored and an edit can remove one", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const upload = (fileName: string) =>
      expectJson(send(app, session, "POST", "/api/files", { fileName, contentBase64: Buffer.from(fileName).toString("base64"), purpose: "Other" }), 201);
    const certificate = await upload("ISO 9001.pdf");
    const insurance = await upload("Insurance.pdf");
    const supplier = await expectJson(
      send(app, session, "POST", "/api/suppliers", { name: "Woodridge", otherFileIds: [certificate.id, insurance.id] }),
      201,
    );
    const select = () => pool.query("SELECT other_file_ids FROM suppliers WHERE id = $1", [supplier.id]);
    assert.deepEqual((await select()).rows, [{ other_file_ids: [certificate.id, insurance.id] }]);

    await expectJson(send(app, session, "PATCH", `/api/suppliers/${supplier.id}`, { otherFileIds: [insurance.id] }), 200);
    assert.deepEqual((await select()).rows, [{ other_file_ids: [insurance.id] }]);
  });
});

test("an other document that does not exist is refused with 400 and nothing is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "POST", "/api/suppliers", { name: "Legacy Paper", otherFileIds: ["file-9999"] });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /file-9999/);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("an impossible date is refused with 400", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const { quote } = await seedSourcingCase(app, session);
    const response = await send(app, session, "PATCH", `/api/quotes/${quote.id}`, { effectiveTo: "2026-02-30", changeReason: "Typo test" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "A date is not valid.");
  });
});

test("a quantity too large for its column is refused with 400 and nothing is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { supplier, item } = await seedSourcingCase(app, session);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "POST", "/api/incoming-defects", {
      supplierId: supplier.id,
      itemId: item.id,
      defectDate: "2026-04-01",
      defectQty: 3000000000,
      defectAction: "Request Credit",
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "A number is too large.");
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("a NUL character in text is refused with 400 and nothing is stored", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const before = await snapshotTables(pool);
    const response = await send(app, session, "POST", "/api/suppliers", { name: "Null\u0000Supplier" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Text cannot contain a NUL character.");
    assert.deepEqual(await snapshotTables(pool), before);
  });
});

test("a purchase price that a price change refers to cannot be deleted", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const session = await signIn(app);
    const { supplier, model, item } = await seedSourcingCase(app, session);
    const purchase = { supplierId: supplier.id, modelId: model.id, itemId: item.id, poNumber: "PO-1", orderDate: "2026-03-01", unitPrice: 10, quantity: 100 };
    const first = await expectJson(send(app, session, "POST", "/api/purchase-prices", purchase), 201);
    await expectJson(send(app, session, "POST", "/api/purchase-prices", { ...purchase, poNumber: "PO-2", orderDate: "2026-04-01", unitPrice: 11 }), 201);

    const response = await send(app, session, "DELETE", `/api/purchase-prices/${first.id}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Cannot delete purchase price: linked to price changes.");
  });
});

test("a model import creates new models and skips names that exist or repeat", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    await expectJson(send(app, session, "POST", "/api/models", { name: "BTA", recordState: "Active" }), 201);

    const result = await expectJson(send(app, session, "POST", "/api/models/import", {
      rows: [
        { name: "bta" },
        { name: "BTC 620", productFamily: "", status: "Inactive", notes: "Pilot" },
        { name: "BTC  620" },
      ],
    }), 201);

    assert.deepEqual(result, { totalRows: 3, created: 1, duplicated: 1, skipped: 1 });
    const { rows } = await pool.query("SELECT name, product_family, status, notes FROM models ORDER BY id");
    assert.deepEqual(rows, [
      { name: "BTA", product_family: "Solar Module", status: "Active", notes: "" },
      { name: "BTC 620", product_family: "Solar Module", status: "Inactive", notes: "Pilot" },
    ]);
    const { rows: audit } = await pool.query("SELECT action, source FROM audit_logs WHERE entity_type = 'Model' ORDER BY id");
    assert.deepEqual(audit, [{ action: "Create", source: "UI" }, { action: "Import", source: "Import" }]);
  });
});

test("an item import adds new models to an existing Item Code and to codes repeated in the import", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { model, item } = await seedSourcingCase(app, session);
    const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
    const btc = await post("/api/models", { name: "BTC 620", recordState: "Active" });
    const btcSet = await post("/api/drawing-sets", {
      modelId: btc.id,
      name: "BTC packaging",
      status: "Active",
      effectiveDate: "2026-03-01",
      recordState: "Active",
      drawingItems: [],
    });

    const result = await post("/api/items/import", {
      rows: [
        { itemCode: "pal-01", description: "Pallet", type: "Pallet", usedFor: ["BTA", "BTC 620"] },
        { itemCode: "PAL-01", description: "Pallet", type: "Pallet", usedFor: ["BTA"] },
        { itemCode: "STR-01", description: "Strap", type: "Strapping", usedFor: ["BTA"] },
        { itemCode: "STR-01", description: "Strap", type: "Strapping", usedFor: ["BTC 620"] },
        { itemCode: "STR-01", description: "Strap", type: "Strapping", usedFor: ["BTA"] },
      ],
    });

    assert.deepEqual(
      [result.totalRows, result.created, result.linked, result.duplicated, result.skipped],
      [5, 1, 2, 1, 1],
    );
    const { rows: items } = await pool.query("SELECT id, item_code, used_for_models FROM items ORDER BY id");
    assert.deepEqual(items.map(({ item_code, used_for_models }) => ({ item_code, used_for_models })), [
      { item_code: "PAL-01", used_for_models: [model.id, btc.id] },
      { item_code: "STR-01", used_for_models: [model.id, btc.id] },
    ]);
    const { rows: btcItems } = await pool.query("SELECT item_id FROM drawing_items WHERE drawing_set_id = $1 ORDER BY item_id", [btcSet.id]);
    assert.deepEqual(btcItems.map((row) => row.item_id), [item.id, items[1].id]);
    const { rows: audit } = await pool.query("SELECT action, entity_label, reason FROM audit_logs WHERE entity_type = 'Item' AND source = 'Import' ORDER BY id");
    assert.deepEqual(audit, [
      { action: "Import", entity_label: "STR-01", reason: "Created from item import" },
      { action: "Edit", entity_label: "PAL-01", reason: "Models added by item import" },
    ]);
  });
});

test("a packaging set for a new model links the shared items it covers to that model", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { model, item, drawingSet } = await seedSourcingCase(app, session);
    const post = (path: string, body: unknown) => expectJson(send(app, session, "POST", path, body), 201);
    const bte = await post("/api/models", { name: "BTE 800", recordState: "Active" });

    const created = await post("/api/drawing-sets", {
      modelId: bte.id,
      name: "SEG-BTE-800 A0",
      status: "Active",
      effectiveDate: "2026-10-28",
      recordState: "Active",
      replaceActive: true,
      linkItemIds: [item.id],
      drawingItems: [{ itemId: item.id }],
    });

    assert.equal(created.modelId, bte.id);
    assert.equal(created.revision, "1.0");
    const { rows: [linked] } = await pool.query("SELECT used_for_models FROM items WHERE id = $1", [item.id]);
    assert.deepEqual(linked.used_for_models, [model.id, bte.id]);
    const { rows: sets } = await pool.query("SELECT id, model_id, status FROM drawing_sets ORDER BY id");
    assert.deepEqual(sets, [
      { id: drawingSet.id, model_id: model.id, status: "Active" },
      { id: created.id, model_id: bte.id, status: "Active" },
    ]);
    const { rows: audit } = await pool.query("SELECT action, reason FROM audit_logs WHERE entity_type = 'Item' AND entity_id = $1 ORDER BY id DESC LIMIT 1", [item.id]);
    assert.deepEqual(audit, [{ action: "Edit", reason: "Linked to model by packaging set import" }]);
  });
});

test("a packaging set that links a missing item is refused and links nothing", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const { item } = await seedSourcingCase(app, session);
    const bte = await expectJson(send(app, session, "POST", "/api/models", { name: "BTE 800", recordState: "Active" }), 201);
    const before = await snapshotTables(pool);

    const response = await send(app, session, "POST", "/api/drawing-sets", {
      modelId: bte.id,
      name: "SEG-BTE-800 A0",
      status: "Active",
      effectiveDate: "2026-10-28",
      recordState: "Active",
      linkItemIds: [item.id, "item-9999"],
      drawingItems: [{ itemId: item.id }],
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await snapshotTables(pool), before);
  });
});
