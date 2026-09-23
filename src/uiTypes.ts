import { type DeleteEndpoint, type AppData } from "./api";
import { type SampleInspection, type IncomingDefectRecord, type Supplier, type Model, type PackagingItem, type DrawingSet, type Quote, type PriceChange } from "./types";

export type Section =
  | "Dashboard"
  | "Suppliers"
  | "Products & Drawings"
  | "Sourcing Workbench"
  | "Pricing"
  | "QC Inspections"
  | "Reports"
  | "Admin";

export type AdminTab = "Users" | "Audit log";

export type ProductsTab = "Models & Items" | "Packaging Sets";

export type SourcingTab = "Development Cases" | "Quotes" | "Comparison";

export type PricingTab = "Price Analytics" | "Price Changes";

export type QCTab = "Sample Inspections" | "Incoming Defects";

export type ReportsTab = "Scorecard" | "Score Settings";

export type ScorecardSortKey = "Score" | "Quality" | "Pricing" | "Responsiveness" | "Scope Fit" | "Lead Time";

export type DeleteHandler = (endpoint: DeleteEndpoint, id: string, label: string) => void;

export type VoidHandler = (endpoint: DeleteEndpoint, id: string, label: string) => void;

export type HistoryHandler = (entityType: string, entityId: string, label: string) => void;

export type VoidTarget = { endpoint: DeleteEndpoint; id: string; label: string };

export type ViewTarget =
  | { type: "inspection"; record: SampleInspection }
  | { type: "incoming-defect"; record: IncomingDefectRecord };

export type EditTarget =
  | { endpoint: "suppliers"; record: Supplier }
  | { endpoint: "models"; record: Model }
  | { endpoint: "items"; record: PackagingItem }
  | { endpoint: "drawing-sets"; record: DrawingSet }
  | { endpoint: "projects"; record: AppData["projects"][number] }
  | { endpoint: "quotes"; record: Quote }
  | { endpoint: "inspections"; record: SampleInspection }
  | { endpoint: "incoming-defects"; record: IncomingDefectRecord }
  | { endpoint: "price-changes"; record: PriceChange }
  | { endpoint: "purchase-prices"; record: AppData["purchasePrices"][number] };
