import { useAppData } from "../AppDataContext";
import type { AppData } from "../api";
import type { HistoryHandler, Section } from "../uiTypes";
import { LifecyclePill } from "./LifecyclePill";

type ArchiveKey = "suppliers" | "models" | "items" | "drawingSets" | "projects" | "quotes" | "priceChanges" | "purchasePrices" | "inspections" | "incomingDefects";
const collections: Partial<Record<Section, Array<[ArchiveKey, string]>>> = {
  Suppliers: [["suppliers", "Supplier"]],
  "Products & Drawings": [["models", "Model"], ["items", "Item"], ["drawingSets", "DrawingSet"]],
  "Sourcing Workbench": [["projects", "Case"], ["quotes", "Quote"]],
  Pricing: [["priceChanges", "PriceChange"], ["purchasePrices", "PurchasePrice"]],
  "QC Inspections": [["inspections", "Inspection"], ["incomingDefects", "IncomingDefect"]],
};

function recordLabel(record: AppData[ArchiveKey][number]) {
  if ("name" in record) return record.name;
  if ("itemCode" in record) return `${record.itemCode} — ${record.itemName}`;
  return record.id;
}

export function VoidedRecords({ section, onHistory }: { section: Section; onHistory: HistoryHandler }) {
  const { data } = useAppData();
  const records = (collections[section] ?? []).flatMap(([key, entity]) =>
    data[key].filter((record) => record.recordState === "Void").map((record) => ({ record, entity })));
  if (!records.length) return null;
  return <details className="voidedArchive">
    <summary>Voided records <span>{records.length}</span></summary>
    <p>Retained for history. These records are read-only and unavailable for new work.</p>
    <div className="dataGrid">{records.map(({ record, entity }) => <article className="recordCard voidedRecord" key={`${entity}-${record.id}`}>
      <div className="recordHeader"><h3>{recordLabel(record)}</h3><LifecyclePill record={record} /></div>
      <p className="voidReason">{record.voidReason || "No void reason recorded."}</p>
      <button className="ghostButton" type="button" onClick={() => onHistory(entity, record.id, recordLabel(record))}>View history</button>
    </article>)}</div>
  </details>;
}
