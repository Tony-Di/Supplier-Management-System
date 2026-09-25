import assert from "node:assert/strict";
import { test } from "node:test";
import type { Express } from "express";

import { withTestApp } from "../testDb";

// Only rejected uploads are exercised here: an accepted upload would write to
// the real uploads/ directory and data/store.json, which withTestApp does not
// isolate. The rejection happens before anything is written.
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

test("an HTML upload is rejected before it is stored", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await (await call(app, "/api/auth/me", { cookie })).json();
    const filesBefore = await (await call(app, "/api/files", { cookie })).json();

    const response = await call(app, "/api/files", {
      method: "POST",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({
        fileName: "invoice.html",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("<script>alert(1)</script>").toString("base64"),
        purpose: "Other",
      }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /invoice\.html cannot be uploaded/);
    const filesAfter = await (await call(app, "/api/files", { cookie })).json();
    assert.equal(filesAfter.length, filesBefore.length);
  });
});
