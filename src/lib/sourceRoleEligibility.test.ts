import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceRoleEligibility } from "./sourceRoleEligibility";
import { latestInspection, qcAllowsSourceRole } from "../../server/rules";
import { fallbackData } from "../appDefaults";
import type { AppData } from "../api";
import type { Quote, SampleInspection } from "../types";

const quote = { id: "q", supplierId: "s", itemId: "i", modelId: "m", drawingSetId: "old", projectId: "p" } as Quote;
const makeInspection = (patch: Partial<SampleInspection>) => ({ id: "inspection", supplierId: "s", itemId: "i", drawingSetId: "current", sampleRound: 1, sampleReceivedDate: "2026-09-01", result: "Pass", ...patch } as SampleInspection);
const dataWith = (inspections: SampleInspection[]) => ({ ...structuredClone(fallbackData),
  suppliers: [{ id: "s" }], items: [{ id: "i" }], models: [{ id: "m" }],
  projects: [{ id: "p", drawingSetId: "current" }], quotes: [quote], inspections,
} as AppData);

for (const [name, inspections] of [
  ["no inspection", []],
  ["pass", [makeInspection({})]],
  ["conditional", [makeInspection({ result: "Conditional" })]],
  ["failed resample supersedes old pass", [makeInspection({}), makeInspection({ id: "new", sampleRound: 2, result: "Fail" })]],
  ["voided fail is ignored", [makeInspection({}), makeInspection({ sampleRound: 2, result: "Fail", recordState: "Void" })]],
  ["other drawing set is ignored", [makeInspection({ drawingSetId: "old" })]],
  ["later date wins the same sample round", [makeInspection({}), makeInspection({ id: "new", sampleReceivedDate: "2026-09-02", result: "Fail" })]],
] as Array<[string, SampleInspection[]]>) {
  test(`source role eligibility matches backend: ${name}`, () => {
    const data = dataWith(inspections);
    const backend = latestInspection(inspections, { supplierId: "s", itemId: "i", drawingSetId: "current", sourceQuoteId: "q" });
    const frontend = sourceRoleEligibility(data, quote, "p");
    assert.equal(frontend.inspection?.id, backend?.id);
    assert.equal(frontend.reason === undefined, qcAllowsSourceRole(backend));
  });
}

test("voided supplier blocks assignment even with a passed sample", () => {
  const data = dataWith([makeInspection({})]); data.suppliers[0].recordState = "Void";
  assert.ok(sourceRoleEligibility(data, quote).reason);
});
