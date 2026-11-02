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

test("selecting on previous orders stays on unless it is switched off", () => {
  assert.equal(getConfig(base).previousOrderSelection, true);
  assert.equal(getConfig({ ...base, PREVIOUS_ORDER_SELECTION: "off" }).previousOrderSelection, false);
});

const passwordMode = {
  DATABASE_URL: base.DATABASE_URL,
  SESSION_SECRET: base.SESSION_SECRET,
  APP_ORIGIN: base.APP_ORIGIN,
  AUTH_MODE: "password",
  SIGN_UP_EMAIL_DOMAINS: "segsolar.com",
};

test("password sign-in needs no Entra credentials and reads the sign-up domains", () => {
  const config = getConfig({ ...passwordMode, SIGN_UP_EMAIL_DOMAINS: " SEGSolar.com, @segsolar-ind.com ,," });
  assert.equal(config.authMode, "password");
  assert.equal(config.entra, undefined);
  assert.deepEqual(config.signUpDomains, ["segsolar.com", "segsolar-ind.com"]);
});

test("password sign-in requires sign-up domains", () => {
  assert.throws(() => getConfig({ ...passwordMode, SIGN_UP_EMAIL_DOMAINS: undefined }), /SIGN_UP_EMAIL_DOMAINS/);
  assert.throws(() => getConfig({ ...passwordMode, SIGN_UP_EMAIL_DOMAINS: " , " }), /at least one domain/);
  assert.throws(() => getConfig({ ...passwordMode, SIGN_UP_EMAIL_DOMAINS: "segsolar.com, *" }), /not a domain: \*/);
});

test("other sign-in modes have no sign-up domains", () => {
  assert.deepEqual(getConfig(base).signUpDomains, []);
});

test("refuses an unknown sign-in mode", () => {
  assert.throws(() => getConfig({ ...base, AUTH_MODE: "pasword" }), /AUTH_MODE must be entra, password or dev/);
});

test("an empty sign-in mode means entra", () => {
  assert.equal(getConfig({ ...base, AUTH_MODE: "" }).authMode, "entra");
});

test("reads the mail server, sending from the SMTP account unless MAIL_FROM is set", () => {
  assert.equal(getConfig(passwordMode).mail, undefined);
  const office = getConfig({ ...passwordMode, SMTP_HOST: "smtp.office365.com", SMTP_USER: "sourcing@segsolar.com", SMTP_PASSWORD: "secret" });
  assert.deepEqual(office.mail, {
    host: "smtp.office365.com",
    port: 587,
    user: "sourcing@segsolar.com",
    password: "secret",
    from: "sourcing@segsolar.com",
  });
  const relay = getConfig({ ...passwordMode, SMTP_HOST: "relay.local", SMTP_PORT: "25", MAIL_FROM: "Sourcing <sourcing@segsolar.com>" });
  assert.deepEqual(relay.mail, { host: "relay.local", port: 25, user: undefined, password: undefined, from: "Sourcing <sourcing@segsolar.com>" });
  assert.throws(() => getConfig({ ...passwordMode, SMTP_HOST: "relay.local" }), /MAIL_FROM/);
  assert.throws(() => getConfig({ ...passwordMode, SMTP_HOST: "relay.local", SMTP_USER: "a@segsolar.com", SMTP_PORT: "smtp" }), /SMTP_PORT/);
});

test("password sign-in in production needs a mail server", () => {
  const production = { ...passwordMode, NODE_ENV: "production", APP_ORIGIN: "https://sourcing.segsolar.com" };
  assert.throws(() => getConfig(production), /SMTP_HOST/);
  assert.equal(getConfig({ ...production, SMTP_HOST: "smtp.office365.com", SMTP_USER: "sourcing@segsolar.com" }).production, true);
});
