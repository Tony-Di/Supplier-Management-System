import assert from "node:assert/strict";
import { test } from "node:test";

import { getConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://localhost/sourcing",
  SESSION_SECRET: "x".repeat(32),
  APP_ORIGIN: "http://127.0.0.1:5173",
  ENTRA_TENANT_ID: "tenant",
  ENTRA_CLIENT_ID: "client",
  ENTRA_CLIENT_SECRET: "secret",
};

test("reads a complete environment", () => {
  const config = getConfig(base);
  assert.equal(config.databaseUrl, "postgres://localhost/sourcing");
  assert.equal(config.authMode, "entra");
  assert.equal(config.entra?.tenantId, "tenant");
});

test("refuses a missing database url", () => {
  assert.throws(() => getConfig({ ...base, DATABASE_URL: undefined }), /DATABASE_URL/);
});

test("refuses a short session secret", () => {
  assert.throws(() => getConfig({ ...base, SESSION_SECRET: "short" }), /SESSION_SECRET/);
});

test("refuses the dev bypass in production", () => {
  assert.throws(
    () => getConfig({ ...base, AUTH_MODE: "dev", NODE_ENV: "production" }),
    /AUTH_MODE=dev/,
  );
});

test("allows the dev bypass without Entra credentials outside production", () => {
  const config = getConfig({
    DATABASE_URL: base.DATABASE_URL,
    SESSION_SECRET: base.SESSION_SECRET,
    APP_ORIGIN: base.APP_ORIGIN,
    AUTH_MODE: "dev",
  });
  assert.equal(config.authMode, "dev");
  assert.equal(config.entra, undefined);
});

test("requires Entra credentials when the mode is entra", () => {
  assert.throws(() => getConfig({ ...base, ENTRA_CLIENT_SECRET: undefined }), /ENTRA_CLIENT_SECRET/);
});

test("requires https in production", () => {
  assert.throws(
    () => getConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://sourcing.segsolar.com" }),
    /HTTPS/,
  );
});
