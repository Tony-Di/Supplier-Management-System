import assert from "node:assert/strict";
import { test } from "node:test";
import type { PoolClient } from "pg";

import { diffStore } from "../storeDiff";
import { loadCounters, loadStore, readFileContent, saveChanges, saveCounters, saveScoreWeights } from "../storeRepository";
import { defaultScoreWeights, emptyStore, type Store } from "../storeShape";
import { sampleFileContents, sampleStore } from "../testFixtures";
import { withTestDatabase } from "../testDb";

// Writes go through a transaction, as in the app: foreign keys are checked at
// commit, and q-1001 refers to q-1002, which is inserted after it.
async function inTransaction(client: PoolClient, fn: () => Promise<void>) {
  await client.query("BEGIN");
  await fn();
  await client.query("COMMIT");
}

async function saveSample(client: PoolClient, store = sampleStore()): Promise<Store> {
  await inTransaction(client, async () => {
    await saveChanges(client, diffStore(emptyStore(), store), sampleFileContents());
    await saveScoreWeights(client, store.scoreWeights);
  });
  return store;
}

test("an empty database loads an empty store with the default weights", async () => {
  await withTestDatabase(async (client) => {
    assert.deepEqual(await loadStore(client), emptyStore());
  });
});

test("a store saved from empty loads back unchanged", async () => {
  await withTestDatabase(async (client) => {
    const store = await saveSample(client);
    assert.deepEqual(await loadStore(client), store);
  });
});

test("updates and deletes are applied", async () => {
  await withTestDatabase(async (client) => {
    await saveSample(client);
    const before = await loadStore(client);
    const after = structuredClone(before);
    after.suppliers[1].name = "UFP Renamed";
    after.priceChanges = after.priceChanges.filter((change) => change.id !== "pc-1002");
    after.drawingSets[0].drawingItems.reverse();
    after.incomingDefects[0].replacementReceipts = [];
    await inTransaction(client, () => saveChanges(client, diffStore(before, after)));
    assert.deepEqual(await loadStore(client), after);
  });
});

test("deleting a drawing set with the diff removes its items too", async () => {
  await withTestDatabase(async (client) => {
    const store = sampleStore();
    store.drawingSets[1].drawingItems.push({ id: "dwgitem-1003", itemId: "item-1002", revision: "1.0", status: "Active", drawingSource: "Package PDF" });
    await saveSample(client, store);
    const before = await loadStore(client);
    const after = structuredClone(before);
    after.drawingSets = after.drawingSets.filter((drawingSet) => drawingSet.id !== "dwgset-1002");
    await inTransaction(client, () => saveChanges(client, diffStore(before, after)));
    assert.deepEqual((await loadStore(client)).drawingSets.map((drawingSet) => drawingSet.id), ["dwgset-1001"]);
    const { rows } = await client.query("SELECT id FROM drawing_items ORDER BY id");
    assert.deepEqual(rows.map((row) => row.id), ["dwgitem-1001", "dwgitem-1002"]);
  });
});

test("records load in the order they were created", async () => {
  await withTestDatabase(async (client) => {
    const store = emptyStore();
    const model = { name: "BTA", productFamily: "Solar Module", status: "Active" as const, notes: "" };
    store.models.push({ ...model, id: "model-10000" }, { ...model, id: "model-9999" });
    await inTransaction(client, () => saveChanges(client, diffStore(emptyStore(), store)));
    assert.deepEqual((await loadStore(client)).models.map((record) => record.id), ["model-9999", "model-10000"]);
  });
});

test("counters keep the last value saved for each prefix", async () => {
  await withTestDatabase(async (client) => {
    await saveCounters(client, [["sup", 1004], ["q", 1010]]);
    await saveCounters(client, [["sup", 1005]]);
    assert.deepEqual(await loadCounters(client), new Map([["sup", 1005], ["q", 1010]]));
  });
});

test("score weights are saved, and a missing row loads as the defaults", async () => {
  await withTestDatabase(async (client) => {
    await client.query("DELETE FROM score_weights");
    assert.deepEqual((await loadStore(client)).scoreWeights, defaultScoreWeights());
    const weights = { ...defaultScoreWeights(), pricing: 30, setup: 0 };
    await saveScoreWeights(client, weights);
    await saveScoreWeights(client, weights);
    assert.deepEqual((await loadStore(client)).scoreWeights, weights);
  });
});

test("file content is stored with the file and read on its own", async () => {
  await withTestDatabase(async (client) => {
    await saveSample(client);
    assert.deepEqual(await readFileContent(client, "file-1001"), {
      fileName: "W9 2026.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("pdf"),
    });
    assert.equal(await readFileContent(client, "file-9999"), undefined);
  });
});

test("a new file without content is refused", async () => {
  await withTestDatabase(async (client) => {
    const store = emptyStore();
    store.files.push(sampleStore().files[0]);
    await assert.rejects(saveChanges(client, diffStore(emptyStore(), store)), /No content for new file file-1001/);
  });
});
