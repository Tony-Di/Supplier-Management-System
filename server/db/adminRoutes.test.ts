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

async function signedInFetch(app: Express) {
  const login = await call(app, "/api/auth/login");
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await call(app, "/api/auth/me", { cookie })).json();
  return { cookie, me };
}

test("a non-admin is refused", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const { cookie } = await signedInFetch(app);
    const response = await call(app, "/api/admin/users", { cookie });
    assert.equal(response.status, 403);
  });
});

test("an admin lists users", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const { cookie, me } = await signedInFetch(app);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const response = await call(app, "/api/admin/users", { cookie });
    assert.equal(response.status, 200);
    const users = await response.json();
    assert.equal(users[0].email, "dev@segsolar.com");
  });
});

test("deactivating yourself is refused with the rule message", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const { cookie, me } = await signedInFetch(app);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const response = await call(app, `/api/admin/users/${me.id}/active`, {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /your own account/);
  });
});

test("an arbitrary role string is rejected, not written", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const { cookie, me } = await signedInFetch(app);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const response = await call(app, `/api/admin/users/${me.id}/role`, {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({ role: "superuser" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Role must be admin or user/);
    const { rows } = await pool.query("SELECT role FROM users WHERE id = $1", [me.id]);
    assert.equal(rows[0].role, "admin");
  });
});

test("an empty body on /active is rejected and leaves the target unchanged", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const { cookie, me } = await signedInFetch(app);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const { rows: inserted } = await pool.query(
      "INSERT INTO users(entra_oid, email, name) VALUES ('oid-target', 'target@segsolar.com', 'Target User') RETURNING id",
    );
    const targetId = inserted[0].id as number;
    const response = await call(app, `/api/admin/users/${targetId}/active`, {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    const { rows } = await pool.query("SELECT active FROM users WHERE id = $1", [targetId]);
    assert.equal(rows[0].active, true);
  });
});

test("a real active:false request still deactivates the target", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const { cookie, me } = await signedInFetch(app);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
    const { rows: inserted } = await pool.query(
      "INSERT INTO users(entra_oid, email, name) VALUES ('oid-target', 'target@segsolar.com', 'Target User') RETURNING id",
    );
    const targetId = inserted[0].id as number;
    const response = await call(app, `/api/admin/users/${targetId}/active`, {
      method: "PATCH",
      cookie,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(response.status, 200);
    const { rows } = await pool.query("SELECT active FROM users WHERE id = $1", [targetId]);
    assert.equal(rows[0].active, false);
  });
});
