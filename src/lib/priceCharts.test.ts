import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardPriceTrendRows, buildQuotePriceChartRows, chartTime, quotePriceSeries } from "./priceCharts";
import type { PackagingItem, Quote, Supplier } from "../types";

const appData = {
  suppliers: [{ id: "s1", name: "Legacy Paper" } as Supplier],
  items: [{ id: "i1", itemCode: "PCP-01" } as PackagingItem, { id: "i2", itemCode: "LPP-01" } as PackagingItem],
};
const quote = (id: string, date: string, unitPrice: number, status: Quote["status"], itemId = "i1") =>
  ({ id, supplierId: "s1", itemId, effectiveFrom: date, quoteDate: date, unitPrice, status }) as Quote;
const quotes = [quote("a", "2026-01-01", 10, "Selected"), quote("b", "2026-03-01", 14, "No Further Action"), quote("c", "2026-05-01", 11, "Selected")];

test("every quote stays in the trend: Selected ones on the price line, the rest as their own points", () => {
  assert.deepEqual(buildQuotePriceChartRows(appData, quotes, "All Quotes"), [
    { date: "2026-01-01", time: chartTime("2026-01-01"), "Legacy Paper · PCP-01 selected": 10 },
    { date: "2026-03-01", time: chartTime("2026-03-01"), "Legacy Paper · PCP-01 other quotes": 14 },
    { date: "2026-05-01", time: chartTime("2026-05-01"), "Legacy Paper · PCP-01 selected": 11 },
  ]);
  assert.deepEqual(quotePriceSeries(appData, quotes, "All Quotes"), ["Legacy Paper · PCP-01 selected", "Legacy Paper · PCP-01 other quotes"]);
});

test("Selected Quotes shows only the price line", () => {
  assert.deepEqual(buildQuotePriceChartRows(appData, quotes, "Selected Quotes"), [
    { date: "2026-01-01", time: chartTime("2026-01-01"), "Legacy Paper · PCP-01 selected": 10 },
    { date: "2026-05-01", time: chartTime("2026-05-01"), "Legacy Paper · PCP-01 selected": 11 },
  ]);
  assert.deepEqual(quotePriceSeries(appData, quotes, "Selected Quotes"), ["Legacy Paper · PCP-01 selected"]);
});

test("one supplier's items get separate lines, so same-day prices do not overwrite each other", () => {
  const sameDay = [quote("a", "2025-11-01", 0.42, "Selected", "i1"), quote("b", "2025-11-01", 0.86, "Selected", "i2")];
  assert.deepEqual(buildQuotePriceChartRows(appData, sameDay, "Selected Quotes"), [
    { date: "2025-11-01", time: chartTime("2025-11-01"), "Legacy Paper · PCP-01 selected": 0.42, "Legacy Paper · LPP-01 selected": 0.86 },
  ]);
  assert.deepEqual(quotePriceSeries(appData, sameDay, "Selected Quotes"), ["Legacy Paper · PCP-01 selected", "Legacy Paper · LPP-01 selected"]);
});

test("trend rows carry a time value so the axis spaces dates by the days between them", () => {
  const rows = buildDashboardPriceTrendRows(appData, [quote("a", "2025-11-01", 15.2, "Selected"), quote("b", "2026-04-01", 14.6, "Selected")]);
  assert.deepEqual(rows.map((row) => row.time), [Date.UTC(2025, 10, 1), Date.UTC(2026, 3, 1)]);
});

test("a supplier's Selected price carries across later dates until its Effective To", () => {
  const twoSuppliers = { suppliers: [{ id: "s1", name: "Legacy Paper" }, { id: "s2", name: "Pacific Pallet" }] as Supplier[] };
  const rows = buildDashboardPriceTrendRows(twoSuppliers, [
    { ...quote("a", "2026-10-01", 13.25, "Selected"), effectiveTo: "2026-12-19" },
    { ...quote("b", "2026-11-15", 14, "Selected"), supplierId: "s2" },
    quote("c", "2026-12-20", 12.9, "Selected"),
  ]);
  assert.deepEqual(rows.map(({ date, "Legacy Paper": legacy, "Pacific Pallet": pacific }) => [date, legacy, pacific]), [
    ["2026-10-01", 13.25, undefined],
    ["2026-11-15", 13.25, 14],
    ["2026-12-20", 12.9, 14],
  ]);
});

test("the trend runs to today, so a single price in effect draws a line", () => {
  const rows = buildDashboardPriceTrendRows(appData, [quote("a", "2026-10-01", 14.75, "Selected")], "2026-10-30");
  assert.deepEqual(rows, [
    { date: "2026-10-01", time: chartTime("2026-10-01"), "Legacy Paper": 14.75 },
    { date: "2026-10-30", time: chartTime("2026-10-30"), "Legacy Paper": 14.75 },
  ]);
});

test("a price that starts after today adds no today point", () => {
  assert.equal(buildDashboardPriceTrendRows(appData, [quote("a", "2026-11-01", 14.75, "Selected")], "2026-10-30").length, 1);
});

test("an ended price is not carried past its Effective To", () => {
  const twoSuppliers = { suppliers: [{ id: "s1", name: "Legacy Paper" }, { id: "s2", name: "Pacific Pallet" }] as Supplier[] };
  const rows = buildDashboardPriceTrendRows(twoSuppliers, [
    { ...quote("a", "2026-10-01", 13.25, "Selected"), effectiveTo: "2026-10-31" },
    { ...quote("b", "2026-11-15", 14, "Selected"), supplierId: "s2" },
  ]);
  assert.equal(rows[1]["Legacy Paper"], undefined);
});
