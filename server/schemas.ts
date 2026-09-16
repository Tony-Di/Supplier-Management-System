import { z } from "zod";

const packagingItemTypes = [
  "Paper Corner Protector",
  "Long Paper Protector",
  "Short Paper Protector",
  "Upper Cover",
  "Paper Plate",
  "Pallet",
  "Strapping",
  "Stretch Film",
] as const;

const lifecycleSchema = {
  recordState: z.enum(["Draft", "Active", "Void"]).default("Draft"),
  voidReason: z.string().optional(),
};

export const supplierSchema = z.object({
  ...lifecycleSchema,
  name: z.string().min(1),
  erpVendorId: z.string().optional(),
  status: z.enum(["Prospect", "Sample Stage", "Approved", "Active", "On Hold", "Rejected"]).default("Active"),
  type: z.enum(["Manufacturer", "Distributor", "Service", "Other"]).default("Manufacturer"),
  country: z.string().default("United States"),
  region: z.string().default(""),
  capableItems: z.array(z.enum(packagingItemTypes)).default([]),
  primaryContact: z.string().default(""),
  email: z.string().email().or(z.literal("")).default(""),
  phone: z.string().default(""),
  paymentTerms: z.string().default(""),
  hasW9: z.boolean().default(false),
  hasPaymentInfo: z.boolean().default(false),
  w9FileId: z.string().optional(),
  paymentInfoFileId: z.string().optional(),
  notes: z.string().default(""),
});

export const modelSchema = z.object({
  ...lifecycleSchema,
  name: z.string().min(1),
  productFamily: z.string().default("Solar Module"),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  notes: z.string().default(""),
});

export const itemSchema = z.object({
  ...lifecycleSchema,
  itemCode: z.string().min(1),
  itemName: z.string().min(1),
  type: z.enum(packagingItemTypes),
  usedForModels: z.array(z.string()).default([]),
  uom: z.enum(["pcs", "set", "bundle", "lb", "kg"]).default("pcs"),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

export const drawingSetSchema = z.object({
  ...lifecycleSchema,
  modelId: z.string().min(1),
  name: z.string().min(1),
  revision: z.string().min(1),
  status: z.enum(["Draft", "Active", "Superseded", "Obsolete"]).default("Draft"),
  effectiveDate: z.string().min(1),
  maintainedBy: z.string().default("Process Engineering"),
  packageFileId: z.string().optional(),
  packageFileName: z.string().optional(),
  drawingItems: z
    .array(
      z.object({
        itemId: z.string().min(1),
        revision: z.string().min(1),
        status: z.enum(["Active", "Superseded", "Obsolete"]).default("Active"),
        drawingSource: z.enum(["Package PDF", "Item-specific PDF"]).default("Package PDF"),
        fileName: z.string().optional(),
        fileId: z.string().optional(),
      }),
    )
    .default([]),
});

export const itemImportSchema = z.object({
  updateExisting: z.boolean().default(false),
  rows: z.array(
    z.object({
      itemCode: z.string().min(1),
      description: z.string().min(1),
      type: z.enum(packagingItemTypes),
      usedFor: z.array(z.string()).min(1),
    }),
  ),
});

export const projectSchema = z.object({
  ...lifecycleSchema,
  name: z.string().min(1),
  modelIds: z.array(z.string()).min(1),
  drawingSetId: z.string().min(1),
  type: z.enum(["New Supplier Development", "Requote", "Re-source", "Backup Supplier", "Price Check", "Model Change"]),
  caseReason: z
    .enum(["New Supplier Intro", "Change Work Order", "Requote", "Re-source", "Backup Supplier", "Price Check"])
    .default("New Supplier Intro"),
  status: z.enum(["Planning", "Quoting", "Sample Stage", "Comparison", "Closed"]).default("Planning"),
  supplierIds: z.array(z.string()).default([]),
  itemIds: z.array(z.string()).default([]),
  owner: z.string().default("Purchasing"),
  openDate: z.string().min(1),
  targetCloseDate: z.string().optional(),
});

export const quoteSchema = z.object({
  ...lifecycleSchema,
  supplierId: z.string().min(1),
  projectId: z.string().optional(),
  quoteType: z.enum(["Standalone", "Case-linked"]).default("Standalone"),
  quoteReason: z.enum(["New Quote", "Requote", "Price Check", "Change Work Order", "Model Change"]).default("New Quote"),
  previousQuoteId: z.string().optional(),
  modelId: z.string().min(1),
  itemId: z.string().min(1),
  drawingSetId: z.string().min(1),
  drawingItemId: z.string().min(1),
  quoteDate: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveTo: z.string().optional(),
  validUntil: z.string().optional(),
  currency: z.literal("USD").default("USD"),
  uom: z.string().default("pcs"),
  unitPrice: z.number().nonnegative(),
  moq: z.string().min(1),
  leadTime: z.string().min(1),
  extraCostType: z.enum(["None", "Freight", "Sample", "Tooling", "Packaging Test", "Other"]).default("None"),
  extraCostAmount: z.number().nonnegative().default(0),
  status: z.enum(["Received", "Under Review", "Sample Requested", "Selected", "Not Selected", "Expired"]).default("Received"),
  attachmentFileId: z.string().optional(),
  notes: z.string().default(""),
});

export const sourceAssignmentSchema = z.object({
  ...lifecycleSchema,
  projectId: z.string().optional(),
  modelId: z.string().min(1),
  itemId: z.string().min(1),
  supplierId: z.string().min(1),
  sourceQuoteId: z.string().optional(),
  role: z.enum(["Primary", "Secondary", "Tertiary", "Backup"]),
  effectiveFrom: z.string().min(1),
  notes: z.string().default(""),
});

export const inspectionSchema = z.object({
  ...lifecycleSchema,
  supplierId: z.string().min(1),
  projectId: z.string().optional(),
  relatedQuoteId: z.string().optional(),
  modelId: z.string().min(1),
  drawingSetId: z.string().min(1),
  itemId: z.string().min(1),
  drawingItemId: z.string().min(1),
  sampleRound: z.number().int().positive().default(1),
  sampleReceivedDate: z.string().min(1),
  inspectionDate: z.string().optional(),
  inspector: z.string().optional(),
  result: z.enum(["Pass", "Fail", "Conditional", "Not Submitted"]).default("Not Submitted"),
  disposition: z.enum(["Pending", "Accepted", "Re-sample Required", "Conditional Approval", "No Further Action"]).default("Pending"),
  problemPhotos: z.number().int().nonnegative().default(0),
  photoFileIds: z.array(z.string()).default([]),
  notes: z.string().default(""),
  signedDate: z.string().optional(),
});

export const incomingDefectSchema = z
  .object({
    ...lifecycleSchema,
    supplierId: z.string().min(1),
    modelId: z.string().optional(),
    itemId: z.string().min(1),
    poNumber: z.string().optional(),
    poQty: z.number().int().nonnegative().optional(),
    defectType: z.enum(["Damage", "Dimension", "Quantity Shortage", "Material", "Labeling", "Other"]).default("Other"),
    defectDate: z.string().min(1),
    defectQty: z.number().int().nonnegative(),
    receivedQty: z.number().int().nonnegative().optional(),
    defectAction: z.enum(["Request Replacement", "Request Credit"]).default("Request Replacement"),
    replacementQty: z.number().int().nonnegative().optional(),
    replacementReceipts: z
      .array(
        z.object({
          receivedDate: z.string().min(1),
          receivedQty: z.number().int().nonnegative(),
          result: z.enum(["Accepted", "Rejected"]),
        }),
      )
      .default([]),
    actionCompleted: z.boolean().default(false),
    actionCompletedDate: z.string().optional(),
    materialReturned: z.boolean().default(false),
    returnDate: z.string().optional(),
    notes: z.string().default(""),
    photoFileIds: z.array(z.string()).default([]),
    attachmentFileIds: z.array(z.string()).default([]),
  })
  .superRefine((record, context) => {
    if (record.defectAction === "Request Replacement" && !record.replacementQty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Replacement quantity is required when action is Request Replacement.",
        path: ["replacementQty"],
      });
    }
    if (record.defectAction !== "Request Replacement" && record.replacementQty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Replacement quantity should only be used for Request Replacement.",
        path: ["replacementQty"],
      });
    }
    if (record.materialReturned && !record.returnDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Return date is required when defect material has been returned.",
        path: ["returnDate"],
      });
    }
    if (record.actionCompleted && !record.actionCompletedDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed date is required when the defect action is completed.",
        path: ["actionCompletedDate"],
      });
    }
    if (record.poQty !== undefined && record.receivedQty !== undefined && record.receivedQty > record.poQty) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Received quantity cannot exceed PO quantity.",
        path: ["receivedQty"],
      });
    }
  });

export const scoreWeightsSchema = z.object({
  sampleQuality: z.number().nonnegative(),
  incomingQuality: z.number().nonnegative(),
  pricing: z.number().nonnegative(),
  responsiveness: z.number().nonnegative(),
  scopeFit: z.number().nonnegative(),
  setup: z.number().nonnegative(),
});

export const priceChangeSchema = z.object({
  ...lifecycleSchema,
  supplierId: z.string().min(1),
  modelId: z.string().min(1),
  itemId: z.string().min(1),
  sourceQuoteId: z.string().optional(),
  previousQuoteId: z.string().optional(),
  sourcePurchasePriceId: z.string().optional(),
  previousPurchasePriceId: z.string().optional(),
  sourceType: z.enum(["Manual", "Requote", "New Quote", "Purchase"]).default("Manual"),
  oldPrice: z.number().nonnegative(),
  newPrice: z.number().nonnegative(),
  currency: z.literal("USD").default("USD"),
  effectiveDate: z.string().min(1),
  reason: z.enum(["Material", "Freight", "Labor", "Negotiated", "Model Change", "Drawing Change", "Requote", "Change Work Order", "Other"]),
  status: z.enum(["Pending", "Approved", "Rejected"]).default("Pending"),
});

export const purchasePriceSchema = z.object({
  ...lifecycleSchema,
  supplierId: z.string().min(1),
  modelId: z.string().min(1),
  itemId: z.string().min(1),
  poNumber: z.string().min(1),
  orderDate: z.string().min(1),
  unitPrice: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
  currency: z.literal("USD").default("USD"),
  uom: z.string().default("pcs"),
  sourceType: z.enum(["ERP Import", "Manual Import"]).default("ERP Import"),
  linkedQuoteId: z.string().optional(),
  buyer: z.string().default("Purchasing"),
  notes: z.string().default(""),
});

export const fileUploadSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().default("application/octet-stream"),
  contentBase64: z.string().min(1),
  purpose: z.enum(["Supplier W9", "Supplier Payment Info", "Drawing", "Quote Attachment", "QC Photo", "Other"]),
  linkedRecordType: z.string().optional(),
  linkedRecordId: z.string().optional(),
});
