import assert from "node:assert/strict";
import { test } from "node:test";

import { csrfHeaders } from "./api";

test("mutating requests carry the csrf token", () => {
  assert.deepEqual(csrfHeaders("POST", "token-123"), { "X-CSRF-Token": "token-123" });
});

test("read-only requests carry no csrf token", () => {
  assert.deepEqual(csrfHeaders("GET", "token-123"), {});
});

test("a missing token adds no header", () => {
  assert.deepEqual(csrfHeaders("POST", ""), {});
});
