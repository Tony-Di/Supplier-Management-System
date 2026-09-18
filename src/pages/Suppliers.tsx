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
  const approvedSuppliers = appData.suppliers.filter((supplier) => supplier.recordState !== "Void");
  return (
    <section className="pageStack">
      <TableToolbar
        action="Add supplier"
        help="Use Edit to update payment terms, W-9, bank/payment info, and capable packaging items."
        onAction={onAdd}
        title="Supplier master"
      />
      <div className="dataGrid supplierGrid">
        {approvedSuppliers.map((supplier) => (
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
              <Field label="Location" value={supplierLocation(supplier)} />
              <Field label="Contact" value={supplier.primaryContact} />
              <Field label="Email" value={supplier.email} />
              <Field label="Phone" value={supplier.phone} />
              <Field label="Payment Terms" value={supplier.paymentTerms || "Not set"} />
            </div>
            <TagRow tags={supplier.capableItems} />
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
