import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readStoreFile, writeStoreFile } from "./storeFile";

function storePath() {
  return join(mkdtempSync(join(tmpdir(), "store-test-")), "store.json");
}

test("reads a stored record set back", () => {
  const path = storePath();
  writeFileSync(path, JSON.stringify({ suppliers: [{ id: "sup-1" }] }), "utf8");

  assert.deepEqual(readStoreFile(path), { suppliers: [{ id: "sup-1" }] });
});

test("returns undefined when the file does not exist", () => {
  assert.equal(readStoreFile(storePath()), undefined);
});

test("refuses to start on a corrupt file instead of dropping the data", () => {
  const path = storePath();
  writeFileSync(path, '{"suppliers": [ broken', "utf8");

  assert.throws(() => readStoreFile(path), (error: Error) => error.message.includes(path));
});

test("writes a store that can be read back", () => {
  const path = storePath();
  writeStoreFile(path, { suppliers: [{ id: "sup-1" }] });

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { suppliers: [{ id: "sup-1" }] });
});

test("leaves no temporary file behind", () => {
  const path = storePath();
  writeStoreFile(path, { suppliers: [] });

  assert.deepEqual(readdirSync(join(path, "..")), ["store.json"]);
});

test("keeps the previous content when the new store cannot be serialized", () => {
  const path = storePath();
  writeStoreFile(path, { suppliers: [{ id: "sup-1" }] });

  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.throws(() => writeStoreFile(path, circular));
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { suppliers: [{ id: "sup-1" }] });
});

test("creates the directory when it is missing", () => {
  const path = join(mkdtempSync(join(tmpdir(), "store-test-")), "data", "store.json");
  writeStoreFile(path, { suppliers: [] });

  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { suppliers: [] });
});
