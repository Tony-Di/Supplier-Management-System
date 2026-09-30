import { isDeepStrictEqual } from "node:util";

import type { Store } from "./storeShape";
import { TABLES, flattenDrawingItems, toRow, type Row, type TableDef } from "./storeTables";

export interface TableChanges {
  def: TableDef;
  inserts: Row[];
  updates: Row[];
  deletes: string[];
}

/**
 * The rows to insert, update and delete to turn `before` into `after`,
 * matching records by ID. Rows are compared as values, so an explicit
 * undefined equals an absent field and key order inside json fields is ignored.
 */
export function diffRecords(def: TableDef, before: readonly object[], after: readonly object[]): TableChanges {
  const beforeRows = new Map(before.map((record) => {
    const row = toRow(def, record);
    return [row[0] as string, row] as const;
  }));
  const afterIds = new Set<string>();
  const changes: TableChanges = { def, inserts: [], updates: [], deletes: [] };
  for (const record of after) {
    const row = toRow(def, record);
    const id = row[0] as string;
    afterIds.add(id);
    const previous = beforeRows.get(id);
    if (!previous) changes.inserts.push(row);
    else if (!isDeepStrictEqual(previous, row)) changes.updates.push(row);
  }
  for (const id of beforeRows.keys()) {
    if (!afterIds.has(id)) changes.deletes.push(id);
  }
  return changes;
}

/** Every table's changes between two versions of the store. Score weights are compared separately. */
export function diffStore(before: Store, after: Store): TableChanges[] {
  return [
    diffRecords(TABLES.files, before.files, after.files),
    diffRecords(TABLES.suppliers, before.suppliers, after.suppliers),
    diffRecords(TABLES.models, before.models, after.models),
    diffRecords(TABLES.items, before.items, after.items),
    diffRecords(TABLES.drawingSets, before.drawingSets, after.drawingSets),
    diffRecords(TABLES.drawingItems, flattenDrawingItems(before.drawingSets), flattenDrawingItems(after.drawingSets)),
    diffRecords(TABLES.projects, before.projects, after.projects),
    diffRecords(TABLES.quotes, before.quotes, after.quotes),
    diffRecords(TABLES.quoteCaseLinks, before.quoteCaseLinks, after.quoteCaseLinks),
    diffRecords(TABLES.sourceAssignments, before.sourceAssignments, after.sourceAssignments),
    diffRecords(TABLES.inspections, before.inspections, after.inspections),
    diffRecords(TABLES.incomingDefects, before.incomingDefects, after.incomingDefects),
    diffRecords(TABLES.purchasePrices, before.purchasePrices, after.purchasePrices),
    diffRecords(TABLES.priceChanges, before.priceChanges, after.priceChanges),
  ];
}
