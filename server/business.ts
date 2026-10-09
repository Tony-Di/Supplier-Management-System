import type { IncomingDefectRecord, PurchasePriceRecord, Quote, QuoteCaseLink, SampleInspection, SourcingProject } from "../src/types";
import { parseLeadTimeDays } from "../src/leadTime";
import type { BusinessContext } from "./context";
import { ValidationError } from "./errors";
import { assertReferences, findDrawingItem, findDrawingSet, findItem, findModel, findProject, findSupplier } from "./lookups";
import { isUsableRecord } from "./rules";
import { findPreviousEffectiveQuote, isEffectivePriceQuote } from "./priceWindows";
import { paymentTermDays, scoreIncomingQuality, scoreLeadTime, scorePaymentTerms, scoreResponsiveness, scoreScopeFit } from "./scoring";
import type { Store } from "./storeShape";

export function validateProjectLinks(store: Store, project: {
  modelIds: string[];
  drawingSetId: string;
  supplierIds: string[];
  itemIds: string[];
}) {
  assertReferences(project.modelIds, (id) => findModel(store, id), "Model");
  assertReferences(project.supplierIds, (id) => findSupplier(store, id), "Supplier");
  assertReferences(project.itemIds, (id) => findItem(store, id), "Item");
  project.modelIds.forEach((modelId) => assertNotVoided(findModel(store, modelId), "Model"));
  project.supplierIds.forEach((supplierId) => assertNotVoided(findSupplier(store, supplierId), "Supplier"));
  project.itemIds.forEach((itemId) => assertNotVoided(findItem(store, itemId), "Item"));

  const drawingSet = findDrawingSet(store, project.drawingSetId);
  if (!drawingSet) throw new ValidationError(`Drawing set not found: ${project.drawingSetId}`);
  ensureActiveDrawingSet(drawingSet);

  if (!project.modelIds.includes(drawingSet.modelId)) {
    throw new ValidationError("Drawing set model must be included in the development case models.");
  }

  const drawingSetItemIds = new Set(drawingSet.drawingItems.map((drawingItem) => drawingItem.itemId));
  const missingDrawingItems = project.itemIds.filter((itemId) => !drawingSetItemIds.has(itemId));
  if (missingDrawingItems.length > 0) {
    throw new ValidationError(`Case items must exist in the selected drawing set: ${missingDrawingItems.join(", ")}`);
  }
}

export function validateDrawingSetLinks(store: Store, drawingSet: { modelId: string; drawingItems: { itemId: string }[] }) {
  if (!findModel(store, drawingSet.modelId)) throw new ValidationError(`Model not found: ${drawingSet.modelId}`);
  assertReferences(
    drawingSet.drawingItems.map((drawingItem) => drawingItem.itemId),
    (id) => findItem(store, id),
    "Item",
  );
}

/** A list of file IDs has no foreign key to check it, so each one is looked up here. */
export function validateSupplierFileLinks(store: Store, supplier: { otherFileIds: string[] }) {
  for (const fileId of supplier.otherFileIds) {
    if (!store.files.some((file) => file.id === fileId)) throw new ValidationError(`Other document not found: ${fileId}`);
  }
}

export function validateQuoteLinks(store: Store, quote: Omit<Quote, "id">) {
  const supplier = findSupplier(store, quote.supplierId);
  if (!supplier) throw new ValidationError(`Supplier not found: ${quote.supplierId}`);
  assertNotVoided(supplier, "Supplier");
  const model = findModel(store, quote.modelId);
  if (!model) throw new ValidationError(`Model not found: ${quote.modelId}`);
  assertNotVoided(model, "Model");
  const item = findItem(store, quote.itemId);
  if (!item) throw new ValidationError(`Item not found: ${quote.itemId}`);
  assertNotVoided(item, "Item");
  if (!supplier.capableItems.includes(item.type)) throw new ValidationError("Supplier is not capable for the selected item type.");
  const drawingSet = findDrawingSet(store, quote.drawingSetId);
  if (!drawingSet) throw new ValidationError(`Drawing set not found: ${quote.drawingSetId}`);
  ensureActiveDrawingSet(drawingSet);
  const drawingItem = findDrawingItem(store, quote.drawingSetId, quote.drawingItemId);
  if (!drawingItem) {
    throw new ValidationError("Drawing item must belong to the selected drawing set.");
  }
  if (drawingSet.modelId !== quote.modelId) throw new ValidationError("Quote model must match the selected drawing set model.");
  if (drawingItem.itemId !== quote.itemId) throw new ValidationError("Quote item must match the selected drawing item.");
  if (!item.usedForModels.includes(quote.modelId)) throw new ValidationError("Quote item must be marked as used for the selected model.");
  if (quote.quoteType === "Case-linked" && !quote.projectId) throw new ValidationError("Case-linked quote requires a case.");
  if (quote.quoteType === "Standalone" && quote.projectId) throw new ValidationError("Standalone quote should not be linked to a case.");
  if (quote.previousQuoteId) {
    const previousQuote = store.quotes.find((candidate) => candidate.id === quote.previousQuoteId);
    if (!previousQuote) throw new ValidationError(`Previous quote not found: ${quote.previousQuoteId}`);
    if (previousQuote.supplierId !== quote.supplierId || previousQuote.itemId !== quote.itemId) {
      throw new ValidationError("Previous quote must match the same supplier and item.");
    }
  }
  if (quote.projectId) {
    const project = findProject(store, quote.projectId);
    if (!project) throw new ValidationError(`Case not found: ${quote.projectId}`);
    if (!project.modelIds.includes(quote.modelId)) {
      throw new ValidationError("Model must be included in the case before case-linked quoting.");
    }
  }
}

export function syncCaseFromQuote(ctx: BusinessContext, quote: Quote) {
  const { store } = ctx;
  if (!quote.projectId) return;
  const project = findProject(store, quote.projectId);
  if (!project) return;
  if (!project.supplierIds.includes(quote.supplierId)) project.supplierIds.push(quote.supplierId);
  if (!project.itemIds.includes(quote.itemId)) project.itemIds.push(quote.itemId);
  upsertQuoteCaseLink(ctx, quote, project, "Origin Case");
  syncReusableQuotesForProjects(ctx);
}

export function syncReusableQuotesForProjects(ctx: BusinessContext, projects = ctx.store.projects) {
  let changed = false;
  for (const project of projects) {
    changed = syncReusableQuotesForProject(ctx, project) || changed;
  }
  return changed;
}

export function syncReusableQuotesForProject(ctx: BusinessContext, project: SourcingProject) {
  const { store } = ctx;
  let changed = false;
  const linkedSupplierIds = new Set(project.supplierIds);
  const projectItemIds = new Set(project.itemIds);
  const projectModelIds = new Set(project.modelIds);

  for (const quote of store.quotes) {
    if (quote.recordState === "Void") continue;
    if (!linkedSupplierIds.has(quote.supplierId)) continue;
    if (!projectItemIds.has(quote.itemId)) continue;
    if (!projectModelIds.has(quote.modelId) && !findItem(store, quote.itemId)?.usedForModels.some((modelId) => projectModelIds.has(modelId))) continue;
    if (!quoteIsEffectiveForProject(quote, project)) continue;
    changed = Boolean(upsertQuoteCaseLink(ctx, quote, project, quote.projectId === project.id ? "Origin Case" : "Reused Existing Quote")) || changed;
  }
  return changed;
}

function upsertQuoteCaseLink(ctx: BusinessContext, quote: Quote, project: SourcingProject, linkType: "Origin Case" | "Reused Existing Quote") {
  const { store } = ctx;
  const existing = store.quoteCaseLinks.find(
    (link) => link.recordState !== "Void" && link.quoteId === quote.id && link.projectId === project.id,
  );
  const sampleRequirement = sampleRequirementForQuoteInProject(store, quote, project);

  if (existing) {
    const before = JSON.stringify(existing);
    existing.supplierId = quote.supplierId;
    existing.itemId = quote.itemId;
    existing.modelId = project.modelIds.includes(quote.modelId) ? quote.modelId : project.modelIds[0] ?? quote.modelId;
    existing.linkType = existing.linkType === "Origin Case" ? "Origin Case" : linkType;
    existing.sampleRequirement = sampleRequirement;
    return before !== JSON.stringify(existing) ? existing : undefined;
  }

  const link = {
    id: ctx.nextId("ql"),
    quoteId: quote.id,
    projectId: project.id,
    supplierId: quote.supplierId,
    itemId: quote.itemId,
    modelId: project.modelIds.includes(quote.modelId) ? quote.modelId : project.modelIds[0] ?? quote.modelId,
    linkType,
    sampleRequirement,
    recordState: "Active" as const,
  };
  store.quoteCaseLinks.push(link);
  return link;
}

function quoteIsEffectiveForProject(quote: Quote, project: SourcingProject) {
  const projectDate = project.openDate || quote.effectiveFrom || quote.quoteDate;
  const startDate = quote.effectiveFrom || quote.quoteDate;
  return startDate <= projectDate && (!quote.effectiveTo || quote.effectiveTo >= projectDate);
}

function sampleRequirementForQuoteInProject(store: Store, quote: Quote, project: SourcingProject): QuoteCaseLink["sampleRequirement"] {
  if (quote.status === "Sample Requested") return "Sample Requested";
  const activeProjectDrawingSet = findDrawingSet(store, project.drawingSetId);
  const passedInspection = store.inspections
    .filter((inspection) =>
      inspection.recordState !== "Void" &&
      inspection.supplierId === quote.supplierId &&
      inspection.itemId === quote.itemId &&
      (!activeProjectDrawingSet || inspection.drawingSetId === activeProjectDrawingSet.id) &&
      inspection.result === "Pass")
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
  if (passedInspection) return "Not Required - Existing QC Pass";
  return quote.status === "Selected" ? "Required" : "Not Reviewed";
}

function assertNotVoided(record: { recordState?: "Draft" | "Active" | "Void" } | undefined, label: string) {
  if (!isUsableRecord(record)) {
    throw new ValidationError(`${label} is voided and cannot be used on new records.`);
  }
}

function ensureActiveDrawingSet(drawingSet: { status?: string; recordState?: string }) {
  if (drawingSet.recordState === "Void" || drawingSet.status !== "Active") {
    throw new ValidationError("Use the current active packaging set for new case, quote, and QC workflow.");
  }
}

export function validateInspectionLinks(store: Store, inspection: Omit<SampleInspection, "id">) {
  validateQuoteLikeLinks(store, inspection);
}

export function validateIncomingDefectLinks(store: Store, record: { supplierId: string; modelId?: string; itemId: string }) {
  if (!findSupplier(store, record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findItem(store, record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
  if (record.modelId && !findModel(store, record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
  assertNotVoided(findSupplier(store, record.supplierId), "Supplier");
  assertNotVoided(findItem(store, record.itemId), "Item");
}

export function normalizeIncomingDefectCompletion(defect: Omit<IncomingDefectRecord, "id"> | IncomingDefectRecord) {
  defect.replacementReceipts ??= [];
  const acceptedReplacementQty = defect.replacementReceipts
    .filter((receipt) => receipt.result === "Accepted")
    .reduce((sum, receipt) => sum + receipt.receivedQty, 0);
  const currentReceivedQty = (defect.receivedQty ?? 0) + acceptedReplacementQty;
  const pendingQty =
    defect.defectAction === "Request Replacement" && defect.poQty !== undefined && defect.receivedQty !== undefined
      ? Math.max(defect.poQty - currentReceivedQty, 0)
      : defect.defectAction === "Request Replacement"
        ? Math.max((defect.replacementQty ?? defect.defectQty) - acceptedReplacementQty, 0)
        : 0;

  defect.actionCompleted = defect.defectAction === "Request Credit" || pendingQty === 0;
  const latestAcceptedReceipt = [...defect.replacementReceipts].reverse().find((receipt) => receipt.result === "Accepted");
  defect.actionCompletedDate = defect.actionCompleted ? latestAcceptedReceipt?.receivedDate ?? defect.actionCompletedDate ?? defect.returnDate ?? defect.defectDate : undefined;
}

function validateQuoteLikeLinks(store: Store, record: {
  supplierId: string;
  projectId?: string;
  relatedQuoteId?: string;
  modelId: string;
  itemId: string;
  drawingSetId: string;
  drawingItemId: string;
}) {
  const supplier = findSupplier(store, record.supplierId);
  if (!supplier) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  assertNotVoided(supplier, "Supplier");
  const model = findModel(store, record.modelId);
  if (!model) throw new ValidationError(`Model not found: ${record.modelId}`);
  assertNotVoided(model, "Model");
  const item = findItem(store, record.itemId);
  if (!item) throw new ValidationError(`Item not found: ${record.itemId}`);
  assertNotVoided(item, "Item");
  const drawingSet = findDrawingSet(store, record.drawingSetId);
  if (!drawingSet) throw new ValidationError(`Drawing set not found: ${record.drawingSetId}`);
  ensureActiveDrawingSet(drawingSet);
  const drawingItem = findDrawingItem(store, record.drawingSetId, record.drawingItemId);
  if (!drawingItem) {
    throw new ValidationError("Drawing item must belong to the selected drawing set.");
  }
  if (drawingSet.modelId !== record.modelId) throw new ValidationError("Inspection model must match the selected drawing set model.");
  if (drawingItem.itemId !== record.itemId) throw new ValidationError("Inspection item must match the selected drawing item.");
  if (!item.usedForModels.includes(record.modelId)) throw new ValidationError("Inspection item must be marked as used for the selected model.");
  if (record.relatedQuoteId) {
    const relatedQuote = store.quotes.find((quote) => quote.id === record.relatedQuoteId);
    if (!relatedQuote) throw new ValidationError(`Related quote not found: ${record.relatedQuoteId}`);
    if (relatedQuote.supplierId !== record.supplierId || relatedQuote.itemId !== record.itemId) {
      throw new ValidationError("Related quote must match the same supplier and item.");
    }
  }
  if (record.projectId) {
    const project = findProject(store, record.projectId);
    if (!project) throw new ValidationError(`Case not found: ${record.projectId}`);
    if (!project.supplierIds.includes(record.supplierId)) {
      throw new ValidationError("Supplier must be part of the case before case-linked sample inspection.");
    }
    if (!project.itemIds.includes(record.itemId)) {
      throw new ValidationError("Item must be part of the case before case-linked sample inspection.");
    }
  }
}

export function validatePriceChangeLinks(store: Store, record: {
  supplierId: string;
  modelId: string;
  itemId: string;
  sourceQuoteId?: string;
  previousQuoteId?: string;
  sourcePurchasePriceId?: string;
  previousPurchasePriceId?: string;
}) {
  if (!findSupplier(store, record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findModel(store, record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
  if (!findItem(store, record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
  for (const quoteId of [record.sourceQuoteId, record.previousQuoteId].filter(Boolean)) {
    const quote = store.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote) throw new ValidationError(`Linked quote not found: ${quoteId}`);
    if (quote.supplierId !== record.supplierId || quote.modelId !== record.modelId || quote.itemId !== record.itemId) {
      throw new ValidationError("Linked quote must match the same supplier, model, and item as the price change.");
    }
  }
  for (const purchaseId of [record.sourcePurchasePriceId, record.previousPurchasePriceId].filter(Boolean)) {
    const purchase = store.purchasePrices.find((candidate) => candidate.id === purchaseId);
    if (!purchase) throw new ValidationError(`Linked purchase price not found: ${purchaseId}`);
    if (purchase.supplierId !== record.supplierId || purchase.itemId !== record.itemId) {
      throw new ValidationError("Linked purchase price must match the same supplier and item as the price change.");
    }
  }
}

export function validatePurchasePriceLinks(store: Store, record: { supplierId: string; modelId: string; itemId: string; linkedQuoteId?: string }) {
  if (!findSupplier(store, record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findModel(store, record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
  if (!findItem(store, record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
  if (record.linkedQuoteId) {
    const quote = store.quotes.find((candidate) => candidate.id === record.linkedQuoteId);
    if (!quote) throw new ValidationError(`Linked quote not found: ${record.linkedQuoteId}`);
    if (quote.supplierId !== record.supplierId || quote.itemId !== record.itemId || quote.modelId !== record.modelId) {
      throw new ValidationError("Linked quote must match the same supplier, item, and model as the purchase price.");
    }
  }
}

export function buildComparison(store: Store, projectId: string) {
  const project = findProject(store, projectId);
  if (!project) throw new ValidationError(`Project not found: ${projectId}`);
  const projectQuoteIds = new Set(
    store.quoteCaseLinks
      .filter((link) => link.projectId === projectId && link.recordState !== "Void")
      .map((link) => link.quoteId),
  );
  const projectQuotes = store.quotes.filter((quote) => projectQuoteIds.has(quote.id) && quote.recordState !== "Void");

  return project.itemIds.map((itemId) => {
    const itemQuotes = projectQuotes.filter((quote) => quote.itemId === itemId);
    const supplierIds = Array.from(new Set(itemQuotes.map((quote) => quote.supplierId)));
    const itemInspections = store.inspections.filter(
      (inspection) => inspection.projectId === projectId && inspection.itemId === itemId && inspection.recordState !== "Void",
    );

    return {
      item: findItem(store, itemId),
      suppliers: supplierIds.map((supplierId) => {
        const supplierQuotes = itemQuotes
          .filter((candidate) => candidate.supplierId === supplierId)
          .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate));
        const quote = supplierQuotes.find(isSelectedQuote) ?? supplierQuotes.find(isSampleRequestedQuote) ?? supplierQuotes[0];
        const inspection = itemInspections.find((candidate) => candidate.supplierId === supplierId);
        return {
          supplier: findSupplier(store, supplierId),
          quote,
          quotes: supplierQuotes,
          inspection,
        };
      }),
      recommendedSupplierId: recommendSupplier(itemQuotes, itemInspections),
    };
  });
}

export function buildPriceChangeFromQuote(ctx: BusinessContext, quote: Quote) {
  const { store } = ctx;
  if (!isEffectivePriceQuote(quote)) return;

  const previousQuote = findPreviousEffectiveQuote(quote, store.quotes);

  if (!previousQuote || previousQuote.unitPrice === quote.unitPrice) return;
  if ((previousQuote.effectiveFrom ?? previousQuote.quoteDate) === (quote.effectiveFrom ?? quote.quoteDate)) return;
  const existingChange = store.priceChanges.find(
    (change) =>
      change.recordState !== "Void" &&
      change.sourceQuoteId === quote.id &&
      change.previousQuoteId === previousQuote.id,
  );
  const sourceType = quote.quoteReason === "Requote" ? "Requote" : "New Quote";
  const reason =
    quote.quoteReason === "Change Work Order"
      ? "Change Work Order"
      : quote.quoteReason === "Model Change"
        ? "Model Change"
        : quote.quoteReason === "Requote"
          ? "Requote"
          : "Other";

  if (existingChange) {
    existingChange.modelId = quote.modelId;
    existingChange.oldPrice = previousQuote.unitPrice;
    existingChange.newPrice = quote.unitPrice;
    existingChange.effectiveDate = quote.effectiveFrom ?? quote.quoteDate;
    existingChange.sourceType = sourceType;
    existingChange.reason = reason;
    return;
  }

  store.priceChanges.push({
    id: ctx.nextId("pc"),
    supplierId: quote.supplierId,
    modelId: quote.modelId,
    itemId: quote.itemId,
    sourceQuoteId: quote.id,
    previousQuoteId: previousQuote.id,
    sourceType,
    oldPrice: previousQuote.unitPrice,
    newPrice: quote.unitPrice,
    currency: "USD",
    effectiveDate: quote.effectiveFrom ?? quote.quoteDate,
    reason,
    status: "Pending",
  });
}

export function reconcileQuotePriceChanges(ctx: BusinessContext) {
  const { store } = ctx;
  releasePricesOfUnselectedQuotes(store);
  const effectiveQuotes = [...store.quotes]
    .filter((quote) => quote.recordState !== "Void" && isEffectivePriceQuote(quote))
    .sort((a, b) => (a.effectiveFrom ?? a.quoteDate).localeCompare(b.effectiveFrom ?? b.quoteDate));

  for (const quote of effectiveQuotes) {
    assignPreviousQuote(store, quote);
    buildPriceChangeFromQuote(ctx, quote);
    closePreviousSelectedQuote(store, quote);
  }
}

/**
 * Undoes what a quote's selection did once it is no longer Selected: the price
 * it closed reopens, a later price stops naming it as the price it replaced,
 * and price changes still pending from or against it are voided.
 */
function releasePricesOfUnselectedQuotes(store: Store) {
  const isCurrentPrice = (id: string | undefined) => {
    const quote = id ? store.quotes.find((candidate) => candidate.id === id) : undefined;
    return Boolean(quote && quote.recordState !== "Void" && isEffectivePriceQuote(quote));
  };
  for (const quote of store.quotes) {
    if (quote.closedByQuoteId && !isCurrentPrice(quote.closedByQuoteId)) {
      quote.effectiveTo = undefined;
      quote.closedByQuoteId = undefined;
    }
    if (quote.previousQuoteId && isCurrentPrice(quote.id) && !isCurrentPrice(quote.previousQuoteId)) {
      quote.previousQuoteId = undefined;
    }
  }
  for (const change of store.priceChanges) {
    if (change.recordState === "Void" || change.status !== "Pending" || !change.sourceQuoteId) continue;
    if (isCurrentPrice(change.sourceQuoteId) && isCurrentPrice(change.previousQuoteId)) continue;
    change.recordState = "Void";
    change.voidReason = "Quote no longer selected";
  }
}

export function assignPreviousQuote(store: Store, quote: Quote) {
  if (quote.previousQuoteId) return;
  const previousQuote = findPreviousEffectiveQuote(quote, store.quotes);
  if (previousQuote) quote.previousQuoteId = previousQuote.id;
}

export function closePreviousSelectedQuote(store: Store, quote: Quote) {
  if (!isEffectivePriceQuote(quote)) return;

  const previousQuote = findPreviousEffectiveQuote(quote, store.quotes);

  if (!previousQuote) return;
  if ((previousQuote.effectiveFrom ?? previousQuote.quoteDate) === (quote.effectiveFrom ?? quote.quoteDate)) return;
  previousQuote.effectiveTo = dayBefore(quote.effectiveFrom ?? quote.quoteDate);
  previousQuote.closedByQuoteId = quote.id;
}

function isSampleRequestedQuote(quote: Quote) {
  return quote.status === "Sample Requested";
}

function isSelectedQuote(quote: Quote) {
  return quote.status === "Selected";
}

function dayBefore(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function buildPriceChangeFromPurchase(ctx: BusinessContext, purchase: PurchasePriceRecord) {
  const { store } = ctx;
  const previousPurchase = [...store.purchasePrices]
    .reverse()
    .find(
      (candidate) =>
        candidate.id !== purchase.id &&
        candidate.supplierId === purchase.supplierId &&
        candidate.itemId === purchase.itemId &&
        candidate.recordState !== "Void",
    );

  if (!previousPurchase || previousPurchase.unitPrice === purchase.unitPrice) return;

  store.priceChanges.push({
    id: ctx.nextId("pc"),
    supplierId: purchase.supplierId,
    modelId: purchase.modelId,
    itemId: purchase.itemId,
    sourcePurchasePriceId: purchase.id,
    previousPurchasePriceId: previousPurchase.id,
    sourceType: "Purchase",
    oldPrice: previousPurchase.unitPrice,
    newPrice: purchase.unitPrice,
    currency: "USD",
    effectiveDate: purchase.orderDate,
    reason: "Other",
    status: "Pending",
  });
}

function buildSupplierScorecard(store: Store, supplierId: string) {
  const supplier = findSupplier(store, supplierId);
  if (!supplier) return undefined;

  const supplierQuotes = store.quotes.filter((quote) => quote.supplierId === supplierId && quote.recordState !== "Void");
  const supplierInspections = store.inspections.filter((inspection) => inspection.supplierId === supplierId && inspection.recordState !== "Void");
  const pass = supplierInspections.filter((inspection) => inspection.result === "Pass").length;
  const fail = supplierInspections.filter((inspection) => inspection.result === "Fail").length;
  const conditional = supplierInspections.filter((inspection) => inspection.result === "Conditional").length;
  const reviewedSamples = pass + fail + conditional;
  const supplierDefects = store.incomingDefects.filter((defect) => defect.supplierId === supplierId && defect.recordState !== "Void");
  const recentDefectQty = supplierDefects
    .filter((defect) => isWithinRecentDays(defect.defectDate, 90))
    .reduce((sum, defect) => sum + defect.defectQty, 0);
  const incomingQualityScore = scoreIncomingQuality(recentDefectQty, store.scoreWeights.incomingQuality);
  const selectedQuotes = supplierQuotes.filter(isSelectedQuote).length;
  const declaredTypes = supplier.capableItems.length;
  const quotedDeclaredTypes = new Set(
    supplierQuotes
      .map((quote) => findItem(store, quote.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const passedDeclaredTypes = new Set(
    supplierInspections
      .filter((inspection) => inspection.result === "Pass")
      .map((inspection) => findItem(store, inspection.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const numericLeadTimes = supplierQuotes
    .map((quote) => parseLeadTimeDays(quote.leadTime))
    .filter((leadTime): leadTime is number => leadTime !== undefined);
  const averageLeadTime =
    numericLeadTimes.length > 0 ? numericLeadTimes.reduce((sum, leadTime) => sum + leadTime, 0) / numericLeadTimes.length : undefined;

  const sampleQualityScore =
    reviewedSamples === 0
      ? 0
      : clamp(Math.round((pass / reviewedSamples) * (store.scoreWeights.sampleQuality - 5) - fail * 3 + (pass > 0 ? 5 : 0)), 0, store.scoreWeights.sampleQuality);
  const pricingScore = scorePricingCompetitiveness(store, supplierQuotes, store.scoreWeights.pricing, supplier.paymentTerms);
  const responsivenessScore = scoreResponsiveness(
    { quoteCount: supplierQuotes.length, averageLeadTime, selectedQuotes },
    store.scoreWeights.responsiveness,
  );
  const scopeScore = scoreScopeFit({ declaredTypes, quotedDeclaredTypes, passedDeclaredTypes }, store.scoreWeights.scopeFit);
  const leadTimeScore = scoreLeadTime(averageLeadTime, store.scoreWeights.setup);
  const qualityScore = sampleQualityScore + incomingQualityScore;
  const qualityMax = store.scoreWeights.sampleQuality + store.scoreWeights.incomingQuality;
  const score = qualityScore + pricingScore + responsivenessScore + scopeScore + leadTimeScore;

  return {
    supplier,
    score,
    grade: score >= 85 ? "A - Preferred" : score >= 70 ? "B - Approved" : score >= 55 ? "C - Conditional" : "D - Not Recommended",
    categories: [
      {
        key: "quality",
        label: "Quality",
        score: qualityScore,
        max: qualityMax,
        detail: `Sample ${sampleQualityScore}/${store.scoreWeights.sampleQuality}; incoming ${incomingQualityScore}/${store.scoreWeights.incomingQuality}`,
        children: [
          {
            key: "sampleQuality",
            label: "Sample Quality",
            score: sampleQualityScore,
            max: store.scoreWeights.sampleQuality,
            detail: reviewedSamples === 0 ? "No QC result yet" : `${pass} pass, ${fail} fail, ${conditional} conditional`,
          },
          {
            key: "incomingQuality",
            label: "Incoming Quality",
            score: incomingQualityScore,
            max: store.scoreWeights.incomingQuality,
            detail: `${recentDefectQty} rejected/defect qty in last 90 days`,
          },
        ],
      },
      {
        key: "pricing",
        label: "Pricing",
        score: pricingScore,
        max: store.scoreWeights.pricing,
        detail: pricingDetail(store, supplierQuotes, supplier.paymentTerms),
      },
      {
        key: "responsiveness",
        label: "Responsiveness",
        score: responsivenessScore,
        max: store.scoreWeights.responsiveness,
        detail: averageLeadTime === undefined ? "No quote lead time yet" : `Average lead time ${Math.round(averageLeadTime)} days`,
      },
      {
        key: "scope",
        label: "Scope Fit",
        score: scopeScore,
        max: store.scoreWeights.scopeFit,
        detail: declaredTypes === 0 ? "No supply scope declared" : `${quotedDeclaredTypes}/${declaredTypes} declared types quoted`,
      },
      {
        key: "setup",
        label: "Lead Time",
        score: leadTimeScore,
        max: store.scoreWeights.setup,
        detail: averageLeadTime === undefined ? "No quote lead time yet" : `Average lead time ${Math.round(averageLeadTime)} days`,
      },
    ],
    scopeLabel:
      declaredTypes === 0
        ? "Not defined"
        : declaredTypes === 1
          ? `${supplier.capableItems[0]} specialist`
          : `${declaredTypes} declared categories`,
    quoteCount: supplierQuotes.length,
    passCount: pass,
    failCount: fail,
    documentsComplete: supplier.hasW9 && supplier.hasPaymentInfo,
  };
}

export function buildScorecard(store: Store) {
  return {
    weights: store.scoreWeights,
    rows: store.suppliers.flatMap((supplier) => {
      const row = buildSupplierScorecard(store, supplier.id);
      return row ? [row] : [];
    }),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scorePricingCompetitiveness(store: Store, supplierQuotes: Quote[], max: number, paymentTerms = "") {
  if (supplierQuotes.length === 0) return 0;
  const quoteScores = supplierQuotes.map((quote) => quotePriceCompetitiveness(store, quote));
  const averagePercent = quoteScores.reduce((sum, score) => sum + score, 0) / quoteScores.length;
  const priceMax = Math.round(max * 0.85);
  const termsMax = max - priceMax;
  return Math.round(priceMax * averagePercent) + scorePaymentTerms(paymentTerms, termsMax);
}

function quotePriceCompetitiveness(store: Store, quote: Quote): number {
  const groupQuotes = store.quotes.filter(
    (candidate) =>
      candidate.recordState !== "Void" &&
      candidate.itemId === quote.itemId &&
      (candidate.projectId ?? "Standalone") === (quote.projectId ?? "Standalone"),
  );
  const lowestPrice = Math.min(...groupQuotes.map((candidate) => candidate.unitPrice).filter((price) => price > 0));
  if (!Number.isFinite(lowestPrice) || lowestPrice <= 0) return 0;
  const gap = (quote.unitPrice - lowestPrice) / lowestPrice;
  if (gap <= 0) return 1;
  if (gap <= 0.03) return 0.9;
  if (gap <= 0.05) return 0.8;
  if (gap <= 0.1) return 0.6;
  return 0.3;
}

function pricingDetail(store: Store, supplierQuotes: Quote[], paymentTerms = "") {
  if (supplierQuotes.length === 0) return "No quote for price comparison";
  const selectedCount = supplierQuotes.filter(isSelectedQuote).length;
  const averagePercent = Math.round((supplierQuotes.reduce((sum, quote) => sum + quotePriceCompetitiveness(store, quote), 0) / supplierQuotes.length) * 100);
  const termsDays = paymentTermDays(paymentTerms);
  const termsLabel = termsDays === undefined ? "payment terms not set" : `Net ${termsDays} payment terms`;
  return `${averagePercent}% price competitiveness, ${termsLabel}, ${selectedCount} selected quote${selectedCount === 1 ? "" : "s"}`;
}

function isWithinRecentDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function recommendSupplier(candidateQuotes: Quote[], candidateInspections: SampleInspection[]) {
  const passSupplierIds = new Set(
    candidateInspections.filter((inspection) => inspection.result === "Pass").map((inspection) => inspection.supplierId),
  );
  const candidates = [...candidateQuotes].sort((a, b) => {
    const aPass = passSupplierIds.has(a.supplierId) ? 0 : 1;
    const bPass = passSupplierIds.has(b.supplierId) ? 0 : 1;
    return aPass - bPass || a.unitPrice - b.unitPrice;
  });

  return candidates[0]?.supplierId ?? null;
}
