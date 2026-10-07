import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDispositionForResult, isQuoteInQcQueue, qcProgress, qcQueueActionLabel } from "./sourcing";
import type { Quote, SampleInspection } from "../types";

test("a conditional sample needs another round by default", () => {
  assert.equal(defaultDispositionForResult("Conditional"), "Re-sample Required");
  assert.equal(defaultDispositionForResult("Fail"), "Re-sample Required");
  assert.equal(defaultDispositionForResult("Pass"), "Accepted");
});

const sampled = { id: "q", status: "Sample Requested", recordState: "Active" } as Quote;
const round = (sampleRound: number, result: SampleInspection["result"], disposition: SampleInspection["disposition"], patch: Partial<SampleInspection> = {}) =>
  ({ id: `ins-${sampleRound}`, relatedQuoteId: "q", sampleRound, sampleReceivedDate: `2026-09-0${sampleRound}`, result, disposition, recordState: "Active", ...patch }) as SampleInspection;
const progress = (quote: Quote, inspections: SampleInspection[]) => qcProgress({ inspections }, quote);

test("QC progress names the round and where it stands", () => {
  assert.deepEqual(progress(sampled, []), { label: "Round 1 – Waiting for Sample", tone: "pending" });
  assert.deepEqual(progress(sampled, [round(1, "Not Submitted", "Pending")]), { label: "Round 1 – Pending Inspection", tone: "pending" });
  assert.deepEqual(progress(sampled, [round(1, "Fail", "Re-sample Required")]), { label: "Round 1 Rejected – Waiting for Round 2", tone: "rejected" });
  assert.deepEqual(progress(sampled, [round(1, "Conditional", "Re-sample Required")]), { label: "Round 1 Rejected – Waiting for Round 2", tone: "rejected" });
  assert.deepEqual(progress(sampled, [round(1, "Fail", "Re-sample Required"), round(2, "Not Submitted", "Pending")]), { label: "Round 2 – Pending Inspection", tone: "pending" });
  assert.deepEqual(progress(sampled, [round(1, "Fail", "Re-sample Required"), round(2, "Fail", "No Further Action")]), { label: "Round 2 Rejected – No Further Action", tone: "rejected" });
  assert.deepEqual(progress({ ...sampled, status: "Selected" }, [round(1, "Fail", "Re-sample Required"), round(2, "Pass", "Accepted")]), { label: "Round 2 Passed", tone: "pass" });
});

test("QC progress ignores a voided round", () => {
  assert.equal(progress(sampled, [round(1, "Fail", "Re-sample Required"), round(2, "Pass", "Accepted", { recordState: "Void" })]).label, "Round 1 Rejected – Waiting for Round 2");
});

test("a quote selected without a sample says why no sample was needed", () => {
  assert.deepEqual(progress({ ...sampled, status: "Selected", statusBasis: "Existing Supplier" }, []), { label: "No Sample Needed – Existing Supplier", tone: "pass" });
  assert.equal(progress({ ...sampled, status: "Selected", statusBasis: "Previous Orders" }, []).label, "No Sample Needed – Previous Orders");
  assert.equal(progress({ ...sampled, status: "Selected", statusBasis: "Migration" }, []).label, "No Sample Needed – Existing Supplier");
  assert.deepEqual(progress({ ...sampled, status: "Received" }, []), { label: "No sample requested", tone: "neutral" });
});

test("the QC queue holds exactly the quotes waiting for a sample", () => {
  assert.equal(isQuoteInQcQueue(sampled), true);
  assert.equal(isQuoteInQcQueue({ ...sampled, recordState: "Void" }), false);
  for (const status of ["Received", "Selected", "No Further Action", "Expired"] as const) assert.equal(isQuoteInQcQueue({ ...sampled, status }), false);
});

test("a rejected round asks QC to receive the next sample", () => {
  assert.equal(qcQueueActionLabel({ inspections: [] }, sampled), "Receive sample");
  assert.equal(qcQueueActionLabel({ inspections: [round(1, "Conditional", "Re-sample Required")] }, sampled), "Receive next sample");
  assert.equal(qcQueueActionLabel({ inspections: [round(1, "Fail", "Re-sample Required")] }, sampled), "Receive next sample");
});
