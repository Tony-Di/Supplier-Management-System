// Times quote edits against a large synthetic data set in the TEST database:
//   npx tsx --env-file-if-exists=.env scripts/measure-write-time.ts
// It empties the business tables of DATABASE_URL_TEST first. The budget is a
// median of 200 ms per edit.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { Store } from "../server/storeShape";

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) throw new Error("DATABASE_URL_TEST is not set.");
process.env.DATABASE_URL = testUrl;
process.chdir(mkdtempSync(join(tmpdir(), "sourcing-measure-")));

const { pool } = await import("../server/db");
const { runMigrations } = await import("./migrate");
const { saveChanges, saveScoreWeights } = await import("../server/storeRepository");
const { diffStore } = await import("../server/storeDiff");
const { emptyStore } = await import("../server/storeShape");
const { createApp } = await import("../server/app");

const pad = (value: number) => String(value).padStart(4, "0");

function syntheticStore(): Store {
  const store = emptyStore();
  const types = ["Pallet", "Strapping", "Upper Cover", "Paper Plate"] as const;
  for (let s = 0; s < 50; s += 1) {
    store.suppliers.push({
      id: `sup-${1001 + s}`, recordState: "Active", name: `Supplier ${s}`, status: "Active", type: "Manufacturer", country: "United States",
      region: "", capableItems: [...types], primaryContact: "", email: "", phone: "", paymentTerms: "Net 30", hasW9: true, hasPaymentInfo: true, notes: "",
    });
  }
  for (let m = 0; m < 20; m += 1) {
    const modelId = `model-${1001 + m}`;
    store.models.push({ id: modelId, recordState: "Active", name: `Model ${m}`, productFamily: "Solar Module", status: "Active", notes: "" });
    const itemIds: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const id = `item-${1001 + m * 10 + i}`;
      itemIds.push(id);
      store.items.push({ id, recordState: "Active", itemCode: `ITEM-${pad(m * 10 + i)}`, itemName: `Item ${m}-${i}`, type: types[i % types.length], usedForModels: [modelId], uom: "pcs", status: "Active" });
    }
    const drawingSetId = `dwgset-${1001 + m}`;
    store.drawingSets.push({
      id: drawingSetId, recordState: "Active", modelId, name: `Model ${m} packaging`, revision: "1.0", status: "Active", effectiveDate: "2026-01-01",
      maintainedBy: "Process Engineering",
      drawingItems: itemIds.map((itemId, i) => ({ id: `dwgitem-${1001 + m * 10 + i}`, itemId, revision: "1.0", status: "Active", drawingSource: "Package PDF" })),
    });
    for (let p = 0; p < 5; p += 1) {
      store.projects.push({
        id: `proj-${1001 + m * 5 + p}`, recordState: "Active", name: `Case ${m}-${p}`, modelIds: [modelId], drawingSetId,
        type: "New Supplier Development", caseReason: "New Supplier Intro", status: "Quoting",
        supplierIds: Array.from({ length: 5 }, (_, k) => `sup-${1001 + ((p * 5 + k) % 50)}`), itemIds, owner: "Purchasing", openDate: "2026-01-01",
      });
    }
  }
  for (let q = 0; q < 3000; q += 1) {
    const project = store.projects[q % store.projects.length];
    const drawingSet = store.drawingSets.find((candidate) => candidate.id === project.drawingSetId)!;
    const drawingItem = drawingSet.drawingItems[q % drawingSet.drawingItems.length];
    const id = `q-${1001 + q}`;
    const supplierId = project.supplierIds[q % project.supplierIds.length];
    store.quotes.push({
      id, recordState: "Active", supplierId, projectId: project.id, quoteType: "Case-linked", quoteReason: "New Quote", modelId: project.modelIds[0],
      itemId: drawingItem.itemId, drawingSetId: drawingSet.id, drawingItemId: drawingItem.id, quoteDate: "2026-02-01", effectiveFrom: "2026-02-01",
      currency: "USD", uom: "pcs", unitPrice: 10 + (q % 7), moq: "100", leadTime: `${7 + (q % 21)} days`, extraCostType: "None", extraCostAmount: 0,
      status: "Received", notes: "",
    });
    store.quoteCaseLinks.push({
      id: `ql-${1001 + q}`, recordState: "Active", quoteId: id, projectId: project.id, supplierId, itemId: drawingItem.itemId,
      modelId: project.modelIds[0], linkType: "Origin Case", sampleRequirement: "Not Reviewed",
    });
  }
  for (let n = 0; n < 1000; n += 1) {
    const quote = store.quotes[n * 3];
    store.inspections.push({
      id: `ins-${1001 + n}`, recordState: "Active", supplierId: quote.supplierId, projectId: quote.projectId, relatedQuoteId: quote.id, modelId: quote.modelId,
      drawingSetId: quote.drawingSetId, itemId: quote.itemId, drawingItemId: quote.drawingItemId, sampleRound: 1, sampleReceivedDate: "2026-02-15",
      result: "Fail", disposition: "Re-sample Required", problemPhotos: 0, photoFileIds: [], notes: "",
    });
  }
  for (let c = 0; c < 500; c += 1) {
    const quote = store.quotes[c * 5];
    store.priceChanges.push({
      id: `pc-${1001 + c}`, recordState: "Active", supplierId: quote.supplierId, modelId: quote.modelId, itemId: quote.itemId, sourceType: "Manual",
      oldPrice: 10, newPrice: 11, currency: "USD", effectiveDate: "2026-03-01", reason: "Material", status: "Approved",
    });
  }
  return store;
}

async function seed() {
  const client = await pool.connect();
  try {
    await runMigrations(client);
    const { rows } = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('schema_migrations', 'users', 'session')`);
    await client.query(`TRUNCATE TABLE ${rows.map((row) => `"${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    const store = syntheticStore();
    await client.query("BEGIN");
    await saveChanges(client, diffStore(emptyStore(), store));
    await saveScoreWeights(client, store.scoreWeights);
    // Counters past every seeded ID, as the app would have left them.
    await client.query(`INSERT INTO id_counters (prefix, value) VALUES
      ('sup', 1050), ('model', 1020), ('item', 1200), ('dwgset', 1020), ('dwgitem', 1200), ('proj', 1100),
      ('q', 4000), ('ql', 4000), ('ins', 2000), ('pc', 1500)
      ON CONFLICT (prefix) DO UPDATE SET value = EXCLUDED.value`);
    await client.query("COMMIT");
    return store;
  } finally {
    client.release();
  }
}

async function time(label: string, runs: number, request: (run: number) => Promise<Response>) {
  const durations: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    const response = await request(run);
    await response.arrayBuffer();
    if (!response.ok) throw new Error(`${label} failed with ${response.status}`);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  console.log(`${label}: median ${Math.round(durations[Math.floor(runs / 2)])} ms, max ${Math.round(durations[runs - 1])} ms over ${runs} runs`);
  return durations[Math.floor(runs / 2)];
}

const store = await seed();
const server = createApp().listen(0);
const { port } = server.address() as { port: number };
const base = `http://127.0.0.1:${port}`;
try {
  const login = await fetch(`${base}/api/auth/login`, { redirect: "manual" });
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { cookie } })).json();
  const headers = { cookie, "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken };
  const quoteId = store.quotes[0].id;
  const edit = (run: number) => fetch(`${base}/api/quotes/${quoteId}`, { method: "PATCH", headers, body: JSON.stringify({ notes: `Edit ${run}` }) });

  await edit(-1); // the first write runs every sync pass over fresh data
  const median = await time("Quote edit", 20, edit);
  await time("Bootstrap read", 10, () => fetch(`${base}/api/bootstrap`, { headers }));
  console.log(median <= 200 ? "Within the 200 ms budget." : "OVER the 200 ms budget.");
} finally {
  server.close();
  await pool.end();
}
