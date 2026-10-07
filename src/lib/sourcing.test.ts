import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDispositionForResult } from "./sourcing";

test("a conditional sample needs another round by default", () => {
  assert.equal(defaultDispositionForResult("Conditional"), "Re-sample Required");
  assert.equal(defaultDispositionForResult("Fail"), "Re-sample Required");
  assert.equal(defaultDispositionForResult("Pass"), "Accepted");
});
