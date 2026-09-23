import { type PackagingItem, type PackagingItemType, type DrawingSet } from "../types";

export function findDuplicateItemCodes(records: PackagingItem[]) {
  const counts = records.reduce((map, item) => {
    const key = item.itemCode.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
}

export function parseItemImportRows(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index !== 0 || !/^item code[\t,]/i.test(line))
    .map((line) => {
      const columns = line.includes("\t") ? line.split("\t") : line.split(",");
      const [itemCode = "", description = "", type = "", usedFor = ""] = columns.map((column) => column.trim());
      return {
        itemCode,
        description,
        type: type as PackagingItemType,
        usedFor: usedFor.split(/[;,]/).map((value) => value.trim()).filter(Boolean),
      };
    })
    .filter((row) => row.itemCode && row.description && row.type && row.usedFor.length > 0);
}

export function buildDrawingRowsFromModelItems(modelItems: PackagingItem[], revision: string) {
  return modelItems.map((item) => ({
    itemCode: item.itemCode,
    revision,
    fileName: "",
  }));
}

export function nextPackagingSetRevision(sets: DrawingSet[], modelId: string) {
  const existingCount = sets.filter((set) => set.modelId === modelId && set.recordState !== "Void").length;
  return `${existingCount + 1}.0`;
}
