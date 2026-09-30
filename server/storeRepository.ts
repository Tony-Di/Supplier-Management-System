import type { PoolClient } from "pg";

import "./pgTypes";
import type {
  DrawingSet,
  IncomingDefectRecord,
  Model,
  PackagingItem,
  PriceChange,
  PurchasePriceRecord,
  Quote,
  QuoteCaseLink,
  SampleInspection,
  ScoreWeights,
  SourceAssignment,
  SourcingProject,
  Supplier,
  UploadedFileRecord,
} from "../src/types";
import type { TableChanges } from "./storeDiff";
import { defaultScoreWeights, type Store } from "./storeShape";
import { TABLES, attachDrawingItems, columnName, fromRow, type Row, type StoredDrawingItem, type TableDef } from "./storeTables";
import { storagePath } from "./uploads";

type Executor = Pick<PoolClient, "query">;

const WEIGHT_FIELDS = ["sampleQuality", "incomingQuality", "pricing", "responsiveness", "scopeFit", "setup"] as const;

// IDs within a table share a prefix, so shorter IDs are older: sup-9999 before sup-10000.
async function selectAll<T>(db: Executor, def: TableDef, orderBy = "length(id), id"): Promise<T[]> {
  const { rows } = await db.query(`SELECT ${def.fields.map(columnName).join(", ")} FROM ${def.table} ORDER BY ${orderBy}`);
  return rows.map((row) => fromRow(def, row)) as unknown as T[];
}

/** Every business record, in the order it was created. File contents are left out. */
export async function loadStore(db: Executor): Promise<Store> {
  const files = await selectAll<Omit<UploadedFileRecord, "storagePath">>(db, TABLES.files);
  const drawingSets = attachDrawingItems(
    await selectAll<Omit<DrawingSet, "drawingItems">>(db, TABLES.drawingSets),
    await selectAll<StoredDrawingItem>(db, TABLES.drawingItems, "drawing_set_id, position"),
  );
  const { rows: [weights] } = await db.query(`SELECT ${WEIGHT_FIELDS.map(columnName).join(", ")} FROM score_weights WHERE id = 1`);
  return {
    suppliers: await selectAll<Supplier>(db, TABLES.suppliers),
    models: await selectAll<Model>(db, TABLES.models),
    items: await selectAll<PackagingItem>(db, TABLES.items),
    drawingSets,
    projects: await selectAll<SourcingProject>(db, TABLES.projects),
    quotes: await selectAll<Quote>(db, TABLES.quotes),
    quoteCaseLinks: await selectAll<QuoteCaseLink>(db, TABLES.quoteCaseLinks),
    sourceAssignments: await selectAll<SourceAssignment>(db, TABLES.sourceAssignments),
    inspections: await selectAll<SampleInspection>(db, TABLES.inspections),
    incomingDefects: await selectAll<IncomingDefectRecord>(db, TABLES.incomingDefects),
    priceChanges: await selectAll<PriceChange>(db, TABLES.priceChanges),
    purchasePrices: await selectAll<PurchasePriceRecord>(db, TABLES.purchasePrices),
    files: files.map((file) => ({ ...file, storagePath: storagePath(file.id, file.fileName) })),
    scoreWeights: weights
      ? (Object.fromEntries(WEIGHT_FIELDS.map((field) => [field, weights[columnName(field)]])) as unknown as ScoreWeights)
      : defaultScoreWeights(),
  };
}

function parameters(def: TableDef, row: Row): unknown[] {
  return row.map((value, index) => (value !== null && def.json?.includes(def.fields[index]) ? JSON.stringify(value) : value));
}

/** Writes one request's changes. A new file row takes its content from `fileContents`. */
export async function saveChanges(db: Executor, changes: TableChanges[], fileContents: ReadonlyMap<string, Buffer> = new Map()): Promise<void> {
  for (const { def, inserts, updates, deletes } of changes) {
    if (deletes.length > 0) await db.query(`DELETE FROM ${def.table} WHERE id = ANY($1)`, [deletes]);
    for (const row of inserts) {
      const columns = def.fields.map(columnName);
      const values = parameters(def, row);
      if (def.table === "files") {
        const content = fileContents.get(row[0] as string);
        if (!content) throw new Error(`No content for new file ${row[0]}`);
        columns.push("content");
        values.push(content);
      }
      const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
      await db.query(`INSERT INTO ${def.table} (${columns.join(", ")}) VALUES (${placeholders})`, values);
    }
    for (const row of updates) {
      const assignments = def.fields.slice(1).map((field, index) => `${columnName(field)} = $${index + 2}`).join(", ");
      await db.query(`UPDATE ${def.table} SET ${assignments} WHERE id = $1`, parameters(def, row));
    }
  }
}

export async function saveScoreWeights(db: Executor, weights: ScoreWeights): Promise<void> {
  const columns = WEIGHT_FIELDS.map(columnName);
  await db.query(
    `INSERT INTO score_weights (id, ${columns.join(", ")}) VALUES (1, ${columns.map((_, index) => `$${index + 1}`).join(", ")})
     ON CONFLICT (id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}`,
    WEIGHT_FIELDS.map((field) => weights[field]),
  );
}

export async function loadCounters(db: Executor): Promise<Map<string, number>> {
  const { rows } = await db.query("SELECT prefix, value FROM id_counters");
  return new Map(rows.map((row) => [row.prefix as string, row.value as number]));
}

export async function saveCounters(db: Executor, counters: Array<[string, number]>): Promise<void> {
  for (const [prefix, value] of counters) {
    await db.query(
      "INSERT INTO id_counters (prefix, value) VALUES ($1, $2) ON CONFLICT (prefix) DO UPDATE SET value = EXCLUDED.value",
      [prefix, value],
    );
  }
}

export async function readFileContent(db: Executor, id: string): Promise<{ fileName: string; mimeType: string; content: Buffer } | undefined> {
  const { rows: [row] } = await db.query("SELECT file_name, mime_type, content FROM files WHERE id = $1", [id]);
  return row ? { fileName: row.file_name as string, mimeType: row.mime_type as string, content: row.content as Buffer } : undefined;
}
