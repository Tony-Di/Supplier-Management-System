import type { IncomingDefectRecord, PurchasePriceRecord, Quote, QuoteCaseLink, SampleInspection, SourcingProject } from "../src/types";
import { parseLeadTimeDays } from "../src/leadTime";
import {
  assertReferences,
  findDrawingItem,
  findDrawingSet,
  findItem,
  findModel,
  nextId,
  findProject,
  findSupplier,
  store,
  ValidationError,
} from "./store";

export function validateProjectLinks(project: {
  modelIds: string[];
  drawingSetId: string;
  supplierIds: string[];
  itemIds: string[];
}) {
  assertReferences(project.modelIds, findModel, "Model");
  assertReferences(project.supplierIds, findSupplier, "Supplier");
  assertReferences(project.itemIds, findItem, "Item");

  const drawingSet = findDrawingSet(project.drawingSetId);
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

export function validateDrawingSetLinks(drawingSet: { modelId: string; drawingItems: { itemId: string }[] }) {
  if (!findModel(drawingSet.modelId)) throw new ValidationError(`Model not found: ${drawingSet.modelId}`);
  assertReferences(
    drawingSet.drawingItems.map((drawingItem) => drawingItem.itemId),
    findItem,
    "Item",
  );
}

export function validateQuoteLinks(quote: Omit<Quote, "id">) {
  const supplier = findSupplier(quote.supplierId);
  if (!supplier) throw new ValidationError(`Supplier not found: ${quote.supplierId}`);
  const model = findModel(quote.modelId);
  if (!model) throw new ValidationError(`Model not found: ${quote.modelId}`);
  const item = findItem(quote.itemId);
  if (!item) throw new ValidationError(`Item not found: ${quote.itemId}`);
  if (!supplier.capableItems.includes(item.type)) throw new ValidationError("Supplier is not capable for the selected item type.");
  const drawingSet = findDrawingSet(quote.drawingSetId);
  if (!drawingSet) throw new ValidationError(`Drawing set not found: ${quote.drawingSetId}`);
  ensureActiveDrawingSet(drawingSet);
  const drawingItem = findDrawingItem(quote.drawingSetId, quote.drawingItemId);
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
    const project = findProject(quote.projectId);
    if (!project) throw new ValidationError(`Case not found: ${quote.projectId}`);
    if (!project.modelIds.includes(quote.modelId)) {
      throw new ValidationError("Model must be included in the case before case-linked quoting.");
    }
  }
}

export function syncCaseFromQuote(quote: Quote) {
  if (!quote.projectId) return;
  const project = findProject(quote.projectId);
  if (!project) return;
  if (!project.supplierIds.includes(quote.supplierId)) project.supplierIds.push(quote.supplierId);
  if (!project.itemIds.includes(quote.itemId)) project.itemIds.push(quote.itemId);
  upsertQuoteCaseLink(quote, project, "Origin Case");
  syncReusableQuotesForProjects();
}

export function syncReusableQuotesForProjects(projects = store.projects) {
  let changed = false;
  for (const project of projects) {
    changed = syncReusableQuotesForProject(project) || changed;
  }
  return changed;
}

export function syncReusableQuotesForProject(project: SourcingProject) {
  let changed = false;
  const linkedSupplierIds = new Set(project.supplierIds);
  const projectItemIds = new Set(project.itemIds);
  const projectModelIds = new Set(project.modelIds);

  for (const quote of store.quotes) {
    if (quote.recordState === "Void") continue;
    if (!linkedSupplierIds.has(quote.supplierId)) continue;
    if (!projectItemIds.has(quote.itemId)) continue;
    if (!projectModelIds.has(quote.modelId) && !findItem(quote.itemId)?.usedForModels.some((modelId) => projectModelIds.has(modelId))) continue;
    if (!quoteIsEffectiveForProject(quote, project)) continue;
    changed = Boolean(upsertQuoteCaseLink(quote, project, quote.projectId === project.id ? "Origin Case" : "Reused Existing Quote")) || changed;
  }
  return changed;
}

function upsertQuoteCaseLink(quote: Quote, project: SourcingProject, linkType: "Origin Case" | "Reused Existing Quote") {
  const existing = store.quoteCaseLinks.find(
    (link) => link.recordState !== "Void" && link.quoteId === quote.id && link.projectId === project.id,
  );
  const sampleRequirement = sampleRequirementForQuoteInProject(quote, project);

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
    id: nextId("ql"),
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

function sampleRequirementForQuoteInProject(quote: Quote, project: SourcingProject): QuoteCaseLink["sampleRequirement"] {
  if (quote.status === "Sample Requested") return "Sample Requested";
  const activeProjectDrawingSet = findDrawingSet(project.drawingSetId);
  const passedInspection = store.inspections
    .filter((inspection) =>
      inspection.recordState !== "Void" &&
      inspection.supplierId === quote.supplierId &&
      inspection.itemId === quote.itemId &&
      (!activeProjectDrawingSet || inspection.drawingSetId === activeProjectDrawingSet.id) &&
      (inspection.result === "Pass" || inspection.result === "Conditional"))
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
  if (passedInspection) return "Not Required - Existing QC Pass";
  return quote.status === "Selected" ? "Required" : "Not Reviewed";
}

function ensureActiveDrawingSet(drawingSet: { status?: string; recordState?: string }) {
  if (drawingSet.recordState === "Void" || drawingSet.status !== "Active") {
    throw new ValidationError("Use the current active packaging set for new case, quote, and QC workflow.");
  }
}

export function validateInspectionLinks(inspection: Omit<SampleInspection, "id">) {
  validateQuoteLikeLinks(inspection);
}

export function validateIncomingDefectLinks(record: { supplierId: string; modelId?: string; itemId: string }) {
  if (!findSupplier(record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findItem(record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
  if (record.modelId && !findModel(record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
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

function validateQuoteLikeLinks(record: {
  supplierId: string;
  projectId?: string;
  relatedQuoteId?: string;
  modelId: string;
  itemId: string;
  drawingSetId: string;
  drawingItemId: string;
}) {
  if (!findSupplier(record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  const model = findModel(record.modelId);
  if (!model) throw new ValidationError(`Model not found: ${record.modelId}`);
  const item = findItem(record.itemId);
  if (!item) throw new ValidationError(`Item not found: ${record.itemId}`);
  const drawingSet = findDrawingSet(record.drawingSetId);
  if (!drawingSet) throw new ValidationError(`Drawing set not found: ${record.drawingSetId}`);
  ensureActiveDrawingSet(drawingSet);
  const drawingItem = findDrawingItem(record.drawingSetId, record.drawingItemId);
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
    const project = findProject(record.projectId);
    if (!project) throw new ValidationError(`Case not found: ${record.projectId}`);
    if (!project.supplierIds.includes(record.supplierId)) {
      throw new ValidationError("Supplier must be part of the case before case-linked sample inspection.");
    }
    if (!project.itemIds.includes(record.itemId)) {
      throw new ValidationError("Item must be part of the case before case-linked sample inspection.");
    }
  }
}

export function validatePriceChangeLinks(record: {
  supplierId: string;
  modelId: string;
  itemId: string;
  sourceQuoteId?: string;
  previousQuoteId?: string;
  sourcePurchasePriceId?: string;
  previousPurchasePriceId?: string;
}) {
  if (!findSupplier(record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findModel(record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
  if (!findItem(record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
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

export function validatePurchasePriceLinks(record: { supplierId: string; modelId: string; itemId: string; linkedQuoteId?: string }) {
  if (!findSupplier(record.supplierId)) throw new ValidationError(`Supplier not found: ${record.supplierId}`);
  if (!findModel(record.modelId)) throw new ValidationError(`Model not found: ${record.modelId}`);
  if (!findItem(record.itemId)) throw new ValidationError(`Item not found: ${record.itemId}`);
  if (record.linkedQuoteId) {
    const quote = store.quotes.find((candidate) => candidate.id === record.linkedQuoteId);
    if (!quote) throw new ValidationError(`Linked quote not found: ${record.linkedQuoteId}`);
    if (quote.supplierId !== record.supplierId || quote.itemId !== record.itemId || quote.modelId !== record.modelId) {
      throw new ValidationError("Linked quote must match the same supplier, item, and model as the purchase price.");
    }
  }
}

export function buildComparison(projectId: string) {
  const project = findProject(projectId);
  if (!project) throw new ValidationError(`Project not found: ${projectId}`);
  syncReusableQuotesForProject(project);
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
      item: findItem(itemId),
      suppliers: supplierIds.map((supplierId) => {
        const supplierQuotes = itemQuotes
          .filter((candidate) => candidate.supplierId === supplierId)
          .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate));
        const quote = supplierQuotes.find(isSelectedQuote) ?? supplierQuotes.find(isSampleRequestedQuote) ?? supplierQuotes[0];
        const inspection = itemInspections.find((candidate) => candidate.supplierId === supplierId);
        return {
          supplier: findSupplier(supplierId),
          quote,
          quotes: supplierQuotes,
          inspection,
        };
      }),
      recommendedSupplierId: recommendSupplier(itemQuotes, itemInspections),
    };
  });
}

export function buildPriceChangeFromQuote(quote: Quote) {
  if (!isEffectivePriceQuote(quote)) return;

  const previousQuote = findPreviousEffectiveQuote(quote);

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
    id: nextId("pc"),
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

export function reconcileQuotePriceChanges() {
  let changed = false;
  const effectiveQuotes = [...store.quotes]
    .filter((quote) => quote.recordState !== "Void" && isEffectivePriceQuote(quote))
    .sort((a, b) => (a.effectiveFrom ?? a.quoteDate).localeCompare(b.effectiveFrom ?? b.quoteDate));

  for (const quote of effectiveQuotes) {
    const beforeQuote = JSON.stringify(quote);
    const beforePriceChangeCount = store.priceChanges.length;
    const beforePriceChanges = JSON.stringify(store.priceChanges);
    assignPreviousQuote(quote);
    buildPriceChangeFromQuote(quote);
    closePreviousSelectedQuote(quote);
    changed = changed || beforeQuote !== JSON.stringify(quote) || beforePriceChangeCount !== store.priceChanges.length || beforePriceChanges !== JSON.stringify(store.priceChanges);
  }

  return changed;
}

export function assignPreviousQuote(quote: Quote) {
  if (quote.previousQuoteId) return;
  const previousQuote = findPreviousEffectiveQuote(quote);
  if (previousQuote) quote.previousQuoteId = previousQuote.id;
}

export function closePreviousSelectedQuote(quote: Quote) {
  if (!isEffectivePriceQuote(quote)) return;

  const previousQuote = findPreviousEffectiveQuote(quote);

  if (!previousQuote) return;
  if ((previousQuote.effectiveFrom ?? previousQuote.quoteDate) === (quote.effectiveFrom ?? quote.quoteDate)) return;
  previousQuote.effectiveTo = dayBefore(quote.effectiveFrom ?? quote.quoteDate);
}

function findPreviousEffectiveQuote(quote: Quote) {
  return (
    (quote.previousQuoteId
      ? store.quotes.find(
          (candidate) =>
            candidate.id === quote.previousQuoteId &&
            candidate.recordState !== "Void" &&
            candidate.supplierId === quote.supplierId &&
            candidate.itemId === quote.itemId,
        )
      : undefined) ??
    [...store.quotes]
      .filter(
        (candidate) =>
          candidate.id !== quote.id &&
          candidate.supplierId === quote.supplierId &&
          candidate.itemId === quote.itemId &&
          candidate.recordState !== "Void" &&
          isEffectivePriceQuote(candidate) &&
          (!candidate.effectiveTo || candidate.effectiveTo >= (quote.effectiveFrom ?? quote.quoteDate)) &&
          (candidate.effectiveFrom ?? candidate.quoteDate) < (quote.effectiveFrom ?? quote.quoteDate),
      )
      .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate))[0]
  );
}

function isEffectivePriceQuote(quote: Quote) {
  return quote.status === "Selected" || quote.quoteReason === "Requote" || quote.quoteReason === "Change Work Order";
}

function isSampleRequestedQuote(quote: Quote) {
  return quote.status === "Sample Requested";
}

function isSelectedQuote(quote: Quote) {
  return quote.status === "Selected";
}

function isQcCandidateQuote(quote: Quote) {
  return isSampleRequestedQuote(quote) || isSelectedQuote(quote);
}

function dayBefore(dateText: string) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function buildPriceChangeFromPurchase(purchase: PurchasePriceRecord) {
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
    id: nextId("pc"),
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

export function scoreSupplier(supplierId: string) {
  return buildSupplierScorecard(supplierId)?.score ?? 0;
}

function buildSupplierScorecard(supplierId: string) {
  const supplier = findSupplier(supplierId);
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
      .map((quote) => findItem(quote.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const passedDeclaredTypes = new Set(
    supplierInspections
      .filter((inspection) => inspection.result === "Pass")
      .map((inspection) => findItem(inspection.itemId)?.type)
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
      : clamp(Math.round((pass / reviewedSamples) * (store.scoreWeights.sampleQuality - 5) + conditional * 2 - fail * 3 + (pass > 0 ? 5 : 0)), 0, store.scoreWeights.sampleQuality);
  const pricingScore = scorePricingCompetitiveness(supplierQuotes, store.scoreWeights.pricing, supplier.paymentTerms);
  const responsivenessScore = clamp(
    (supplierQuotes.length > 0 ? 8 : 0) + (averageLeadTime !== undefined && averageLeadTime <= 14 ? 4 : 0) + (selectedQuotes > 0 ? 3 : 0),
    0,
    store.scoreWeights.responsiveness,
  );
  const scopeScore = clamp(
    (declaredTypes > 0 ? 4 : 0) + (quotedDeclaredTypes > 0 ? 3 : 0) + (passedDeclaredTypes > 0 ? 3 : 0),
    0,
    store.scoreWeights.scopeFit,
  );
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
        detail: pricingDetail(supplierQuotes, supplier.paymentTerms),
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

export function buildScorecard() {
  return {
    weights: store.scoreWeights,
    rows: store.suppliers.flatMap((supplier) => {
      const row = buildSupplierScorecard(supplier.id);
      return row ? [row] : [];
    }),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scoreIncomingQuality(recentDefectQty: number, max: number) {
  if (recentDefectQty < 5) return max;
  if (recentDefectQty < 10) return Math.round(max * 0.75);
  if (recentDefectQty < 20) return Math.round(max * 0.45);
  return Math.round(max * 0.15);
}

function scoreLeadTime(averageLeadTime: number | undefined, max: number) {
  if (averageLeadTime === undefined) return 0;
  if (averageLeadTime <= 7) return max;
  if (averageLeadTime <= 14) return Math.round(max * 0.8);
  if (averageLeadTime <= 21) return Math.round(max * 0.55);
  if (averageLeadTime <= 30) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

function scorePricingCompetitiveness(supplierQuotes: Quote[], max: number, paymentTerms = "") {
  if (supplierQuotes.length === 0) return 0;
  const quoteScores = supplierQuotes.map((quote) => quotePriceCompetitiveness(quote));
  const averagePercent = quoteScores.reduce((sum, score) => sum + score, 0) / quoteScores.length;
  const priceMax = Math.round(max * 0.85);
  const termsMax = max - priceMax;
  return Math.round(priceMax * averagePercent) + scorePaymentTerms(paymentTerms, termsMax);
}

function quotePriceCompetitiveness(quote: Quote): number {
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

function pricingDetail(supplierQuotes: Quote[], paymentTerms = "") {
  if (supplierQuotes.length === 0) return "No quote for price comparison";
  const selectedCount = supplierQuotes.filter(isSelectedQuote).length;
  const averagePercent = Math.round((supplierQuotes.reduce((sum, quote) => sum + quotePriceCompetitiveness(quote), 0) / supplierQuotes.length) * 100);
  const termsDays = paymentTermDays(paymentTerms);
  const termsLabel = termsDays === undefined ? "payment terms not set" : `Net ${termsDays} payment terms`;
  return `${averagePercent}% price competitiveness, ${termsLabel}, ${selectedCount} selected quote${selectedCount === 1 ? "" : "s"}`;
}

function scorePaymentTerms(paymentTerms: string, max: number) {
  const days = paymentTermDays(paymentTerms);
  if (days === undefined) return 0;
  if (days >= 60) return max;
  if (days >= 45) return Math.round(max * 0.8);
  if (days >= 30) return Math.round(max * 0.6);
  if (days >= 15) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

function paymentTermDays(paymentTerms: string) {
  const match = paymentTerms.match(/(?:net\s*)?(\d{1,3})/i);
  return match ? Number(match[1]) : undefined;
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
