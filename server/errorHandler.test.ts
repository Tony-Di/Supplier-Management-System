import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";

import { ClaimError } from "./auth/claims";
import { errorHandler } from "./errorHandler";

function fakeResponse() {
  const captured: { statusCode?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return response;
    },
    json(body: unknown) {
      captured.body = body;
    },
  };
  return { response: response as unknown as Response, captured };
}

test("a ClaimError surfaces as its own status and message, not a generic 500", () => {
  const { response, captured } = fakeResponse();
  const error = new ClaimError("This account belongs to a different tenant.");

  errorHandler(error, {} as Request, response, (() => undefined) as NextFunction);

  assert.equal(captured.statusCode, 403);
  assert.deepEqual(captured.body, { message: "This account belongs to a different tenant." });
});

function respond(error: unknown) {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;
  errorHandler(error, {} as Request, response, () => {});
  return sent;
}

const databaseError = (code: string, message: string) => Object.assign(new Error(message), { code });

test("a foreign key refusal from Postgres is a 400 with a plain message", () => {
  assert.deepEqual(respond(databaseError("23503", 'insert or update on table "suppliers" violates foreign key constraint')), {
    status: 400,
    body: { message: "This change refers to a record that does not exist, or removes one that other records still use." },
  });
});

test("an impossible date from Postgres is a 400", () => {
  assert.deepEqual(respond(databaseError("22008", "date/time field value out of range")), {
    status: 400,
    body: { message: "A date is not valid." },
  });
});

test("any other error stays a 500 without detail", () => {
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(respond(databaseError("ECONNREFUSED", "connect ECONNREFUSED")), { status: 500, body: { message: "Internal server error" } });
  } finally {
    console.error = original;
  }
});
