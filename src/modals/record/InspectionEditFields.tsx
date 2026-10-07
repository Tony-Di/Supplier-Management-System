import { type SampleInspection } from "../../types";
import { rejectedSampleActions } from "../../lib/sourcing";
import { useState } from "react";

export function InspectionEditFields({ record }: { record: SampleInspection }) {
  const [result, setResult] = useState<SampleInspection["result"]>(record.result);
  const showAction = result !== "Pass" && result !== "Not Submitted";

  return (
    <>
      <label>
        Result
        <select name="result" value={result} onChange={(event) => setResult(event.target.value as SampleInspection["result"])}>
          {["Pass", "Fail", "Conditional", "Not Submitted"].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      {showAction && (
        <label>
          Action
          <select name="disposition" defaultValue={rejectedSampleActions.includes(record.disposition) ? record.disposition : "Re-sample Required"}>
            {rejectedSampleActions.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      )}
      <label>Sample Round<input min="1" name="sampleRound" defaultValue={record.sampleRound} step="1" type="number" /></label>
      <label>Sample Received<input name="sampleReceivedDate" defaultValue={record.sampleReceivedDate} type="date" required /></label>
      <label>Inspector<input name="inspector" defaultValue={record.inspector ?? ""} /></label>
      <label>Signed Date<input name="signedDate" defaultValue={record.signedDate ?? ""} type="date" /></label>
      <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
    </>
  );
}
