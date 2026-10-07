import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quote } from "../src/types";
import { reconcileQuotePriceChanges } from "./business";
import { createContext } from "./context";
import { emptyStore } from "./storeShape";

function priceQuote(id: string, effectiveFrom: string, unitPrice: number, patch: Partial<Quote> = {}): Quote {
  return {
    id,
    recordState: "Active",
    supplierId: "sup-1",
    quoteType: "Standalone",
    quoteReason: "New Quote",
    modelId: "model-1",
    itemId: "item-1",
    drawingSetId: "dwgset-1",
    drawingItemId: "dwgitem-1",
    quoteDate: effectiveFrom,
    effectiveFrom,
    currency: "USD",
    uom: "pcs",
    unitPrice,
    moq: "100",
    leadTime: "14 days",
    status: "Selected",
    notes: "",
    ...patch,
  };
}

function reconciled(quotes: Quote[]) {
  const store = emptyStore();
  store.quotes = quotes;
  const ctx = createContext(store, new Map(), undefined);
  reconcileQuotePriceChanges(ctx);
  return { store, reconcileAgain: () => reconcileQuotePriceChanges(ctx) };
}

const activeChanges = (store: ReturnType<typeof emptyStore>) =>
  store.priceChanges.filter((change) => change.recordState !== "Void").map((change) => [change.sourceQuoteId, change.previousQuoteId]);

test("a new Selected price closes the previous one and remembers which quote closed it", () => {
  const { store } = reconciled([priceQuote("q1", "2026-01-01", 10), priceQuote("q2", "2026-07-01", 12)]);
  assert.equal(store.quotes[0].effectiveTo, "2026-06-30");
  assert.equal(store.quotes[0].closedByQuoteId, "q2");
  assert.deepEqual(activeChanges(store), [["q2", "q1"]]);
});

test("a requote that is not Selected leaves the current price open", () => {
  const { store } = reconciled([priceQuote("q1", "2026-01-01", 10), priceQuote("q2", "2026-07-01", 12, { status: "Received", quoteReason: "Requote" })]);
  assert.equal(store.quotes[0].effectiveTo, undefined);
  assert.deepEqual(activeChanges(store), []);
});

test("a quote that stops being Selected reopens the price it closed and voids its pending price change", () => {
  const { store, reconcileAgain } = reconciled([priceQuote("q1", "2026-01-01", 10), priceQuote("q2", "2026-07-01", 12)]);
  store.quotes[1].status = "No Further Action";
  reconcileAgain();
  assert.equal(store.quotes[0].effectiveTo, undefined);
  assert.equal(store.quotes[0].closedByQuoteId, undefined);
  assert.deepEqual(store.priceChanges.map((change) => [change.recordState, change.voidReason]), [["Void", "Quote no longer selected"]]);
});

test("an approved price change stays when its quote stops being Selected", () => {
  const { store, reconcileAgain } = reconciled([priceQuote("q1", "2026-01-01", 10), priceQuote("q2", "2026-07-01", 12)]);
  store.priceChanges[0].status = "Approved";
  store.quotes[1].status = "No Further Action";
  reconcileAgain();
  assert.equal(store.priceChanges[0].recordState, undefined);
});

test("a price that ended before the next one started is not reopened", () => {
  const { store, reconcileAgain } = reconciled([priceQuote("q1", "2026-01-01", 10, { effectiveTo: "2026-05-31" }), priceQuote("q2", "2026-07-01", 12)]);
  store.quotes[1].status = "No Further Action";
  reconcileAgain();
  assert.equal(store.quotes[0].effectiveTo, "2026-05-31");
});

test("when the middle price stops being Selected, the next price closes the one before it", () => {
  const { store, reconcileAgain } = reconciled([priceQuote("a1", "2026-01-01", 10), priceQuote("a2", "2026-04-01", 11), priceQuote("a3", "2026-07-01", 12)]);
  assert.deepEqual(activeChanges(store), [["a2", "a1"], ["a3", "a2"]]);
  store.quotes[1].status = "No Further Action";
  reconcileAgain();
  const [a1, , a3] = store.quotes;
  assert.equal(a3.previousQuoteId, "a1");
  assert.deepEqual([a1.effectiveTo, a1.closedByQuoteId], ["2026-06-30", "a3"]);
  assert.deepEqual(activeChanges(store), [["a3", "a1"]]);
});
