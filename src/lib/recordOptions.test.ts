import assert from "node:assert/strict";
import { test } from "node:test";
import { availableRecordOptions, voidedReferenceMessage } from "./recordOptions";
import { fallbackData } from "../appDefaults";
import type { AppData } from "../api";
import type { EditTarget } from "../uiTypes";

test("all record pickers exclude voided records while retaining active, draft and legacy records", () => {
  const data = structuredClone(fallbackData);
  const keys = ["suppliers", "models", "items", "projects", "quotes", "inspections", "incomingDefects", "priceChanges", "purchasePrices", "sourceAssignments", "quoteCaseLinks"] as const;
  for (const key of keys) (data[key] as unknown[]) = [{ id: "active", recordState: "Active" }, { id: "draft", recordState: "Draft" }, { id: "legacy" }, { id: "void", recordState: "Void" }];
  data.drawingSets = [{ id: "active", drawingItems: [{ itemId: "active" }, { itemId: "void" }] }, { id: "void", recordState: "Void", drawingItems: [] }] as AppData["drawingSets"];
  const before = structuredClone(data);
  const options = availableRecordOptions(data);
  for (const key of keys) assert.deepEqual(options[key].map((record) => record.id), ["active", "draft", "legacy"]);
  assert.equal(options.drawingSets.length, 1);
  assert.deepEqual(options.drawingSets[0].drawingItems.map((item) => item.itemId), ["active"]);
  assert.deepEqual(data, before, "picker filtering must not mutate historical data");
});

test("editing an old quote with a now-voided supplier explains the backend restriction", () => {
  const data = { ...fallbackData, suppliers: [{ id: "supplier", recordState: "Void" }] } as AppData;
  assert.match(voidedReferenceMessage(data, { endpoint: "quotes", record: { supplierId: "supplier" } } as EditTarget) ?? "", /Supplier is voided/);
});
