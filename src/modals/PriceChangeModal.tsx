import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createPriceChange } from "../api";
import { useState, FormEvent } from "react";
import { type PriceChange } from "../types";
import { formatMoney } from "../lib/format";

export function PriceChangeModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const [itemId, setItemId] = useState(data.items[0]?.id ?? "");
  const quoteOptions = data.quotes.filter((quote) => quote.supplierId === supplierId && quote.itemId === itemId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createPriceChange({
        supplierId,
        modelId,
        itemId,
        sourceQuoteId: String(form.get("sourceQuoteId") ?? "") || undefined,
        previousQuoteId: String(form.get("previousQuoteId") ?? "") || undefined,
        sourceType: String(form.get("sourceType") ?? "Manual") as PriceChange["sourceType"],
        oldPrice: Number(form.get("oldPrice") ?? 0),
        newPrice: Number(form.get("newPrice") ?? 0),
        currency: "USD",
        effectiveDate: String(form.get("effectiveDate") ?? ""),
        reason: String(form.get("reason") ?? "Other") as PriceChange["reason"],
        status: String(form.get("status") ?? "Pending") as PriceChange["status"],
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to log price change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Log price change</h2>
            <p>Price changes can be manual or linked to quote/requote history for the same supplier and item.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        <div className="formGrid">
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {data.items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Source Type
            <select name="sourceType" defaultValue="Manual">
              {["Manual", "Requote", "New Quote", "Purchase"].map((source) => <option key={source}>{source}</option>)}
            </select>
          </label>
          <label>
            Previous Quote
            <select name="previousQuoteId" defaultValue="">
              <option value="">No previous quote</option>
              {quoteOptions.map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Source Quote
            <select name="sourceQuoteId" defaultValue="">
              <option value="">No source quote</option>
              {quoteOptions.map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Old Price
            <input min="0" name="oldPrice" required step="0.001" type="number" />
          </label>
          <label>
            New Price
            <input min="0" name="newPrice" required step="0.001" type="number" />
          </label>
          <label>
            Effective Date
            <input name="effectiveDate" required type="date" />
          </label>
          <label>
            Reason
            <select name="reason" defaultValue="Other">
              {["Material", "Freight", "Labor", "Negotiated", "Model Change", "Drawing Change", "Requote", "Change Work Order", "Other"].map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="Pending">
              {["Pending", "Approved", "Rejected"].map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save price change"}
          </button>
        </div>
      </form>
    </div>
  );
}
