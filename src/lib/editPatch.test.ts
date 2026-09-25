import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEditPatch } from "../modals/record/editHelpers";
import type { Quote } from "../types";

const quote = { id: "q1", recordState: "Active", effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" } as Quote;

function quoteForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

test("a quote edit sends the reason for a changed Effective To", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, quoteForm({ effectiveTo: "2026-05-31", changeReason: "Supplier notice" }));
  assert.equal(patch.effectiveTo, "2026-05-31");
  assert.equal(patch.changeReason, "Supplier notice");
});

test("a quote edit without a reason sends none", () => {
  const patch = buildEditPatch({ endpoint: "quotes", record: quote }, quoteForm({ effectiveTo: "2026-06-30", changeReason: "" }));
  assert.equal("changeReason" in patch, false);
});
