import { packagingItemOptions } from "../constants";
import { type PackagingItem, type DrawingSet, type Model } from "../types";

export function findDuplicateItemCodes(records: PackagingItem[]) {
  const counts = records.reduce((map, item) => {
    const key = item.itemCode.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
}

// Pasted Excel cells often differ from the stored names only in case or
// spacing; those are matched rather than rejected.
const matchKey = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

// Rows of pasted or exported text. A cell that starts with a quote may hold
// the delimiter and line breaks, and "" inside it stands for one quote; a
// quote anywhere else is plain text.
function splitRecords(text: string) {
  const records: string[] = [];
  let record = "";
  let quoted = false;
  let cellStart = true;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        record += char;
        index += 1;
      } else if (char === '"') {
        quoted = false;
      }
      record += char;
    } else if (char === "\n") {
      records.push(record);
      record = "";
      cellStart = true;
    } else {
      if (char === '"' && cellStart) quoted = true;
      cellStart = char === "," || char === "\t";
      record += char;
    }
  }
  records.push(record);
  return records;
}

function splitCells(record: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const char = record[index];
    if (quoted) {
      if (char === '"' && record[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

export function parseItemImportRows(rawText: string, models: Pick<Model, "id" | "name">[]) {
  return splitRecords(rawText.replace(/\r\n?/g, "\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index !== 0 || !/^item code[\t,]/i.test(line))
    .map((line) => {
      const columns = line.includes("\t") ? splitCells(line, "\t") : splitCells(line, ",");
      const [itemCode = "", description = "", rawType = "", rawUsedFor = ""] = columns.map((column) => column.trim());
      const usedForNames = rawUsedFor.split(/[;,]/).map((value) => value.trim()).filter(Boolean);
      const errors: string[] = [];

      const missing = [
        ["Item Code", itemCode],
        ["Description", description],
        ["Type", rawType],
        ["Used for", usedForNames.join()],
      ].filter(([, value]) => !value).map(([label]) => label);
      if (missing.length > 0) errors.push(`Missing ${missing.join(", ")}`);

      const type = packagingItemOptions.find((option) => matchKey(option) === matchKey(rawType));
      if (rawType && !type) errors.push(`Type "${rawType}" is not a valid type`);

      const usedFor = usedForNames.map((value) => {
        const model = models.find((candidate) => matchKey(candidate.id) === matchKey(value) || matchKey(candidate.name) === matchKey(value));
        if (!model) errors.push(`Model "${value}" not found`);
        return model?.name ?? value;
      });

      return { itemCode, description, type: type ?? rawType, usedFor, errors };
    });
}

export function buildDrawingRowsFromModelItems(modelItems: PackagingItem[], revision: string) {
  return modelItems.map((item) => ({
    itemCode: item.itemCode,
    revision,
    fileName: "",
  }));
}

export function packagingSetNameFromFileName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

export function nextPackagingSetRevision(sets: DrawingSet[], modelId: string) {
  const existingCount = sets.filter((set) => set.modelId === modelId && set.recordState !== "Void").length;
  return `${existingCount + 1}.0`;
}
