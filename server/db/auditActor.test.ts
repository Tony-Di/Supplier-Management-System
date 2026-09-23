import assert from "node:assert/strict";
import { test } from "node:test";
import type { Express } from "express";

import { listAuditEntries } from "../auditLog";
import { withTestApp } from "../testDb";

// withTestApp redirects DATABASE_URL to DATABASE_URL_TEST *before* dynamically
// importing server/app.ts (which transitively imports server/db.ts and binds
// its pool), then hands back that same pool. Reading the audit trail through
// that pool (rather than a separately-connected client, as in a bespoke
// withTestDatabase-based test) is what keeps the write and the read looking
// at the same database. Do not import "../app", "../db" or "../session"
// statically here.
//
// Note: only the Postgres-backed tables (audit_logs, users, session) are
// isolated and reset per test. Every other business entity (suppliers,
// models, items, drawing sets, ...) still lives in the JSON-file store at
// data/store.json, which withTestApp does not touch. Any record created
// through these HTTP calls is deleted again at the end of the test so this
// suite does not leave test fixtures behind in that file on every run.
async function call(app: Express, path: string, init?: RequestInit & { cookie?: string }) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init?.headers ?? {}), ...(init?.cookie ? { cookie: init.cookie } : {}) },
    });
  } finally {
    server.close();
  }
}

test("a create records the signed-in user", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await (await call(app, "/api/auth/me", { cookie })).json();
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken };
    const response = await call(app, "/api/suppliers", {
      method: "POST",
      cookie,
      headers,
      body: JSON.stringify({ name: "Audit Actor Test" }),
    });
    try {
      assert.equal(response.status, 201);
      const [entry] = await listAuditEntries(pool, { entityType: "Supplier" });
      assert.equal(entry.actorLabel, "Dev User");
      assert.equal(entry.actorUserId, me.id);
    } finally {
      const supplier = await response.json().catch(() => undefined);
      if (supplier?.id) await call(app, `/api/suppliers/${supplier.id}`, { method: "DELETE", cookie, headers });
    }
  });
});

test("a system-generated sync stays anonymous even though a signed-in user triggered it", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await (await call(app, "/api/auth/me", { cookie })).json();
    const headers = { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken };

    const model = await (
      await call(app, "/api/models", { method: "POST", cookie, headers, body: JSON.stringify({ name: "Audit Actor Test Model", recordState: "Active" }) })
    ).json();
    const drawingSet = await (
      await call(app, "/api/drawing-sets", {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({ modelId: model.id, name: "Audit Actor Test Set", status: "Active", effectiveDate: "2026-01-01", drawingItems: [] }),
      })
    ).json();

    let item: { id?: string } = {};
    try {
      // Creating an Active item used by this model triggers
      // syncActivePackagingSetItems, which edits the drawing set to add the
      // item's drawing coverage — a system-generated side effect of the
      // signed-in user's item-create request.
      const itemResponse = await call(app, "/api/items", {
        method: "POST",
        cookie,
        headers,
        body: JSON.stringify({
          itemCode: `AUDIT-ITEM-${Date.now()}`,
          itemName: "Audit Item",
          type: "Pallet",
          usedForModels: [model.id],
          uom: "pcs",
          status: "Active",
          recordState: "Active",
        }),
      });
      assert.equal(itemResponse.status, 201);
      item = await itemResponse.json();

      const [syncEntry] = await listAuditEntries(pool, { entityType: "DrawingSet" });
      assert.equal(syncEntry.source, "System");
      assert.equal(syncEntry.actorLabel, "System");
      assert.equal(syncEntry.actorUserId, null);

      const [itemEntry] = await listAuditEntries(pool, { entityType: "Item" });
      assert.equal(itemEntry.actorLabel, "Dev User");
      assert.equal(itemEntry.actorUserId, me.id);
    } finally {
      // Delete order matters: the item is linked into the drawing set by the
      // very sync this test exercises, and the model is used by both.
      if (drawingSet?.id) await call(app, `/api/drawing-sets/${drawingSet.id}`, { method: "DELETE", cookie, headers });
      if (item?.id) await call(app, `/api/items/${item.id}`, { method: "DELETE", cookie, headers });
      if (model?.id) await call(app, `/api/models/${model.id}`, { method: "DELETE", cookie, headers });
    }
  });
});
