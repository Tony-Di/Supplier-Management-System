import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quote } from "../src/types";
import { buildScorecard, reconcileQuotePriceChanges, syncReusableQuotesForProject } from "./business";
import { createContext } from "./context";
import { emptyStore } from "./storeShape";
import { sampleStore } from "./testFixtures";

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

test("a conditional sample does not spare a case another sample", () => {
  const linkFor = (result: "Pass" | "Conditional") => {
    const store = sampleStore();
    store.projects[0].openDate = "2026-03-01";
    store.inspections[0].result = result;
    syncReusableQuotesForProject(createContext(store, new Map(), undefined), store.projects[0]);
    return store.quoteCaseLinks[0].sampleRequirement;
  };
  assert.equal(linkFor("Pass"), "Not Required - Existing QC Pass");
  assert.notEqual(linkFor("Conditional"), "Not Required - Existing QC Pass");
});

test("a conditional sample adds nothing to the sample quality score", () => {
  const store = sampleStore();
  store.inspections.push({ ...store.inspections[0], id: "ins-1002", sampleRound: 3, result: "Conditional", disposition: "Re-sample Required" });
  const row = buildScorecard(store).rows.find((candidate) => candidate.supplier.id === "sup-1001");
  const sampleQuality = row?.categories[0].children?.find((child) => child.key === "sampleQuality");
  // Weight 30: one pass in two reviewed samples is half of 25 scaled points, plus 5 for having a pass.
  assert.equal(sampleQuality?.score, 18);
});
