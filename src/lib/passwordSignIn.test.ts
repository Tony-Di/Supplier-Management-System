import assert from "node:assert/strict";
import { test } from "node:test";

import { emailDomainProblem, newPasswordProblem, passwordLinkToken } from "./passwordSignIn";

test("reads the token from an emailed link's fragment", () => {
  assert.equal(passwordLinkToken("#set-password=Ab_c-123"), "Ab_c-123");
  assert.equal(passwordLinkToken(""), null);
  assert.equal(passwordLinkToken("#set-password="), null);
  assert.equal(passwordLinkToken("#set-password=abc&x=1"), null);
  assert.equal(passwordLinkToken("#other=abc"), null);
});

test("a new password needs 8 characters and a matching confirmation", () => {
  assert.match(newPasswordProblem("short", "short") ?? "", /at least 8/);
  assert.match(newPasswordProblem("long enough", "long enougj") ?? "", /do not match/);
  assert.match(newPasswordProblem("        ", "        ") ?? "", /spaces/);
  assert.match(newPasswordProblem("x".repeat(129), "x".repeat(129)) ?? "", /at most 128/);
  assert.equal(newPasswordProblem("long enough", "long enough"), null);
});

test("only the configured domains can sign up", () => {
  const domains = ["segsolar.com", "segsolar-ind.com"];
  assert.equal(emailDomainProblem(" Ana@SEGSolar.com ", domains), null);
  assert.equal(emailDomainProblem("ana@segsolar-ind.com", domains), null);
  assert.equal(emailDomainProblem("ana@gmail.com", domains), "Use your @segsolar.com or @segsolar-ind.com email address.");
  assert.equal(emailDomainProblem("ana@mail.segsolar.com", domains), "Use your @segsolar.com or @segsolar-ind.com email address.");
  assert.equal(emailDomainProblem("ana", domains), "Enter your work email address.");
  assert.equal(emailDomainProblem("ana@", domains), "Enter your work email address.");
});
