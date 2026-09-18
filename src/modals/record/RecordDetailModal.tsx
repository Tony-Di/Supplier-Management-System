import { type ViewTarget } from "../../uiTypes";
import { useAppData } from "../../AppDataContext";
import { supplierName, itemCode, drawingItemForInspection, modelName, drawingSetName, quoteLabel } from "../../lib/lookups";
import { type SampleInspection, type IncomingDefectRecord, type AuditLogRecord } from "../../types";
import { Field } from "../../components/Field";
import { DrawingFileReference } from "../../components/DrawingFileReference";
import { PhotoFileReferences } from "../../components/PhotoFileReferences";
import { incomingDefectPendingQty, isIncomingDefectPendingReceive } from "../../lib/defects";
import { incomingDefectTimeline } from "../../lib/defectTimeline";
import { StatusPill } from "../../components/StatusPill";
import { IncomingDefectFiles } from "../../components/IncomingDefectFiles";
import { formatAuditValue } from "../../lib/format";

export function RecordDetailModal({ onClose, target }: { onClose: () => void; target: ViewTarget }) {
  const { data: appData } = useAppData();
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modalPanel detailModal">
        <div className="modalHeader">
          <div>
            <h2>{target.type === "inspection" ? "Inspection record" : "Incoming defect record"}</h2>
            <p>{target.type === "inspection" ? `${supplierName(appData, target.record.supplierId)} / ${itemCode(appData, target.record.itemId)}` : `${target.record.poNumber ?? "No PO"} / ${supplierName(appData, target.record.supplierId)}`}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {target.type === "inspection" ? <InspectionRecordDetails inspection={target.record} /> : <IncomingDefectRecordDetails defect={target.record} />}
      </section>
    </div>
  );
}

export function InspectionRecordDetails({ inspection }: { inspection: SampleInspection }) {
  const { data: appData } = useAppData();
  const drawingItem = drawingItemForInspection(appData, inspection);
  return (
    <div className="recordDetailStack">
      <div className="fieldGrid large">
        <Field label="Source" value={inspection.relatedQuoteId ? "From Quote" : "Standalone"} />
        <Field label="Supplier" value={supplierName(appData, inspection.supplierId)} />
        <Field label="Item" value={itemCode(appData, inspection.itemId)} />
        <Field label="Model" value={modelName(appData, inspection.modelId)} />
        <Field label="Packaging set" value={drawingSetName(appData, inspection.drawingSetId)} />
        <Field label="Drawing revision" value={drawingItem?.revision ?? "-"} />
        <Field label="Related quote" value={quoteLabel(appData, inspection.relatedQuoteId)} />
        <Field label="Sample round" value={`Round ${inspection.sampleRound}`} />
        <Field label="Sample received" value={inspection.sampleReceivedDate} />
        <Field label="Inspection date" value={inspection.inspectionDate ?? "Pending"} />
        <Field label="Inspector" value={inspection.inspector || "-"} />
        <Field label="Result" value={inspection.result} />
        <Field label="Action" value={inspection.disposition} />
        <Field label="Signed date" value={inspection.signedDate ?? "-"} />
      </div>
      <section className="detailSection">
        <h3>Drawing file</h3>
        <DrawingFileReference drawingItem={drawingItem} drawingSet={appData.drawingSets.find((set) => set.id === inspection.drawingSetId)} />
      </section>
      <section className="detailSection">
        <h3>Problem photos</h3>
        <PhotoFileReferences inspection={inspection} />
      </section>
      <section className="detailSection">
        <h3>Notes</h3>
        <p>{inspection.notes || "-"}</p>
      </section>
    </div>
  );
}

export function IncomingDefectRecordDetails({ defect }: { defect: IncomingDefectRecord }) {
  const { data: appData } = useAppData();
  return (
    <div className="recordDetailStack">
      <div className="fieldGrid large">
        <Field label="PO number" value={defect.poNumber ?? "-"} />
        <Field label="Supplier" value={supplierName(appData, defect.supplierId)} />
        <Field label="Item" value={itemCode(appData, defect.itemId)} />
        <Field label="Model" value={defect.modelId ? modelName(appData, defect.modelId) : "-"} />
        <Field label="Defect date" value={defect.defectDate} />
        <Field label="Defect type" value={defect.defectType} />
        <Field label="PO qty" value={String(defect.poQty ?? "-")} />
        <Field label="Original received qty" value={String(defect.receivedQty ?? "-")} />
        <Field label="Defect qty" value={String(defect.defectQty)} />
        <Field label="Action" value={defect.defectAction} />
        <Field label="Pending qty" value={String(incomingDefectPendingQty(defect))} />
        <Field label="Status" value={isIncomingDefectPendingReceive(defect) ? "Pending" : "Complete"} />
        <Field label="Defect material returned" value={defect.materialReturned ? "Yes" : "No"} />
        <Field label="Return date" value={defect.returnDate ?? "-"} />
      </div>
      <section className="detailSection">
        <h3>Replacement timeline</h3>
        {(defect.replacementReceipts ?? []).length === 0 ? (
          <p>{incomingDefectTimeline(defect)}</p>
        ) : (
          <table className="compactComparison">
            <thead>
              <tr>
                <th>Date</th>
                <th>Received Qty</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {(defect.replacementReceipts ?? []).map((receipt, index) => (
                <tr key={`${defect.id}-receipt-${index}`}>
                  <td>{receipt.receivedDate}</td>
                  <td>{receipt.receivedQty}</td>
                  <td><StatusPill label={receipt.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="detailSection">
        <h3>Files</h3>
        <IncomingDefectFiles defect={defect} />
      </section>
      <section className="detailSection">
        <h3>Notes</h3>
        <p>{defect.notes || "-"}</p>
      </section>
    </div>
  );
}

export function AuditDiff({ record }: { record: AuditLogRecord }) {
  const keys = Array.from(new Set([...Object.keys(record.before ?? {}), ...Object.keys(record.after ?? {})]));
  if (keys.length === 0) return <p className="historyReason">No field-level diff stored.</p>;

  return (
    <div className="historyDiff">
      {keys.map((key) => (
        <div className="historyDiffRow" key={key}>
          <span>{key}</span>
          <strong>{formatAuditValue(record.before?.[key])}</strong>
          <strong>{formatAuditValue(record.after?.[key])}</strong>
        </div>
      ))}
    </div>
  );
}
