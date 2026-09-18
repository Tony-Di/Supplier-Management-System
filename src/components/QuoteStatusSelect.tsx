import { type Quote } from "../types";
import { useState } from "react";
import { quoteStatusOptions } from "../constants";

export function QuoteStatusSelect({
  onChange,
  quote,
}: {
  onChange: (quoteId: string, status: Quote["status"]) => Promise<void>;
  quote: Quote;
}) {
  const [saving, setSaving] = useState(false);

  async function changeStatus(status: Quote["status"]) {
    setSaving(true);
    await onChange(quote.id, status);
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
        {quoteStatusOptions.map((status) => <option key={status}>{status}</option>)}
      </select>
    </label>
  );
}
