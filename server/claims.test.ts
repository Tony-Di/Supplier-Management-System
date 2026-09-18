import assert from "node:assert/strict";
import { test } from "node:test";

import { validateClaims } from "./auth/claims";

const valid = {
  tid: "seg-tenant",
  oid: "00000000-1111-2222-3333-444444444444",
  preferred_username: "Di.Zhou@segsolar.com",
  name: "Di Zhou",
};

test("maps a valid token to user fields", () => {
  assert.deepEqual(validateClaims(valid, "seg-tenant"), {
    oid: "00000000-1111-2222-3333-444444444444",
    email: "di.zhou@segsolar.com",
    name: "Di Zhou",
  });
});

test("rejects a token from another tenant", () => {
  assert.throws(() => validateClaims({ ...valid, tid: "someone-else" }, "seg-tenant"), /tenant/i);
});

test("rejects a token with no object id", () => {
  assert.throws(() => validateClaims({ ...valid, oid: undefined }, "seg-tenant"), /oid/);
});

test("falls back to the email claim when preferred_username is absent", () => {
  const claims = { ...valid, preferred_username: undefined, email: "di.zhou@segsolar.com" };
  assert.equal(validateClaims(claims, "seg-tenant").email, "di.zhou@segsolar.com");
});

test("falls back to the email local part when no name is present", () => {
  const claims = { ...valid, name: undefined };
  assert.equal(validateClaims(claims, "seg-tenant").name, "Di.Zhou");
});
