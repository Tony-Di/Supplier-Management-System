import assert from "node:assert/strict";
import { test } from "node:test";

import { diffRecords, diffStore } from "./storeDiff";
import { emptyStore } from "./storeShape";
import { TABLES, toRow } from "./storeTables";
import { sampleStore } from "./testFixtures";

function changedTables(changes: ReturnType<typeof diffStore>) {
  return changes
    .filter((change) => change.inserts.length + change.updates.length + change.deletes.length > 0)
    .map((change) => change.def.table);
}

test("identical stores have no changes", () => {
  assert.deepEqual(changedTables(diffStore(sampleStore(), sampleStore())), []);
});

test("a new record is an insert of its full row", () => {
  const before = sampleStore();
  const after = sampleStore();
  const model = { id: "model-1003", name: "BTD", productFamily: "Solar Module", status: "Active" as const, notes: "" };
  after.models.push(model);
  const changes = diffRecords(TABLES.models, before.models, after.models);
  assert.deepEqual(changes.inserts, [toRow(TABLES.models, model)]);
  assert.deepEqual([changes.updates, changes.deletes], [[], []]);
});

test("a changed record is an update of its full row", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.quotes[0].status = "Not Selected";
  const changes = diffRecords(TABLES.quotes, before.quotes, after.quotes);
  assert.deepEqual(changes.updates, [toRow(TABLES.quotes, after.quotes[0])]);
  assert.deepEqual([changes.inserts, changes.deletes], [[], []]);
});

test("a removed record is a delete by id", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.priceChanges = after.priceChanges.filter((change) => change.id !== "pc-1002");
  assert.deepEqual(diffRecords(TABLES.priceChanges, before.priceChanges, after.priceChanges).deletes, ["pc-1002"]);
});

test("reordered keys inside a json field are not a change", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.incomingDefects[0].replacementReceipts = [{ result: "Accepted", receivedQty: 5, receivedDate: "2026-04-10" }];
  assert.deepEqual(changedTables(diffStore(before, after)), []);
});

test("an explicit undefined is not a change from an absent field", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.suppliers[1] = { ...after.suppliers[1], erpVendorId: undefined };
  assert.deepEqual(changedTables(diffStore(before, after)), []);
});

test("drawing items are compared as rows of their own", () => {
  const before = sampleStore();
  const after = sampleStore();
  after.drawingSets[0].drawingItems.shift();
  const changes = diffStore(before, after).find((change) => change.def.table === "drawing_items");
  assert.deepEqual(changes?.deletes, ["dwgitem-1001"]);
  // The remaining item moved from position 1 to 0.
  assert.deepEqual(changes?.updates.map((row) => [row[0], row[2]]), [["dwgitem-1002", 0]]);
  assert.deepEqual(changedTables(diffStore(before, after)), ["drawing_items"]);
});

test("saving a whole store from empty inserts every record", () => {
  const store = sampleStore();
  const inserted = Object.fromEntries(diffStore(emptyStore(), store).map((change) => [change.def.table, change.inserts.length]));
  assert.deepEqual(inserted, {
    files: 2, suppliers: 2, models: 2, items: 2, drawing_sets: 2, drawing_items: 2, projects: 1, quotes: 2,
    quote_case_links: 1, source_assignments: 1, inspections: 1, incoming_defects: 2, purchase_prices: 1, price_changes: 2,
  });
});

test("score weights are not part of the table changes", () => {
  const after = sampleStore();
  after.scoreWeights.pricing = 40;
  assert.deepEqual(changedTables(diffStore(sampleStore(), after)), []);
});
