import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import express, { type Express } from "express";

import { serveFrontend } from "./frontend";

function builtFrontend() {
  const dir = mkdtempSync(join(tmpdir(), "dist-test-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Workbench</title>");
  writeFileSync(join(dir, "assets", "index-abc.js"), "console.log('app')");
  return dir;
}

function appWithApi() {
  const app = express();
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  return app;
}

async function get(app: Express, path: string) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: response.status, type: response.headers.get("content-type") ?? "", body: await response.text() };
  } finally {
    server.close();
  }
}

test("the built app is served at the root and on client-side routes", async () => {
  const app = appWithApi();
  serveFrontend(app, builtFrontend());
  for (const path of ["/", "/suppliers", "/reports/scorecard"]) {
    const response = await get(app, path);
    assert.equal(response.status, 200, path);
    assert.match(response.body, /<title>Workbench<\/title>/, path);
  }
});

test("built assets are served as files", async () => {
  const app = appWithApi();
  serveFrontend(app, builtFrontend());
  const response = await get(app, "/assets/index-abc.js");
  assert.equal(response.status, 200);
  assert.match(response.type, /javascript/);
});

test("API and upload paths never fall back to the app page", async () => {
  const app = appWithApi();
  serveFrontend(app, builtFrontend());
  assert.deepEqual(JSON.parse((await get(app, "/api/health")).body), { ok: true });
  for (const path of ["/api/unknown", "/api", "/uploads/file-1.pdf", "/assets/missing.js"]) {
    const response = await get(app, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(response.body, /Workbench/, path);
  }
});

test("nothing is served when the frontend has not been built", async () => {
  const app = appWithApi();
  serveFrontend(app, join(tmpdir(), "no-such-dist"));
  assert.equal((await get(app, "/")).status, 404);
});
