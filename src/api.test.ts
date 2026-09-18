import assert from "node:assert/strict";
import { test } from "node:test";
import { updateRecord } from "./api";

test("rejected requests preserve the server's exact business rule message", async () => {
  const originalFetch = globalThis.fetch;
  const message = "Supplier is voided and cannot be used on new records.";
  globalThis.fetch = async () => new Response(JSON.stringify({ message }), { status: 400 });
  try {
    await assert.rejects(updateRecord("quotes", "review", { unitPrice: 25 }), (error) => error instanceof Error && error.message === message);
  } finally { globalThis.fetch = originalFetch; }
});
