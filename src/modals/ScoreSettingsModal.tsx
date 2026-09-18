import { useState, FormEvent } from "react";
import { type ScoreWeights } from "../types";
import { updateScoreWeights } from "../api";

export function ScoreSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const defaultWeights: ScoreWeights = {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weights: ScoreWeights = {
      sampleQuality: Number(form.get("sampleQuality") ?? 0),
      incomingQuality: Number(form.get("incomingQuality") ?? 0),
      pricing: Number(form.get("pricing") ?? 0),
      responsiveness: Number(form.get("responsiveness") ?? 0),
      scopeFit: Number(form.get("scopeFit") ?? 0),
      setup: Number(form.get("setup") ?? 0),
    };
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total !== 100) {
      setFormError("Score weights must add up to 100.");
      return;
    }
    setSaving(true);
    setFormError("");

    try {
      await updateScoreWeights(weights);
      await onSaved();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to save score settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Score settings</h2>
            <p>Weights control how supplier scorecard categories add up to 100.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Sample Quality
            <input defaultValue={defaultWeights.sampleQuality} min="0" name="sampleQuality" step="1" type="number" />
          </label>
          <label>
            Incoming Quality
            <input defaultValue={defaultWeights.incomingQuality} min="0" name="incomingQuality" step="1" type="number" />
          </label>
          <label>
            Pricing
            <input defaultValue={defaultWeights.pricing} min="0" name="pricing" step="1" type="number" />
          </label>
          <label>
            Responsiveness
            <input defaultValue={defaultWeights.responsiveness} min="0" name="responsiveness" step="1" type="number" />
          </label>
          <label>
            Scope Fit
            <input defaultValue={defaultWeights.scopeFit} min="0" name="scopeFit" step="1" type="number" />
          </label>
          <label>
            Lead Time
            <input defaultValue={defaultWeights.setup} min="0" name="setup" step="1" type="number" />
          </label>
        </div>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
