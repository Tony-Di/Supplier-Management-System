import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { Express } from "express";

import { withTestApp } from "../testDb";
import { call, expectJson } from "./http";
import type { Mail } from "../mailer";

// This file runs the app with email and password sign-in. Config is read when
// the app is first imported, and withTestApp imports it dynamically, so these
// settings (which override .env's AUTH_MODE=dev) are in place by then. As in
// the other suites, do not import "../app", "../db" or "../session" statically.
process.env.AUTH_MODE = "password";
process.env.SIGN_UP_EMAIL_DOMAINS = "segsolar.com, @SEGSOLAR-IND.com";
process.env.APP_ORIGIN = "http://sourcing.test";
delete process.env.SMTP_HOST;

const outbox: Mail[] = [];
const { setMailTransport } = await import("../mailer");
setMailTransport(async (mail) => {
  outbox.push(mail);
});
beforeEach(() => {
  outbox.length = 0;
});

// Most rate limits count per IP; each test posts from its own address (the
// app trusts one proxy hop) so they do not use up each other's allowance.
let lastIp = 0;
function newIp() {
  lastIp += 1;
  return `10.0.0.${lastIp}`;
}

function post(app: Express, path: string, body: unknown, options: { ip: string; cookie?: string }) {
  return call(app, `/api/auth/password${path}`, {
    method: "POST",
    cookie: options.cookie,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": options.ip },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /sourcing\.sid=/);
  return cookie;
}

function tokenFrom(mail: Mail): string {
  const match = mail.text.match(/http:\/\/sourcing\.test\/#set-password=([\w-]+)/);
  assert.ok(match, `no link in: ${mail.text}`);
  return match[1];
}

function takeMail(to: string): Mail {
  const index = outbox.findIndex((mail) => mail.to === to);
  assert.ok(index >= 0, `no email to ${to}`);
  return outbox.splice(index, 1)[0];
}

async function me(app: Express, cookie: string) {
  return call(app, "/api/auth/me", { cookie });
}

/** Signs up and sets a password, returning the session the link signed in. */
async function createAccount(app: Express, email: string, name: string, password: string) {
  const ip = newIp();
  await expectJson(post(app, "/sign-up", { name, email }, { ip }), 202);
  const set = await post(app, "/set", { token: tokenFrom(takeMail(email)), password }, { ip });
  assert.equal(set.status, 200);
  return sessionCookie(set);
}

test("the sign-in screen is told to show the password form", async () => {
  await withTestApp(async ({ createApp }) => {
    const options = await expectJson(call(createApp(), "/api/auth/options"), 200);
    assert.deepEqual(options, { mode: "password", signUpDomains: ["segsolar.com", "segsolar-ind.com"] });
  });
});

test("signing up emails a link that sets the password, creates the account and signs in once", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const ip = newIp();
    const sent = await expectJson(post(app, "/sign-up", { name: "Ana Buyer", email: " Ana.Buyer@SEGSolar.com " }, { ip }), 202);
    assert.match(sent.message, /Check your inbox/);

    const mail = takeMail("ana.buyer@segsolar.com");
    assert.match(mail.subject, /Set your password/);
    assert.match(mail.html, /Ana Buyer/);
    const token = tokenFrom(mail);
    const { rows: before } = await pool.query("SELECT count(*)::int AS count FROM users");
    assert.equal(before[0].count, 0, "no account until the link is used");

    const link = await expectJson(post(app, "/link", { token }, { ip }), 200);
    assert.deepEqual(link, { email: "ana.buyer@segsolar.com", name: "Ana Buyer", newAccount: true });

    const short = await expectJson(post(app, "/set", { token, password: "short" }, { ip }), 400);
    assert.match(short.message, /at least 8/);

    const set = await post(app, "/set", { token, password: "packaging-2026" }, { ip });
    assert.equal(set.status, 200);
    const user = await expectJson(me(app, sessionCookie(set)), 200);
    assert.equal(user.email, "ana.buyer@segsolar.com");
    assert.equal(user.name, "Ana Buyer");
    assert.equal(user.role, "user");

    const { rows } = await pool.query("SELECT entra_oid, password_hash FROM users WHERE id = $1", [user.id]);
    assert.equal(rows[0].entra_oid, null);
    assert.match(rows[0].password_hash, /^scrypt\$/);
    assert.ok(!rows[0].password_hash.includes("packaging-2026"));

    const reused = await expectJson(post(app, "/set", { token, password: "another-pass" }, { ip }), 400);
    assert.match(reused.message, /expired or has already been used/);
  });
});

test("only the configured email domains can sign up", async () => {
  await withTestApp(async ({ createApp }) => {
    const refused = await expectJson(post(createApp(), "/sign-up", { name: "Out", email: "someone@gmail.com" }, { ip: newIp() }), 400);
    assert.equal(refused.message, "Use your @segsolar.com or @segsolar-ind.com email address.");
    assert.equal(outbox.length, 0);
  });
});

test("signing in checks the password and gives the same answer for an unknown address", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    await createAccount(app, "qc@segsolar-ind.com", "QC Lead", "incoming-qc-1");
    const ip = newIp();

    const wrong = await expectJson(post(app, "/sign-in", { email: "qc@segsolar-ind.com", password: "incoming-qc-2" }, { ip }), 401);
    const unknown = await expectJson(post(app, "/sign-in", { email: "nobody@segsolar-ind.com", password: "incoming-qc-1" }, { ip }), 401);
    assert.equal(wrong.message, "Email or password is incorrect.");
    assert.equal(unknown.message, wrong.message);

    const right = await post(app, "/sign-in", { email: "QC@segsolar-ind.com", password: "incoming-qc-1" }, { ip });
    assert.equal(right.status, 200);
    const user = await expectJson(me(app, sessionCookie(right)), 200);
    assert.equal(user.email, "qc@segsolar-ind.com");
    const { rows } = await pool.query("SELECT last_login_at FROM users WHERE id = $1", [user.id]);
    assert.ok(rows[0].last_login_at);
  });
});

test("five wrong passwords lock the address for the rest of the minute, from any IP", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    await createAccount(app, "locked@segsolar.com", "Locked", "right-password");
    const ip = newIp();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expectJson(post(app, "/sign-in", { email: "locked@segsolar.com", password: `wrong-${attempt}` }, { ip }), 401);
    }
    const locked = await post(app, "/sign-in", { email: "locked@segsolar.com", password: "right-password" }, { ip: newIp() });
    assert.equal(locked.status, 429);
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    assert.match((await locked.json()).message, /Too many attempts/);

    // Another address from the same IP is not locked.
    await expectJson(post(app, "/sign-in", { email: "other@segsolar.com", password: "whatever-1" }, { ip }), 401);
  });
});

test("a reset link changes the password and ends the account's other sessions", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const oldSession = await createAccount(app, "buyer@segsolar.com", "Buyer", "first-password");
    const ip = newIp();

    await expectJson(post(app, "/forgot", { email: "nobody@segsolar.com" }, { ip }), 202);
    assert.equal(outbox.length, 0, "no email for an address without an account");

    await expectJson(post(app, "/forgot", { email: "buyer@segsolar.com" }, { ip }), 202);
    const mail = takeMail("buyer@segsolar.com");
    assert.match(mail.subject, /Reset your password/);
    const token = tokenFrom(mail);
    assert.deepEqual(await expectJson(post(app, "/link", { token }, { ip }), 200), {
      email: "buyer@segsolar.com",
      name: "Buyer",
      newAccount: false,
    });

    const set = await post(app, "/set", { token, password: "second-password" }, { ip });
    assert.equal(set.status, 200);
    assert.equal((await me(app, sessionCookie(set))).status, 200);
    assert.equal((await me(app, oldSession)).status, 401);

    await expectJson(post(app, "/sign-in", { email: "buyer@segsolar.com", password: "first-password" }, { ip }), 401);
    assert.equal((await post(app, "/sign-in", { email: "buyer@segsolar.com", password: "second-password" }, { ip })).status, 200);
  });
});

test("signing up again with a registered address sends a reset link and keeps the account", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    await createAccount(app, "dup@segsolar.com", "Original Name", "first-password");
    const ip = newIp();
    await expectJson(post(app, "/sign-up", { name: "Someone Else", email: "dup@segsolar.com" }, { ip }), 202);
    const mail = takeMail("dup@segsolar.com");
    assert.match(mail.subject, /Reset your password/);
    assert.equal((await post(app, "/set", { token: tokenFrom(mail), password: "second-password" }, { ip })).status, 200);
    const { rows } = await pool.query("SELECT name FROM users WHERE lower(email) = 'dup@segsolar.com'");
    assert.deepEqual(rows, [{ name: "Original Name" }]);
  });
});

test("only the newest link for an address works", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const ip = newIp();
    await expectJson(post(app, "/sign-up", { name: "Twice", email: "twice@segsolar.com" }, { ip }), 202);
    const first = tokenFrom(takeMail("twice@segsolar.com"));
    await expectJson(post(app, "/sign-up", { name: "Twice", email: "twice@segsolar.com" }, { ip }), 202);
    const second = tokenFrom(takeMail("twice@segsolar.com"));
    await expectJson(post(app, "/link", { token: first }, { ip }), 400);
    await expectJson(post(app, "/link", { token: second }, { ip }), 200);
  });
});

test("an expired link is refused", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    const ip = newIp();
    await expectJson(post(app, "/sign-up", { name: "Late", email: "late@segsolar.com" }, { ip }), 202);
    const token = tokenFrom(takeMail("late@segsolar.com"));
    await pool.query("UPDATE password_links SET expires_at = now() - interval '1 second'");
    await expectJson(post(app, "/link", { token }, { ip }), 400);
    await expectJson(post(app, "/set", { token, password: "too-late-now" }, { ip }), 400);
  });
});

test("a deactivated account can neither sign in nor get a reset link", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    await createAccount(app, "gone@segsolar.com", "Gone", "gone-password");
    await pool.query("UPDATE users SET active = false WHERE email = 'gone@segsolar.com'");
    const ip = newIp();

    const refused = await expectJson(post(app, "/sign-in", { email: "gone@segsolar.com", password: "gone-password" }, { ip }), 403);
    assert.match(refused.message, /deactivated/);
    await expectJson(post(app, "/sign-in", { email: "gone@segsolar.com", password: "wrong-password" }, { ip }), 401);

    await expectJson(post(app, "/forgot", { email: "gone@segsolar.com" }, { ip }), 202);
    await expectJson(post(app, "/sign-up", { name: "Gone", email: "gone@segsolar.com" }, { ip }), 202);
    assert.equal(outbox.length, 0);
  });
});

test("a password can be set on an account that first signed in another way", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    await pool.query("INSERT INTO users(entra_oid, email, name, role) VALUES ('oid-1', 'Lead@segsolar.com', 'Sourcing Lead', 'admin')");
    const ip = newIp();
    await expectJson(post(app, "/forgot", { email: "lead@segsolar.com" }, { ip }), 202);
    const mail = takeMail("lead@segsolar.com");
    assert.match(mail.subject, /Set your password/);
    const set = await post(app, "/set", { token: tokenFrom(mail), password: "lead-password" }, { ip });
    const user = await expectJson(me(app, sessionCookie(set)), 200);
    assert.equal(user.role, "admin");
    const { rows } = await pool.query("SELECT count(*)::int AS count FROM users");
    assert.equal(rows[0].count, 1);
  });
});

test("the admin user list never carries password hashes", async () => {
  await withTestApp(async ({ createApp, pool }) => {
    const app = createApp();
    await createAccount(app, "admin@segsolar.com", "Admin", "admin-password");
    await pool.query("UPDATE users SET role = 'admin'");
    const signedIn = await post(app, "/sign-in", { email: "admin@segsolar.com", password: "admin-password" }, { ip: newIp() });
    const users = await expectJson(call(app, "/api/admin/users", { cookie: sessionCookie(signedIn) }), 200);
    assert.equal(users.length, 1);
    assert.ok(!JSON.stringify(users).toLowerCase().includes("password"));
    assert.ok(!JSON.stringify(users).includes("scrypt"));
  });
});

test("the Microsoft sign-in route is closed", async () => {
  await withTestApp(async ({ createApp }) => {
    const response = await call(createApp(), "/api/auth/login");
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("set-cookie"), null);
  });
});

test("password routes refuse anything but a JSON body", async () => {
  await withTestApp(async ({ createApp }) => {
    const response = await call(createApp(), "/api/auth/password/sign-in", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Forwarded-For": newIp() },
      body: JSON.stringify({ email: "a@segsolar.com", password: "whatever-1" }),
    });
    assert.equal(response.status, 400);
  });
});

test("one IP trying many addresses is stopped after twenty failures", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const ip = newIp();
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await expectJson(post(app, "/sign-in", { email: `spray-${attempt}@segsolar.com`, password: "Summer2026!" }, { ip }), 401);
    }
    assert.equal((await post(app, "/sign-in", { email: "spray-21@segsolar.com", password: "Summer2026!" }, { ip })).status, 429);
    assert.equal((await post(app, "/sign-in", { email: "spray-21@segsolar.com", password: "Summer2026!" }, { ip: newIp() })).status, 401);
  });
});

function requestChangeLink(app: Express, cookie: string | undefined, csrfToken?: string) {
  return call(app, "/api/auth/password/change-link", {
    method: "POST",
    cookie,
    headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
  });
}

test("a signed-in user can email themselves a link to change their password", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const browser = await createAccount(app, "change@segsolar.com", "Changer", "old-password");
    const session = await expectJson(me(app, browser), 200);
    assert.equal(session.features.passwordSignIn, true);
    const ip = newIp();
    const laptop = sessionCookie(await post(app, "/sign-in", { email: "change@segsolar.com", password: "old-password" }, { ip }));

    assert.equal((await requestChangeLink(app, undefined)).status, 401);
    assert.equal((await requestChangeLink(app, browser)).status, 403, "the CSRF token is required");
    assert.equal(outbox.length, 0);

    assert.deepEqual(await expectJson(requestChangeLink(app, browser, session.csrfToken), 202), { email: "change@segsolar.com" });
    const mail = takeMail("change@segsolar.com");
    assert.match(mail.subject, /Reset your password/);
    assert.match(mail.text, /Hello Changer,/);

    // The old password works until the link is used.
    assert.equal((await post(app, "/sign-in", { email: "change@segsolar.com", password: "old-password" }, { ip })).status, 200);

    const token = tokenFrom(mail);
    assert.equal((await expectJson(post(app, "/link", { token }, { ip }), 200)).newAccount, false);
    const set = await post(app, "/set", { token, password: "new-password" }, { ip });
    assert.equal(set.status, 200);
    assert.equal((await me(app, sessionCookie(set))).status, 200);
    assert.equal((await me(app, browser)).status, 401);
    assert.equal((await me(app, laptop)).status, 401);

    await expectJson(post(app, "/sign-in", { email: "change@segsolar.com", password: "old-password" }, { ip }), 401);
    assert.equal((await post(app, "/sign-in", { email: "change@segsolar.com", password: "new-password" }, { ip })).status, 200);
  });
});

test("an account can ask for three change links a minute", async () => {
  await withTestApp(async ({ createApp }) => {
    const app = createApp();
    const cookie = await createAccount(app, "often@segsolar.com", "Often", "often-password");
    const { csrfToken } = await expectJson(me(app, cookie), 200);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expectJson(requestChangeLink(app, cookie, csrfToken), 202);
    }
    assert.equal((await requestChangeLink(app, cookie, csrfToken)).status, 429);
    assert.equal(outbox.length, 3);
  });
});
