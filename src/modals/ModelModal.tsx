import { ErrorNotice } from "../components/ErrorNotice";
import { useState, FormEvent } from "react";
import { createModel } from "../api";
import { type Model } from "../types";

export function ModelModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createModel({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        productFamily: String(form.get("productFamily") ?? "Solar Module"),
        status: String(form.get("status") ?? "Active") as Model["status"],
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create model.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add model</h2>
            <p>Create the module/model first so items and drawings can link to it.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />

        <div className="formGrid">
          <label>
            Model
            <input name="name" required placeholder="BTA, BTC..." />
          </label>
          <label>
            Product Family
            <input name="productFamily" defaultValue="Solar Module" />
          </label>
          <label>
            Status
            <select name="status" defaultValue="Active">
              {["Active", "Inactive"].map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save model"}
          </button>
        </div>
      </form>
    </div>
  );
}
