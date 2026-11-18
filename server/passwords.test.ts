import assert from "node:assert/strict";
import { test } from "node:test";

import { hashLinkToken, hashPassword, newLinkToken, passwordProblem, verifyPassword } from "./passwords";
import { passwordLinkUrl, signUpMail } from "./passwordMail";

test("a hashed password verifies, and nothing else does", async () => {
  const hash = await hashPassword("packaging-2026");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes("packaging-2026"));
  assert.equal(await verifyPassword("packaging-2026", hash), true);
  assert.equal(await verifyPassword("packaging-2027", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes differently each time", async () => {
  assert.notEqual(await hashPassword("same-password"), await hashPassword("same-password"));
});

test("an account without a password never verifies", async () => {
  assert.equal(await verifyPassword("anything", null), false);
  assert.equal(await verifyPassword("anything", undefined), false);
  assert.equal(await verifyPassword("", ""), false);
});

test("a new password needs 8 to 128 characters that are not all spaces", () => {
  assert.match(passwordProblem("short") ?? "", /at least 8/);
  assert.match(passwordProblem("x".repeat(129)) ?? "", /at most 128/);
  assert.match(passwordProblem(" ".repeat(10)) ?? "", /spaces/);
  assert.equal(passwordProblem("eight ch"), null);
});

test("only the hash of a link token is kept", () => {
  const { token, tokenHash } = newLinkToken();
  assert.match(token, /^[\w-]{43}$/);
  assert.equal(tokenHash, hashLinkToken(token));
  assert.notEqual(tokenHash, token);
  assert.notEqual(newLinkToken().token, token);
});

test("the emailed link carries its token in the fragment and the name is escaped", () => {
  const url = passwordLinkUrl("https://sourcing.segsolar.com", "abc_123-x");
  assert.equal(url, "https://sourcing.segsolar.com/#set-password=abc_123-x");
  const mail = signUpMail("a@segsolar.com", "<b>Ana</b> & Co", url);
  assert.match(mail.text, /Hello <b>Ana<\/b> & Co,/);
  assert.match(mail.html, /Hello &#60;b&#62;Ana&#60;\/b&#62; &#38; Co,/);
  assert.match(mail.text, /Set your password: https:\/\/sourcing\.segsolar\.com\/#set-password=abc_123-x/);
});
