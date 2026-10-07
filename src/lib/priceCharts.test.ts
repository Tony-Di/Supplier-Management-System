import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuotePriceChartRows, quotePriceSeries } from "./priceCharts";
import type { Quote, Supplier } from "../types";

const appData = { suppliers: [{ id: "s1", name: "Legacy Paper" } as Supplier] };
const quote = (id: string, date: string, unitPrice: number, status: Quote["status"]) =>
  ({ id, supplierId: "s1", effectiveFrom: date, quoteDate: date, unitPrice, status }) as Quote;
const quotes = [quote("a", "2026-01-01", 10, "Selected"), quote("b", "2026-03-01", 14, "No Further Action"), quote("c", "2026-05-01", 11, "Selected")];

test("every quote stays in the trend: Selected ones on the price line, the rest as their own points", () => {
  assert.deepEqual(buildQuotePriceChartRows(appData, quotes, "All Quotes"), [
    { date: "2026-01-01", "Legacy Paper selected": 10 },
    { date: "2026-03-01", "Legacy Paper other quotes": 14 },
    { date: "2026-05-01", "Legacy Paper selected": 11 },
  ]);
  assert.deepEqual(quotePriceSeries(appData, quotes, "All Quotes"), ["Legacy Paper selected", "Legacy Paper other quotes"]);
});

test("Selected Quotes shows only the price line", () => {
  assert.deepEqual(buildQuotePriceChartRows(appData, quotes, "Selected Quotes"), [
    { date: "2026-01-01", "Legacy Paper selected": 10 },
    { date: "2026-05-01", "Legacy Paper selected": 11 },
  ]);
  assert.deepEqual(quotePriceSeries(appData, quotes, "Selected Quotes"), ["Legacy Paper selected"]);
});
