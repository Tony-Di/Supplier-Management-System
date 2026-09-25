import { availableRecordOptions } from "../../lib/recordOptions";
import { useMemo } from "react";
import { type EditTarget } from "../../uiTypes";
import { useAppData } from "../../AppDataContext";
import { useState, useEffect } from "react";
import { type PackagingItemType } from "../../types";
import { MultiSelectDropdown } from "../../components/MultiSelectDropdown";
import { packagingItemOptions, quoteStatusOptions } from "../../constants";
import { isPublishedRecord } from "../../lib/recordLifecycle";
import { modelName, activeDrawingSetsForModel, itemById } from "../../lib/lookups";
import { InspectionEditFields } from "./InspectionEditFields";
import { IncomingDefectEditFields } from "./IncomingDefectEditFields";

export function EditFields({ target }: { target: EditTarget }) {
  const { data } = useAppData();
  const appData = useMemo(() => availableRecordOptions(data), [data]);
  if (target.endpoint === "suppliers") {
    const record = target.record;
    const [capableItems, setCapableItems] = useState<PackagingItemType[]>(record.capableItems);
    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>Supplier Type<select name="type" defaultValue={record.type}>{["Manufacturer", "Distributor", "Service", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>ERP Vendor ID<input name="erpVendorId" defaultValue={record.erpVendorId ?? ""} /></label>
        <label>Country<input name="country" defaultValue={record.country} /></label>
        <label>Region<input name="region" defaultValue={record.region} /></label>
        <label>Contact<input name="primaryContact" defaultValue={record.primaryContact} /></label>
        <label>Email<input name="email" defaultValue={record.email} /></label>
        <label>Phone<input name="phone" defaultValue={record.phone} /></label>
        <label>Payment Terms<input name="paymentTerms" defaultValue={record.paymentTerms} placeholder="Net 30, Net 45..." /></label>
        <label>W-9<select name="hasW9" defaultValue={record.hasW9 ? "true" : "false"}>{["true", "false"].map((value) => <option key={value} value={value}>{value === "true" ? "Uploaded" : "Missing"}</option>)}</select></label>
        <label>Payment Info<select name="hasPaymentInfo" defaultValue={record.hasPaymentInfo ? "true" : "false"}>{["true", "false"].map((value) => <option key={value} value={value}>{value === "true" ? "Uploaded" : "Missing"}</option>)}</select></label>
        <input name="capableItemsJson" type="hidden" value={JSON.stringify(capableItems)} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={packagingItemOptions.map((item) => ({ id: item, label: item }))}
            label="Capable packaging items"
            selectedIds={capableItems}
            setSelectedIds={setCapableItems}
          />
        </div>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "models") {
    const record = target.record;
    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>Product Family<input name="productFamily" defaultValue={record.productFamily} /></label>
        <label>Status<select name="status" defaultValue={record.status}>{["Active", "Inactive"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "items") {
    const record = target.record;
    const [usedForModels, setUsedForModels] = useState<string[]>(record.usedForModels);
    return (
      <>
        <label>Item Code<input name="itemCode" defaultValue={record.itemCode} required /></label>
        <label>Item Name<input name="itemName" defaultValue={record.itemName} required /></label>
        <label>Type<select name="type" defaultValue={record.type}>{packagingItemOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>UOM<select name="uom" defaultValue={record.uom}>{["pcs", "set", "bundle", "lb", "kg"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={record.status}>{["Active", "Inactive"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <input name="usedForModelsJson" type="hidden" value={JSON.stringify(usedForModels)} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={appData.models.filter((model) => model.recordState !== "Void").map((model) => ({ id: model.id, label: model.name }))}
            label="Used for models"
            selectedIds={usedForModels}
            setSelectedIds={setUsedForModels}
          />
        </div>
      </>
    );
  }

  if (target.endpoint === "drawing-sets") {
    const record = target.record;
    const modelItems = appData.items.filter((item) => isPublishedRecord(item) && item.usedForModels.includes(record.modelId));
    const syncedDrawingItems = modelItems.map((item) => ({
      itemId: item.id,
      revision: record.revision,
      status: "Active",
      drawingSource: "Package PDF",
    }));
    return (
      <>
        <label>Packaging Set Name<input name="name" defaultValue={record.name} required /></label>
        <label>Effective Date<input name="effectiveDate" defaultValue={record.effectiveDate} type="date" required /></label>
        <label>Maintained By<input name="maintainedBy" defaultValue={record.maintainedBy} /></label>
        <input name="drawingItemsJson" type="hidden" value={JSON.stringify(syncedDrawingItems)} />
        <div className="notice modalNotice fullSpan">
          This packaging set covers all {modelItems.length} active item{modelItems.length === 1 ? "" : "s"} linked to {modelName(appData, record.modelId)}. Import a new packaging set to replace the PDF/version.
        </div>
      </>
    );
  }

  if (target.endpoint === "projects") {
    const record = target.record;
    const [modelId, setModelId] = useState(record.modelIds[0] ?? appData.models[0]?.id ?? "");
    const drawingSetOptions = activeDrawingSetsForModel(appData.drawingSets, modelId, record.drawingSetId);
    const [drawingSetId, setDrawingSetId] = useState(
      drawingSetOptions.some((drawingSet) => drawingSet.id === record.drawingSetId)
        ? record.drawingSetId
        : drawingSetOptions[0]?.id ?? "",
    );
    const selectedDrawingSet = appData.drawingSets.find((drawingSet) => drawingSet.id === drawingSetId);
    const drawingSetItemOptions = selectedDrawingSet?.drawingItems.map((drawingItem) => {
      const item = itemById(appData, drawingItem.itemId);
      return {
        id: drawingItem.itemId,
        label: `${item?.itemCode ?? "Unknown item"} - ${item?.itemName ?? ""} / ${drawingItem.revision}`,
      };
    }) ?? [];
    const [supplierIds, setSupplierIds] = useState<string[]>(record.supplierIds);
    const [itemIds, setItemIds] = useState<string[]>(record.itemIds);

    useEffect(() => {
      const nextDrawingSet = activeDrawingSetsForModel(appData.drawingSets, modelId, record.drawingSetId)[0];
      setDrawingSetId((current) => drawingSetOptions.some((drawingSet) => drawingSet.id === current) ? current : nextDrawingSet?.id ?? "");
    }, [modelId]);

    useEffect(() => {
      const drawingItemIds = drawingSetItemOptions.map((item) => item.id);
      setItemIds((current) => {
        const kept = current.filter((itemId) => drawingItemIds.includes(itemId));
        return kept.length > 0 ? kept : drawingItemIds;
      });
    }, [drawingSetId]);

    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>
          Model
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
            {appData.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label>
          Packaging Set
          <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
            {drawingSetOptions.map((drawingSet) => <option key={drawingSet.id} value={drawingSet.id}>{drawingSet.name} {drawingSet.revision}</option>)}
          </select>
        </label>
        <label>
          Reason
          <select name="caseReason" defaultValue={record.caseReason}>
            {["New Supplier Intro", "Change Work Order", "Requote", "Re-source", "Backup Supplier", "Price Check"].map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
        </label>
        <input name="supplierIdsJson" type="hidden" value={JSON.stringify(supplierIds)} />
        <input name="itemIdsJson" type="hidden" value={JSON.stringify(itemIds)} />
        <input name="modelId" type="hidden" value={modelId} />
        <input name="drawingSetId" type="hidden" value={drawingSetId} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={appData.suppliers.filter((supplier) => supplier.recordState !== "Void").map((supplier) => ({ id: supplier.id, label: supplier.name }))}
            label="Suppliers linked"
            selectedIds={supplierIds}
            setSelectedIds={setSupplierIds}
          />
        </div>
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={drawingSetItemOptions}
            label="Drawing items in this case"
            selectedIds={itemIds}
            setSelectedIds={setItemIds}
          />
        </div>
      </>
    );
  }

  if (target.endpoint === "quotes") {
    const record = target.record;
    return (
      <>
        <label>Unit Price<input min="0" name="unitPrice" defaultValue={record.unitPrice} step="0.001" type="number" required /></label>
        <label>MOQ<input name="moq" defaultValue={record.moq} required /></label>
        <label>Lead Time<input name="leadTime" defaultValue={record.leadTime} required /></label>
        <label>Effective From<input name="effectiveFrom" defaultValue={record.effectiveFrom ?? record.quoteDate} type="date" required /></label>
        <label>Effective To<input name="effectiveTo" defaultValue={record.effectiveTo ?? ""} type="date" /></label>
        <label>Reason for changing Effective To<input name="changeReason" placeholder="Required only when Effective To changes" /></label>
        <label>Extra Cost Type<select name="extraCostType" defaultValue={record.extraCostType ?? "None"}>{["None", "Freight", "Sample", "Tooling", "Packaging Test", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Extra Cost Amount<input min="0" name="extraCostAmount" defaultValue={record.extraCostAmount ?? 0} step="0.001" type="number" /></label>
        <label>Status<select name="status" defaultValue={record.status}>{quoteStatusOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "inspections") {
    return <InspectionEditFields record={target.record} />;
  }

  if (target.endpoint === "incoming-defects") {
    return <IncomingDefectEditFields record={target.record} />;
  }

  if (target.endpoint === "purchase-prices") {
    const record = target.record;
    return (
      <>
        <label>PO Number<input name="poNumber" defaultValue={record.poNumber} required /></label>
        <label>Order Date<input name="orderDate" defaultValue={record.orderDate} type="date" required /></label>
        <label>Unit Price<input min="0" name="unitPrice" defaultValue={record.unitPrice} step="0.001" type="number" required /></label>
        <label>Quantity<input min="0" name="quantity" defaultValue={record.quantity} step="1" type="number" required /></label>
        <label>Buyer<input name="buyer" defaultValue={record.buyer} /></label>
        <label>Source<select name="sourceType" defaultValue={record.sourceType}>{["ERP Import", "Manual Import"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  const record = target.record;
  return (
    <>
      <label>Old Price<input min="0" name="oldPrice" defaultValue={record.oldPrice} step="0.001" type="number" required /></label>
      <label>New Price<input min="0" name="newPrice" defaultValue={record.newPrice} step="0.001" type="number" required /></label>
      <label>Status<select name="status" defaultValue={record.status}>{["Pending", "Approved", "Rejected"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Reason<select name="reason" defaultValue={record.reason}>{["Material", "Freight", "Labor", "Negotiated", "Model Change", "Drawing Change", "Requote", "Change Work Order", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </>
  );
}
