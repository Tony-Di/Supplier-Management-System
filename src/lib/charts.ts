import { type Quote } from "../types";

export function dashboardPriceDomain(visibleQuotes: Quote[]): [number, number] | ["auto", "auto"] {
  return priceAnalyticsDomain(visibleQuotes);
}

export function priceAnalyticsDomain(visibleQuotes: Quote[]): [number, number] | ["auto", "auto"] {
  const prices = visibleQuotes.map((quote) => quote.unitPrice).filter((price) => Number.isFinite(price));
  if (prices.length === 0) return ["auto", "auto"];

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= 1) return [0, 1];

  const range = max - min;
  const padding = range === 0 ? Math.max(max * 0.08, 0.5) : range * 0.18;
  const roughStep = Math.max((max + padding) / 8, 0.01);
  const stepMagnitude = 10 ** Math.floor(Math.log10(roughStep));
  const stepBase = roughStep / stepMagnitude;
  const step = stepBase <= 2 ? 2 * stepMagnitude : stepBase <= 5 ? 5 * stepMagnitude : 10 * stepMagnitude;
  const lower = Math.floor(Math.max(0, min - padding) / step) * step;
  const upper = Math.ceil((max + padding) / step) * step;

  return [lower, upper];
}

export function chartColor(index: number) {
  const palette = ["#d71920", "#25282d", "#8f2b31", "#6b7280", "#c84d52", "#3f4652", "#a84348", "#9ca3af"];
  return palette[index % palette.length];
}
