import { type IncomingDefectRecord } from "../../types";
import { useState } from "react";
import { incomingDefectPendingQty } from "../../lib/defects";
import { incomingDefectTypes } from "../../constants";
import { StatusPill } from "../../components/StatusPill";
import { Plus } from "lucide-react";

export function IncomingDefectEditFields({ record }: { record: IncomingDefectRecord }) {
  const [defectQty, setDefectQty] = useState(String(record.defectQty));
  const [defectAction, setDefectAction] = useState<IncomingDefectRecord["defectAction"]>(record.defectAction ?? "Request Replacement");
  const [materialReturned, setMaterialReturned] = useState(Boolean(record.materialReturned));
  const [replacementReceipts, setReplacementReceipts] = useState<NonNullable<IncomingDefectRecord["replacementReceipts"]>>(record.replacementReceipts ?? []);
  const [newReceiptDate, setNewReceiptDate] = useState("");
  const [newReceiptQty, setNewReceiptQty] = useState("");
  const [newReceiptResult, setNewReceiptResult] = useState<"Accepted" | "Rejected">("Accepted");
  const workingDefect = {
    ...record,
    defectAction,
    defectQty: Number(defectQty) || 0,
    replacementQty: defectAction === "Request Replacement" ? Number(defectQty) || 0 : undefined,
    replacementReceipts,
  };
  const showReplacementReceiptEntry = defectAction === "Request Replacement" && incomingDefectPendingQty(workingDefect) > 0;

  function addReplacementReceipt() {
    if (!newReceiptDate || !newReceiptQty) return;
    setReplacementReceipts((current) => [
      ...current,
      {
        receivedDate: newReceiptDate,
        receivedQty: Number(newReceiptQty),
        result: newReceiptResult,
      },
    ]);
    setNewReceiptDate("");
    setNewReceiptQty("");
    setNewReceiptResult("Accepted");
  }

  return (
    <>
      <label>Defect Date<input name="defectDate" defaultValue={record.defectDate} type="date" required /></label>
      <label>PO Number<input name="poNumber" defaultValue={record.poNumber ?? ""} placeholder="PO001" /></label>
      <label>PO Qty<input min="0" name="poQty" defaultValue={record.poQty ?? ""} step="1" type="number" /></label>
      <label>Defect Type<select name="defectType" defaultValue={record.defectType}>{incomingDefectTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Defect Qty<input min="0" name="defectQty" onChange={(event) => setDefectQty(event.target.value)} step="1" type="number" value={defectQty} required /></label>
      <label>Initial Received Qty<input min="0" name="receivedQty" defaultValue={record.receivedQty ?? ""} step="1" type="number" /></label>
      <label>
        Action
        <select name="defectAction" value={defectAction} onChange={(event) => setDefectAction(event.target.value as IncomingDefectRecord["defectAction"])}>
          {["Request Replacement", "Request Credit"].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      {defectAction === "Request Replacement" && (
        <label>Replacement Qty<input min="0" name="replacementQty" readOnly step="1" type="number" value={defectQty} /></label>
      )}
      <label>Defect Material Returned<select name="materialReturned" value={materialReturned ? "true" : "false"} onChange={(event) => setMaterialReturned(event.target.value === "true")}>{["false", "true"].map((value) => <option key={value} value={value}>{value === "true" ? "Yes" : "No"}</option>)}</select></label>
      {materialReturned && <label>Return Date<input name="returnDate" defaultValue={record.returnDate ?? ""} type="date" /></label>}
      <input name="replacementReceiptsJson" type="hidden" value={JSON.stringify(replacementReceipts)} />
      {defectAction === "Request Replacement" && (
        <div className="formSection fullSpan">
          <strong>Replacement receipts</strong>
          {replacementReceipts.length === 0 ? (
            <p className="muted">No replacement receipt recorded yet.</p>
          ) : (
            <div className="receiptList">
              {replacementReceipts.map((receipt, index) => (
                <div className="receiptRow" key={`${receipt.receivedDate}-${index}`}>
                  <span>Round {index + 1}</span>
                  <strong>{receipt.receivedDate}</strong>
                  <span>{receipt.receivedQty} pcs</span>
                  <StatusPill label={receipt.result} />
                  <button onClick={() => setReplacementReceipts((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} type="button">Remove</button>
                </div>
              ))}
            </div>
          )}
          {showReplacementReceiptEntry && (
            <div className="receiptEntry">
              <div className="receiptEntryGrid">
                <label>Replacement Receive Date<input type="date" value={newReceiptDate} onChange={(event) => setNewReceiptDate(event.target.value)} /></label>
                <label>Received This Time<input min="0" step="1" type="number" value={newReceiptQty} onChange={(event) => setNewReceiptQty(event.target.value)} /></label>
                <label>Result<select value={newReceiptResult} onChange={(event) => setNewReceiptResult(event.target.value as "Accepted" | "Rejected")}><option>Accepted</option><option>Rejected</option></select></label>
              </div>
              <div className="receiptEntryActions">
                <button className="primaryButton" disabled={!newReceiptDate || !newReceiptQty} onClick={addReplacementReceipt} type="button">
                  <Plus size={16} />
                  Add receipt
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
    </>
  );
}
