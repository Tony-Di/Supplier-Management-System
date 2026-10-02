import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, importItems } from "../api";
import { useState, useMemo, FormEvent } from "react";
import { parseItemImportRows } from "../lib/import";
import { Panel } from "../components/Panel";
import { packagingItemOptions } from "../constants";
import type { PackagingItemType } from "../types";

export function ItemImportModal({
  models,
  onClose,
  onImported,
}: {
  models: AppData["models"];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [rawText, setRawText] = useState("Item Code\tDescription\tType\tUsed for\n");
  const preview = useMemo(() => parseItemImportRows(rawText, models), [rawText, models]);
  const invalidCount = preview.filter((row) => row.errors.length > 0).length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (preview.length === 0) throw new Error("No import rows found.");
      const result = await importItems({
        rows: preview.map(({ itemCode, description, type, usedFor }) => ({
          itemCode,
          description,
          type: type as PackagingItemType,
          usedFor,
        })),
      });
      window.alert([
        "Item import summary",
        `Total rows: ${result.totalRows}`,
        `Duplicated existing Item Code: ${result.duplicated}`,
        `Successfully imported: ${result.created}`,
        `Skipped: ${result.skipped}`,
      ].join("\n"));
      await onImported();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to import items.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Import items</h2>
            <p>Paste Excel columns: Item Code, Description, Type, Used for. Use comma or semicolon to link one item to multiple models. Existing Item Codes are skipped.</p>
            <p>Type must be one of: {packagingItemOptions.join(", ")}.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        <label className="fullWidthLabel">
          Excel rows
          <textarea onChange={(event) => setRawText(event.target.value)} rows={8} value={rawText} />
        </label>
        <Panel
          title="Import preview"
          actions={preview.length > 0 && (
            <span className={invalidCount > 0 ? "importSummaryInvalid" : "muted"}>
              {invalidCount > 0 ? `${preview.length} rows · ${invalidCount} need fixing` : `${preview.length} rows ready`}
            </span>
          )}
        >
          <table>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Description</th>
                <th>Type</th>
                <th>Used For</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row, index) => (
                <tr className={row.errors.length > 0 ? "importRowInvalid" : undefined} key={index}>
                  <td>{row.itemCode}</td>
                  <td>{row.description}</td>
                  <td>{row.type}</td>
                  <td>{row.usedFor.join(", ")}</td>
                  <td>{row.errors.length > 0 ? row.errors.join("; ") : "Ready"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.length === 0 && <div className="notice errorNotice">Create a model before importing items.</div>}
        </Panel>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || preview.length === 0 || invalidCount > 0} type="submit">
            {saving ? "Importing..." : "Import items"}
          </button>
        </div>
      </form>
    </div>
  );
}
