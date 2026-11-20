import assert from "node:assert/strict";
import { test } from "node:test";

import { pageOf } from "./paging";

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

test("a list that fits on one page comes back whole", () => {
  const rows = numbers(50);
  const page = pageOf(rows, 1);
  assert.equal(page.rows, rows);
  assert.deepEqual({ page: page.page, pageCount: page.pageCount, first: page.first, last: page.last }, { page: 1, pageCount: 1, first: 1, last: 50 });
});

test("a longer list is cut into pages", () => {
  const page = pageOf(numbers(120), 2);
  assert.deepEqual(page.rows, numbers(100).slice(50));
  assert.deepEqual({ page: page.page, pageCount: page.pageCount, total: page.total, first: page.first, last: page.last }, { page: 2, pageCount: 3, total: 120, first: 51, last: 100 });
  assert.deepEqual(pageOf(numbers(120), 3).rows, numbers(120).slice(100));
});

test("a page past either end shows the nearest page", () => {
  assert.equal(pageOf(numbers(120), 9).page, 3);
  assert.equal(pageOf(numbers(120), 0).page, 1);
  assert.equal(pageOf(numbers(120), Number.NaN).page, 1);
});

test("an empty list is one empty page", () => {
  assert.deepEqual(pageOf([], 1), { rows: [], page: 1, pageCount: 1, total: 0, first: 0, last: 0 });
});
