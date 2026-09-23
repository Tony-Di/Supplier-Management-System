import assert from "node:assert/strict";
import { test } from "node:test";
import { supplierName } from "./lookups";
import { buildDashboardPriceTrendRows } from "./priceCharts";
import type { Quote, Supplier } from "../types";

test("interleaved data snapshots never leak supplier names into charts", () => {
  const first = { suppliers: [{ id: "s", name: "First" }] as Supplier[] };
  const second = { suppliers: [{ id: "s", name: "Second" }] as Supplier[] };
  const quotes = [{ supplierId: "s", quoteDate: "2026-09-01", unitPrice: 2 }] as Quote[];
  assert.equal(supplierName(first, "s"), "First");
  assert.deepEqual(buildDashboardPriceTrendRows(second, quotes), [{ date: "2026-09-01", Second: 2 }]);
  assert.deepEqual(buildDashboardPriceTrendRows(first, quotes), [{ date: "2026-09-01", First: 2 }]);
});
