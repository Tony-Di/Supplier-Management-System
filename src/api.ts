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
  AuditLogRecord,
  UploadedFileRecord,
} from "./types";

export interface AppData {
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
  auditLogs: AuditLogRecord[];
}

export interface ComparisonRow {
  item?: PackagingItem;
  suppliers: Array<{
    supplier?: Supplier;
    quote?: Quote;
    quotes?: Quote[];
    inspection?: SampleInspection;
  }>;
  recommendedSupplierId: string | null;
}

export interface ScorecardRow {
  supplier: Supplier;
  score: number;
  grade: string;
  categories: Array<{
    key: "quality" | "pricing" | "responsiveness" | "scope" | "setup";
    label: string;
    score: number;
    max: number;
    detail: string;
    children?: Array<{
      key: "sampleQuality" | "incomingQuality";
      label: string;
      score: number;
      max: number;
      detail: string;
    }>;
  }>;
  scopeLabel: string;
  quoteCount: number;
  passCount: number;
  failCount: number;
  documentsComplete: boolean;
}

export interface ScorecardResponse {
  weights: ScoreWeights;
  rows: ScorecardRow[];
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(errorBody.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export function fetchBootstrap() {
  return request<AppData>("/api/bootstrap");
}

export function fetchComparison(projectId: string) {
  return request<ComparisonRow[]>(`/api/projects/${projectId}/comparison`);
}

export function fetchScorecard() {
  return request<ScorecardResponse>("/api/scorecard");
}

export function updateScoreWeights(payload: ScoreWeights) {
  return request<ScoreWeights>("/api/score-settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createSupplier(payload: Omit<Supplier, "id">) {
  return request<Supplier>("/api/suppliers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createModel(payload: Omit<Model, "id">) {
  return request<Model>("/api/models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createItem(payload: Omit<PackagingItem, "id">) {
  return request<PackagingItem>("/api/items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function importItems(payload: {
  updateExisting?: boolean;
  rows: Array<{ itemCode: string; description: string; type: PackagingItem["type"]; usedFor: string[] }>;
}) {
  return request<{ totalRows: number; created: number; duplicated: number; skipped: number; duplicateItemCodes: string[] }>("/api/items/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createDrawingSet(
  payload: Omit<DrawingSet, "id" | "drawingItems"> & {
    drawingItems: Array<Omit<DrawingSet["drawingItems"][number], "id">>;
    replaceActive?: boolean;
  },
) {
  return request<DrawingSet>("/api/drawing-sets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createProject(payload: Omit<SourcingProject, "id">) {
  return request<SourcingProject>("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createQuote(payload: Omit<Quote, "id">) {
  return request<Quote>("/api/quotes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function upsertSourceAssignment(payload: Omit<SourceAssignment, "id" | "recordState">) {
  return request<SourceAssignment>("/api/source-assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createInspection(payload: Omit<SampleInspection, "id">) {
  return request<SampleInspection>("/api/inspections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createIncomingDefect(payload: Omit<IncomingDefectRecord, "id">) {
  return request<IncomingDefectRecord>("/api/incoming-defects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function createPriceChange(payload: Omit<PriceChange, "id">) {
  return request<PriceChange>("/api/price-changes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type DeleteEndpoint =
  | "suppliers"
  | "models"
  | "items"
  | "drawing-sets"
  | "projects"
  | "quotes"
  | "inspections"
  | "incoming-defects"
  | "price-changes"
  | "purchase-prices";

export function deleteRecord(endpoint: DeleteEndpoint, id: string) {
  return request<{ ok: true }>(`/api/${endpoint}/${id}`, {
    method: "DELETE",
  });
}

export function updateRecord<T>(endpoint: DeleteEndpoint, id: string, payload: Partial<T>) {
  return request<T>(`/api/${endpoint}/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function voidRecord(endpoint: DeleteEndpoint, id: string, reason: string) {
  return request<{ ok: true }>(`/api/${endpoint}/${id}/void`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function uploadFile(payload: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  purpose: UploadedFileRecord["purpose"];
  linkedRecordType?: string;
  linkedRecordId?: string;
}) {
  return request<UploadedFileRecord>("/api/files", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
