import { type DeleteHandler, type EditTarget, type HistoryHandler, type VoidHandler } from "../uiTypes";
import { useAppData } from "../AppDataContext";
import { useState } from "react";
import { findDuplicateItemCodes } from "../lib/import";
import { Panel } from "../components/Panel";
import { FileStack, Plus } from "lucide-react";
import { StatusPill } from "../components/StatusPill";
import { modelName, itemById, fileRecord, fileUrl } from "../lib/lookups";
import { LifecyclePill } from "../components/LifecyclePill";
import { RecordMenu } from "../components/RecordMenu";
import { canDeleteRecord } from "../lib/recordLifecycle";
import { type DrawingSet } from "../types";
import { TableToolbar } from "../components/TableToolbar";
import { EmptyState } from "../components/EmptyState";
import { Field } from "../components/Field";

export function ModelsAndItems({
  onAddItem,
  onAddModel,
  onDelete,
  onEdit,
  onHistory,
  onImportItems,
  onVoid,
}: {
  onAddItem: () => void;
  onAddModel: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onImportItems: () => void;
  onVoid: VoidHandler;
}) {
  const { data: appData } = useAppData();
  const approvedModels = appData.models.filter((model) => model.recordState !== "Void");
  const [masterView, setMasterView] = useState<"Items" | "Models">("Items");
  const approvedItems = appData.items.filter((item) => item.recordState !== "Void");
  const duplicateItemCodes = findDuplicateItemCodes(appData.items.filter((item) => item.recordState !== "Void"));
  return (
    <section className="pageStack">
      <Panel title="Product master list">
        <div className="itemMasterHeader">
          <div className="itemMasterControls">
            <label className="modelFilterControl">
              View
              <select value={masterView} onChange={(event) => setMasterView(event.target.value as "Items" | "Models")}>
                <option value="Items">Packaging items</option>
                <option value="Models">Models</option>
              </select>
            </label>
          </div>
          <div className="itemMasterActions">
            {masterView === "Items" && (
              <button className="ghostButton" onClick={onImportItems} type="button">
                <FileStack size={16} />
                Import items
              </button>
            )}
            {masterView === "Items" ? (
              <button className="primaryButton" onClick={onAddItem} type="button">
                <Plus size={16} />
                Add item
              </button>
            ) : (
              <button className="primaryButton" onClick={onAddModel} type="button">
                <Plus size={16} />
                Add model
              </button>
            )}
          </div>
        </div>
        <div className="tableScroll">
          {masterView === "Items" ? (
            <table>
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Type</th>
                  <th>Used For</th>
                  <th>UOM</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="stackedCell">
                        <span>{item.itemCode}</span>
                        {duplicateItemCodes.has(item.itemCode.toLowerCase()) && <StatusPill label="Duplicate" />}
                      </div>
                    </td>
                    <td>{item.itemName}</td>
                    <td>{item.type}</td>
                    <td>{item.usedForModels.map((value) => modelName(appData, value)).join(", ")}</td>
                    <td>{item.uom}</td>
                    <td>
                      <div className="tableActions">
                        <LifecyclePill record={item} />
                        <RecordMenu
                          canDelete={canDeleteRecord(appData, "items", item.id)}
                          label={item.itemCode}
                          onDelete={() => onDelete("items", item.id, item.itemCode)}
                          onEdit={() => onEdit({ endpoint: "items", record: item })}
                          onHistory={() => onHistory("Item", item.id, item.itemCode)}
                          onVoid={() => onVoid("items", item.id, item.itemCode)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Product Family</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedModels.map((model) => (
                  <tr key={model.id}>
                    <td>{model.name}</td>
                    <td>{model.productFamily}</td>
                    <td>{model.status}</td>
                    <td>{model.notes}</td>
                    <td>
                      <div className="tableActions">
                        <LifecyclePill record={model} />
                        <RecordMenu
                          canDelete={canDeleteRecord(appData, "models", model.id)}
                          label={model.name}
                          onDelete={() => onDelete("models", model.id, model.name)}
                          onEdit={() => onEdit({ endpoint: "models", record: model })}
                          onHistory={() => onHistory("Model", model.id, model.name)}
                          onVoid={() => onVoid("models", model.id, model.name)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </section>
  );
}

export function DrawingSets({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onVoid: VoidHandler;
}) {
  const { data: appData } = useAppData();
  const [modelFilter, setModelFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"All" | DrawingSet["status"]>("Active");
  const approvedDrawingSets = appData.drawingSets
    .filter((drawingSet) => drawingSet.recordState !== "Void")
    .filter((drawingSet) => modelFilter === "All" || drawingSet.modelId === modelFilter)
    .filter((drawingSet) => statusFilter === "All" || drawingSet.status === statusFilter);
  return (
    <section className="pageStack">
      <TableToolbar
        action="Import packaging set"
        help="A packaging set is one model packaging package: one package PDF can cover multiple items while item-level links remain available for quote and QC."
        onAction={onAdd}
        title="Packaging sets"
      />
      <div className="filterBar">
        <label>
          Model
          <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
            <option value="All">All models</option>
            {appData.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            {["All", "Active", "Superseded", "Draft", "Obsolete"].map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>
      {approvedDrawingSets.length === 0 && <EmptyState text="No packaging sets match the selected filters." />}
      {approvedDrawingSets.map((set) => (
        <Panel key={set.id} title={<PackagingSetTitle set={set} />}>
          <div className="packagingSetHeader">
            <div className="packagingSetSummary">
              <Field label="Model" value={modelName(appData, set.modelId)} />
              <Field label="Effective date" value={set.effectiveDate} />
              <Field label="Maintained by" value={set.maintainedBy} />
              <Field label="Covered items" value={`${set.drawingItems.length} included`} />
            </div>
            <div className="recordActions">
              {set.status !== "Active" && <StatusPill label={set.status} />}
              <LifecyclePill record={set} />
              <RecordMenu
                canDelete={canDeleteRecord(appData, "drawing-sets", set.id)}
                label={set.name}
                onDelete={() => onDelete("drawing-sets", set.id, set.name)}
                onEdit={() => onEdit({ endpoint: "drawing-sets", record: set })}
                onHistory={() => onHistory("DrawingSet", set.id, set.name)}
                onVoid={() => onVoid("drawing-sets", set.id, set.name)}
              />
            </div>
          </div>
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
              {set.drawingItems.map((drawingItem) => {
                const item = itemById(appData, drawingItem.itemId);
                return (
                  <tr key={drawingItem.id}>
                    <td>{item?.itemCode}</td>
                    <td>{item?.itemName}</td>
                    <td>{item?.type}</td>
                    <td>{item?.usedForModels.map((value) => modelName(appData, value)).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ))}
    </section>
  );
}

export function PackagingSetTitle({ set }: { set: DrawingSet }) {
  const { data: appData } = useAppData();
  const title = `${set.name} ${set.revision}`;
  const file = fileRecord(appData, set.packageFileId);
  if (file) {
    return (
      <a className="packagingSetTitleLink" href={fileUrl(file)} rel="noreferrer" target="_blank" title={`Open ${file.fileName}`}>
        {title}
      </a>
    );
  }
  return <span>{title}</span>;
}
