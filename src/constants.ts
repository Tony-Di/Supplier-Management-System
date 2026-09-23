import { type PackagingItemType, type Quote, type IncomingDefectRecord } from "./types";
import { type ScorecardSortKey } from "./uiTypes";

export const packagingItemOptions: PackagingItemType[] = [
  "Paper Corner Protector",
  "Long Paper Protector",
  "Short Paper Protector",
  "Upper Cover",
  "Paper Plate",
  "Pallet",
  "Strapping",
  "Stretch Film",
];

export const quoteStatusOptions: Quote["status"][] = ["Received", "Under Review", "Sample Requested", "Selected", "Not Selected", "Expired"];

export const incomingDefectTypes: IncomingDefectRecord["defectType"][] = ["Damage", "Dimension", "Quantity Shortage", "Material", "Labeling", "Other"];

export const scorecardSortOptions: ScorecardSortKey[] = ["Score", "Quality", "Pricing", "Responsiveness", "Scope Fit", "Lead Time"];

// Mirrors the server's upload allowlist in server/uploads.ts.
export const uploadAccept = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.xlsx,.xls,.csv,.docx,.doc";
