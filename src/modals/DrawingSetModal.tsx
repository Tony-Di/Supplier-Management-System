import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createDrawingSet } from "../api";
import { useAppData } from "../AppDataContext";
import { useState, FormEvent } from "react";
import { isPublishedRecord } from "../lib/recordLifecycle";
import { nextPackagingSetRevision, buildDrawingRowsFromModelItems } from "../lib/import";
import { uploadOptionalFormFile } from "../lib/uploads";
import { modelName } from "../lib/lookups";
import { Panel } from "../components/Panel";

export function DrawingSetModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { data: appData } = useAppData();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const modelItems = data.items.filter((item) => isPublishedRecord(item) && item.usedForModels.includes(modelId));
  const nextRevision = nextPackagingSetRevision(data.drawingSets, modelId);
  const drawingRows = buildDrawingRowsFromModelItems(modelItems, nextRevision);
  const activeDrawingSet = data.drawingSets.find((drawingSet) => drawingSet.modelId === modelId && drawingSet.status === "Active" && drawingSet.recordState !== "Void");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const drawingSetRevision = nextRevision;
      const drawingPackageUpload = await uploadOptionalFormFile(form, "drawingPackageFile", "Drawing", "drawing-set");
      const drawingItems = drawingRows.map((row) => {
        const item = modelItems.find((candidate) => candidate.itemCode.toLowerCase() === row.itemCode.toLowerCase());
        if (!item) throw new Error(`Item Code is not active for selected model: ${row.itemCode}`);
        return {
          itemId: item.id,
          revision: row.revision || drawingSetRevision,
          status: "Active" as const,
          drawingSource: "Package PDF" as const,
          fileName: undefined,
          fileId: undefined,
        };
      });
      await createDrawingSet({
        recordState: "Active",
        modelId,
        name: String(form.get("name") ?? ""),
        revision: drawingSetRevision,
        status: "Active",
        effectiveDate: String(form.get("effectiveDate") ?? ""),
        maintainedBy: String(form.get("maintainedBy") ?? "Process Engineering"),
        packageFileId: drawingPackageUpload?.id,
        packageFileName: drawingPackageUpload?.fileName,
        replaceActive: true,
        drawingItems,
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to import packaging set.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Import packaging set</h2>
            <p>Upload one package PDF for a model and link the covered items for quote and QC tracking.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        {data.models.length === 0 && <div className="formError">Create a model before importing a packaging set.</div>}
        {data.models.length > 0 && modelItems.length === 0 && (
          <div className="formError">Create at least one item for this model before importing a packaging set.</div>
        )}
        <div className="formGrid packagingImportGrid">
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set Name
            <input name="name" required placeholder="SEG-620-BTC_BG_210R" />
          </label>
          <label>
            Effective Date
            <input name="effectiveDate" required type="date" />
          </label>
          <label>
            Maintained By
            <input name="maintainedBy" defaultValue="Process Engineering" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Package PDF
          <input name="drawingPackageFile" required type="file" />
        </label>
        <div className="notice modalNotice">
          This packaging set will cover all {modelItems.length} active item{modelItems.length === 1 ? "" : "s"} currently linked to {modelName(appData, modelId)}.
        </div>
        {activeDrawingSet && (
          <div className="notice modalNotice">
            Current active package for {modelName(appData, modelId)} is {activeDrawingSet.name} {activeDrawingSet.revision}. The new import will be saved as version {nextRevision} and replace it for user-facing workflow while keeping the old version in audit history.
          </div>
        )}
        <Panel title={`Version ${nextRevision} covers ${drawingRows.length} item${drawingRows.length === 1 ? "" : "s"}`}>
          <table>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Packaging Type</th>
                <th>Used For</th>
              </tr>
            </thead>
            <tbody>
              {drawingRows.map((row) => {
                const item = modelItems.find((candidate) => candidate.itemCode === row.itemCode);
                return (
                <tr key={`${row.itemCode}-${row.revision}-${row.fileName}`}>
                  <td>{row.itemCode}</td>
                  <td>{item?.itemName ?? "-"}</td>
                  <td>{item?.type ?? "-"}</td>
                  <td>{item?.usedForModels.map((value) => modelName(appData, value)).join(", ") ?? "-"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !modelId || modelItems.length === 0 || drawingRows.length === 0} type="submit">
            {saving ? "Importing..." : "Import packaging set"}
          </button>
        </div>
      </form>
    </div>
  );
}
