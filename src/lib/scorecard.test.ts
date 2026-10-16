import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreIssueSummary } from "./scorecard";
import type { ScorecardRow } from "../api";

function rowWithSampleQuality(score: number, max: number) {
  return {
    supplier: { id: "sup-1" },
    categories: [
      {
        key: "quality",
        score,
        max,
        children: [{ key: "sampleQuality", score, max }],
      },
    ],
  } as unknown as ScorecardRow;
}

test("a sample quality weighted at zero is not reported as no QC pass", () => {
  assert.equal(scoreIssueSummary({ incomingDefects: [] }, rowWithSampleQuality(0, 0)), "None");
});

test("a sample quality that scores nothing out of its weight is reported as no QC pass", () => {
  assert.equal(scoreIssueSummary({ incomingDefects: [] }, rowWithSampleQuality(0, 20)), "No QC pass");
});
