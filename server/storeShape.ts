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

/** Every business record plus the score weights: what /api/bootstrap returns. */
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

export function defaultScoreWeights(): ScoreWeights {
  return {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };
}

export function emptyStore(): Store {
  return {
    suppliers: [],
    models: [],
    items: [],
    drawingSets: [],
    projects: [],
    quotes: [],
    quoteCaseLinks: [],
    sourceAssignments: [],
    inspections: [],
    incomingDefects: [],
    priceChanges: [],
    purchasePrices: [],
    files: [],
    scoreWeights: defaultScoreWeights(),
  };
}
