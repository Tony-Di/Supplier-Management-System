import { resolve } from "node:path";

import { readStoreFile, writeStoreFile } from "./storeFile";
import {
  drawingSets as seedDrawingSets,
  inspections as seedInspections,
  items as seedItems,
  models as seedModels,
  priceChanges as seedPriceChanges,
  projects as seedProjects,
  purchasePrices as seedPurchasePrices,
  quotes as seedQuotes,
  suppliers as seedSuppliers,
} from "../src/data";
import type {
  DrawingSet,
  Model,
  PackagingItem,
  PriceChange,
  PurchasePriceRecord,
  Quote,
  QuoteCaseLink,
  SampleInspection,
  IncomingDefectRecord,
  ScoreWeights,
  SourceAssignment,
  SourcingProject,
  Supplier,
  UploadedFileRecord,
} from "../src/types";

export interface Store {
  suppliers: Supplier[];
  models: Model[];
  items: PackagingItem[];
  drawingSets: DrawingSet[];
  projects: SourcingProject[];
  quotes: Quote[];
  quoteCaseLinks: QuoteCaseLink[];
  sourceAssignments: SourceAssignment[];
  inspections: SampleInspection[];
  incomingDefects: IncomingDefectRecord[];
  priceChanges: PriceChange[];
  purchasePrices: PurchasePriceRecord[];
  files: UploadedFileRecord[];
  scoreWeights: ScoreWeights;
}

const seedStore: Store = {
  suppliers: structuredClone(seedSuppliers),
  models: structuredClone(seedModels),
  items: structuredClone(seedItems),
  drawingSets: structuredClone(seedDrawingSets),
  projects: structuredClone(seedProjects),
  quotes: structuredClone(seedQuotes),
  quoteCaseLinks: [],
  sourceAssignments: [],
  inspections: structuredClone(seedInspections),
  incomingDefects: [],
  priceChanges: structuredClone(seedPriceChanges),
  purchasePrices: structuredClone(seedPurchasePrices),
  files: [],
  scoreWeights: defaultScoreWeights(),
};

const storePath = resolve(process.cwd(), "data", "store.json");

export const store: Store = loadStore();

const counters = new Map<string, number>();

initializeCounters();

function loadStore(): Store {
  const storedStore = readStoreFile(storePath) as Store | undefined;
  return normalizeStore(storedStore ?? seedStore);
}

function normalizeStore(nextStore: Store): Store {
  nextStore.incomingDefects ??= [];
  nextStore.quoteCaseLinks ??= [];
  nextStore.sourceAssignments ??= [];
  nextStore.purchasePrices ??= structuredClone(seedPurchasePrices);
  nextStore.files ??= [];
  nextStore.scoreWeights = normalizeScoreWeights(nextStore.scoreWeights);
  const markActive = (record: { recordState?: "Draft" | "Active" | "Void" }) => {
    record.recordState ??= "Active";
  };

  for (const supplier of nextStore.suppliers) {
    markActive(supplier);
    supplier.paymentTerms ??= "";
    supplier.capableItems = supplier.capableItems.map(normalizePackagingItemType);
  }
  nextStore.models.forEach(markActive);
  for (const item of nextStore.items) {
    markActive(item);
    if (item.recordState === "Draft") item.recordState = "Active";
    item.type = normalizePackagingItemType(item.type);
  }
  for (const drawingSet of nextStore.drawingSets) {
    markActive(drawingSet);
    const sharedFileId = commonDrawingItemValue(drawingSet.drawingItems.map((drawingItem) => drawingItem.fileId).filter(isPresentString));
    const sharedFileName = commonDrawingItemValue(drawingSet.drawingItems.map((drawingItem) => drawingItem.fileName).filter(isPresentString));
    if (!drawingSet.packageFileId && sharedFileId) drawingSet.packageFileId = sharedFileId;
    if (!drawingSet.packageFileName && sharedFileName) drawingSet.packageFileName = sharedFileName;
    for (const drawingItem of drawingSet.drawingItems) {
      if (drawingSet.packageFileId && drawingItem.fileId === drawingSet.packageFileId) {
        drawingItem.fileId = undefined;
        drawingItem.fileName = undefined;
      }
      if (!drawingSet.packageFileId && drawingSet.packageFileName && drawingItem.fileName === drawingSet.packageFileName) {
        drawingItem.fileName = undefined;
      }
      drawingItem.drawingSource ??= drawingItem.fileId ? "Item-specific PDF" : "Package PDF";
      if (!drawingItem.fileId && drawingSet.packageFileId) drawingItem.drawingSource = "Package PDF";
    }
  }
  normalizeDrawingSetRevisions(nextStore.drawingSets);
  for (const assignment of nextStore.sourceAssignments) {
    markActive(assignment);
    if ((assignment.role as string) === "Approved Only") assignment.role = "Backup";
  }
  for (const inspection of nextStore.inspections) {
    markActive(inspection);
    if (inspection.recordState === "Draft") inspection.recordState = "Active";
    inspection.sampleRound ??= 1;
    inspection.disposition ??=
      inspection.result === "Pass"
        ? "Accepted"
        : inspection.result === "Fail"
          ? "Re-sample Required"
          : inspection.result === "Conditional"
            ? "Conditional Approval"
            : "Pending";
  }
  nextStore.purchasePrices.forEach(markActive);
  for (const defect of nextStore.incomingDefects) {
    markActive(defect);
    const legacyDefect = defect as typeof defect & {
      replacementRequired?: boolean;
      replacementStatus?: string;
      replacementDate?: string;
      creditReceivedDate?: string;
    };
    defect.defectType ??= "Other";
    defect.defectAction ??= normalizeDefectAction(legacyDefect.replacementStatus, legacyDefect.replacementRequired);
    if (defect.defectAction !== "Request Replacement") defect.replacementQty = undefined;
    defect.replacementReceipts ??= [];
    defect.poQty ??= defect.receivedQty !== undefined ? defect.receivedQty + defect.defectQty : undefined;
    defect.materialReturned ??= legacyDefect.replacementStatus === "Returned";
    defect.returnDate ??= legacyDefect.replacementDate;
    defect.actionCompleted = isDefectActionComplete(defect);
    defect.actionCompletedDate = defect.actionCompleted ? defect.actionCompletedDate ?? defect.returnDate ?? defect.defectDate : undefined;
    defect.notes ??= "";
    defect.photoFileIds ??= [];
    defect.attachmentFileIds ??= [];
    delete legacyDefect.replacementRequired;
    delete legacyDefect.replacementStatus;
    delete legacyDefect.replacementDate;
    delete legacyDefect.creditReceivedDate;
  }

  for (const project of nextStore.projects) {
    markActive(project);
    if (project.recordState === "Draft") project.recordState = "Active";
    project.caseReason ??= "New Supplier Intro";
    if ((project.type as string) === "New Source") project.type = "New Supplier Development";
    const legacyProject = project as typeof project & { dueDate?: string };
    project.openDate ??= "2026-08-04";
    project.targetCloseDate ??= legacyProject.dueDate;
    delete legacyProject.dueDate;
  }

  for (const quote of nextStore.quotes) {
    markActive(quote);
    const legacyQuote = quote as typeof quote & {
      freightEstimate?: number;
      leadTimeUnit?: string;
      sampleCost?: number;
      toolingCost?: number;
    };
    if (quote.recordState === "Draft") quote.recordState = "Active";
    quote.quoteType ??= quote.projectId ? "Case-linked" : "Standalone";
    quote.quoteReason ??= "New Quote";
    quote.effectiveFrom ??= quote.quoteDate;
    quote.quoteDate = quote.effectiveFrom;
    if (typeof quote.moq === "number") quote.moq = String(quote.moq);
    if (typeof quote.leadTime === "number") quote.leadTime = legacyQuote.leadTimeUnit ? `${quote.leadTime} ${legacyQuote.leadTimeUnit}` : String(quote.leadTime);
    quote.extraCostType ??=
      legacyQuote.freightEstimate && legacyQuote.freightEstimate > 0
        ? "Freight"
        : legacyQuote.sampleCost && legacyQuote.sampleCost > 0
          ? "Sample"
          : legacyQuote.toolingCost && legacyQuote.toolingCost > 0
            ? "Tooling"
            : "None";
    quote.extraCostAmount ??=
      quote.extraCostType === "Freight"
        ? legacyQuote.freightEstimate ?? 0
        : quote.extraCostType === "Sample"
          ? legacyQuote.sampleCost ?? 0
          : quote.extraCostType === "Tooling"
            ? legacyQuote.toolingCost ?? 0
            : 0;
    if ((quote.status as string) === "Shortlisted") quote.status = "Under Review";
    if ((quote.status as string) === "Move to QC") quote.status = "Sample Requested";
    if ((quote.status as string) === "Rejected") quote.status = "Not Selected";
  }

  normalizeQuoteCaseLinks(nextStore);

  for (const priceChange of nextStore.priceChanges) {
    markActive(priceChange);
    priceChange.sourceType ??= "Manual";
  }

  return nextStore;
}

function normalizeQuoteCaseLinks(nextStore: Store) {
  let linkCounter = nextStore.quoteCaseLinks.reduce((max, link) => {
    const match = /^ql-(\d+)$/.exec(link.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1000);

  for (const link of nextStore.quoteCaseLinks) {
    link.recordState ??= "Active";
    link.linkType ??= "Reused Existing Quote";
    link.sampleRequirement ??= "Not Reviewed";
  }

  for (const quote of nextStore.quotes) {
    if (!quote.projectId || quote.recordState === "Void") continue;
    const exists = nextStore.quoteCaseLinks.some((link) => link.quoteId === quote.id && link.projectId === quote.projectId);
    if (!exists) {
      nextStore.quoteCaseLinks.push({
        id: `ql-${++linkCounter}`,
        quoteId: quote.id,
        projectId: quote.projectId,
        supplierId: quote.supplierId,
        itemId: quote.itemId,
        modelId: quote.modelId,
        linkType: "Origin Case",
        sampleRequirement: quote.status === "Sample Requested" ? "Sample Requested" : "Not Reviewed",
        recordState: "Active",
      });
    }
  }
}

function normalizePackagingItemType(value: string) {
  const legacyMap: Record<string, PackagingItem["type"]> = {
    "Corner Protector": "Paper Corner Protector",
    Strap: "Strapping",
    Carton: "Upper Cover",
    "Honeycomb Board": "Paper Plate",
    Foam: "Paper Plate",
    "Plastic Bag": "Stretch Film",
    Label: "Paper Plate",
    "Wooden Crate": "Pallet",
    "Other Packaging": "Paper Plate",
  };

  return (legacyMap[value] ?? value) as PackagingItem["type"];
}

function commonDrawingItemValue(values: string[]) {
  if (values.length === 0) return undefined;
  const [first] = values;
  return values.every((value) => value === first) ? first : undefined;
}

function isPresentString(value: string | undefined): value is string {
  return Boolean(value);
}

function normalizeDrawingSetRevisions(drawingSets: DrawingSet[]) {
  const setsByModel = new Map<string, DrawingSet[]>();
  for (const drawingSet of drawingSets) {
    const modelSets = setsByModel.get(drawingSet.modelId) ?? [];
    modelSets.push(drawingSet);
    setsByModel.set(drawingSet.modelId, modelSets);
  }

  for (const modelSets of setsByModel.values()) {
    modelSets
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id))
      .forEach((drawingSet, index) => {
        const numericRevision = `${index + 1}.0`;
        drawingSet.revision = numericRevision;
        drawingSet.drawingItems.forEach((drawingItem) => {
          drawingItem.revision = numericRevision;
        });
      });
  }
}

function normalizeDefectAction(status?: string, replacementRequired?: boolean) {
  if (status === "Credit Requested") return "Request Credit";
  if (status === "Requested" || status === "Replaced" || replacementRequired) return "Request Replacement";
  return "Request Credit";
}

function isDefectActionComplete(defect: IncomingDefectRecord) {
  if (defect.defectAction === "Request Credit") return true;
  const acceptedReplacementQty = (defect.replacementReceipts ?? [])
    .filter((receipt) => receipt.result === "Accepted")
    .reduce((sum, receipt) => sum + receipt.receivedQty, 0);
  if (defect.poQty === undefined || defect.receivedQty === undefined) {
    return acceptedReplacementQty >= (defect.replacementQty ?? defect.defectQty) || Boolean(defect.actionCompleted);
  }
  return defect.receivedQty + acceptedReplacementQty >= defect.poQty;
}

function defaultScoreWeights(): ScoreWeights {
  return {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };
}

function normalizeScoreWeights(weights: ScoreWeights | undefined): ScoreWeights {
  return { ...defaultScoreWeights(), ...(weights ?? {}) };
}

export function saveStore() {
  writeStoreFile(storePath, store);
}

function initializeCounters() {
  const idGroups = [
    ...store.suppliers.map((record) => record.id),
    ...store.models.map((record) => record.id),
    ...store.items.map((record) => record.id),
    ...store.drawingSets.map((record) => record.id),
    ...store.drawingSets.flatMap((record) => record.drawingItems.map((drawingItem) => drawingItem.id)),
    ...store.projects.map((record) => record.id),
    ...store.quotes.map((record) => record.id),
    ...store.quoteCaseLinks.map((record) => record.id),
    ...store.sourceAssignments.map((record) => record.id),
    ...store.inspections.map((record) => record.id),
    ...store.incomingDefects.map((record) => record.id),
    ...store.priceChanges.map((record) => record.id),
    ...store.purchasePrices.map((record) => record.id),
    ...store.files.map((record) => record.id),
  ];

  for (const id of idGroups) {
    const match = /^([a-z]+)-(\d+)$/.exec(id);
    if (!match) continue;
    const [, prefix, value] = match;
    counters.set(prefix, Math.max(counters.get(prefix) ?? 1000, Number(value)));
  }
}

export function nextId(prefix: string) {
  const next = (counters.get(prefix) ?? 1000) + 1;
  counters.set(prefix, next);
  return `${prefix}-${next}`;
}

export function findSupplier(id: string) {
  return store.suppliers.find((supplier) => supplier.id === id);
}

export function findModel(id: string) {
  return store.models.find((model) => model.id === id);
}

export function findItem(id: string) {
  return store.items.find((item) => item.id === id);
}

export function findDrawingSet(id: string) {
  return store.drawingSets.find((drawingSet) => drawingSet.id === id);
}

export function findDrawingItem(drawingSetId: string, drawingItemId: string) {
  return findDrawingSet(drawingSetId)?.drawingItems.find((drawingItem) => drawingItem.id === drawingItemId);
}

export function findProject(id: string) {
  return store.projects.find((project) => project.id === id);
}

export function assertReferences(ids: string[], finder: (id: string) => unknown, label: string) {
  const missing = ids.filter((id) => !finder(id));
  if (missing.length > 0) {
    throw new ValidationError(`${label} not found: ${missing.join(", ")}`);
  }
}

export class ValidationError extends Error {
  status = 400;
}
