import { packagingItemOptions } from "../constants";
import { type PackagingItem, type DrawingSet, type Model } from "../types";

export type ImportKind = "Items" | "Models";

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

function importLines(rawText: string) {
  return splitRecords(rawText.replace(/\r\n?/g, "\n"))
    .map((line) => line.trim())
    .filter(Boolean);
}

function importCells(line: string) {
  return (line.includes("\t") ? splitCells(line, "\t") : splitCells(line, ",")).map((cell) => cell.trim());
}

const itemHeader = /^item\s*code\s*([\t,]|$)/i;
const modelHeader = /^(model|module)s?(\s*name)?\s*([\t,]|$)/i;
const modelStatuses: Model["status"][] = ["Active", "Inactive"];

function findModel(models: Pick<Model, "id" | "name">[], value: string) {
  return models.find((candidate) => matchKey(candidate.id) === matchKey(value) || matchKey(candidate.name) === matchKey(value));
}

function splitUsedFor(value: string) {
  return value.split(/[;,]/).map((name) => name.trim()).filter(Boolean);
}

// A header row decides. Without one, the paste is items when most rows carry
// a packaging type in the third column or a known model in the fourth.
export function detectImportKind(rawText: string, models: Pick<Model, "id" | "name">[]): ImportKind {
  const lines = importLines(rawText);
  if (lines.length === 0 || itemHeader.test(lines[0])) return "Items";
  if (modelHeader.test(lines[0])) return "Models";
  const itemLines = lines.filter((line) => {
    const [, , type = "", usedFor = ""] = importCells(line);
    return packagingItemOptions.some((option) => matchKey(option) === matchKey(type)) || splitUsedFor(usedFor).some((value) => findModel(models, value));
  });
  return itemLines.length * 2 >= lines.length ? "Items" : "Models";
}

const codeKey = (itemCode: string) => itemCode.trim().toLowerCase();

// An Item Code that already exists, or repeats in the paste, is not a second
// item: its Used for models are added to the one item.
export function parseItemImportRows(
  rawText: string,
  models: Pick<Model, "id" | "name">[],
  items: Pick<PackagingItem, "itemCode" | "usedForModels">[] = [],
) {
  const existingCodes = new Set(items.map((item) => codeKey(item.itemCode)));
  const linkedModelIds = new Map(items.map((item) => [codeKey(item.itemCode), new Set(item.usedForModels)]));
  return importLines(rawText)
    .filter((line, index) => index !== 0 || !itemHeader.test(line))
    .map((line) => {
      const [itemCode = "", description = "", rawType = "", rawUsedFor = ""] = importCells(line);
      const usedForNames = splitUsedFor(rawUsedFor);
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

      const matchedModels = usedForNames.map((value) => {
        const model = findModel(models, value);
        if (!model) errors.push(`Model "${value}" not found`);
        return model;
      });
      const usedFor = matchedModels.map((model, index) => model?.name ?? usedForNames[index]);

      let note = "";
      if (errors.length === 0) {
        const key = codeKey(itemCode);
        const linked = linkedModelIds.get(key);
        const rowModels = [...new Map(matchedModels.filter((model) => model !== undefined).map((model) => [model.id, model])).values()];
        const added = rowModels.filter((model) => !linked?.has(model.id));
        const existing = existingCodes.has(key);
        if (linked && added.length > 0) note = `Adds ${added.map((model) => model.name).join(", ")} to ${existing ? "the existing item" : "the same item above"}`;
        else if (linked) note = existing ? "Already exists, skipped" : "Repeated row, skipped";
        linkedModelIds.set(key, new Set([...(linked ?? []), ...added.map((model) => model.id)]));
      }

      return { itemCode, description, type: type ?? rawType, usedFor, note, errors };
    });
}

export function parseModelImportRows(rawText: string, models: Pick<Model, "name">[]) {
  const existingNames = new Set(models.map((model) => matchKey(model.name)));
  const seenNames = new Set<string>();
  return importLines(rawText)
    .filter((line, index) => index !== 0 || !modelHeader.test(line))
    .map((line) => {
      const [name = "", productFamily = "", rawStatus = "", notes = ""] = importCells(line);
      const errors: string[] = [];
      if (!name) errors.push("Missing Model");
      const status = rawStatus ? modelStatuses.find((option) => matchKey(option) === matchKey(rawStatus)) : "Active";
      if (!status) errors.push(`Status "${rawStatus}" must be Active or Inactive`);

      const key = matchKey(name);
      const note = !name ? "" : existingNames.has(key) ? "Already exists, skipped" : seenNames.has(key) ? "Repeated row, skipped" : "";
      if (name) seenNames.add(key);

      return { name, productFamily: productFamily || "Solar Module", status: status ?? rawStatus, notes, note, errors };
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
