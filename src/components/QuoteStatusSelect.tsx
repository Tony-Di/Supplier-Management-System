import { type Quote } from "../types";
import { useState, type FormEvent } from "react";
import { useAppData } from "../AppDataContext";
import { useSession } from "../SessionContext";
import { quoteStatusOptions } from "../constants";
import { manualSelection, previousOrdersSelection } from "../lib/selection";

export type QuoteStatusChange = Pick<Quote, "status" | "statusBasis" | "statusReference">;

export function QuoteStatusSelect({
  onChange,
  quote,
}: {
  onChange: (quoteId: string, change: QuoteStatusChange) => Promise<void>;
  quote: Quote;
}) {
  const { data } = useAppData();
  const { features } = useSession();
  const [saving, setSaving] = useState(false);
  const [confirmingPreviousOrders, setConfirmingPreviousOrders] = useState(false);
  const selection = manualSelection(data, quote, features.previousOrderSelection);
  const sampleRequired = quote.status !== "Selected" && selection === "Sample Required";

  async function save(change: QuoteStatusChange) {
    setSaving(true);
    await onChange(quote.id, change);
    setSaving(false);
  }

  function changeStatus(status: Quote["status"]) {
    if (status === "Selected" && selection === "Previous Orders") {
      setConfirmingPreviousOrders(true);
      return;
    }
    void save({ status });
  }

  function confirmPreviousOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setConfirmingPreviousOrders(false);
    void save(previousOrdersSelection(String(form.get("statusReference") ?? "")));
  }

  return (
    <>
      <label className="inlineStatusSelect">
        <select
          aria-label="Quote status"
          disabled={saving}
          onChange={(event) => changeStatus(event.target.value as Quote["status"])}
          value={quote.status}
        >
          {quoteStatusOptions.map((status) => (
            <option disabled={status === "Selected" && sampleRequired} key={status} value={status}>
              {status === "Selected" && sampleRequired ? "Selected (request a sample first)" : status}
            </option>
          ))}
        </select>
      </label>
      {confirmingPreviousOrders && (
        <div className="modalBackdrop" role="presentation">
          <form aria-label="Confirm previous orders" className="modalPanel compactModal" onSubmit={confirmPreviousOrders}>
            <div className="modalHeader">
              <div>
                <h2>Select without a sample</h2>
                <p>Selected is allowed without a sample only when this supplier has supplied this item before.</p>
              </div>
            </div>
            <div className="formGrid">
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
            </div>
            <div className="modalActions">
              <button className="ghostButton" onClick={() => setConfirmingPreviousOrders(false)} type="button">Cancel</button>
              <button className="primaryButton" type="submit">Set Selected</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
