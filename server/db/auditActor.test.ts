import assert from "node:assert/strict";
import { test } from "node:test";

import { listAuditEntries } from "../auditLog";
import { withTestApp } from "../testDb";
import { expectJson, send, signIn } from "./http";

// Read the audit trail through the pool withTestApp hands back: it is the
// app's own pool, bound to the test database. Do not import "../app",
// "../db" or "../session" statically here.

test("a create records the signed-in user", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    await expectJson(send(app, session, "POST", "/api/suppliers", { name: "Audit Actor Test" }), 201);
    const [entry] = await listAuditEntries(pool, { entityType: "Supplier" });
    assert.equal(entry.actorLabel, "Dev User");
    assert.equal(entry.actorUserId, session.userId);
  });
});

test("a system-generated sync stays anonymous even though a signed-in user triggered it", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const session = await signIn(app);
    const model = await expectJson(send(app, session, "POST", "/api/models", { name: "Audit Actor Test Model", recordState: "Active" }), 201);
    await expectJson(
      send(app, session, "POST", "/api/drawing-sets", {
        modelId: model.id,
        name: "Audit Actor Test Set",
        status: "Active",
        effectiveDate: "2026-01-01",
        drawingItems: [],
      }),
      201,
    );

    // Creating an Active item used by this model makes syncActivePackagingSetItems
    // add it to the packaging set: a system change caused by the user's request.
    await expectJson(
      send(app, session, "POST", "/api/items", {
        itemCode: "AUDIT-ITEM-1",
        itemName: "Audit Item",
        type: "Pallet",
        usedForModels: [model.id],
        uom: "pcs",
        status: "Active",
        recordState: "Active",
      }),
      201,
    );

    const [syncEntry] = await listAuditEntries(pool, { entityType: "DrawingSet" });
    assert.equal(syncEntry.source, "System");
    assert.equal(syncEntry.actorLabel, "System");
    assert.equal(syncEntry.actorUserId, null);

    const [itemEntry] = await listAuditEntries(pool, { entityType: "Item" });
    assert.equal(itemEntry.actorLabel, "Dev User");
    assert.equal(itemEntry.actorUserId, session.userId);
  });
});
