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
