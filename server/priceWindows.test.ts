import assert from "node:assert/strict";
import { test } from "node:test";

import type { Quote } from "../src/types";
import { effectiveDateOrderError, overlappingPriceQuote, priceWindowError } from "./priceWindows";

function quote(id: string, effectiveFrom: string, effectiveTo?: string, patch: Partial<Quote> = {}): Quote {
  return {
    id,
    supplierId: "sup-1",
    itemId: "item-1",
    quoteDate: effectiveFrom,
    effectiveFrom,
    effectiveTo,
    status: "Selected",
    quoteReason: "New Quote",
    recordState: "Active",
    ...patch,
  } as Quote;
}

test("Effective To cannot fall before Effective From", () => {
  assert.equal(
    effectiveDateOrderError(quote("q1", "2026-07-01", "2026-06-30")),
    "Effective To (2026-06-30) must be on or after Effective From (2026-07-01).",
  );
});

test("a one-day price window and an open window are valid", () => {
  assert.equal(effectiveDateOrderError(quote("q1", "2026-07-01", "2026-07-01")), undefined);
  assert.equal(effectiveDateOrderError(quote("q1", "2026-07-01")), undefined);
});

test("a new price does not conflict with the open price it replaces", () => {
  const current = quote("q1", "2026-01-01");
  const next = quote("q2", "2026-07-01");
  assert.equal(overlappingPriceQuote(next, [current, next]), undefined);
});

test("extending a price into the next price's window is a conflict", () => {
  const current = quote("q1", "2026-01-01", "2026-08-31");
  const next = quote("q2", "2026-07-01");
  assert.equal(overlappingPriceQuote(current, [current, next])?.id, "q2");
});

test("a bounded price that ends before the next one starts does not conflict", () => {
  const current = quote("q1", "2026-01-01", "2026-06-30");
  const next = quote("q2", "2026-07-01");
  assert.equal(overlappingPriceQuote(current, [current, next]), undefined);
});

test("two prices starting on the same day conflict", () => {
  const first = quote("q1", "2026-01-01");
  const second = quote("q2", "2026-01-01");
  assert.equal(overlappingPriceQuote(second, [first, second])?.id, "q1");
});

test("quotes that are only offers do not hold a price window", () => {
  const current = quote("q1", "2026-01-01", "2026-12-31");
  const offer = quote("q2", "2026-03-01", undefined, { status: "Received" });
  assert.equal(overlappingPriceQuote(current, [current, offer]), undefined);
  assert.equal(overlappingPriceQuote(offer, [current, offer]), undefined);
});

test("a requote holds a price window even before it is selected", () => {
  const current = quote("q1", "2026-01-01", "2026-12-31");
  const requote = quote("q2", "2026-03-01", "2026-04-30", { status: "Received", quoteReason: "Requote" });
  assert.equal(overlappingPriceQuote(current, [current, requote])?.id, "q2");
});

test("voided quotes and other suppliers or items are ignored", () => {
  const current = quote("q1", "2026-01-01", "2026-12-31");
  const others = [
    quote("q2", "2026-03-01", undefined, { recordState: "Void" }),
    quote("q3", "2026-03-01", undefined, { supplierId: "sup-2" }),
    quote("q4", "2026-03-01", undefined, { itemId: "item-2" }),
  ];
  assert.equal(overlappingPriceQuote(current, [current, ...others]), undefined);
});

const describe = (candidate: Quote) => `quote ${candidate.id}`;

test("saving a quote checks the order of its dates", () => {
  const inverted = quote("q1", "2026-07-01", "2026-06-30");
  assert.match(priceWindowError(inverted, [inverted], { describe }) ?? "", /must be on or after Effective From/);
});

test("a new quote that overlaps an existing price is refused and names it", () => {
  const later = quote("q1", "2026-07-01");
  const backdated = quote("new", "2026-03-01");
  assert.equal(
    priceWindowError(backdated, [later], { describe }),
    "This price overlaps quote q1, effective 2026-07-01 to no end date. Change Effective From or Effective To so the two prices do not overlap.",
  );
});

test("a new quote can set Effective To without giving a reason", () => {
  const next = quote("new", "2026-07-01", "2026-12-31");
  assert.equal(priceWindowError(next, [quote("q1", "2026-01-01")], { describe }), undefined);
});

test("changing Effective To on a saved quote needs a reason", () => {
  const before = quote("q1", "2026-01-01", "2026-06-30");
  const after = { ...before, effectiveTo: "2026-05-31" };
  assert.equal(priceWindowError(after, [before], { before, describe }), "Enter a reason for changing Effective To.");
  assert.equal(priceWindowError(after, [before], { before, changeReason: "  ", describe }), "Enter a reason for changing Effective To.");
  assert.equal(priceWindowError(after, [before], { before, changeReason: "Supplier notice", describe }), undefined);
});

test("editing other fields does not re-check an overlap that already exists", () => {
  const before = quote("q1", "2026-01-01", "2026-12-31");
  const existing = quote("q2", "2026-07-01");
  const after = { ...before, notes: "MOQ confirmed" };
  assert.equal(priceWindowError(after, [before, existing], { before, describe }), undefined);
});

test("selecting an offer whose window overlaps a current price is refused", () => {
  const current = quote("q1", "2026-07-01");
  const before = quote("q2", "2026-03-01", undefined, { status: "Under Review" });
  const after = { ...before, status: "Selected" as const };
  assert.match(priceWindowError(after, [current, before], { before, describe }) ?? "", /overlaps quote q1/);
});
