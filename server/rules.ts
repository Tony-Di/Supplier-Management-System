interface LifecycleRecord {
  recordState?: "Draft" | "Active" | "Void";
}

interface InspectionLike extends LifecycleRecord {
  supplierId: string;
  itemId: string;
  drawingSetId?: string;
  relatedQuoteId?: string;
  sampleRound: number;
  sampleReceivedDate: string;
  result: string;
}

/** A voided record stays readable for history but must not be referenced by new work. */
export function isUsableRecord(record: LifecycleRecord | undefined): boolean {
  return Boolean(record) && record?.recordState !== "Void";
}

/** The most recent sample inspection for a supplier and item, optionally scoped to one drawing set or quote. */
export function latestInspection<T extends InspectionLike>(
  inspections: T[],
  criteria: { supplierId: string; itemId: string; drawingSetId?: string; sourceQuoteId?: string },
): T | undefined {
  return [...inspections]
    .filter((inspection) => {
      if (!isUsableRecord(inspection)) return false;
      if (criteria.drawingSetId && inspection.drawingSetId !== criteria.drawingSetId) return false;
      const matchesQuote =
        criteria.sourceQuoteId !== undefined && inspection.relatedQuoteId === criteria.sourceQuoteId;
      const matchesSupplierItem =
        inspection.supplierId === criteria.supplierId && inspection.itemId === criteria.itemId;
      return matchesQuote || matchesSupplierItem;
    })
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
}

/** Primary, Secondary, Tertiary and Backup are only eligible after QC passes or approves conditionally. */
export function qcAllowsSourceRole(inspection: { result: string } | undefined): boolean {
  return inspection?.result === "Pass" || inspection?.result === "Conditional";
}
