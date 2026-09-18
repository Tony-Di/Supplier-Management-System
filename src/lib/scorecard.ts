import { type ScorecardRow, type AppData } from "../api";
import { type ScorecardSortKey } from "../uiTypes";
import { isWithinRecentDays, scoreIncomingQuality, scoreLeadTime, scorePaymentTerms, paymentTermDays } from "./score";
import { type Quote, type SampleInspection, type Supplier, type ScoreWeights } from "../types";
import { supplierName } from "./lookups";
import { isSelectedQuote } from "./sourcing";
import { parseLeadTimeDays } from "../leadTime";
import { clamp } from "./format";

export function averageScore(rows: ScorecardRow[]) {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
}

export function bestScore(rows: ScorecardRow[]) {
  return rows.reduce((best, row) => Math.max(best, row.score), 0);
}

export function bestSupplierName(rows: ScorecardRow[]) {
  const best = [...rows].sort((a, b) => b.score - a.score)[0];
  return best ? best.supplier.name : "no visible suppliers";
}

export function scorecardSortValue(row: ScorecardRow, sortBy: ScorecardSortKey) {
  if (sortBy === "Score") return row.score;
  const keyBySort: Record<Exclude<ScorecardSortKey, "Score">, ScorecardRow["categories"][number]["key"]> = {
    Quality: "quality",
    Pricing: "pricing",
    Responsiveness: "responsiveness",
    "Scope Fit": "scope",
    "Lead Time": "setup",
  };
  return row.categories.find((category) => category.key === keyBySort[sortBy])?.score ?? 0;
}

export function scoreIssueSummary(appData: Pick<AppData, "incomingDefects">, row: ScorecardRow) {
  const issues: string[] = [];
  const quality = row.categories.find((category) => category.key === "quality");
  const pricing = row.categories.find((category) => category.key === "pricing");
  const response = row.categories.find((category) => category.key === "responsiveness");
  const scope = row.categories.find((category) => category.key === "scope");
  const leadTime = row.categories.find((category) => category.key === "setup");
  const sampleQuality = quality?.children?.find((child) => child.key === "sampleQuality");
  const incomingQuality = quality?.children?.find((child) => child.key === "incomingQuality");
  const supplierDefectQty = appData.incomingDefects
    .filter((defect) => defect.supplierId === row.supplier.id && defect.recordState !== "Void" && isWithinRecentDays(defect.defectDate, 90))
    .reduce((sum, defect) => sum + defect.defectQty, 0);

  if (sampleQuality && sampleQuality.score === 0) issues.push("No QC pass");
  if (incomingQuality && incomingQuality.score < incomingQuality.max && supplierDefectQty > 0) issues.push(`${supplierDefectQty} defect qty`);
  if (pricing && pricing.score < pricing.max * 0.35) issues.push("Not price competitive");
  if (response && response.score < response.max * 0.5) issues.push("Weak response data");
  if (scope && scope.score < scope.max * 0.6) issues.push("Scope not proven");
  if (leadTime && leadTime.score < leadTime.max * 0.5) issues.push("Long lead time");
  if (issues.length === 0) return "None";
  return issues.slice(0, 3).join(", ");
}

export function averageCategoryScore(rows: ScorecardRow[], key: ScorecardRow["categories"][number]["key"]) {
  if (rows.length === 0) return "0/0";
  const totals = rows.reduce(
    (sum, row) => {
      const category = row.categories.find((candidate) => candidate.key === key);
      return {
        score: sum.score + (category?.score ?? 0),
        max: sum.max + (category?.max ?? 0),
      };
    },
    { score: 0, max: 0 },
  );
  return `${Math.round(totals.score / rows.length)}/${Math.round(totals.max / rows.length)}`;
}

export function aggregateRecentDefectsBySupplier(appData: Pick<AppData, "incomingDefects">, days: number) {
  const map = new Map<string, number>();
  for (const defect of appData.incomingDefects.filter((record) => record.recordState !== "Void" && isWithinRecentDays(record.defectDate, days))) {
    map.set(defect.supplierId, (map.get(defect.supplierId) ?? 0) + defect.defectQty);
  }
  return map;
}

export function scoreDonutSegments(row: ScorecardRow) {
  let cursor = 0;
  const segments = sortedScoreCategories(row).flatMap((category) => {
    const start = cursor;
    const end = cursor + Math.max(0, Math.min(100, category.score));
    cursor = end;
    return [`${scoreCategoryColor(category.key)} ${start}% ${end}%`];
  });
  segments.push(`#eef0f3 ${cursor}% 100%`);
  return `conic-gradient(${segments.join(", ")})`;
}

export function sortedScoreCategories(row: ScorecardRow) {
  return [...row.categories].sort((a, b) => b.max - a.max || b.score - a.score);
}

export function scoreCategoryColor(key: ScorecardRow["categories"][number]["key"]) {
  const colors: Record<ScorecardRow["categories"][number]["key"], string> = {
    quality: "#E00700",
    pricing: "#1C5CB0",
    responsiveness: "#B8860B",
    scope: "#00876C",
    setup: "#6A4C93",
  };
  return colors[key];
}

export function recommendSupplier(appData: Pick<AppData, "suppliers">, candidateQuotes: Quote[], candidateInspections: SampleInspection[]) {
  const passSupplierIds = new Set(
    candidateInspections.filter((inspection) => inspection.result === "Pass").map((inspection) => inspection.supplierId),
  );
  const candidates = [...candidateQuotes].sort((a, b) => {
    const aPass = passSupplierIds.has(a.supplierId) ? 0 : 1;
    const bPass = passSupplierIds.has(b.supplierId) ? 0 : 1;
    return aPass - bPass || a.unitPrice - b.unitPrice;
  });

  return candidates[0] ? supplierName(appData, candidates[0].supplierId) : "Need quote";
}

export function supplierScore(appData: Pick<AppData, "incomingDefects" | "inspections" | "items" | "quotes" | "suppliers">, supplierId: string) {
  const supplier = appData.suppliers.find((candidate) => candidate.id === supplierId);
  if (!supplier) return 0;

  return buildSupplierScorecard(appData, supplier).score;
}

export function buildSupplierScorecard(appData: Pick<AppData, "incomingDefects" | "inspections" | "items" | "quotes">, supplier: Supplier): ScorecardRow {
  const supplierQuotes = appData.quotes.filter((quote) => quote.supplierId === supplier.id && quote.recordState !== "Void");
  const supplierInspections = appData.inspections.filter((inspection) => inspection.supplierId === supplier.id && inspection.recordState !== "Void");
  const supplierDefects = appData.incomingDefects.filter((defect) => defect.supplierId === supplier.id && defect.recordState !== "Void");
  const pass = supplierInspections.filter((inspection) => inspection.result === "Pass").length;
  const fail = supplierInspections.filter((inspection) => inspection.result === "Fail").length;
  const conditional = supplierInspections.filter((inspection) => inspection.result === "Conditional").length;
  const reviewedSamples = pass + fail + conditional;
  const weights: ScoreWeights = {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };
  const recentDefectQty = supplierDefects
    .filter((defect) => isWithinRecentDays(defect.defectDate, 90))
    .reduce((sum, defect) => sum + defect.defectQty, 0);
  const incomingQualityScore = scoreIncomingQuality(recentDefectQty, weights.incomingQuality);
  const selectedQuotes = supplierQuotes.filter(isSelectedQuote).length;
  const declaredTypes = supplier.capableItems.length;
  const quotedDeclaredTypes = new Set(
    supplierQuotes
      .map((quote) => appData.items.find((item) => item.id === quote.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const passedDeclaredTypes = new Set(
    supplierInspections
      .filter((inspection) => inspection.result === "Pass")
      .map((inspection) => appData.items.find((item) => item.id === inspection.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const numericLeadTimes = supplierQuotes
    .map((quote) => parseLeadTimeDays(quote.leadTime))
    .filter((leadTime): leadTime is number => leadTime !== undefined);
  const averageLeadTime = numericLeadTimes.length > 0 ? numericLeadTimes.reduce((sum, leadTime) => sum + leadTime, 0) / numericLeadTimes.length : undefined;

  const sampleQualityScore =
    reviewedSamples === 0
      ? 0
      : clamp(Math.round((pass / reviewedSamples) * (weights.sampleQuality - 5) + conditional * 2 - fail * 3 + (pass > 0 ? 5 : 0)), 0, weights.sampleQuality);
  const pricingScore = scorePricingCompetitiveness(appData, supplierQuotes, weights.pricing, supplier.paymentTerms);
  const responsivenessScore = clamp((supplierQuotes.length > 0 ? 8 : 0) + (averageLeadTime !== undefined && averageLeadTime <= 14 ? 4 : 0) + (selectedQuotes > 0 ? 3 : 0), 0, weights.responsiveness);
  const scopeScore = clamp((declaredTypes > 0 ? 4 : 0) + (quotedDeclaredTypes > 0 ? 3 : 0) + (passedDeclaredTypes > 0 ? 3 : 0), 0, weights.scopeFit);
  const leadTimeScore = scoreLeadTime(averageLeadTime, weights.setup);
  const qualityScore = sampleQualityScore + incomingQualityScore;
  const qualityMax = weights.sampleQuality + weights.incomingQuality;
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
        detail: `Sample ${sampleQualityScore}/${weights.sampleQuality}; incoming ${incomingQualityScore}/${weights.incomingQuality}`,
        children: [
          {
            key: "sampleQuality",
            label: "Sample Quality",
            score: sampleQualityScore,
            max: weights.sampleQuality,
            detail: reviewedSamples === 0 ? "No QC result yet" : `${pass} pass, ${fail} fail, ${conditional} conditional`,
          },
          {
            key: "incomingQuality",
            label: "Incoming Quality",
            score: incomingQualityScore,
            max: weights.incomingQuality,
            detail: `${recentDefectQty} rejected/defect qty in last 90 days`,
          },
        ],
      },
      {
        key: "pricing",
        label: "Pricing",
        score: pricingScore,
        max: weights.pricing,
        detail: pricingDetail(appData, supplierQuotes, supplier.paymentTerms),
      },
      {
        key: "responsiveness",
        label: "Responsiveness",
        score: responsivenessScore,
        max: weights.responsiveness,
        detail: averageLeadTime === undefined ? "No quote lead time yet" : `Average lead time ${Math.round(averageLeadTime)} days`,
      },
      {
        key: "scope",
        label: "Scope Fit",
        score: scopeScore,
        max: weights.scopeFit,
        detail: declaredTypes === 0 ? "No supply scope declared" : `${quotedDeclaredTypes}/${declaredTypes} declared types quoted`,
      },
      {
        key: "setup",
        label: "Lead Time",
        score: leadTimeScore,
        max: weights.setup,
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

export function scorePricingCompetitiveness(appData: Pick<AppData, "quotes">, supplierQuotes: Quote[], max: number, paymentTerms = "") {
  if (supplierQuotes.length === 0) return 0;
  const quoteScores = supplierQuotes.map((quote) => quotePriceCompetitiveness(appData, quote));
  const averagePercent = quoteScores.reduce((sum, score) => sum + score, 0) / quoteScores.length;
  const priceMax = Math.round(max * 0.85);
  const termsMax = max - priceMax;
  return Math.round(priceMax * averagePercent) + scorePaymentTerms(paymentTerms, termsMax);
}

export function quotePriceCompetitiveness(appData: Pick<AppData, "quotes">, quote: Quote): number {
  const groupQuotes = appData.quotes.filter(
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

export function pricingDetail(appData: Pick<AppData, "quotes">, supplierQuotes: Quote[], paymentTerms = "") {
  if (supplierQuotes.length === 0) return "No quote for price comparison";
  const selectedCount = supplierQuotes.filter(isSelectedQuote).length;
  const averagePercent = Math.round((supplierQuotes.reduce((sum, quote) => sum + quotePriceCompetitiveness(appData, quote), 0) / supplierQuotes.length) * 100);
  const termsDays = paymentTermDays(paymentTerms);
  const termsLabel = termsDays === undefined ? "payment terms not set" : `Net ${termsDays} payment terms`;
  return `${averagePercent}% price competitiveness, ${termsLabel}, ${selectedCount} selected quote${selectedCount === 1 ? "" : "s"}`;
}
