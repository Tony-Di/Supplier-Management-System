import { type AppData } from "../api";
import { type Quote } from "../types";
import { supplierName } from "./lookups";
import { isSelectedQuote } from "./sourcing";

export function buildQuotePriceChartRows(appData: Pick<AppData, "suppliers">, visibleQuotes: Quote[], includeAllQuoteSeries: boolean, includeSelectedSeries: boolean) {
  const rows = new Map<string, Record<string, string | number>>();
  const ensureRow = (date: string) => {
    const row = rows.get(date) ?? { date };
    rows.set(date, row);
    return row;
  };

  for (const quote of visibleQuotes) {
    const date = quote.effectiveFrom ?? quote.quoteDate;
    if (includeAllQuoteSeries) {
      ensureRow(date)[`${supplierName(appData, quote.supplierId)} all quotes`] = quote.unitPrice;
    }
    if (includeSelectedSeries && isSelectedQuote(quote)) {
      ensureRow(date)[`${supplierName(appData, quote.supplierId)} selected`] = quote.unitPrice;
    }
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
