import { type AppData } from "../api";
import { itemCode, supplierName, itemById, projectName } from "./lookups";
import { type Quote, type SourceAssignment, type SampleInspection } from "../types";
import { parseLeadTimeDays } from "../leadTime";

export function caseSupplierIds(appData: Pick<AppData, "items" | "projects" | "quoteCaseLinks" | "quotes">, project: AppData["projects"][number]) {
  const quotedSupplierIds = appData.quotes
    .filter((quote) => quoteAppliesToProject(appData, quote, project.id) && quote.recordState !== "Void")
    .map((quote) => quote.supplierId);
  return Array.from(new Set([...project.supplierIds, ...quotedSupplierIds]));
}

export function buildCaseProgressRows(appData: Pick<AppData, "inspections" | "items" | "projects" | "quoteCaseLinks" | "quotes" | "sourceAssignments" | "suppliers">, project: AppData["projects"][number], visibleItemIds: string[]) {
  const rowKeys = new Set(
    appData.quotes
      .filter((quote) =>
        quote.recordState !== "Void" &&
        visibleItemIds.includes(quote.itemId) &&
        quoteAppliesToProject(appData, quote, project.id))
      .map((quote) => `${quote.itemId}::${quote.supplierId}`),
  );

  return Array.from(rowKeys)
    .map((key) => {
      const [itemId, supplierId] = key.split("::");
      return buildCaseProgressRow(appData, project, itemId, supplierId);
    })
    .sort((a, b) =>
      itemCode(appData, a.itemId).localeCompare(itemCode(appData, b.itemId)) ||
      supplierName(appData, a.supplierId).localeCompare(supplierName(appData, b.supplierId)),
    );
}

export function buildCaseProgressRow(appData: Pick<AppData, "inspections" | "items" | "projects" | "quoteCaseLinks" | "quotes" | "sourceAssignments" | "suppliers">, project: AppData["projects"][number], itemId: string, supplierId: string) {
  const item = itemById(appData, itemId);
  const supplier = appData.suppliers.find((candidate) => candidate.id === supplierId);
  const inScope = !item || !supplier || supplier.capableItems.includes(item.type);
  const itemQuotes = quotesForCaseItemSupplier(appData, project, itemId, supplierId);
  const quote = itemQuotes.find(isSelectedQuote) ?? itemQuotes.find(isSampleRequestedQuote) ?? itemQuotes[0];
  const quoteInspections = quote ? inspectionsForQuote(appData, quote.id) : [];
  const latestInspection = quote ? latestCaseInspection(appData, project, quote) : undefined;
  const quoteCaseLink = quote ? quoteCaseLinkFor(appData, quote.id, project.id) : undefined;
  const assignment = appData.sourceAssignments
    .filter((current) =>
      current.recordState !== "Void" &&
      current.projectId === project.id &&
      current.itemId === itemId &&
      current.supplierId === supplierId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const canAssign = Boolean(quote && latestInspection && (latestInspection.result === "Pass" || latestInspection.result === "Conditional"));

  return {
    assignDisabledReason: quote
      ? latestInspection
        ? "QC must pass or be conditional before assigning source role."
        : "QC inspection is required before assigning source role."
      : "Quote is required before assigning source role.",
    canAssign,
    inScope,
    item,
    itemId,
    lastUpdate: latestActivityDate(itemQuotes, quoteInspections),
    qcLabel: quote ? caseQcLabel(appData, project, quote, latestInspection) : "No sample requested",
    quoteCaseLink,
    quoteLinkLabel: quote ? quoteCaseLabel(appData, quote, project.id) : "",
    quote,
    quoteLabel: quote ? quote.status : inScope ? "No quote" : "Not in scope",
    sourceRole: assignment?.role,
    supplier,
    supplierId,
  };
}

export function sourceRoleForQuote(appData: Pick<AppData, "sourceAssignments">, quote: Quote) {
  return appData.sourceAssignments.find((assignment) =>
    assignment.recordState !== "Void" &&
    assignment.sourceQuoteId === quote.id)?.role;
}

export function sourceRoleRank(role: SourceAssignment["role"]) {
  return { Primary: 1, Secondary: 2, Tertiary: 3, Backup: 4 }[role];
}

export function sourceRoleLabel(role: SourceAssignment["role"]) {
  return role === "Backup" ? "Backup pool" : role;
}

export function isActiveSourceRole(role: SourceAssignment["role"]) {
  return role === "Primary" || role === "Secondary" || role === "Tertiary";
}

export function averageLeadTimeForActiveSourceSuppliers(appData: Pick<AppData, "quotes">, assignments: SourceAssignment[]) {
  const activeAssignments = assignments.filter((assignment) => assignment.recordState !== "Void" && isActiveSourceRole(assignment.role));
  const quoteIds = new Set(activeAssignments.map((assignment) => assignment.sourceQuoteId).filter(Boolean));
  let sourceQuotes = appData.quotes.filter((quote) => quote.recordState !== "Void" && quoteIds.has(quote.id));
  if (sourceQuotes.length === 0) {
    const supplierIds = new Set(activeAssignments.map((assignment) => assignment.supplierId));
    sourceQuotes = appData.quotes.filter((quote) => quote.recordState !== "Void" && supplierIds.has(quote.supplierId) && isSelectedQuote(quote));
  }
  const leadTimes = sourceQuotes
    .map((quote) => parseLeadTimeDays(quote.leadTime))
    .filter((leadTime): leadTime is number => leadTime !== undefined);
  return leadTimes.length === 0 ? undefined : leadTimes.reduce((sum, leadTime) => sum + leadTime, 0) / leadTimes.length;
}

export function supplierCaseProgress(appData: Pick<AppData, "inspections" | "items" | "projects" | "quoteCaseLinks" | "quotes" | "suppliers">, project: AppData["projects"][number], supplierId: string, visibleItemIds = project.itemIds) {
  const supplier = appData.suppliers.find((candidate) => candidate.id === supplierId);
  const inScopeItemIds = visibleItemIds.filter((itemId) => {
    const item = itemById(appData, itemId);
    return !item || !supplier || supplier.capableItems.includes(item.type);
  });
  const supplierQuotes = appData.quotes.filter(
    (quote) => quoteAppliesToProject(appData, quote, project.id)
      && quote.supplierId === supplierId
      && visibleItemIds.includes(quote.itemId)
      && quote.recordState !== "Void",
  );
  const quotedItemIds = new Set(supplierQuotes.map((quote) => quote.itemId));
  const sampleRequestedQuotes = supplierQuotes.filter(isSampleRequestedQuote);
  const selectedQuotes = supplierQuotes.filter(isSelectedQuote);
  const selectedCount = selectedQuotes.length;
  const pendingQc = sampleRequestedQuotes.filter((value) => isQuoteInQcQueue(appData, value)).length;
  const passedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(appData, quote.id)?.result === "Pass").length;
  const failedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(appData, quote.id)?.result === "Fail").length;

  return {
    lastUpdate: latestActivityDate(supplierQuotes, sampleRequestedQuotes.flatMap((quote) => inspectionsForQuote(appData, quote.id))),
    qcLabel: sampleRequestedQuotes.length === 0
      ? "No sample requested"
      : pendingQc > 0
        ? `${pendingQc} QC pending`
        : failedQc > 0
          ? "Re-sample required"
          : passedQc === sampleRequestedQuotes.length
            ? "QC pass"
            : "QC in review",
    quoteLabel: supplierQuotes.length === 0
      ? "No quote"
      : quotedItemIds.size < inScopeItemIds.length
        ? `${quotedItemIds.size}/${inScopeItemIds.length} quoted`
        : selectedCount > 0
          ? `${selectedCount} selected`
          : "Quote received",
    scopeCount: inScopeItemIds.length,
    selectedCount,
  };
}

export function itemCaseProgress(appData: Pick<AppData, "inspections" | "items" | "projects" | "quoteCaseLinks" | "quotes" | "suppliers">, project: AppData["projects"][number], itemId: string, supplierIds: string[]) {
  const item = itemById(appData, itemId);
  const inScopeSupplierIds = supplierIds.filter((supplierId) => {
    const supplier = appData.suppliers.find((candidate) => candidate.id === supplierId);
    return !item || !supplier || supplier.capableItems.includes(item.type);
  });
  const itemQuotes = appData.quotes.filter((quote) => quoteAppliesToProject(appData, quote, project.id) && quote.itemId === itemId && quote.recordState !== "Void");
  const sampleRequestedQuotes = itemQuotes.filter(isSampleRequestedQuote);
  const selectedQuotes = itemQuotes.filter(isSelectedQuote);
  const selectedQuote = selectedQuotes[0];
  const pendingQc = sampleRequestedQuotes.filter((value) => isQuoteInQcQueue(appData, value)).length;
  const passedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(appData, quote.id)?.result === "Pass").length;

  return {
    inScopeCount: inScopeSupplierIds.length,
    lastUpdate: latestActivityDate(itemQuotes, sampleRequestedQuotes.flatMap((quote) => inspectionsForQuote(appData, quote.id))),
    qcLabel: sampleRequestedQuotes.length === 0
      ? "No sample requested"
      : pendingQc > 0
        ? `${pendingQc} QC pending`
        : passedQc > 0
          ? "QC pass"
          : "QC in review",
    quoteCount: new Set(itemQuotes.map((quote) => quote.supplierId)).size,
    selectedSupplier: selectedQuote ? supplierName(appData, selectedQuote.supplierId) : "-",
  };
}

export function latestActivityDate(activityQuotes: Quote[], activityInspections: SampleInspection[]) {
  const dates = [
    ...activityQuotes.map((quote) => quote.effectiveFrom ?? quote.quoteDate),
    ...activityInspections.flatMap((inspection) => [inspection.sampleReceivedDate, inspection.inspectionDate ?? ""]),
  ].filter(Boolean);
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? "-";
}

export function latestProjectQuote(appData: Pick<AppData, "items" | "projects" | "quoteCaseLinks" | "quotes">, projectId: string, supplierId: string, itemId: string) {
  return appData.quotes
    .filter((quote) => quoteAppliesToProject(appData, quote, projectId) && quote.supplierId === supplierId && quote.itemId === itemId && quote.recordState !== "Void")
    .sort((a, b) => b.quoteDate.localeCompare(a.quoteDate))[0];
}

export function quoteAppliesToProject(appData: Pick<AppData, "items" | "projects" | "quoteCaseLinks">, quote: Quote, projectId: string) {
  if (quote.projectId === projectId) return true;
  if (appData.quoteCaseLinks.some((link) => link.recordState !== "Void" && link.projectId === projectId && link.quoteId === quote.id)) return true;
  const project = appData.projects.find((candidate) => candidate.id === projectId);
  const item = itemById(appData, quote.itemId);
  return Boolean(
    project &&
      item &&
      project.supplierIds.includes(quote.supplierId) &&
      project.itemIds.includes(quote.itemId) &&
      item.usedForModels.some((modelId) => project.modelIds.includes(modelId)),
  );
}

export function quoteCaseLinkFor(appData: Pick<AppData, "quoteCaseLinks">, quoteId: string, projectId: string) {
  return appData.quoteCaseLinks.find((link) => link.recordState !== "Void" && link.projectId === projectId && link.quoteId === quoteId);
}

export function quoteHasCaseLink(appData: Pick<AppData, "quoteCaseLinks">, quote: Quote) {
  return Boolean(quote.projectId) || appData.quoteCaseLinks.some((link) => link.recordState !== "Void" && link.quoteId === quote.id);
}

export function quoteCaseLabel(appData: Pick<AppData, "projects" | "quoteCaseLinks">, quote: Quote, projectFilter = "All") {
  if (projectFilter !== "All" && projectFilter !== "Standalone") {
    return quoteCaseLinkFor(appData, quote.id, projectFilter)?.linkType ?? (quote.projectId === projectFilter ? "Origin Case" : "Reused Existing Quote");
  }
  if (!quote.projectId && !appData.quoteCaseLinks.some((link) => link.recordState !== "Void" && link.quoteId === quote.id)) return "Standalone";
  const originProject = quote.projectId ? projectName(appData, quote.projectId) : "";
  const reusedCount = appData.quoteCaseLinks.filter((link) => link.recordState !== "Void" && link.quoteId === quote.id && link.linkType === "Reused Existing Quote").length;
  if (reusedCount > 0) return originProject ? `Origin + ${reusedCount} reused` : `${reusedCount} reused`;
  return originProject ? "Origin Case" : "Linked";
}

export function quotesForCaseItemSupplier(appData: Pick<AppData, "items" | "projects" | "quoteCaseLinks" | "quotes">, project: AppData["projects"][number], itemId: string, supplierId: string) {
  return appData.quotes
    .filter((quote) =>
      quote.recordState !== "Void" &&
      quote.supplierId === supplierId &&
      quote.itemId === itemId &&
      quoteAppliesToProject(appData, quote, project.id))
    .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate));
}

export function latestCaseInspection(appData: Pick<AppData, "inspections">, project: AppData["projects"][number], quote: Quote) {
  const directInspection = latestInspectionForQuote(appData, quote.id);
  if (directInspection) return directInspection;
  return appData.inspections
    .filter((inspection) =>
      inspection.recordState !== "Void" &&
      inspection.supplierId === quote.supplierId &&
      inspection.itemId === quote.itemId &&
      inspection.drawingSetId === project.drawingSetId)
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
}

export function caseQcLabel(appData: Pick<AppData, "inspections" | "quoteCaseLinks">, project: AppData["projects"][number], quote: Quote, inspection?: SampleInspection) {
  const link = quoteCaseLinkFor(appData, quote.id, project.id);
  if (inspection?.result === "Pass" || inspection?.result === "Conditional") return "Existing QC Pass";
  if (isSampleRequestedQuote(quote)) return qcQueueStatus(appData, quote);
  if (link?.sampleRequirement === "Not Required - Existing QC Pass") return "Existing QC Pass";
  if (link?.sampleRequirement === "Required") return "Sample Required";
  return "No sample requested";
}

export function inspectionsForQuote(appData: Pick<AppData, "inspections">, quoteId: string) {
  return appData.inspections
    .filter((inspection) => inspection.relatedQuoteId === quoteId && inspection.recordState !== "Void")
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate));
}

export function latestInspectionForQuote(appData: Pick<AppData, "inspections">, quoteId: string) {
  return inspectionsForQuote(appData, quoteId).slice(-1)[0];
}

export function isSampleRequestedQuote(quote: Quote) {
  return quote.status === "Sample Requested";
}

export function isSelectedQuote(quote: Quote) {
  return quote.status === "Selected";
}

export function isQcCandidateQuote(quote: Quote) {
  return isSampleRequestedQuote(quote) || isSelectedQuote(quote);
}

export function isQuoteInQcQueue(appData: Pick<AppData, "inspections">, quote: Quote) {
  const latestInspection = latestInspectionForQuote(appData, quote.id);
  if (!latestInspection) return true;
  if (latestInspection.result === "Pass" || latestInspection.disposition === "Accepted") return false;
  if (latestInspection.disposition === "No Further Action") return false;
  return true;
}

export function qcQueueStatus(appData: Pick<AppData, "inspections">, quote: Quote) {
  const latestInspection = latestInspectionForQuote(appData, quote.id);
  if (!latestInspection) return "Waiting for Sample";
  if (latestInspection.result === "Not Submitted") return "Pending Inspection";
  if (latestInspection.result === "Fail") return latestInspection.disposition === "No Further Action" ? "Closed Fail" : "Re-sample Required";
  if (latestInspection.result === "Conditional") return "Conditional Review";
  return "QC Pass";
}

export function qcQueueActionLabel(appData: Pick<AppData, "inspections">, quote: Quote) {
  const latestInspection = latestInspectionForQuote(appData, quote.id);
  if (!latestInspection) return "Receive sample";
  if (latestInspection.result === "Fail" && latestInspection.disposition !== "No Further Action") return "Receive next sample";
  return "Record inspection";
}

export function defaultDispositionForResult(result: SampleInspection["result"]): SampleInspection["disposition"] {
  if (result === "Pass") return "Accepted";
  if (result === "Fail") return "Re-sample Required";
  if (result === "Conditional") return "Conditional Approval";
  return "Pending";
}

export function caseTypeForReason(reason: AppData["projects"][number]["caseReason"]): AppData["projects"][number]["type"] {
  if (reason === "New Supplier Intro") return "New Supplier Development";
  if (reason === "Change Work Order") return "Model Change";
  return reason;
}

export function nextInspectionRoundForQuote(appData: Pick<AppData, "inspections">, quoteId: string) {
  return (latestInspectionForQuote(appData, quoteId)?.sampleRound ?? 0) + 1;
}

export function drawingItemForQuote(appData: Pick<AppData, "drawingSets">, quote: Quote) {
  return appData.drawingSets.find((set) => set.id === quote.drawingSetId)?.drawingItems.find((drawingItem) => drawingItem.id === quote.drawingItemId);
}
