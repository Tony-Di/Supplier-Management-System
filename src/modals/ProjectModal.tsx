import { type AppData, createProject } from "../api";
import { useState, useEffect, FormEvent } from "react";
import { activeDrawingSetsForModel } from "../lib/lookups";
import { caseTypeForReason } from "../lib/sourcing";
import { CheckGroup } from "../components/CheckGroup";

export function ProjectModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const firstModelId = data.models[0]?.id ?? "";
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [modelId, setModelId] = useState(firstModelId);
  const [caseReason, setCaseReason] = useState<AppData["projects"][number]["caseReason"]>("Requote");
  const drawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId);
  const [drawingSetId, setDrawingSetId] = useState(drawingSetOptions[0]?.id ?? "");
  const selectedDrawingSet = data.drawingSets.find((drawingSet) => drawingSet.id === drawingSetId);
  const drawingSetItemOptions = selectedDrawingSet?.drawingItems.map((drawingItem) => {
    const item = data.items.find((candidate) => candidate.id === drawingItem.itemId);
    return {
      id: drawingItem.itemId,
      label: `${item?.itemCode ?? "Unknown item"} - ${item?.itemName ?? ""} / ${drawingItem.revision}`,
    };
  }) ?? [];
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<string[]>(drawingSetItemOptions.map((item) => item.id));

  useEffect(() => {
    const nextDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId)[0];
    setDrawingSetId(nextDrawingSet?.id ?? "");
  }, [data.drawingSets, modelId]);

  useEffect(() => {
    const drawingItemIds = drawingSetItemOptions.map((item) => item.id);
    setItemIds((current) => {
      const kept = current.filter((itemId) => drawingItemIds.includes(itemId));
      return kept.length > 0 ? kept : drawingItemIds;
    });
  }, [drawingSetId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createProject({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        modelIds: [modelId],
        drawingSetId,
        type: caseTypeForReason(caseReason),
        caseReason,
        status: "Planning",
        supplierIds,
        itemIds,
        owner: "Purchasing",
        openDate: String(form.get("openDate") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create case.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Create development case</h2>
            <p>A case groups one quoting/sample activity, such as change work order, requote, or full package development.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Case Name
            <input name="name" required placeholder="BTA Packaging Local Supplier Development" />
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label>
            Packaging Set
            <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {drawingSetOptions.map((drawingSet) => (
                <option key={drawingSet.id} value={drawingSet.id}>{drawingSet.name} {drawingSet.revision}</option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <select name="caseReason" value={caseReason} onChange={(event) => setCaseReason(event.target.value as AppData["projects"][number]["caseReason"])}>
              {["New Supplier Intro", "Change Work Order", "Requote", "Re-source", "Backup Supplier", "Price Check"].map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </label>
          <label>
            Open Date
            <input name="openDate" required type="date" defaultValue="2026-08-04" />
          </label>
        </div>
        <CheckGroup
          items={data.suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
          label="Suppliers linked"
          selectedIds={supplierIds}
          setSelectedIds={setSupplierIds}
        />
        <CheckGroup
          items={drawingSetItemOptions}
          label="Drawing items included"
          selectedIds={itemIds}
          setSelectedIds={setItemIds}
        />
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingSetId || itemIds.length === 0} type="submit">
            {saving ? "Saving..." : "Save case"}
          </button>
        </div>
      </form>
    </div>
  );
}
