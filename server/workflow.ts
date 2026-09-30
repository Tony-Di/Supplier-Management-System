import type { Quote } from "../src/types";
import { isPlainRecord, type AuditAction } from "./auditEntry";
import {
  assignPreviousQuote,
  buildPriceChangeFromQuote,
  closePreviousSelectedQuote,
  reconcileQuotePriceChanges,
  syncCaseFromQuote,
  syncReusableQuotesForProject,
  syncReusableQuotesForProjects,
  validateDrawingSetLinks,
} from "./business";
import type { BusinessContext } from "./context";
import { ValidationError } from "./errors";
import { mergePatch } from "./patch";
import { priceWindowError } from "./priceWindows";
import { latestInspection, qcAllowsSourceRole } from "./rules";
import type { Store } from "./storeShape";

export function cloneRecord<T>(record: T | undefined): T | undefined {
  return record ? structuredClone(record) : undefined;
}

export function editAction(before: unknown, after: unknown): AuditAction {
  const beforeRecord = isPlainRecord(before) ? before : undefined;
  const afterRecord = isPlainRecord(after) ? after : {};
  if (beforeRecord?.status !== afterRecord.status && afterRecord.status) return "Status Change";
  if (beforeRecord?.result !== afterRecord.result && afterRecord.result) return "Status Change";
  if (beforeRecord?.recordState === "Draft" && afterRecord.recordState === "Active") return "Approve";
  return "Edit";
}

export function entityLabel(store: Store, entityType: string, record: unknown) {
  const recordValue = isPlainRecord(record) ? record : {};
  if (entityType === "Supplier") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Model") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Item") return String(recordValue.itemCode ?? recordValue.id);
  if (entityType === "DrawingSet") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Case") return String(recordValue.name ?? recordValue.id);
  if (entityType === "Quote") return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)}`;
  if (entityType === "Inspection") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / Round ${recordValue.sampleRound ?? 1}`;
  }
  if (entityType === "IncomingDefect") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / ${recordValue.defectDate}`;
  }
  if (entityType === "PriceChange") return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} price change`;
  if (entityType === "SourceAssignment") {
    return `${findSupplierName(store, recordValue.supplierId)} / ${findItemCode(store, recordValue.itemId)} / ${recordValue.role ?? "source role"}`;
  }
  return String(recordValue.id ?? entityType);
}

function findSupplierName(store: Store, id: unknown) {
  return store.suppliers.find((supplier) => supplier.id === id)?.name ?? "Unknown supplier";
}

function findItemCode(store: Store, id: unknown) {
  return store.items.find((item) => item.id === id)?.itemCode ?? "Unknown item";
}

export function checkPriceWindow(store: Store, quote: Quote, before?: Quote, changeReason?: string) {
  const error = priceWindowError(quote, store.quotes, {
    before,
    changeReason,
    describe: (conflict) => `the ${conflict.currency} ${conflict.unitPrice} quote ${conflict.id}`,
  });
  if (error) throw new ValidationError(error);
}

export function nextDrawingSetRevision(store: Store, modelId: string) {
  const existingCount = store.drawingSets.filter(
    (drawingSet) => drawingSet.modelId === modelId && drawingSet.recordState !== "Void",
  ).length;
  return `${existingCount + 1}.0`;
}

export function syncActivePackagingSetItems(ctx: BusinessContext, modelIds: string[], reason: string) {
  const { store } = ctx;
  const targetModelIds = new Set(modelIds.filter(Boolean));
  if (targetModelIds.size === 0) return false;
  let changed = false;

  for (const drawingSet of store.drawingSets) {
    if (drawingSet.recordState === "Void" || drawingSet.status !== "Active" || !targetModelIds.has(drawingSet.modelId)) continue;
    const modelItems = store.items
      .filter((item) => item.recordState !== "Void" && item.status === "Active" && item.usedForModels.includes(drawingSet.modelId))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    const nextItemIds = modelItems.map((item) => item.id);
    const currentItemIds = drawingSet.drawingItems.map((drawingItem) => drawingItem.itemId);
    if (JSON.stringify(currentItemIds) === JSON.stringify(nextItemIds)) continue;

    const before = cloneRecord(drawingSet);
    drawingSet.drawingItems = modelItems.map((item) => {
      const existing = drawingSet.drawingItems.find((drawingItem) => drawingItem.itemId === item.id);
      return {
        id: existing?.id ?? ctx.nextId("dwgitem"),
        itemId: item.id,
        revision: drawingSet.revision,
        status: "Active",
        drawingSource: "Package PDF",
        fileName: undefined,
        fileId: undefined,
      };
    });
    validateDrawingSetLinks(store, drawingSet);
    ctx.audit(
      "Edit",
      "DrawingSet",
      drawingSet.id,
      drawingSet.name,
      before,
      drawingSet,
      `${reason}: synced package coverage to active items for ${entityLabel(store, "Model", store.models.find((model) => model.id === drawingSet.modelId))}`,
      undefined,
      "System",
    );
    changed = true;
  }

  return changed;
}

export function syncActiveCasesForModels(ctx: BusinessContext, modelIds: string[], reason: string) {
  const { store } = ctx;
  const targetModelIds = new Set(modelIds.filter(Boolean));
  if (targetModelIds.size === 0) return false;
  let changed = false;

  for (const project of store.projects) {
    if (project.recordState === "Void" || project.status === "Closed") continue;
    if (!project.modelIds.some((modelId) => targetModelIds.has(modelId))) continue;
    const drawingSet = store.drawingSets.find(
      (candidate) =>
        candidate.id === project.drawingSetId &&
        candidate.recordState !== "Void" &&
        candidate.status === "Active",
    );
    if (!drawingSet) continue;
    const activeDrawingItemIds = drawingSet.drawingItems
      .filter((drawingItem) => drawingItem.status === "Active")
      .map((drawingItem) => drawingItem.itemId)
      .filter((itemId) => {
        const item = store.items.find((candidate) => candidate.id === itemId);
        return item?.recordState !== "Void" && item?.status === "Active";
      });
    const missingItemIds = activeDrawingItemIds.filter((itemId) => !project.itemIds.includes(itemId));
    if (missingItemIds.length === 0) {
      syncReusableQuotesForProject(ctx, project);
      continue;
    }

    const before = cloneRecord(project);
    project.itemIds = Array.from(new Set([...project.itemIds, ...missingItemIds]));
    syncReusableQuotesForProject(ctx, project);
    ctx.audit("Edit", "Case", project.id, project.name, before, project, `${reason}: synced case items from active packaging set`, project.id, "System");
    changed = true;
  }

  return changed;
}

export function syncQuoteStatusesFromPassedInspections(ctx: BusinessContext) {
  let changed = false;
  for (const inspection of ctx.store.inspections) {
    if (inspection.recordState !== "Void") changed = syncQuoteStatusFromInspection(ctx, inspection) || changed;
  }
  return changed;
}

export function syncQuoteStatusFromInspection(ctx: BusinessContext, inspection: { relatedQuoteId?: string; result: string }) {
  const { store } = ctx;
  if (!inspection.relatedQuoteId || inspection.result !== "Pass") return false;
  const quote = store.quotes.find((candidate) => candidate.id === inspection.relatedQuoteId && candidate.recordState !== "Void");
  if (!quote || quote.status === "Selected") return false;
  const before = cloneRecord(quote);
  quote.status = "Selected";
  assignPreviousQuote(store, quote);
  buildPriceChangeFromQuote(ctx, quote);
  closePreviousSelectedQuote(store, quote);
  syncCaseFromQuote(ctx, quote);
  syncReusableQuotesForProjects(ctx);
  ctx.audit(
    "Status Change",
    "Quote",
    quote.id,
    entityLabel(store, "Quote", quote),
    before,
    quote,
    "Sample inspection passed; quote selected automatically.",
    quote.projectId,
    "System",
  );
  return true;
}

export function ensureSourceAssignmentLinks(store: Store, record: {
  projectId?: string;
  modelId: string;
  itemId: string;
  supplierId: string;
  sourceQuoteId?: string;
}) {
  const supplier = store.suppliers.find((candidate) => candidate.id === record.supplierId && candidate.recordState !== "Void");
  if (!supplier) {
    throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  }
  if (!store.models.some((model) => model.id === record.modelId && model.recordState !== "Void")) {
    throw new ValidationError(`Model not found: ${record.modelId}`);
  }
  const item = store.items.find((candidate) => candidate.id === record.itemId && candidate.recordState !== "Void");
  if (!item) {
    throw new ValidationError(`Item not found: ${record.itemId}`);
  }
  if (!item.usedForModels.includes(record.modelId)) {
    throw new ValidationError("Item is not linked to the selected model.");
  }
  if (!supplier.capableItems.includes(item.type)) {
    throw new ValidationError("Supplier is not capable for the selected item type.");
  }
  if (record.projectId && !store.projects.some((project) => project.id === record.projectId && project.recordState !== "Void")) {
    throw new ValidationError(`Case not found: ${record.projectId}`);
  }
  if (record.sourceQuoteId) {
    const quote = store.quotes.find((candidate) => candidate.id === record.sourceQuoteId && candidate.recordState !== "Void");
    if (!quote) throw new ValidationError(`Quote not found: ${record.sourceQuoteId}`);
    if (quote.supplierId !== record.supplierId || quote.itemId !== record.itemId) {
      throw new ValidationError("Source quote must match assignment supplier and item.");
    }
    if (quote.modelId !== record.modelId && !store.items.find((candidate) => candidate.id === record.itemId)?.usedForModels.includes(record.modelId)) {
      throw new ValidationError("Source quote item must be valid for the assignment model.");
    }
    if (
      record.projectId &&
      quote.projectId !== record.projectId &&
      !store.quoteCaseLinks.some((link) => link.recordState !== "Void" && link.projectId === record.projectId && link.quoteId === quote.id)
    ) {
      throw new ValidationError("Source quote must be linked to the assignment case.");
    }
  }

  const project = record.projectId ? store.projects.find((candidate) => candidate.id === record.projectId) : undefined;
  const inspection = latestInspection(store.inspections, {
    supplierId: record.supplierId,
    itemId: record.itemId,
    drawingSetId: project?.drawingSetId,
    sourceQuoteId: record.sourceQuoteId,
  });
  if (!qcAllowsSourceRole(inspection)) {
    throw new ValidationError("QC must pass or be conditional before assigning source role.");
  }
}

export function demoteConflictingSourceRoles(ctx: BusinessContext, current: {
  id: string;
  projectId?: string;
  modelId: string;
  itemId: string;
  role: string;
}) {
  if (!["Primary", "Secondary", "Tertiary"].includes(current.role)) return;
  for (const assignment of ctx.store.sourceAssignments) {
    if (
      assignment.id !== current.id &&
      assignment.recordState !== "Void" &&
      (assignment.projectId ?? "") === (current.projectId ?? "") &&
      assignment.modelId === current.modelId &&
      assignment.itemId === current.itemId &&
      assignment.role === current.role
    ) {
      const before = cloneRecord(assignment);
      assignment.role = "Backup";
      ctx.audit(
        "Edit",
        "SourceAssignment",
        assignment.id,
        entityLabel(ctx.store, "SourceAssignment", assignment),
        before,
        assignment,
        `Demoted because another supplier was set as ${current.role}`,
        assignment.projectId,
        "System",
      );
    }
  }
}

export function ensureUniqueItemCode(store: Store, itemCode: string, currentItemId?: string) {
  const normalizedCode = itemCode.trim().toLowerCase();
  const duplicate = store.items.find(
    (item) =>
      item.id !== currentItemId &&
      item.recordState !== "Void" &&
      item.itemCode.trim().toLowerCase() === normalizedCode,
  );
  if (duplicate) {
    throw new ValidationError("Item Code already exists. Edit the existing item and add additional models instead of creating a duplicate.");
  }
}

function blockDelete(label: string, links: string[]) {
  const activeLinks = links.filter(Boolean);
  if (activeLinks.length > 0) {
    throw new ValidationError(`Cannot delete ${label}: linked to ${activeLinks.join(", ")}.`);
  }
}

export function ensureNoSupplierLinks(store: Store, id: string) {
  blockDelete("supplier", [
    store.projects.some((project) => project.supplierIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.supplierId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.supplierId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.supplierId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.supplierId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.supplierId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.supplierId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.supplierId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoModelLinks(store: Store, id: string) {
  blockDelete("model", [
    store.items.some((item) => item.usedForModels.includes(id)) ? "items" : "",
    store.drawingSets.some((drawingSet) => drawingSet.modelId === id) ? "drawing sets" : "",
    store.projects.some((project) => project.modelIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.modelId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.modelId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.modelId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.modelId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.modelId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.modelId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.modelId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoItemLinks(store: Store, id: string) {
  blockDelete("item", [
    store.drawingSets.some((drawingSet) => drawingSet.drawingItems.some((drawingItem) => drawingItem.itemId === id))
      ? "drawing sets"
      : "",
    store.projects.some((project) => project.itemIds.includes(id)) ? "development cases" : "",
    store.quotes.some((quote) => quote.itemId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.itemId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.itemId === id) ? "sample inspections" : "",
    store.incomingDefects.some((defect) => defect.itemId === id) ? "incoming defects" : "",
    store.priceChanges.some((change) => change.itemId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.itemId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.itemId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoDrawingSetLinks(store: Store, id: string) {
  blockDelete("drawing set", [
    store.projects.some((project) => project.drawingSetId === id) ? "development cases" : "",
    store.quotes.some((quote) => quote.drawingSetId === id) ? "quotes" : "",
    store.inspections.some((inspection) => inspection.drawingSetId === id) ? "sample inspections" : "",
  ]);
}

export function ensureNoProjectLinks(store: Store, id: string) {
  blockDelete("case", [
    store.quotes.some((quote) => quote.projectId === id) ? "quotes" : "",
    store.quoteCaseLinks.some((link) => link.projectId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.projectId === id) ? "sample inspections" : "",
    store.sourceAssignments.some((assignment) => assignment.projectId === id) ? "source assignments" : "",
  ]);
}

export function ensureNoQuoteLinks(store: Store, id: string) {
  blockDelete("quote", [
    store.quotes.some((quote) => quote.previousQuoteId === id) ? "later quotes" : "",
    store.quoteCaseLinks.some((link) => link.quoteId === id) ? "case quote links" : "",
    store.inspections.some((inspection) => inspection.relatedQuoteId === id) ? "sample inspections" : "",
    store.priceChanges.some((change) => change.sourceQuoteId === id || change.previousQuoteId === id) ? "price changes" : "",
    store.purchasePrices.some((purchase) => purchase.linkedQuoteId === id) ? "purchase prices" : "",
    store.sourceAssignments.some((assignment) => assignment.sourceQuoteId === id) ? "source assignments" : "",
  ]);
}

export function deleteById<T extends { id: string }>(records: T[], id: string, label: string) {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) throw new ValidationError(`${label} not found: ${id}`);
  records.splice(index, 1);
}

/** Replaces a record with the edit laid over it, validated by `parse`. A null in the patch clears that field. */
export function updateById<T extends { id: string }>(
  records: T[],
  id: string,
  patch: unknown,
  parse: (value: unknown) => Omit<T, "id">,
) {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) throw new ValidationError(`Record not found: ${id}`);
  records[index] = { id, ...parse({ ...mergePatch(records[index], patch), id }) } as T;
  return records[index];
}

export function voidById<T extends { id: string; recordState?: "Draft" | "Active" | "Void"; voidReason?: string }>(
  records: T[],
  id: string,
  reason?: string,
) {
  const record = records.find((candidate) => candidate.id === id);
  if (!record) throw new ValidationError(`Record not found: ${id}`);
  record.recordState = "Void";
  record.voidReason = String(reason ?? "").trim() || "Entered in error";
}

/**
 * The passes that keep derived records consistent: packaging-set coverage,
 * case items, reusable quotes, quotes selected by a passed inspection, and
 * price changes. Every write runs them before it commits, so reads never need to.
 */
export function reconcile(ctx: BusinessContext) {
  const modelIds = ctx.store.models.map((model) => model.id);
  syncActivePackagingSetItems(ctx, modelIds, "Auto sync");
  syncActiveCasesForModels(ctx, modelIds, "Auto sync");
  syncReusableQuotesForProjects(ctx);
  syncQuoteStatusesFromPassedInspections(ctx);
  reconcileQuotePriceChanges(ctx);
}
