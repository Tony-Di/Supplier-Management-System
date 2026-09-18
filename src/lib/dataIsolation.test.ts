import assert from "node:assert/strict";
import { test } from "node:test";
import { supplierName } from "./lookups";
import { buildDashboardPriceTrendRows } from "./priceCharts";
import { quotePriceCompetitiveness } from "./scorecard";
import type { Quote, Supplier } from "../types";

test("interleaved data snapshots never leak supplier names into charts", () => {
  const first = { suppliers: [{ id: "s", name: "First" }] as Supplier[] };
  const second = { suppliers: [{ id: "s", name: "Second" }] as Supplier[] };
  const quotes = [{ supplierId: "s", quoteDate: "2026-09-01", unitPrice: 2 }] as Quote[];
  assert.equal(supplierName(first, "s"), "First");
  assert.deepEqual(buildDashboardPriceTrendRows(second, quotes), [{ date: "2026-09-01", Second: 2 }]);
  assert.deepEqual(buildDashboardPriceTrendRows(first, quotes), [{ date: "2026-09-01", First: 2 }]);
});

test("pricing competitiveness uses only the explicitly supplied quote set", () => {
  const quote = { id: "q", itemId: "i", unitPrice: 100 } as Quote;
  assert.equal(quotePriceCompetitiveness({ quotes: [quote] }, quote), 1);
  assert.equal(quotePriceCompetitiveness({ quotes: [quote, { ...quote, id: "cheaper", unitPrice: 50 }] }, quote), 0.3);
  assert.equal(quotePriceCompetitiveness({ quotes: [quote] }, quote), 1);
});
