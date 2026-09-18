import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, createQuote } from "../api";
import { useAppData } from "../AppDataContext";
import { useState, useEffect, FormEvent } from "react";
import { type Quote } from "../types";
import { activeDrawingSetsForModel, itemById } from "../lib/lookups";
import { todayDateString } from "../lib/format";
import { uploadOptionalFormFile } from "../lib/uploads";
import { quoteStatusOptions } from "../constants";

export function QuoteModal({
  data,
  projectId,
  onClose,
  onCreated,
}: {
  data: AppData;
  projectId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { data: appData } = useAppData();
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [quoteType, setQuoteType] = useState<Quote["quoteType"]>(project ? "Case-linked" : "Standalone");
  const [modelId, setModelId] = useState(project?.modelIds[0] ?? data.models[0]?.id ?? "");
  const quoteDrawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId, project?.drawingSetId);
  const [drawingSetId, setDrawingSetId] = useState(project?.drawingSetId ?? quoteDrawingSetOptions[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayDateString());
  const drawingSet = data.drawingSets.find((candidate) => candidate.id === drawingSetId);
  const supplierOptions = data.suppliers.filter((supplier) => supplier.recordState !== "Void");
  const projectItems = project?.itemIds.length ? data.items.filter((item) => project.itemIds.includes(item.id)) : data.items.filter((item) => item.usedForModels.includes(modelId));
  const [supplierId, setSupplierId] = useState(supplierOptions[0]?.id ?? "");
  const selectedSupplier = supplierOptions.find((supplier) => supplier.id === supplierId);
  const modelScopedItems = quoteType === "Case-linked" && project ? projectItems : data.items.filter((item) => item.usedForModels.includes(modelId));
  const itemOptions = modelScopedItems.filter((item) =>
    item.recordState !== "Void" &&
    item.status === "Active" &&
    (!selectedSupplier || selectedSupplier.capableItems.includes(item.type)),
  );
  const [itemId, setItemId] = useState(itemOptions[0]?.id ?? "");
  const drawingItemId = drawingSet?.drawingItems.find((drawingItem) => drawingItem.itemId === itemId)?.id ?? "";

  useEffect(() => {
    if (!supplierOptions.some((supplier) => supplier.id === supplierId)) setSupplierId(supplierOptions[0]?.id ?? "");
    if (!itemOptions.some((item) => item.id === itemId)) setItemId(itemOptions[0]?.id ?? "");
    const matchingDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId)[0];
    if (!matchingDrawingSet || drawingSet?.modelId !== modelId) setDrawingSetId(matchingDrawingSet?.id ?? "");
  }, [data.drawingSets, drawingSet?.modelId, drawingSetId, itemId, itemOptions, modelId, supplierId, supplierOptions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (!drawingSet || !drawingItemId) throw new Error("Packaging set and item link must exist first.");
      const attachmentUpload = await uploadOptionalFormFile(form, "attachmentFile", "Quote Attachment", "quote");
      const effectiveFromValue = String(form.get("effectiveFrom") ?? "");
      await createQuote({
        recordState: "Active",
        supplierId,
        projectId: quoteType === "Case-linked" ? project?.id : undefined,
        quoteType,
        quoteReason: String(form.get("quoteReason") ?? "New Quote") as Quote["quoteReason"],
        previousQuoteId: undefined,
        modelId,
        itemId,
        drawingSetId: drawingSet.id,
        drawingItemId,
        quoteDate: effectiveFromValue,
        effectiveFrom: effectiveFromValue,
        effectiveTo: String(form.get("effectiveTo") ?? "") || undefined,
        validUntil: undefined,
        currency: "USD",
        uom: itemById(appData, itemId)?.uom ?? "pcs",
        unitPrice: Number(form.get("unitPrice") ?? 0),
        moq: String(form.get("moq") ?? ""),
        leadTime: String(form.get("leadTime") ?? ""),
        extraCostType: String(form.get("extraCostType") ?? "None") as Quote["extraCostType"],
        extraCostAmount: Number(form.get("extraCostAmount") ?? 0),
        status: String(form.get("status") ?? "Received") as Quote["status"],
        attachmentFileId: attachmentUpload?.id,
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create quote.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add quote</h2>
            <p>Quotes can be standalone for single-item supplier intro, or linked to a development case.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        <div className="formGrid">
          <label>
            Quote Mode
            <select value={quoteType} onChange={(event) => setQuoteType(event.target.value as Quote["quoteType"])}>
              <option>Standalone</option>
              <option disabled={!project}>Case-linked</option>
            </select>
          </label>
          <label>
            Quote Reason
            <select name="quoteReason" defaultValue="New Quote">
              {["New Quote", "Requote", "Price Check", "Change Work Order", "Model Change"].map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set
            <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId).map((set) => <option key={set.id} value={set.id}>{set.name} {set.revision}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Effective From
            <input name="effectiveFrom" onChange={(event) => setEffectiveFrom(event.target.value)} required type="date" value={effectiveFrom} />
          </label>
          <label>
            Effective To
            <input name="effectiveTo" type="date" />
          </label>
          <label>
            Unit Price USD
            <input min="0" name="unitPrice" required step="0.001" type="number" />
          </label>
          <label>
            MOQ
            <input name="moq" placeholder="100 pcs, 500 pcs, MOQ 1 truckload" required />
          </label>
          <label>
            Lead Time
            <input name="leadTime" placeholder="8 business days, 2-3 weeks, TBD" required />
          </label>
          <label>
            Extra Cost Type
            <select name="extraCostType" defaultValue="None">
              {["None", "Freight", "Sample", "Tooling", "Packaging Test", "Other"].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Extra Cost Amount
            <input min="0" name="extraCostAmount" step="0.001" type="number" defaultValue="0" />
          </label>
          <label>
            Status
            <select name="status" defaultValue="Received">
              {quoteStatusOptions.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Quote Attachment
            <input name="attachmentFile" type="file" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingItemId} type="submit">
            {saving ? "Saving..." : "Save quote"}
          </button>
        </div>
      </form>
    </div>
  );
}
