import { type Quote } from "../types";
import { useState } from "react";
import { useAppData } from "../AppDataContext";
import { useSession } from "../SessionContext";
import { quoteStatusOptions } from "../constants";
import { manualSelection } from "../lib/selection";

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
  const selection = manualSelection(data, quote, features.previousOrderSelection);
  const sampleRequired = quote.status !== "Selected" && selection === "Sample Required";

  async function changeStatus(status: Quote["status"]) {
    let change: QuoteStatusChange = { status };
    if (status === "Selected" && selection === "Previous Orders") {
      const reference = window.prompt("This supplier has supplied this item before, so no sample is needed.\nPO number (optional):", "");
      if (reference === null) return;
      change = { status, statusBasis: "Previous Orders", statusReference: reference.trim() || undefined };
    }
    setSaving(true);
    await onChange(quote.id, change);
    setSaving(false);
  }

  return (
    <label className="inlineStatusSelect">
      <select
        aria-label="Quote status"
        disabled={saving}
        onChange={(event) => void changeStatus(event.target.value as Quote["status"])}
        value={quote.status}
      >
        {quoteStatusOptions.map((status) => (
          <option disabled={status === "Selected" && sampleRequired} key={status} value={status}>
            {status === "Selected" && sampleRequired ? "Selected (request a sample first)" : status}
          </option>
        ))}
      </select>
    </label>
  );
}
