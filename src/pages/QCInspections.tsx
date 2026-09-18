import { isUsableRecord } from "../lib/recordOptions";
import { type DeleteHandler, type EditTarget, type HistoryHandler, type VoidHandler } from "../uiTypes";
import { type SampleInspection, type IncomingDefectRecord } from "../types";
import { useAppData } from "../AppDataContext";
import { useState } from "react";
import { isSampleRequestedQuote, isQuoteInQcQueue, latestInspectionForQuote, qcQueueStatus, qcQueueActionLabel } from "../lib/sourcing";
import { TableToolbar } from "../components/TableToolbar";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { supplierName, itemCode, drawingSetName } from "../lib/lookups";
import { formatMoney } from "../lib/format";
import { StatusPill } from "../components/StatusPill";
import { PhotoFileReferences } from "../components/PhotoFileReferences";
import { LifecyclePill } from "../components/LifecyclePill";
import { RecordMenu } from "../components/RecordMenu";
import { canDeleteRecord } from "../lib/recordLifecycle";
import { isIncomingDefectPendingReceive, isIncomingDefectComplete, incomingDefectCurrentReceivedQty, incomingDefectPendingQty } from "../lib/defects";
import { exportIncomingDefectHistory } from "../lib/exports";
import { incomingDefectActionLabel } from "../lib/defectTimeline";
import { IncomingDefectFiles } from "../components/IncomingDefectFiles";

export function SampleInspections({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onRecordQuote,
  onView,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onRecordQuote: (quoteId: string) => void;
  onView: (inspection: SampleInspection) => void;
  onVoid: VoidHandler;
}) {
  const { data: appData } = useAppData();
  const [sourceFilter, setSourceFilter] = useState<"All" | "From Quote" | "Standalone">("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState<"All" | SampleInspection["result"]>("All");
  const sampleRequestedQuotes = appData.quotes.filter((quote) => isSampleRequestedQuote(quote) && quote.recordState !== "Void");
  const queueQuotes = sampleRequestedQuotes.filter((quote) => isQuoteInQcQueue(appData, quote));
  const visibleInspections = appData.inspections
    .filter((inspection) => inspection.recordState !== "Void")
    .filter((inspection) => sourceFilter === "All" || (sourceFilter === "Standalone" ? !inspection.relatedQuoteId : Boolean(inspection.relatedQuoteId)))
    .filter((inspection) => supplierFilter === "All" || inspection.supplierId === supplierFilter)
    .filter((inspection) => itemFilter === "All" || inspection.itemId === itemFilter)
    .filter((inspection) => resultFilter === "All" || inspection.result === resultFilter)
    .sort((a, b) => (b.inspectionDate ?? b.sampleReceivedDate).localeCompare(a.inspectionDate ?? a.sampleReceivedDate));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Add standalone inspection"
        help="Sample Requested quotes enter this queue. Waiting sample and pending inspection are shown in one place."
        onAction={onAdd}
        title="QC sample inspection"
      />
      <Panel title="QC sample queue">
        <div className="tableViewport"><table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Item</th>
              <th>Quote</th>
              <th>Drawing</th>
              <th>Round</th>
              <th>QC Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {queueQuotes.length === 0 && (
              <tr>
                <td colSpan={7}><EmptyState text="No sample requested quotes are waiting for QC." /></td>
              </tr>
            )}
            {queueQuotes.map((quote) => {
              const latestInspection = latestInspectionForQuote(appData, quote.id);
              const nextRound = latestInspection?.result === "Not Submitted" ? latestInspection.sampleRound : (latestInspection?.sampleRound ?? 0) + 1;
              return (
                <tr key={`qc-queue-${quote.id}`}>
                  <td>{supplierName(appData, quote.supplierId)}</td>
                  <td>{itemCode(appData, quote.itemId)}</td>
                  <td>{formatMoney(quote.unitPrice)} / {quote.effectiveFrom ?? quote.quoteDate}</td>
                  <td>{drawingSetName(appData, quote.drawingSetId)}</td>
                  <td>Round {nextRound}</td>
                  <td><StatusPill label={qcQueueStatus(appData, quote)} /></td>
                  <td>
                    {latestInspection?.result === "Not Submitted" ? (
                      <button className="ghostButton" onClick={() => onEdit({ endpoint: "inspections", record: latestInspection })} type="button">Complete inspection</button>
                    ) : (
                      <button className="ghostButton" onClick={() => onRecordQuote(quote.id)} type="button">{qcQueueActionLabel(appData, quote)}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Inspection records">
        <div className="quoteFilters compactRecordFilters">
          <label>
            Source
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
              <option>All</option>
              <option>From Quote</option>
              <option>Standalone</option>
            </select>
          </label>
          <label>
            Comparison Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {appData.suppliers.filter(isUsableRecord).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {appData.items.filter(isUsableRecord).map((item) => <option key={item.id} value={item.id}>{item.itemCode}</option>)}
            </select>
          </label>
          <label>
            Result
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as typeof resultFilter)}>
              <option>All</option>
              <option>Pass</option>
              <option>Fail</option>
              <option>Conditional</option>
              <option>Not Submitted</option>
            </select>
          </label>
        </div>
        <div className="tableViewport"><table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Round</th>
              <th>Received</th>
              <th>Inspected</th>
              <th>Result</th>
              <th>Photos</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleInspections.length === 0 && (
              <tr>
                <td colSpan={8}><EmptyState text="No inspection records match the filters." /></td>
              </tr>
            )}
            {visibleInspections.map((inspection) => {
              return (
                <tr key={`inspection-record-${inspection.id}`}>
                  <td>{inspection.relatedQuoteId ? "From Quote" : "Standalone"}</td>
                  <td>{supplierName(appData, inspection.supplierId)}</td>
                  <td>{itemCode(appData, inspection.itemId)}</td>
                  <td>Round {inspection.sampleRound}</td>
                  <td>{inspection.sampleReceivedDate}</td>
                  <td>{inspection.inspectionDate ?? "Pending"}</td>
                  <td><StatusPill label={inspection.result} /></td>
                  <td><PhotoFileReferences inspection={inspection} /></td>
                  <td>
                    <div className="tableActions">
                      <LifecyclePill record={inspection} />
                      <RecordMenu
                        canDelete={canDeleteRecord(appData, "inspections", inspection.id)}
                        label={`${supplierName(appData, inspection.supplierId)} ${itemCode(appData, inspection.itemId)} inspection`}
                        onDelete={() => onDelete("inspections", inspection.id, "inspection")}
                        onEdit={() => onEdit({ endpoint: "inspections", record: inspection })}
                        onHistory={() => onHistory("Inspection", inspection.id, `${supplierName(appData, inspection.supplierId)} / ${itemCode(appData, inspection.itemId)} Round ${inspection.sampleRound}`)}
                        onView={() => onView(inspection)}
                        onVoid={() => onVoid("inspections", inspection.id, "inspection")}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>
    </section>
  );
}

export function IncomingDefects({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onView,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onView: (defect: IncomingDefectRecord) => void;
  onVoid: VoidHandler;
}) {
  const { data: appData } = useAppData();
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [poFilter, setPoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Pending" | "Complete">("All");
  const [actionFilter, setActionFilter] = useState<"All" | IncomingDefectRecord["defectAction"]>("All");
  const allActiveDefects = appData.incomingDefects
    .filter((defect) => defect.recordState !== "Void")
    .sort((a, b) => b.defectDate.localeCompare(a.defectDate));
  const filteredDefects = allActiveDefects
    .filter((defect) => defect.recordState !== "Void")
    .filter((defect) => supplierFilter === "All" || defect.supplierId === supplierFilter)
    .filter((defect) => itemFilter === "All" || defect.itemId === itemFilter)
    .filter((defect) => !poFilter.trim() || (defect.poNumber ?? "").toLowerCase().includes(poFilter.trim().toLowerCase()))
    .filter((defect) => actionFilter === "All" || defect.defectAction === actionFilter)
    .filter((defect) => statusFilter === "All" || (statusFilter === "Pending" ? isIncomingDefectPendingReceive(defect) : isIncomingDefectComplete(defect)))
    .sort((a, b) => b.defectDate.localeCompare(a.defectDate));
  const pendingReceiveDefects = allActiveDefects.filter((defect) => isIncomingDefectPendingReceive(defect));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Record incoming defect"
        extraActions={<button className="ghostButton" onClick={() => exportIncomingDefectHistory(appData, filteredDefects)} type="button">Export historical record</button>}
        help="Incoming defects track rejected or returned production receipts and feed the supplier Incoming Quality score."
        onAction={onAdd}
        title="Incoming defects and returns"
      />
      <Panel title="Pending receive queue">
        <div className="tableViewport"><table className="compactComparison">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>PO Qty</th>
              <th>Received Qty</th>
              <th>Defect Qty</th>
              <th>Pending Qty</th>
              <th>Returned</th>
              <th>Menu</th>
            </tr>
          </thead>
          <tbody>
            {pendingReceiveDefects.length === 0 && (
              <tr>
                <td colSpan={10}><EmptyState text="No replacement receipt is pending." /></td>
              </tr>
            )}
            {pendingReceiveDefects.map((defect) => (
              <tr key={defect.id}>
                <td>{defect.poNumber ?? "-"}</td>
                <td>{defect.defectDate}</td>
                <td>{supplierName(appData, defect.supplierId)}</td>
                <td>{itemCode(appData, defect.itemId)}</td>
                <td>{defect.poQty ?? "-"}</td>
                <td>{incomingDefectCurrentReceivedQty(defect) || "-"}</td>
                <td>{defect.defectQty}</td>
                <td>{incomingDefectPendingQty(defect)}</td>
                <td>{defect.materialReturned ? `Yes${defect.returnDate ? ` / ${defect.returnDate}` : ""}` : "No"}</td>
                <td>
                  <div className="tableActions">
                    <LifecyclePill record={defect} />
                    <RecordMenu
                      canDelete={canDeleteRecord(appData, "incoming-defects", defect.id)}
                      label={`${supplierName(appData, defect.supplierId)} ${itemCode(appData, defect.itemId)} incoming defect`}
                      onDelete={() => onDelete("incoming-defects", defect.id, "incoming defect")}
                      onEdit={() => onEdit({ endpoint: "incoming-defects", record: defect })}
                      onHistory={() => onHistory("IncomingDefect", defect.id, `${supplierName(appData, defect.supplierId)} / ${itemCode(appData, defect.itemId)}`)}
                      onView={() => onView(defect)}
                      onVoid={() => onVoid("incoming-defects", defect.id, "incoming defect")}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Incoming defect records">
        <div className="quoteFilters compactRecordFilters">
          <label>
            Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {appData.suppliers.filter(isUsableRecord).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {appData.items.filter(isUsableRecord).map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            PO Number
            <input placeholder="Search PO" value={poFilter} onChange={(event) => setPoFilter(event.target.value)} />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option>All</option>
              <option>Pending</option>
              <option>Complete</option>
            </select>
          </label>
          <label>
            Action
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as typeof actionFilter)}>
              <option>All</option>
              <option>Request Credit</option>
              <option>Request Replacement</option>
            </select>
          </label>
        </div>
        <div className="tableViewport"><table className="compactComparison">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Defect Type</th>
              <th>Defect Qty</th>
              <th>Action</th>
              <th>Status</th>
              <th>Files</th>
              <th>Menu</th>
            </tr>
          </thead>
          <tbody>
            {filteredDefects.length === 0 && (
              <tr>
                <td colSpan={10}><EmptyState text="No incoming defect records match the filters." /></td>
              </tr>
            )}
            {filteredDefects.map((defect) => (
              <tr key={`defect-record-${defect.id}`}>
                <td>{defect.poNumber ?? "-"}</td>
                <td>{defect.defectDate}</td>
                <td>{supplierName(appData, defect.supplierId)}</td>
                <td>{itemCode(appData, defect.itemId)}</td>
                <td>{defect.defectType}</td>
                <td>{defect.defectQty}</td>
                <td><StatusPill label={incomingDefectActionLabel(defect)} /></td>
                <td><StatusPill label={isIncomingDefectPendingReceive(defect) ? "Pending" : "Complete"} /></td>
                <td><IncomingDefectFiles defect={defect} /></td>
                <td>
                  <div className="tableActions">
                    <button className="ghostButton smallButton" onClick={() => onView(defect)} type="button">View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
    </section>
  );
}
