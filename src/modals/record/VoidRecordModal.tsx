import { type VoidTarget } from "../../uiTypes";
import { useState, FormEvent } from "react";

export function VoidRecordModal({
  onClose,
  onVoid,
  target,
}: {
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
  target: VoidTarget;
}) {
  const [reason, setReason] = useState("Entered in error");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    await onVoid(reason.trim() || "Entered in error");
    setSaving(false);
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Void record</h2>
            <p>{target.label}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <label className="fullWidthLabel">
          Void reason
          <textarea onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="dangerButton" disabled={saving} type="submit">
            {saving ? "Voiding..." : "Void record"}
          </button>
        </div>
      </form>
    </div>
  );
}
