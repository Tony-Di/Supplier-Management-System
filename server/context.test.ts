import assert from "node:assert/strict";
import { test } from "node:test";

import { createContext } from "./context";
import { emptyStore } from "./storeShape";

test("nextId continues from the stored counter, and a new prefix starts after 1000", () => {
  const ctx = createContext(emptyStore(), new Map([["sup", 1004]]), undefined);
  assert.equal(ctx.nextId("sup"), "sup-1005");
  assert.equal(ctx.nextId("sup"), "sup-1006");
  assert.equal(ctx.nextId("q"), "q-1001");
  assert.deepEqual(ctx.changedCounters(), [["sup", 1006], ["q", 1001]]);
});

test("an untouched counter is not reported as changed", () => {
  assert.deepEqual(createContext(emptyStore(), new Map([["sup", 1004]]), undefined).changedCounters(), []);
});

test("audit entries are collected for the save", () => {
  const ctx = createContext(emptyStore(), new Map(), undefined);
  ctx.audit("Create", "Model", "model-1001", "BTA");
  assert.deepEqual(ctx.auditEntries.map((entry) => entry.entityId), ["model-1001"]);
});

test("file contents are kept for the save", () => {
  const ctx = createContext(emptyStore(), new Map(), undefined);
  ctx.addFileContent("file-1001", Buffer.from("pdf"));
  assert.deepEqual(ctx.fileContents.get("file-1001"), Buffer.from("pdf"));
});
