import { type AppData } from "../api";
import { type Quote } from "../types";
import { itemCode, supplierName } from "./lookups";
import { isSelectedQuote } from "./sourcing";

export type PriceTrendSource = "All Quotes" | "Selected Quotes";

/** A date as UTC midnight, so a time-scaled axis spaces points by the days between them. */
export function chartTime(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function quoteDate(quote: Quote) {
  return quote.effectiveFrom ?? quote.quoteDate;
}

/**
 * The series a quote is drawn in, one per supplier and item so that one
 * supplier's items never share a line: Selected quotes form the price line;
 * any other quote is a point of its own, shown with All Quotes.
 */
function priceSeriesFor(appData: Pick<AppData, "suppliers" | "items">, quote: Quote, source: PriceTrendSource) {
  const name = `${supplierName(appData, quote.supplierId)} · ${itemCode(appData, quote.itemId)}`;
  if (isSelectedQuote(quote)) return `${name} selected`;
  return source === "All Quotes" ? `${name} other quotes` : undefined;
}

export function quotePriceSeries(appData: Pick<AppData, "suppliers" | "items">, quotes: Quote[], source: PriceTrendSource) {
  return Array.from(new Set(quotes.map((quote) => priceSeriesFor(appData, quote, source)).filter((series): series is string => Boolean(series))));
}

export function buildQuotePriceChartRows(appData: Pick<AppData, "suppliers" | "items">, quotes: Quote[], source: PriceTrendSource) {
  const rows = new Map<string, Record<string, string | number>>();
  for (const quote of quotes) {
    const series = priceSeriesFor(appData, quote, source);
    if (!series) continue;
    const date = quoteDate(quote);
    const row = rows.get(date) ?? { date, time: chartTime(date) };
    row[series] = quote.unitPrice;
    rows.set(date, row);
  }
  return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function buildDashboardPriceTrendRows(appData: Pick<AppData, "suppliers">, visibleQuotes: Quote[]) {
  const rows = new Map<string, Record<string, string | number>>();

  for (const quote of visibleQuotes) {
    const date = quoteDate(quote);
    const row = rows.get(date) ?? { date, time: chartTime(date) };
    row[supplierName(appData, quote.supplierId)] = quote.unitPrice;
    rows.set(date, row);
  }

  const sortedRows = Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // A Selected price holds until its Effective To, so each supplier's line
  // carries its latest price across later dates instead of ending in a lone point.
  for (const row of sortedRows) {
    const date = String(row.date);
    for (const supplierId of new Set(visibleQuotes.map((quote) => quote.supplierId))) {
      const name = supplierName(appData, supplierId);
      if (row[name] !== undefined) continue;
      const latest = visibleQuotes
        .filter((quote) => quote.supplierId === supplierId && quoteDate(quote) <= date)
        .sort((a, b) => quoteDate(b).localeCompare(quoteDate(a)))[0];
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= date)) row[name] = latest.unitPrice;
    }
  }
  return sortedRows;
}
