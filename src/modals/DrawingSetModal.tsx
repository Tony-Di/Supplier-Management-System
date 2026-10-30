import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createDrawingSet } from "../api";
import { useAppData } from "../AppDataContext";
import { useState, FormEvent } from "react";
import { isPublishedRecord } from "../lib/recordLifecycle";
import { nextPackagingSetRevision, buildDrawingRowsFromModelItems, modelFromFileName, packagingSetNameFromFileName } from "../lib/import";
import { uploadOptionalFormFile } from "../lib/uploads";
import { uploadAccept } from "../constants";
import { modelName } from "../lib/lookups";
import { Panel } from "../components/Panel";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";

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
  // No model is preselected, so a PDF cannot land on the first model unnoticed.
  const [modelId, setModelId] = useState("");
  const [fileModelId, setFileModelId] = useState("");
  const [linkItemIds, setLinkItemIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  // The name follows the chosen PDF until the user types their own.
  const [nameFromFile, setNameFromFile] = useState("");
  const linkedItems = data.items.filter((item) => isPublishedRecord(item) && item.usedForModels.includes(modelId));
  // Items shared with other models can be linked to this one as the set is imported.
  const linkableItems = modelId ? data.items.filter((item) => isPublishedRecord(item) && item.status === "Active" && !item.usedForModels.includes(modelId)) : [];
  const linkingItems = linkableItems.filter((item) => linkItemIds.includes(item.id));
  const modelItems = [...linkedItems, ...linkingItems];
  const nextRevision = nextPackagingSetRevision(data.drawingSets, modelId);
  const drawingRows = buildDrawingRowsFromModelItems(modelItems, nextRevision);
  const activeDrawingSet = data.drawingSets.find((drawingSet) => drawingSet.modelId === modelId && drawingSet.status === "Active" && drawingSet.recordState !== "Void");

  function chooseModel(nextModelId: string) {
    setModelId(nextModelId);
    setLinkItemIds([]);
  }

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
        name,
        revision: drawingSetRevision,
        status: "Active",
        effectiveDate: String(form.get("effectiveDate") ?? ""),
        maintainedBy: String(form.get("maintainedBy") ?? "Process Engineering"),
        packageFileId: drawingPackageUpload?.id,
        packageFileName: drawingPackageUpload?.fileName,
        replaceActive: true,
        linkItemIds: linkingItems.map((item) => item.id),
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
        <div className="formGrid packagingImportGrid">
          <label>
            Model
            <select value={modelId} onChange={(event) => chooseModel(event.target.value)} required>
              <option disabled value="">Select model</option>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set Name
            <input name="name" required placeholder="SEG-620-BTC_BG_210R" value={name} onChange={(event) => setName(event.target.value)} />
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
          <input
            name="drawingPackageFile"
            required
            type="file"
            accept={uploadAccept}
            onChange={(event) => {
              const file = event.target.files?.[0];
              const fileModel = file ? modelFromFileName(file.name, data.models) : undefined;
              setFileModelId(fileModel?.id ?? "");
              if (fileModel && !modelId) chooseModel(fileModel.id);
              if (!file || (name && name !== nameFromFile)) return;
              const fileName = packagingSetNameFromFileName(file.name);
              setName(fileName);
              setNameFromFile(fileName);
            }}
          />
        </label>
        {fileModelId && modelId && fileModelId !== modelId && (
          <div className="formError">
            The PDF name points to {modelName(appData, fileModelId)}, but this packaging set will be saved for {modelName(appData, modelId)}. Check the Model.
          </div>
        )}
        {!modelId && <div className="notice modalNotice">Choose the model this PDF belongs to, or pick a PDF named after the model.</div>}
        {modelId && (
          <div className="notice modalNotice">
            {linkedItems.length > 0
              ? `This packaging set will cover all ${linkedItems.length} active item${linkedItems.length === 1 ? "" : "s"} currently linked to ${modelName(appData, modelId)}.`
              : `${modelName(appData, modelId)} has no items yet. Pick the items this packaging set covers below; they will be linked to ${modelName(appData, modelId)}.`}
          </div>
        )}
        {modelId && linkableItems.length > 0 && (
          <MultiSelectDropdown
            items={linkableItems.map((item) => ({ id: item.id, label: `${item.itemCode} · ${item.itemName}` }))}
            label={`Also link items to ${modelName(appData, modelId)}`}
            selectedIds={linkItemIds}
            setSelectedIds={setLinkItemIds}
          />
        )}
        {/* Said rather than hidden, so the option is not mistaken for missing. */}
        {modelId && linkableItems.length === 0 && (
          <div className="multiSelectField">
            <span>Also link items to {modelName(appData, modelId)}</span>
            <span className="muted linkItemsEmpty">
              Every active item is already linked to {modelName(appData, modelId)}. To cover a new item, add it under Models &amp; Items first.
            </span>
          </div>
        )}
        {activeDrawingSet && (
          <div className="notice modalNotice">
            Current active package for {modelName(appData, modelId)} is {activeDrawingSet.name} {activeDrawingSet.revision}. The new import will be saved as version {nextRevision} and replace it for user-facing workflow while keeping the old version in audit history.
          </div>
        )}
        {modelId && (
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
                    <td>
                      {item?.usedForModels.map((value) => modelName(appData, value)).join(", ") ?? "-"}
                      {item && linkingItems.includes(item) && <span className="muted"> + {modelName(appData, modelId)} (new link)</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
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
