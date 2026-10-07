import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestApp } from "../testDb";
import { expectJson, send, signIn } from "./http";
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

test("passing an inspection stores the quote as Selected with its price change", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const seed = await seedSourcingCase(app, session);
    const { id: _seedQuoteId, ...quoteFields } = seed.quote;
    const earlier = await expectJson(
      send(app, session, "POST", "/api/quotes", { ...quoteFields, quoteDate: "2026-01-10", effectiveFrom: "2026-01-10", unitPrice: 10, status: "Selected" }),
      201,
    );
    const inspection = await expectJson(
      send(app, session, "POST", "/api/inspections", {
        supplierId: seed.supplier.id,
        projectId: seed.project.id,
        relatedQuoteId: seed.quote.id,
        modelId: seed.model.id,
        drawingSetId: seed.drawingSet.id,
        itemId: seed.item.id,
        drawingItemId: seed.drawingSet.drawingItems[0].id,
        sampleReceivedDate: "2026-02-15",
        result: "Not Submitted",
      }),
      201,
    );

    await expectJson(send(app, session, "PATCH", `/api/inspections/${inspection.id}`, { result: "Pass" }), 200);

    const { rows: [quote] } = await pool.query("SELECT status, previous_quote_id FROM quotes WHERE id = $1", [seed.quote.id]);
    assert.deepEqual(quote, { status: "Selected", previous_quote_id: earlier.id });
    const { rows: changes } = await pool.query("SELECT source_quote_id, previous_quote_id, old_price, new_price FROM price_changes");
    assert.deepEqual(changes, [{ source_quote_id: seed.quote.id, previous_quote_id: earlier.id, old_price: 10, new_price: 12 }]);
    const { rows: [closed] } = await pool.query("SELECT effective_to FROM quotes WHERE id = $1", [earlier.id]);
    assert.notEqual(closed.effective_to, null);
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
