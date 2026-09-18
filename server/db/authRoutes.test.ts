import assert from "node:assert/strict";
import { test } from "node:test";
import type { Express } from "express";

import { withTestApp } from "../testDb";

// AUTH_MODE=dev is set by .env (loaded by `npm run test:db`); the dev bypass
// signs in a fixed local account without contacting Entra.
//
// withTestApp is the only way this file reaches the app: it points
// DATABASE_URL at the test database *before* dynamically importing
// server/app.ts (which transitively imports server/db.ts). Do not import
// "../app", "../db" or "../session" statically here — a static import would
// evaluate server/db.ts against the development DATABASE_URL and this suite
// would read and write real supplier data.
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

test("an unauthenticated API call is rejected", async () => {
  await withTestApp(async ({ createApp }) => {
    const response = await call(createApp(), "/api/bootstrap");
    assert.equal(response.status, 401);
  });
});

test("an unauthenticated upload request is rejected", async () => {
  await withTestApp(async ({ createApp }) => {
    const response = await call(createApp(), "/uploads/file-1001.pdf");
    assert.equal(response.status, 401);
  });
});

test("the dev bypass signs in and /api/auth/me returns the user", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await call(app, "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.email, "dev@segsolar.com");
  });
});

test("GET /api/health is reachable without a session while /api/bootstrap is not", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const health = await call(app, "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      ok: true,
      service: "global-sourcing-api",
      language: "TypeScript",
      storage: "json-file prototype",
    });

    const bootstrap = await call(app, "/api/bootstrap");
    assert.equal(bootstrap.status, 401);
  });
});

test("a deactivated user cannot use an existing session", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    await pool.query("UPDATE users SET active = false, session_epoch = session_epoch + 1 WHERE email = $1", [
      "dev@segsolar.com",
    ]);
    const me = await call(app, "/api/auth/me", { cookie });
    assert.equal(me.status, 401);
  });
});
