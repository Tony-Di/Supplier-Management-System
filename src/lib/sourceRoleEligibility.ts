import type { AppData } from "../api";
import type { Quote } from "../types";
import { isUsableRecord } from "./recordOptions";

/** Whether a quote can take a source role (it must be Selected, as server/workflow.ts checks), and the case's latest QC record for it. */
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
    reason: quote.status === "Selected" ? undefined : "Quote must be Selected before assigning a source role.",
  };
}
