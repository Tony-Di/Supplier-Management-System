import { ErrorNotice } from "../components/ErrorNotice";
import { type AppData, importItems, importModels } from "../api";
import { useState, useMemo, FormEvent } from "react";
import { detectImportKind, parseItemImportRows, parseModelImportRows } from "../lib/import";
import { Panel } from "../components/Panel";
import { packagingItemOptions } from "../constants";
import type { Model, PackagingItemType } from "../types";

export function ProductImportModal({
  data,
  onClose,
  onImported,
}: {
  data: AppData;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [rawText, setRawText] = useState("");
  const kind = useMemo(() => detectImportKind(rawText, data.models), [rawText, data.models]);
  const itemRows = useMemo(() => (kind === "Items" ? parseItemImportRows(rawText, data.models, data.items) : []), [kind, rawText, data.models, data.items]);
  const modelRows = useMemo(() => (kind === "Models" ? parseModelImportRows(rawText, data.models) : []), [kind, rawText, data.models]);
  const preview = kind === "Items" ? itemRows : modelRows;
  const invalidCount = preview.filter((row) => row.errors.length > 0).length;
  const noun = kind === "Items" ? "items" : "models";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      if (preview.length === 0) throw new Error("No import rows found.");
      if (kind === "Models") {
        const result = await importModels({
          rows: modelRows.map(({ name, productFamily, status, notes }) => ({ name, productFamily, status: status as Model["status"], notes })),
        });
        window.alert([
          "Model import summary",
          `Total rows: ${result.totalRows}`,
          `Created: ${result.created}`,
          `Already existed (skipped): ${result.duplicated}`,
          `Repeated rows (skipped): ${result.skipped}`,
        ].join("\n"));
      } else {
        const result = await importItems({
          rows: itemRows.map(({ itemCode, description, type, usedFor }) => ({
            itemCode,
            description,
            type: type as PackagingItemType,
            usedFor,
          })),
        });
        window.alert([
          "Item import summary",
          `Total rows: ${result.totalRows}`,
          `Created: ${result.created}`,
          `Added models to existing items: ${result.linked}`,
          `Already existed (skipped): ${result.duplicated}`,
          `Repeated rows (skipped): ${result.skipped}`,
        ].join("\n"));
      }
      await onImported();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : `Unable to import ${noun}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Import models or items</h2>
            <p>Paste rows from Excel. The import tells models from packaging items by the header row, or by the columns when there is no header.</p>
            <p>Models: Model, Product Family, Status, Notes. Only Model is required; existing models are skipped.</p>
            <p>Items: Item Code, Description, Type, Used for. Use comma or semicolon to link one item to several models; an Item Code that already exists gets the new models added.</p>
            <p>Type must be one of: {packagingItemOptions.join(", ")}.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <ErrorNotice message={formError} onDismiss={() => setFormError("")} />
        <label className="fullWidthLabel">
          Excel rows
          <textarea
            onChange={(event) => setRawText(event.target.value)}
            placeholder={"Model\tProduct Family\tStatus\tNotes\n— or —\nItem Code\tDescription\tType\tUsed for"}
            rows={8}
            value={rawText}
          />
        </label>
        <Panel
          title={preview.length > 0 ? `Import preview: detected as ${noun}` : "Import preview"}
          actions={preview.length > 0 && (
            <span className={invalidCount > 0 ? "importSummaryInvalid" : "muted"}>
              {invalidCount > 0 ? `${preview.length} rows · ${invalidCount} need fixing` : `${preview.length} rows ready`}
            </span>
          )}
        >
          {kind === "Items" ? (
            <table>
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Used For</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {itemRows.map((row, index) => (
                  <tr className={row.errors.length > 0 ? "importRowInvalid" : undefined} key={index}>
                    <td>{row.itemCode}</td>
                    <td>{row.description}</td>
                    <td>{row.type}</td>
                    <td>{row.usedFor.join(", ")}</td>
                    <td>{row.errors.length > 0 ? row.errors.join("; ") : row.note || "Ready"}</td>
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
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row, index) => (
                  <tr className={row.errors.length > 0 ? "importRowInvalid" : undefined} key={index}>
                    <td>{row.name}</td>
                    <td>{row.productFamily}</td>
                    <td>{row.status}</td>
                    <td>{row.notes}</td>
                    <td>{row.errors.length > 0 ? row.errors.join("; ") : row.note || "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {kind === "Items" && preview.length > 0 && data.models.length === 0 && (
            <div className="notice errorNotice">Create or import a model before importing items.</div>
          )}
        </Panel>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || preview.length === 0 || invalidCount > 0} type="submit">
            {saving ? "Importing..." : preview.length > 0 ? `Import ${noun}` : "Import"}
          </button>
        </div>
      </form>
    </div>
  );
}
