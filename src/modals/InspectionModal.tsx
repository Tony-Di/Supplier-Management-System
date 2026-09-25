import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createInspection } from "../api";
import { useAppData } from "../AppDataContext";
import { useState, useEffect, FormEvent } from "react";
import { activeDrawingSetsForModel, itemCode, drawingFileLabel } from "../lib/lookups";
import { caseSupplierIds, nextInspectionRoundForQuote, defaultDispositionForResult } from "../lib/sourcing";
import { type SampleInspection } from "../types";
import { uploadMultipleFormFiles } from "../lib/uploads";
import { uploadAccept } from "../constants";
import { formatMoney } from "../lib/format";

export function InspectionModal({
  data,
  projectId,
  quoteId,
  caseContextId,
  onClose,
  onCreated,
}: {
  data: AppData;
  projectId?: string;
  quoteId?: string;
  caseContextId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { data: appData } = useAppData();
  const sourceQuote = data.quotes.find((quote) => quote.id === quoteId);
  const caseContext = data.projects.find((candidate) => candidate.id === caseContextId);
  const contextDrawingSet = data.drawingSets.find((set) => set.id === caseContext?.drawingSetId);
  const project = caseContext ?? data.projects.find((candidate) => candidate.id === (sourceQuote?.projectId ?? projectId));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [inspectionMode, setInspectionMode] = useState<"Standalone" | "Case-linked">(sourceQuote?.projectId || project ? "Case-linked" : "Standalone");
  const [modelId, setModelId] = useState(contextDrawingSet?.modelId ?? sourceQuote?.modelId ?? project?.modelIds[0] ?? data.models[0]?.id ?? "");
  const inspectionDrawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId, contextDrawingSet?.id ?? sourceQuote?.drawingSetId ?? project?.drawingSetId);
  const [drawingSetId, setDrawingSetId] = useState(contextDrawingSet?.id ?? sourceQuote?.drawingSetId ?? project?.drawingSetId ?? inspectionDrawingSetOptions[0]?.id ?? "");
  const drawingSet = data.drawingSets.find((candidate) => candidate.id === drawingSetId);
  const supplierOptions = inspectionMode === "Case-linked" && project ? data.suppliers.filter((supplier) => caseSupplierIds(appData, project).includes(supplier.id)) : data.suppliers;
  const itemOptions = inspectionMode === "Case-linked" && project ? data.items.filter((item) => project.itemIds.includes(item.id)) : data.items.filter((item) => item.usedForModels.includes(modelId));
  const [supplierId, setSupplierId] = useState(sourceQuote?.supplierId ?? supplierOptions[0]?.id ?? "");
  const [itemId, setItemId] = useState(sourceQuote?.itemId ?? itemOptions[0]?.id ?? "");
  const drawingItemId = (caseContext ? undefined : sourceQuote?.drawingItemId) ?? drawingSet?.drawingItems.find((drawingItem) => drawingItem.itemId === itemId)?.id ?? "";
  const selectedDrawingItem = drawingSet?.drawingItems.find((drawingItem) => drawingItem.id === drawingItemId);
  const lockedToQuote = Boolean(sourceQuote);
  const nextRound = sourceQuote ? nextInspectionRoundForQuote(appData, sourceQuote.id) : 1;
  const [result, setResult] = useState<SampleInspection["result"]>("Not Submitted");

  useEffect(() => {
    if (sourceQuote) return;
    if (!supplierOptions.some((supplier) => supplier.id === supplierId)) setSupplierId(supplierOptions[0]?.id ?? "");
    if (!itemOptions.some((item) => item.id === itemId)) setItemId(itemOptions[0]?.id ?? "");
    const matchingDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId)[0];
    if (!matchingDrawingSet || drawingSet?.modelId !== modelId) setDrawingSetId(matchingDrawingSet?.id ?? "");
  }, [data.drawingSets, drawingSet?.modelId, drawingSetId, itemId, itemOptions, modelId, sourceQuote, supplierId, supplierOptions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (!drawingSet || !drawingItemId) throw new Error("Packaging set and item link must exist first.");
      const result = String(form.get("result") ?? "Not Submitted") as SampleInspection["result"];
      const photoUploads = await uploadMultipleFormFiles(form, "photoFiles", "QC Photo", "inspection");
      const disposition = result === "Pass" || result === "Not Submitted"
        ? defaultDispositionForResult(result)
        : String(form.get("disposition") ?? defaultDispositionForResult(result)) as SampleInspection["disposition"];
      await createInspection({
        recordState: "Active",
        supplierId,
        projectId: caseContext?.id ?? sourceQuote?.projectId ?? (inspectionMode === "Case-linked" ? project?.id : undefined),
        relatedQuoteId: sourceQuote?.id ?? (String(form.get("relatedQuoteId") ?? "") || undefined),
        modelId,
        drawingSetId: drawingSet.id,
        itemId,
        drawingItemId,
        sampleRound: Number(form.get("sampleRound") ?? nextRound),
        sampleReceivedDate: String(form.get("sampleReceivedDate") ?? ""),
        inspectionDate: String(form.get("inspectionDate") ?? "") || undefined,
        inspector: String(form.get("inspector") ?? "") || undefined,
        result,
        disposition,
        problemPhotos: photoUploads.length,
        photoFileIds: photoUploads.map((file) => file.id),
        notes: String(form.get("notes") ?? ""),
        signedDate: result === "Not Submitted" ? undefined : String(form.get("signedDate") ?? "") || undefined,
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create inspection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add QC inspection</h2>
            <p>QC records are item-level, even when the drawing is managed as a full model packaging set.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        <div className="formGrid">
          <label>
            QC Mode
            <select disabled={lockedToQuote} value={inspectionMode} onChange={(event) => setInspectionMode(event.target.value as "Standalone" | "Case-linked")}>
              <option>Standalone</option>
              <option disabled={!project}>Case-linked</option>
            </select>
          </label>
          <label>
            Related Quote
            <select disabled={lockedToQuote} name="relatedQuoteId" defaultValue={sourceQuote?.id ?? ""}>
              <option value="">No related quote</option>
              {data.quotes
                .filter((quote) => quote.supplierId === supplierId && quote.itemId === itemId)
                .map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Model
            <select disabled={lockedToQuote} value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set
            <select disabled={lockedToQuote} value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId).map((set) => <option key={set.id} value={set.id}>{set.name} {set.revision}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select disabled={lockedToQuote} value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select disabled={lockedToQuote} value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Sample Round
            <input min="1" name="sampleRound" readOnly={lockedToQuote} step="1" type="number" defaultValue={nextRound} />
          </label>
          <label>
            Sample Received Date
            <input name="sampleReceivedDate" required type="date" />
          </label>
          <label>
            Inspection Date
            <input name="inspectionDate" type="date" />
          </label>
          <label>
            Inspector
            <input name="inspector" placeholder="QC name" />
          </label>
          <label>
            Result
            <select name="result" value={result} onChange={(event) => setResult(event.target.value as SampleInspection["result"])}>
              {["Pass", "Fail", "Conditional", "Not Submitted"].map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          {result !== "Pass" && result !== "Not Submitted" && (
            <label>
              Action
              <select name="disposition" defaultValue={result === "Conditional" ? "Conditional Approval" : "Re-sample Required"}>
                {["Re-sample Required", "Conditional Approval"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          )}
          <label>
            Problem Photos
            <input multiple name="photoFiles" type="file" accept={uploadAccept} />
          </label>
          <label>
            Signed Date
            <input name="signedDate" type="date" />
          </label>
        </div>
        <div className="notice modalNotice">
          Packaging package: {drawingSet ? `${drawingSet.name} ${drawingSet.revision}` : "-"} / item link: {selectedDrawingItem ? itemCode(appData, selectedDrawingItem.itemId) : "No packaging item linked"} / PDF: {drawingFileLabel(appData, selectedDrawingItem, drawingSet)}
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} placeholder="QC notes or issue summary" />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingItemId} type="submit">
            {saving ? "Saving..." : "Save inspection"}
          </button>
        </div>
      </form>
    </div>
  );
}
