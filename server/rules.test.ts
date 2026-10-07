import assert from "node:assert/strict";
import { test } from "node:test";

import { isUsableRecord } from "./rules";

test("an active record can be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Active" }), true);
});

test("a draft record can be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Draft" }), true);
});

test("a record without a lifecycle state can be referenced", () => {
  assert.equal(isUsableRecord({}), true);
});

test("a voided record cannot be referenced", () => {
  assert.equal(isUsableRecord({ recordState: "Void" }), false);
});

test("a missing record cannot be referenced", () => {
  assert.equal(isUsableRecord(undefined), false);
});
