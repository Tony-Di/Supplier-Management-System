import { type AppData, createItem } from "../api";
import { useAppData } from "../AppDataContext";
import { useState, FormEvent } from "react";
import { type PackagingItemType, type PackagingItem } from "../types";
import { packagingItemOptions } from "../constants";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";

export function ItemModal({
  models,
  onClose,
  onCreated,
}: {
  models: AppData["models"];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { data: appData } = useAppData();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [usedForModels, setUsedForModels] = useState<string[]>(models[0] ? [models[0].id] : []);
  const [itemCode, setItemCode] = useState("");
  const duplicateItem = appData.items.find((item) => item.recordState !== "Void" && item.itemCode.toLowerCase() === itemCode.trim().toLowerCase());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (duplicateItem) {
        throw new Error("This Item Code already exists. Edit the existing item and add more models under Used for models.");
      }
      await createItem({
        itemCode: itemCode.trim(),
        itemName: String(form.get("itemName") ?? ""),
        type: String(form.get("type") ?? "Pallet") as PackagingItemType,
        usedForModels,
        uom: String(form.get("uom") ?? "pcs") as PackagingItem["uom"],
        status: "Active",
        recordState: "Active",
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add packaging item</h2>
            <p>Item Code follows your internal system. One item can be linked to multiple models before packaging sets are built.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        {formError && <div className="formError">{formError}</div>}

        <div className="formGrid">
          <label>
            Item Code
            <input name="itemCode" onChange={(event) => setItemCode(event.target.value)} required placeholder="PKG-BTA-..." value={itemCode} />
          </label>
          <label>
            Item Name
            <input name="itemName" required placeholder="BTA Pallet" />
          </label>
          <label>
            Packaging Type
            <select name="type" defaultValue="Pallet">
              {packagingItemOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            UOM
            <select name="uom" defaultValue="pcs">
              {["pcs", "set", "bundle", "lb", "kg"].map((uom) => (
                <option key={uom}>{uom}</option>
              ))}
            </select>
          </label>
        </div>
        {duplicateItem && (
          <div className="formError">
            This Item Code already exists as {duplicateItem.itemName}. Edit that item and select additional models instead of creating a duplicate.
          </div>
        )}

        <MultiSelectDropdown
          items={models.map((model) => ({ id: model.id, label: model.name }))}
          label="Used for models"
          selectedIds={usedForModels}
          setSelectedIds={setUsedForModels}
        />

        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || usedForModels.length === 0 || Boolean(duplicateItem)} type="submit">
            {saving ? "Saving..." : "Save item"}
          </button>
        </div>
      </form>
    </div>
  );
}
