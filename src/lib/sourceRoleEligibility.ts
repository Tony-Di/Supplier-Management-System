import type { AppData } from "../api";
import type { Quote } from "../types";
import { isUsableRecord } from "./recordOptions";

/** Keep the selection order aligned with server/rules.ts; parity is regression tested. */
export function sourceRoleEligibility(data: AppData, quote: Quote | undefined, projectId = quote?.projectId) {
  if (!quote) return { reason: "Quote is required before assigning source role.", inspection: undefined };
  const project = data.projects.find((record) => record.id === projectId);
  const inspection = [...data.inspections]
    .filter((record) => isUsableRecord(record) && (!project?.drawingSetId || record.drawingSetId === project.drawingSetId) &&
      (record.relatedQuoteId === quote.id || (record.supplierId === quote.supplierId && record.itemId === quote.itemId)))
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
  const unavailable = !isUsableRecord(quote) ||
    !isUsableRecord(data.suppliers.find((record) => record.id === quote.supplierId)) ||
    !isUsableRecord(data.items.find((record) => record.id === quote.itemId)) ||
    !isUsableRecord(data.models.find((record) => record.id === quote.modelId)) ||
    Boolean(projectId && !isUsableRecord(project));
  if (unavailable) return { inspection, reason: "A linked supplier, model, item, case or quote is unavailable. Source roles cannot be assigned." };
  return {
    inspection,
    reason: inspection?.result === "Pass" || inspection?.result === "Conditional"
      ? undefined : "QC must pass or be conditional before assigning source role.",
  };
}
