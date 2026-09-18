import { type EditTarget } from "../../uiTypes";
import { useAppData } from "../../AppDataContext";
import { useState, FormEvent } from "react";
import { buildEditPatch, editTitle } from "./editHelpers";
import { EditFields } from "./EditFields";

export function EditRecordModal({
  onClose,
  onSave,
  target,
}: {
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  target: EditTarget;
}) {
  const { data: appData } = useAppData();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const patch = buildEditPatch(target, form);
      setSaving(true);
      setFormError("");
      await onSave(patch);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Edit record</h2>
            <p>{editTitle(appData, target)}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <div className="formGrid">
          <EditFields target={target} />
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}
