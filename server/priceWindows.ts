import type { Quote } from "../src/types";

type PriceQuote = Pick<
  Quote,
  "id" | "supplierId" | "itemId" | "quoteDate" | "effectiveFrom" | "effectiveTo" | "status" | "quoteReason" | "previousQuoteId" | "recordState"
>;

const OPEN_END = "9999-12-31";

function startOf(quote: PriceQuote) {
  return quote.effectiveFrom ?? quote.quoteDate;
}

/** A quote that sets the supplier's price for the item, as opposed to one that is only an offer. */
export function isEffectivePriceQuote(quote: PriceQuote): boolean {
  return quote.status === "Selected" || quote.quoteReason === "Requote" || quote.quoteReason === "Change Work Order";
}

/** The price this quote replaces: the linked previous quote, or the latest earlier price still open on its start date. */
export function findPreviousEffectiveQuote<T extends PriceQuote>(quote: PriceQuote, quotes: T[]): T | undefined {
  const start = startOf(quote);
  const linked = quote.previousQuoteId
    ? quotes.find(
        (candidate) =>
          candidate.id === quote.previousQuoteId &&
          candidate.recordState !== "Void" &&
          candidate.supplierId === quote.supplierId &&
          candidate.itemId === quote.itemId,
      )
    : undefined;
  return (
    linked ??
    [...quotes]
      .filter(
        (candidate) =>
          candidate.id !== quote.id &&
          candidate.supplierId === quote.supplierId &&
          candidate.itemId === quote.itemId &&
          candidate.recordState !== "Void" &&
          isEffectivePriceQuote(candidate) &&
          (!candidate.effectiveTo || candidate.effectiveTo >= start) &&
          startOf(candidate) < start,
      )
      .sort((a, b) => startOf(b).localeCompare(startOf(a)))[0]
  );
}

export function effectiveDateOrderError(quote: PriceQuote): string | undefined {
  const start = startOf(quote);
  if (quote.effectiveTo && quote.effectiveTo < start) {
    return `Effective To (${quote.effectiveTo}) must be on or after Effective From (${start}).`;
  }
  return undefined;
}

/**
 * Another price for the same supplier and item whose window overlaps this
 * quote's. The price this quote replaces is not a conflict when it starts
 * earlier, because saving closes it the day before this quote starts.
 */
export function overlappingPriceQuote<T extends PriceQuote>(quote: PriceQuote, quotes: T[]): T | undefined {
  if (!isEffectivePriceQuote(quote)) return undefined;
  const start = startOf(quote);
  const end = quote.effectiveTo ?? OPEN_END;
  const previous = findPreviousEffectiveQuote(quote, quotes);
  const closedOnSave = previous && startOf(previous) < start ? previous : undefined;
  return quotes.find(
    (candidate) =>
      candidate.id !== quote.id &&
      candidate !== closedOnSave &&
      candidate.recordState !== "Void" &&
      candidate.supplierId === quote.supplierId &&
      candidate.itemId === quote.itemId &&
      isEffectivePriceQuote(candidate) &&
      startOf(candidate) <= end &&
      start <= (candidate.effectiveTo ?? OPEN_END),
  );
}

function priceWindowKey(quote: PriceQuote) {
  return [quote.supplierId, quote.itemId, startOf(quote), quote.effectiveTo ?? "", isEffectivePriceQuote(quote)].join("|");
}

/**
 * Why a quote cannot be saved with its price window, if it cannot. `before` is
 * the saved quote when editing. Overlaps are checked when the window is new or
 * has changed, so an overlap already in the data does not block unrelated
 * edits. A changed Effective To needs a reason for the audit trail.
 */
export function priceWindowError<T extends PriceQuote>(
  quote: PriceQuote,
  quotes: T[],
  options: { before?: PriceQuote; changeReason?: string; describe: (quote: T) => string },
): string | undefined {
  const orderError = effectiveDateOrderError(quote);
  if (orderError) return orderError;

  const { before } = options;
  if (before && before.effectiveTo !== quote.effectiveTo && !options.changeReason?.trim()) {
    return "Enter a reason for changing Effective To.";
  }
  if (before && priceWindowKey(before) === priceWindowKey(quote)) return undefined;

  const conflict = overlappingPriceQuote(quote, quotes);
  if (!conflict) return undefined;
  return (
    `This price overlaps ${options.describe(conflict)}, effective ${startOf(conflict)} to ${conflict.effectiveTo ?? "no end date"}. ` +
    "Change Effective From or Effective To so the two prices do not overlap."
  );
}
