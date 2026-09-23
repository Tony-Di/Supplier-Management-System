export type SupplierStatus =
  | "Prospect"
  | "Sample Stage"
  | "Approved"
  | "Active"
  | "On Hold"
  | "Rejected";

export type PackagingItemType =
  | "Paper Corner Protector"
  | "Long Paper Protector"
  | "Short Paper Protector"
  | "Upper Cover"
  | "Paper Plate"
  | "Pallet"
  | "Strapping"
  | "Stretch Film";

export type RecordState = "Draft" | "Active" | "Void";

export interface RecordLifecycle {
  recordState?: RecordState;
  voidReason?: string;
}

export interface Supplier extends RecordLifecycle {
  id: string;
  name: string;
  erpVendorId?: string;
  status: SupplierStatus;
  type: "Manufacturer" | "Distributor" | "Service" | "Other";
  country: string;
  region: string;
  capableItems: PackagingItemType[];
  primaryContact: string;
  email: string;
  phone: string;
  paymentTerms: string;
  hasW9: boolean;
  hasPaymentInfo: boolean;
  w9FileId?: string;
  paymentInfoFileId?: string;
  notes: string;
}

export interface Model extends RecordLifecycle {
  id: string;
  name: string;
  productFamily: string;
  status: "Active" | "Inactive";
  notes: string;
}

export interface PackagingItem extends RecordLifecycle {
  id: string;
  itemCode: string;
  itemName: string;
  type: PackagingItemType;
  usedForModels: string[];
  uom: "pcs" | "set" | "bundle" | "lb" | "kg";
  status: "Active" | "Inactive";
}

export interface DrawingSet extends RecordLifecycle {
  id: string;
  modelId: string;
  name: string;
  revision: string;
  status: "Draft" | "Active" | "Superseded" | "Obsolete";
  effectiveDate: string;
  maintainedBy: string;
  packageFileId?: string;
  packageFileName?: string;
  drawingItems: DrawingItem[];
}

export interface DrawingItem {
  id: string;
  itemId: string;
  revision: string;
  status: "Active" | "Superseded" | "Obsolete";
  drawingSource?: "Package PDF" | "Item-specific PDF";
  fileName?: string;
  fileId?: string;
}

export interface SourcingProject extends RecordLifecycle {
  id: string;
  name: string;
  modelIds: string[];
  drawingSetId: string;
  type: "New Supplier Development" | "Requote" | "Re-source" | "Backup Supplier" | "Price Check" | "Model Change";
  caseReason: "New Supplier Intro" | "Change Work Order" | "Requote" | "Re-source" | "Backup Supplier" | "Price Check";
  status: "Planning" | "Quoting" | "Sample Stage" | "Comparison" | "Closed";
  supplierIds: string[];
  itemIds: string[];
  owner: string;
  openDate: string;
  targetCloseDate?: string;
}

export interface Quote extends RecordLifecycle {
  id: string;
  supplierId: string;
  projectId?: string;
  quoteType: "Standalone" | "Case-linked";
  quoteReason: "New Quote" | "Requote" | "Price Check" | "Change Work Order" | "Model Change";
  previousQuoteId?: string;
  modelId: string;
  itemId: string;
  drawingSetId: string;
  drawingItemId: string;
  quoteDate: string;
  effectiveFrom: string;
  effectiveTo?: string;
  validUntil?: string;
  currency: "USD";
  uom: string;
  unitPrice: number;
  moq: string;
  leadTime: string;
  extraCostType?: "None" | "Freight" | "Sample" | "Tooling" | "Packaging Test" | "Other";
  extraCostAmount?: number;
  status: "Received" | "Under Review" | "Sample Requested" | "Selected" | "Not Selected" | "Expired";
  attachmentFileId?: string;
  notes: string;
}

export interface QuoteCaseLink extends RecordLifecycle {
  id: string;
  quoteId: string;
  projectId: string;
  supplierId: string;
  itemId: string;
  modelId: string;
  linkType: "Origin Case" | "Reused Existing Quote";
  sampleRequirement: "Not Reviewed" | "Not Required - Existing QC Pass" | "Required" | "Sample Requested" | "QC Passed" | "QC Failed";
}

export type SourceRole = "Primary" | "Secondary" | "Tertiary" | "Backup";

export interface SourceAssignment extends RecordLifecycle {
  id: string;
  projectId?: string;
  modelId: string;
  itemId: string;
  supplierId: string;
  sourceQuoteId?: string;
  role: SourceRole;
  effectiveFrom: string;
  notes: string;
}

export interface SampleInspection extends RecordLifecycle {
  id: string;
  supplierId: string;
  projectId?: string;
  relatedQuoteId?: string;
  modelId: string;
  drawingSetId: string;
  itemId: string;
  drawingItemId: string;
  sampleRound: number;
  sampleReceivedDate: string;
  inspectionDate?: string;
  inspector?: string;
  result: "Pass" | "Fail" | "Conditional" | "Not Submitted";
  disposition: "Pending" | "Accepted" | "Re-sample Required" | "Conditional Approval" | "No Further Action";
  problemPhotos: number;
  photoFileIds?: string[];
  notes: string;
  signedDate?: string;
}

export interface IncomingDefectRecord extends RecordLifecycle {
  id: string;
  supplierId: string;
  modelId?: string;
  itemId: string;
  poNumber?: string;
  poQty?: number;
  defectType: "Damage" | "Dimension" | "Quantity Shortage" | "Material" | "Labeling" | "Other";
  defectDate: string;
  defectQty: number;
  receivedQty?: number;
  defectAction: "Request Replacement" | "Request Credit";
  replacementQty?: number;
  replacementReceipts?: ReplacementReceipt[];
  actionCompleted?: boolean;
  actionCompletedDate?: string;
  materialReturned?: boolean;
  returnDate?: string;
  notes: string;
  photoFileIds?: string[];
  attachmentFileIds?: string[];
}

export interface ReplacementReceipt {
  receivedDate: string;
  receivedQty: number;
  result: "Accepted" | "Rejected";
}

export interface ScoreWeights {
  sampleQuality: number;
  incomingQuality: number;
  pricing: number;
  responsiveness: number;
  scopeFit: number;
  setup: number;
}

export interface PriceChange extends RecordLifecycle {
  id: string;
  supplierId: string;
  modelId: string;
  itemId: string;
  sourceQuoteId?: string;
  previousQuoteId?: string;
  sourcePurchasePriceId?: string;
  previousPurchasePriceId?: string;
  sourceType: "Manual" | "Requote" | "New Quote" | "Purchase";
  oldPrice: number;
  newPrice: number;
  currency: "USD";
  effectiveDate: string;
  reason: "Material" | "Freight" | "Labor" | "Negotiated" | "Model Change" | "Drawing Change" | "Requote" | "Change Work Order" | "Other";
  status: "Pending" | "Approved" | "Rejected";
}

export interface PurchasePriceRecord extends RecordLifecycle {
  id: string;
  supplierId: string;
  modelId: string;
  itemId: string;
  poNumber: string;
  orderDate: string;
  unitPrice: number;
  quantity: number;
  currency: "USD";
  uom: string;
  sourceType: "ERP Import" | "Manual Import";
  linkedQuoteId?: string;
  buyer: string;
  notes: string;
}

export interface UploadedFileRecord {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  uploadedAt: string;
  purpose: "Supplier W9" | "Supplier Payment Info" | "Drawing" | "Quote Attachment" | "QC Photo" | "Other";
  linkedRecordType?: string;
  linkedRecordId?: string;
}

export interface AuditLogRecord {
  id: number;
  timestamp: string;
  actorUserId: number | null;
  actorLabel: string;
  action: "Create" | "Edit" | "Status Change" | "Upload" | "Void" | "Delete" | "Approve" | "Import";
  entityType: string;
  entityId: string;
  entityLabel: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  source: "UI" | "Import" | "System";
  linkedRecordId?: string;
}
