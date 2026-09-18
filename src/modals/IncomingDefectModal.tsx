import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createIncomingDefect } from "../api";
import { useState, FormEvent } from "react";
import { type IncomingDefectRecord } from "../types";
import { uploadMultipleFormFiles } from "../lib/uploads";
import { incomingDefectTypes } from "../constants";

export function IncomingDefectModal({
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
  const [defectQty, setDefectQty] = useState("");
  const [defectAction, setDefectAction] = useState<IncomingDefectRecord["defectAction"]>("Request Replacement");
  const [materialReturned, setMaterialReturned] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const defectActionValue = String(form.get("defectAction") ?? "Request Replacement") as IncomingDefectRecord["defectAction"];
      const materialReturnedValue = String(form.get("materialReturned") ?? "false") === "true";
      const returnDate = String(form.get("returnDate") ?? "") || undefined;
      const poQty = String(form.get("poQty") ?? "") ? Number(form.get("poQty")) : undefined;
      const receivedQty = String(form.get("receivedQty") ?? "") ? Number(form.get("receivedQty")) : undefined;
      const photoUploads = await uploadMultipleFormFiles(form, "photoFiles", "QC Photo", "incoming-defect");
      const attachmentUploads = await uploadMultipleFormFiles(form, "attachmentFiles", "Other", "incoming-defect");
      const actionCompleted = defectActionValue === "Request Credit" || (poQty !== undefined && receivedQty !== undefined && receivedQty >= poQty);
      await createIncomingDefect({
        recordState: "Active",
        supplierId,
        modelId: modelId || undefined,
        itemId,
        poNumber: String(form.get("poNumber") ?? "") || undefined,
        poQty,
        defectType: String(form.get("defectType") ?? "Other") as IncomingDefectRecord["defectType"],
        defectDate: String(form.get("defectDate") ?? ""),
        defectQty: Number(form.get("defectQty") ?? 0),
        receivedQty,
        defectAction: defectActionValue,
        replacementQty: defectActionValue === "Request Replacement" ? Number(form.get("replacementQty") ?? form.get("defectQty") ?? 0) : undefined,
        actionCompleted,
        actionCompletedDate: actionCompleted ? returnDate ?? String(form.get("defectDate") ?? "") : undefined,
        materialReturned: materialReturnedValue,
        returnDate,
        notes: String(form.get("notes") ?? ""),
        photoFileIds: photoUploads.map((file) => file.id),
        attachmentFileIds: attachmentUploads.map((file) => file.id),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to record incoming defect.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Record incoming defect</h2>
            <p>Incoming defects feed supplier Incoming Quality score by recent rejected quantity.</p>
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
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {data.items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="">No model link</option>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Defect Date
            <input name="defectDate" required type="date" />
          </label>
          <label>
            PO Number
            <input name="poNumber" placeholder="PO001" />
          </label>
          <label>
            PO Qty
            <input min="0" name="poQty" step="1" type="number" />
          </label>
          <label>
            Defect Type
            <select name="defectType" defaultValue="Other">
              {incomingDefectTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Defect Qty
            <input min="0" name="defectQty" onChange={(event) => setDefectQty(event.target.value)} required step="1" type="number" value={defectQty} />
          </label>
          <label>
            Initial Received Qty
            <input min="0" name="receivedQty" step="1" type="number" />
          </label>
          <label>
            Action for the Defect
            <select name="defectAction" value={defectAction} onChange={(event) => setDefectAction(event.target.value as IncomingDefectRecord["defectAction"])}>
              {["Request Replacement", "Request Credit"].map((action) => <option key={action}>{action}</option>)}
            </select>
          </label>
          {defectAction === "Request Replacement" && (
            <label>
              Replacement Qty
              <input min="0" name="replacementQty" readOnly step="1" type="number" value={defectQty} />
            </label>
          )}
          <label>Defect Material Returned<select name="materialReturned" value={materialReturned ? "true" : "false"} onChange={(event) => setMaterialReturned(event.target.value === "true")}>{["false", "true"].map((value) => <option key={value} value={value}>{value === "true" ? "Yes" : "No"}</option>)}</select></label>
          {materialReturned && (
            <label>
              Return Date
              <input name="returnDate" type="date" />
            </label>
          )}
          <label>
            Photos
            <input multiple name="photoFiles" type="file" />
          </label>
          <label>
            Attachments
            <input multiple name="attachmentFiles" type="file" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save defect record"}
          </button>
        </div>
      </form>
    </div>
  );
}
