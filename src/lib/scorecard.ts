import { type ScorecardRow, type AppData } from "../api";
import { type ScorecardSortKey } from "../uiTypes";
import { isWithinRecentDays } from "./score";

export function averageScore(rows: ScorecardRow[]) {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
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
