import { useAppData } from "../AppDataContext";
import { useState, FormEvent } from "react";
import { type PackagingItemType, type Supplier } from "../types";
import { uploadOptionalFormFile } from "../lib/uploads";
import { createSupplier } from "../api";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { packagingItemOptions } from "../constants";

export function SupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { data: appData } = useAppData();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [capableItems, setCapableItems] = useState<PackagingItemType[]>(["Pallet"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const w9Upload = await uploadOptionalFormFile(form, "w9File", "Supplier W9", "supplier");
      const paymentInfoUpload = await uploadOptionalFormFile(form, "paymentInfoFile", "Supplier Payment Info", "supplier");
      await createSupplier({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        erpVendorId: String(form.get("erpVendorId") ?? "") || undefined,
        status: "Active",
        type: String(form.get("type") ?? "Manufacturer") as Supplier["type"],
        country: String(form.get("country") ?? "United States"),
        region: String(form.get("region") ?? ""),
        capableItems,
        primaryContact: String(form.get("primaryContact") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        paymentTerms: String(form.get("paymentTerms") ?? ""),
        hasW9: Boolean(w9Upload),
        hasPaymentInfo: Boolean(paymentInfoUpload),
        w9FileId: w9Upload?.id,
        paymentInfoFileId: paymentInfoUpload?.id,
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create supplier.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add vendor</h2>
            <p>Pre-ERP suppliers can be created here before they receive an ERP Vendor ID.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        {formError && <div className="formError">{formError}</div>}
        {appData.models.length === 0 && <div className="formError">Create a model before adding items.</div>}

        <div className="formGrid">
          <label>
            Supplier Name
            <input name="name" required placeholder="Example Packaging Inc." />
          </label>
          <label>
            ERP Vendor ID
            <input name="erpVendorId" placeholder="Optional until approved" />
          </label>
          <label>
            Supplier Type
            <select name="type" defaultValue="Manufacturer">
              {["Manufacturer", "Distributor", "Service", "Other"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            Country
            <input name="country" defaultValue="United States" />
          </label>
          <label>
            State / Region
            <input name="region" placeholder="TX, OH, CA..." />
          </label>
          <label>
            Primary Contact
            <input name="primaryContact" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Payment Terms
            <input name="paymentTerms" placeholder="Net 30, Net 45..." />
          </label>
        </div>

        <MultiSelectDropdown
          items={packagingItemOptions.map((item) => ({ id: item, label: item }))}
          label="Capable packaging items"
          selectedIds={capableItems}
          setSelectedIds={setCapableItems}
        />

        <div className="formGrid">
          <label>
            W-9 file
            <input name="w9File" type="file" />
          </label>
          <label>
            Bank / payment info file
            <input name="paymentInfoFile" type="file" />
          </label>
        </div>

        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save vendor"}
          </button>
        </div>
      </form>
    </div>
  );
}
