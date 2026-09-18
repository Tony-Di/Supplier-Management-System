import { type DeleteHandler, type EditTarget, type HistoryHandler, type VoidHandler } from "../uiTypes";
import { useAppData } from "../AppDataContext";
import { TableToolbar } from "../components/TableToolbar";
import { LifecyclePill } from "../components/LifecyclePill";
import { RecordMenu } from "../components/RecordMenu";
import { canDeleteRecord } from "../lib/recordLifecycle";
import { Field } from "../components/Field";
import { supplierLocation } from "../lib/lookups";
import { TagRow } from "../components/TagRow";
import { DocumentCheck } from "../components/DocumentCheck";
import { useEffect, useState } from "react";
import { fetchScorecard, type ScorecardRow } from "../api";
import { packagingItemOptions } from "../constants";
import { EmptyState } from "../components/EmptyState";

export function Suppliers({
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
  const [search, setSearch] = useState("");
  const [capability, setCapability] = useState("All");
  const [documents, setDocuments] = useState("All");
  const [scores, setScores] = useState<ScorecardRow[]>([]);
  useEffect(() => {
    let current = true;
    fetchScorecard().then((response) => { if (current) setScores(response.rows); }).catch(() => { if (current) setScores([]); });
    return () => { current = false; };
  }, [appData]);
  const approvedSuppliers = appData.suppliers.filter((supplier) => supplier.recordState !== "Void");
  const visibleSuppliers = approvedSuppliers.filter((supplier) => {
    const matchesSearch = `${supplier.name} ${supplier.erpVendorId ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
    const complete = supplier.hasW9 && supplier.hasPaymentInfo;
    return matchesSearch && (capability === "All" || supplier.capableItems.some((item) => item === capability)) &&
      (documents === "All" || (documents === "Complete" ? complete : !complete));
  });
  return (
    <section className="pageStack">
      <TableToolbar
        action="Add supplier"
        help="Use Edit to update payment terms, W-9, bank/payment info, and capable packaging items."
        onAction={onAdd}
        title="Supplier master"
      />
      <div className="supplierFilters">
        <label className="supplierSearch">Search suppliers<input placeholder="Name or ERP vendor ID" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Capability<select value={capability} onChange={(event) => setCapability(event.target.value)}><option value="All">All item types</option>{packagingItemOptions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Documents<select value={documents} onChange={(event) => setDocuments(event.target.value)}><option value="All">Any status</option><option>Complete</option><option>Missing documents</option></select></label>
        <span className="recordCount">{visibleSuppliers.length} of {approvedSuppliers.length} suppliers</span>
      </div>
      {visibleSuppliers.length === 0 && <EmptyState text="No suppliers match these filters." />}
      <div className="dataGrid supplierGrid">
        {visibleSuppliers.map((supplier) => (
          <article className="recordCard" key={supplier.id}>
            <div className="recordHeader">
              <div>
                <h3>{supplier.name}</h3>
                <p>{supplier.erpVendorId ? `ERP Vendor ID ${supplier.erpVendorId}` : "Pre-ERP supplier record"}</p>
              </div>
              <div className="recordActions">
                <LifecyclePill record={supplier} />
                <RecordMenu
                  canDelete={canDeleteRecord(appData, "suppliers", supplier.id)}
                  label={supplier.name}
                  onDelete={() => onDelete("suppliers", supplier.id, supplier.name)}
                  onEdit={() => onEdit({ endpoint: "suppliers", record: supplier })}
                  onHistory={() => onHistory("Supplier", supplier.id, supplier.name)}
                  onVoid={() => onVoid("suppliers", supplier.id, supplier.name)}
                />
              </div>
            </div>
            <div className="fieldGrid">
              <Field label="Supplier score" value={scores.find((row) => row.supplier.id === supplier.id)?.score.toString() ?? "Unavailable"} />
              <Field label="Location" value={supplierLocation(supplier)} />
              <Field label="Contact" value={supplier.primaryContact} />
              <Field label="Email" value={supplier.email} />
              <Field label="Phone" value={supplier.phone} />
              <Field label="Payment Terms" value={supplier.paymentTerms || "Not set"} />
            </div>
            <div className="capabilityBlock"><span>Capable item types</span><TagRow tags={supplier.capableItems} /></div>
            <div className="documentChecks">
              <DocumentCheck ok={supplier.hasW9} label="W-9" fileId={supplier.w9FileId} />
              <DocumentCheck ok={supplier.hasPaymentInfo} label="Payment info" fileId={supplier.paymentInfoFileId} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
