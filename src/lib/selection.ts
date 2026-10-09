import type { Quote, SampleInspection, Supplier } from "../types";

/**
 * How a buyer may set a quote to Selected:
 * - "Existing Supplier": directly, because the supplier passed QC or had a Selected quote for the item.
 * - "Previous Orders": after confirming earlier orders, while that entry point is on and the supplier has a Since date.
 * - "Sample Required": not by hand; a passed sample selects it.
 */
export type ManualSelection = "Existing Supplier" | "Previous Orders" | "Sample Required";

interface SelectionRecords {
  suppliers: Pick<Supplier, "id" | "supplierSince">[];
  quotes: Pick<Quote, "id" | "supplierId" | "itemId" | "status" | "recordState">[];
  inspections: Pick<SampleInspection, "supplierId" | "itemId" | "result" | "recordState">[];
}

export function manualSelection(
  records: SelectionRecords,
  quote: Pick<Quote, "id" | "supplierId" | "itemId">,
  previousOrderSelection: boolean,
): ManualSelection {
  const sameSupplierItem = (record: { supplierId: string; itemId: string; recordState?: string }) =>
    record.recordState !== "Void" && record.supplierId === quote.supplierId && record.itemId === quote.itemId;
  const passedQc = records.inspections.some((inspection) => sameSupplierItem(inspection) && inspection.result === "Pass");
  const selectedBefore = records.quotes.some((other) => other.id !== quote.id && sameSupplierItem(other) && other.status === "Selected");
  if (passedQc || selectedBefore) return "Existing Supplier";
  const supplier = records.suppliers.find((candidate) => candidate.id === quote.supplierId);
  return previousOrderSelection && supplier?.supplierSince ? "Previous Orders" : "Sample Required";
}
