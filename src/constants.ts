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

/** Documents a supplier may keep besides its W-9 and bank/payment info file. */
export const maxOtherSupplierFiles = 2;

export const quoteStatusOptions: Quote["status"][] = ["Received", "Sample Requested", "Selected", "No Further Action", "Expired"];

export const incomingDefectTypes: IncomingDefectRecord["defectType"][] = ["Damage", "Dimension", "Quantity Shortage", "Material", "Labeling", "Other"];

export const scorecardSortOptions: ScorecardSortKey[] = ["Score", "Quality", "Pricing", "Responsiveness", "Scope Fit", "Lead Time"];

// Mirrors the server's upload allowlist in server/uploads.ts.
export const uploadAccept = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.xlsx,.xls,.csv,.docx,.doc";
