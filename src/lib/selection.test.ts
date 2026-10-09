import assert from "node:assert/strict";
import { test } from "node:test";
import { manualSelection } from "./selection";
import type { Quote, SampleInspection, Supplier } from "../types";

const quote = { id: "q-new", supplierId: "sup-1", itemId: "item-1" };

function data({ inspections = [], quotes = [], supplierSince }: { inspections?: Partial<SampleInspection>[]; quotes?: Partial<Quote>[]; supplierSince?: string } = {}) {
  return {
    suppliers: [{ id: "sup-1", supplierSince } as Supplier],
    inspections: inspections.map((inspection) => ({ supplierId: "sup-1", itemId: "item-1", result: "Pass", ...inspection }) as SampleInspection),
    quotes: quotes.map((other) => ({ supplierId: "sup-1", itemId: "item-1", status: "Selected", ...other }) as Quote),
  };
}

test("a supplier that passed QC for the item can be selected directly", () => {
  assert.equal(manualSelection(data({ inspections: [{}] }), quote, true), "Existing Supplier");
});

test("a supplier with an earlier Selected quote for the item can be selected directly", () => {
  assert.equal(manualSelection(data({ quotes: [{ id: "q-old" }] }), quote, true), "Existing Supplier");
});

test("the quote's own status, a voided record, a failed sample and another item do not count", () => {
  const records = data({
    quotes: [{ id: "q-new" }, { id: "q-void", recordState: "Void" }, { id: "q-other-item", itemId: "item-2" }],
    inspections: [{ result: "Fail" }, { recordState: "Void" }, { result: "Conditional" }, { itemId: "item-2" }],
  });
  assert.equal(manualSelection(records, quote, false), "Sample Required");
});

test("a supplier with a Since date can be selected on previous orders while that is switched on", () => {
  assert.equal(manualSelection(data({ supplierSince: "2023-04-01" }), quote, true), "Previous Orders");
  assert.equal(manualSelection(data({ supplierSince: "2023-04-01" }), quote, false), "Sample Required");
  assert.equal(manualSelection(data(), quote, true), "Sample Required");
});
