import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreIncomingQuality, scoreLeadTime, scorePaymentTerms, scoreResponsiveness, scoreScopeFit } from "./scoring";

const responsive = { quoteCount: 2, averageLeadTime: 10, selectedQuotes: 1 };
const slow = { quoteCount: 2, averageLeadTime: 20, selectedQuotes: 0 };

test("default weights keep the existing responsiveness points", () => {
  assert.equal(scoreResponsiveness(responsive, 15), 15);
  assert.equal(scoreResponsiveness(slow, 15), 8);
  assert.equal(scoreResponsiveness({ quoteCount: 0, averageLeadTime: undefined, selectedQuotes: 0 }, 15), 0);
});

test("a raised responsiveness weight can be earned in full", () => {
  assert.equal(scoreResponsiveness(responsive, 30), 30);
  assert.equal(scoreResponsiveness(slow, 30), 16);
});

test("default weights keep the existing scope points", () => {
  assert.equal(scoreScopeFit({ declaredTypes: 2, quotedDeclaredTypes: 1, passedDeclaredTypes: 1 }, 10), 10);
  assert.equal(scoreScopeFit({ declaredTypes: 2, quotedDeclaredTypes: 0, passedDeclaredTypes: 0 }, 10), 4);
});

test("a raised scope weight can be earned in full", () => {
  assert.equal(scoreScopeFit({ declaredTypes: 2, quotedDeclaredTypes: 1, passedDeclaredTypes: 1 }, 20), 20);
  assert.equal(scoreScopeFit({ declaredTypes: 2, quotedDeclaredTypes: 0, passedDeclaredTypes: 0 }, 20), 8);
});

test("a zero weight scores nothing", () => {
  assert.equal(scoreResponsiveness(responsive, 0), 0);
  assert.equal(scoreScopeFit({ declaredTypes: 2, quotedDeclaredTypes: 1, passedDeclaredTypes: 1 }, 0), 0);
});

test("incoming quality keeps its defect-quantity thresholds", () => {
  assert.deepEqual([4, 5, 9, 10, 19, 20].map((qty) => scoreIncomingQuality(qty, 20)), [20, 15, 15, 9, 9, 3]);
});

test("missing lead times and payment terms earn no credit", () => {
  assert.equal(scoreLeadTime(undefined, 10), 0);
  assert.equal(scoreLeadTime(21, 10), 6);
  assert.equal(scorePaymentTerms("", 10), 0);
  assert.equal(scorePaymentTerms("Net 60", 10), 10);
});
