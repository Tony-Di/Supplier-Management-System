import assert from "node:assert/strict";
import { test } from "node:test";
import type { Express } from "express";

import { withTestApp } from "../testDb";

// Only the refused change is exercised: an accepted one would rewrite the
// weights in the real data/store.json, which withTestApp does not isolate.
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

test("a non-admin can read the score weights but not change them", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await (await call(app, "/api/auth/me", { cookie })).json();
    assert.equal(me.role, "user");

    const read = await call(app, "/api/score-settings", { cookie });
    assert.equal(read.status, 200);
    const weights = await read.json();

    const change = await call(app, "/api/score-settings", {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({ ...weights, sampleQuality: weights.sampleQuality + 5, pricing: weights.pricing - 5 }),
    });
    assert.equal(change.status, 403);
    assert.deepEqual(await (await call(app, "/api/score-settings", { cookie })).json(), weights);
  });
});
