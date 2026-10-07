import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceRoleEligibility } from "./sourceRoleEligibility";
import { fallbackData } from "../appDefaults";
import type { AppData } from "../api";
import type { Quote, SampleInspection } from "../types";

const quote = { id: "q", supplierId: "s", itemId: "i", modelId: "m", drawingSetId: "old", projectId: "p", status: "Selected" } as Quote;
const makeInspection = (patch: Partial<SampleInspection>) => ({ id: "inspection", supplierId: "s", itemId: "i", drawingSetId: "current", sampleRound: 1, sampleReceivedDate: "2026-09-01", result: "Pass", ...patch } as SampleInspection);
const dataWith = (inspections: SampleInspection[]) => ({ ...structuredClone(fallbackData),
  suppliers: [{ id: "s" }], items: [{ id: "i" }], models: [{ id: "m" }],
  projects: [{ id: "p", drawingSetId: "current" }], quotes: [quote], inspections,
} as AppData);

test("a Selected quote can take a source role", () => {
  assert.equal(sourceRoleEligibility(dataWith([]), quote, "p").reason, undefined);
});

test("a quote that is not Selected cannot take a source role, even with a passed sample", () => {
  for (const status of ["Received", "Sample Requested", "No Further Action", "Expired"] as const) {
    assert.equal(sourceRoleEligibility(dataWith([makeInspection({})]), { ...quote, status }, "p").reason, "Quote must be Selected before assigning a source role.");
  }
});

test("a missing quote or a voided supplier blocks assignment", () => {
  assert.ok(sourceRoleEligibility(dataWith([]), undefined).reason);
  const data = dataWith([]); data.suppliers[0].recordState = "Void";
  assert.ok(sourceRoleEligibility(data, quote).reason);
});

for (const [name, inspections, expected] of [
  ["no inspection", [], undefined],
  ["the newest round", [makeInspection({}), makeInspection({ id: "new", sampleRound: 2, result: "Fail" })], "new"],
  ["a voided round is ignored", [makeInspection({}), makeInspection({ id: "void", sampleRound: 2, recordState: "Void" })], "inspection"],
  ["another drawing set is ignored", [makeInspection({ drawingSetId: "old" })], undefined],
  ["a later date wins the same round", [makeInspection({}), makeInspection({ id: "new", sampleReceivedDate: "2026-09-02" })], "new"],
] as Array<[string, SampleInspection[], string | undefined]>) {
  test(`the latest QC record is found for the case: ${name}`, () => {
    assert.equal(sourceRoleEligibility(dataWith(inspections), quote, "p").inspection?.id, expected);
  });
}
