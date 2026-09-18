import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLeadTimeDays } from "./leadTime";

test("reads a plain day value", () => {
  assert.equal(parseLeadTimeDays("14 Days "), 14);
});

test("treats a bare number as days", () => {
  assert.equal(parseLeadTimeDays("14"), 14);
});

test("converts weeks to days", () => {
  assert.equal(parseLeadTimeDays("3 weeks"), 21);
});

test("converts months to days", () => {
  assert.equal(parseLeadTimeDays("1 month"), 30);
});

test("takes the upper bound of a range", () => {
  assert.equal(parseLeadTimeDays("4 - 5 weeks"), 35);
});

test("takes the upper bound of a written range", () => {
  assert.equal(parseLeadTimeDays("2 to 3 weeks"), 21);
});

test("converts business days to calendar days", () => {
  assert.equal(parseLeadTimeDays("8 business days"), 11);
});

test("reads abbreviated units", () => {
  assert.equal(parseLeadTimeDays("6 wks"), 42);
});

test("rounds a fractional value", () => {
  assert.equal(parseLeadTimeDays("1.5 weeks"), 11);
});

test("returns undefined when there is no number", () => {
  assert.equal(parseLeadTimeDays("TBD"), undefined);
});

test("returns undefined for empty and missing values", () => {
  assert.equal(parseLeadTimeDays(""), undefined);
  assert.equal(parseLeadTimeDays(undefined), undefined);
});
