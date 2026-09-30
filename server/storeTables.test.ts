import assert from "node:assert/strict";
import { test } from "node:test";

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
} from "./schemas";
import { TABLES, attachDrawingItems, columnName, flattenDrawingItems, fromRow, toRow, type TableDef } from "./storeTables";
import { sampleStore } from "./testFixtures";

/** What pg hands back for a row: values keyed by column, timestamps as Dates. */
function asLoaded(def: TableDef, row: unknown[]) {
  return Object.fromEntries(
    def.fields.map((field, index) => {
      const value = row[index];
      return [columnName(field), value !== null && def.timestamps?.includes(field) ? new Date(value as string) : value];
    }),
  );
}

function roundTrip(def: TableDef, record: object) {
  return fromRow(def, asLoaded(def, toRow(def, record)));
}

const sorted = (values: Iterable<string>) => [...values].sort();

test("column names are the fields in snake case", () => {
  assert.equal(columnName("id"), "id");
  assert.equal(columnName("sampleReceivedDate"), "sample_received_date");
  assert.equal(columnName("w9FileId"), "w9_file_id");
  assert.equal(columnName("hasW9"), "has_w9");
});

test("every table starts with its id", () => {
  for (const def of Object.values(TABLES)) assert.equal(def.fields[0], "id", def.table);
});

test("every field a request can set has a column", () => {
  const cases: Array<[TableDef, string[]]> = [
    [TABLES.suppliers, Object.keys(supplierSchema.shape)],
    [TABLES.models, Object.keys(modelSchema.shape)],
    [TABLES.items, Object.keys(itemSchema.shape)],
    [TABLES.drawingSets, Object.keys(drawingSetSchema.shape).filter((key) => key !== "drawingItems")],
    [TABLES.drawingItems, [...Object.keys(drawingSetSchema.shape.drawingItems.removeDefault().element.shape), "drawingSetId", "position"]],
    [TABLES.projects, Object.keys(projectSchema.shape)],
    [TABLES.quotes, Object.keys(quoteSchema.shape)],
    [TABLES.sourceAssignments, Object.keys(sourceAssignmentSchema.shape)],
    [TABLES.inspections, Object.keys(inspectionSchema.shape)],
    [TABLES.incomingDefects, Object.keys(incomingDefectSchema.innerType().shape)],
    [TABLES.priceChanges, Object.keys(priceChangeSchema.shape)],
    [TABLES.purchasePrices, Object.keys(purchasePriceSchema.shape)],
  ];
  for (const [def, keys] of cases) assert.deepEqual(sorted(def.fields), sorted(["id", ...keys]), def.table);
});

test("case links and files, which have no request schema, keep every field", () => {
  const store = sampleStore();
  assert.deepEqual(sorted(TABLES.quoteCaseLinks.fields), sorted(Object.keys(store.quoteCaseLinks[0])));
  const { storagePath: _derived, ...file } = store.files[0];
  assert.deepEqual(sorted(TABLES.files.fields), sorted(Object.keys(file)));
});

test("every record maps to a row and back unchanged", () => {
  const store = sampleStore();
  const collections = [
    "suppliers", "models", "items", "projects", "quotes", "quoteCaseLinks", "sourceAssignments",
    "inspections", "incomingDefects", "priceChanges", "purchasePrices",
  ] as const;
  for (const collection of collections) {
    for (const record of store[collection]) assert.deepEqual(roundTrip(TABLES[collection], record), record, record.id);
  }
  for (const { drawingItems: _items, ...drawingSet } of store.drawingSets) {
    assert.deepEqual(roundTrip(TABLES.drawingSets, drawingSet), drawingSet);
  }
  for (const drawingItem of flattenDrawingItems(store.drawingSets)) {
    assert.deepEqual(roundTrip(TABLES.drawingItems, drawingItem), drawingItem);
  }
  for (const { storagePath: _derived, ...file } of store.files) assert.deepEqual(roundTrip(TABLES.files, file), file);
});

test("an absent optional field is stored as null and stays absent", () => {
  const minimal = sampleStore().quotes[1];
  const row = toRow(TABLES.quotes, minimal);
  assert.equal(row[TABLES.quotes.fields.indexOf("effectiveTo")], null);
  assert.equal("effectiveTo" in roundTrip(TABLES.quotes, minimal), false);
});

test("an explicit undefined is stored the same as an absent field", () => {
  const minimal = sampleStore().quotes[1];
  assert.deepEqual(toRow(TABLES.quotes, { ...minimal, effectiveTo: undefined }), toRow(TABLES.quotes, minimal));
});

test("false, zero and empty values are kept", () => {
  const supplier = roundTrip(TABLES.suppliers, sampleStore().suppliers[1]);
  assert.equal(supplier.hasW9, false);
  assert.equal(supplier.region, "");
  assert.deepEqual(supplier.capableItems, []);
  assert.equal(roundTrip(TABLES.quotes, sampleStore().quotes[1]).extraCostAmount, 0);
});

test("drawing items keep their set and their order", () => {
  const { drawingSets } = sampleStore();
  const rows = flattenDrawingItems(drawingSets);
  assert.deepEqual(
    rows.map((row) => [row.id, row.drawingSetId, row.position]),
    [["dwgitem-1001", "dwgset-1001", 0], ["dwgitem-1002", "dwgset-1001", 1]],
  );
  const setsWithoutItems = drawingSets.map(({ drawingItems: _items, ...drawingSet }) => drawingSet);
  assert.deepEqual(attachDrawingItems(setsWithoutItems, [...rows].reverse()), drawingSets);
});
