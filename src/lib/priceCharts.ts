import { type AppData } from "../api";
import { type Quote } from "../types";
import { supplierName } from "./lookups";
import { isSelectedQuote } from "./sourcing";

export type PriceTrendSource = "All Quotes" | "Selected Quotes";

/** The series a quote is drawn in: Selected quotes form the supplier's price line; any other quote is a point of its own, shown with All Quotes. */
function priceSeriesFor(appData: Pick<AppData, "suppliers">, quote: Quote, source: PriceTrendSource) {
  const name = supplierName(appData, quote.supplierId);
  if (isSelectedQuote(quote)) return `${name} selected`;
  return source === "All Quotes" ? `${name} other quotes` : undefined;
}

export function quotePriceSeries(appData: Pick<AppData, "suppliers">, quotes: Quote[], source: PriceTrendSource) {
  return Array.from(new Set(quotes.map((quote) => priceSeriesFor(appData, quote, source)).filter((series): series is string => Boolean(series))));
}

export function buildQuotePriceChartRows(appData: Pick<AppData, "suppliers">, quotes: Quote[], source: PriceTrendSource) {
  const rows = new Map<string, Record<string, string | number>>();
  for (const quote of quotes) {
    const series = priceSeriesFor(appData, quote, source);
    if (!series) continue;
    const date = quote.effectiveFrom ?? quote.quoteDate;
    const row = rows.get(date) ?? { date };
    row[series] = quote.unitPrice;
    rows.set(date, row);
  }
  return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function buildDashboardPriceTrendRows(appData: Pick<AppData, "suppliers">, visibleQuotes: Quote[]) {
  const rows = new Map<string, Record<string, string | number>>();

  for (const quote of visibleQuotes) {
    const date = quote.effectiveFrom ?? quote.quoteDate;
    const row = rows.get(date) ?? { date };
    row[supplierName(appData, quote.supplierId)] = quote.unitPrice;
    rows.set(date, row);
  }

  return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
