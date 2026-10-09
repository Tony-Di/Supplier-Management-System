import { useState } from "react";
import { useAppData } from "../AppDataContext";
import { useSession } from "../SessionContext";
import { quoteStatusOptions } from "../constants";
import { manualSelection } from "../lib/selection";
import { type Quote } from "../types";

/**
 * The status picker of the quote forms. Selected is offered only when the
 * supplier may be selected by hand; a previous-order selection asks the buyer
 * to confirm and takes an optional PO number.
 */
export function QuoteStatusField({ defaultValue, quote }: { defaultValue: Quote["status"]; quote: Pick<Quote, "id" | "supplierId" | "itemId"> }) {
  const { data } = useAppData();
  const { features } = useSession();
  const [status, setStatus] = useState(defaultValue);
  const alreadySelected = defaultValue === "Selected";
  const selection = manualSelection(data, quote, features.previousOrderSelection);
  const sampleRequired = !alreadySelected && selection === "Sample Required";

  return (
    <>
      <label>
        Status
        <select name="status" value={status} onChange={(event) => setStatus(event.target.value as Quote["status"])}>
          {quoteStatusOptions.map((option) => (
            <option disabled={option === "Selected" && sampleRequired} key={option} value={option}>
              {option === "Selected" && sampleRequired ? "Selected (request a sample first)" : option}
            </option>
          ))}
        </select>
      </label>
      {status === "Selected" && !alreadySelected && selection === "Previous Orders" && (
        <div className="formSection fullSpan">
          <label className="checkboxOption">
            <input name="previousOrdersConfirmed" required type="checkbox" />
            This supplier has supplied this item before; no sample is needed.
          </label>
          <label>
            PO number (optional)
            <input name="statusReference" placeholder="PO-12345" />
          </label>
        </div>
      )}
    </>
  );
}
