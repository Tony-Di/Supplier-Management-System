import { type AppData } from "./api";
import { suppliers as seedSuppliers, models as seedModels, items as seedItems, drawingSets as seedDrawingSets, projects as seedProjects, quotes as seedQuotes, inspections as seedInspections, priceChanges as seedPriceChanges, purchasePrices as seedPurchasePrices } from "./data";

export const fallbackData: AppData = {
  suppliers: seedSuppliers,
  models: seedModels,
  items: seedItems,
  drawingSets: seedDrawingSets,
  projects: seedProjects,
  quotes: seedQuotes,
  quoteCaseLinks: [],
  sourceAssignments: [],
  inspections: seedInspections,
  incomingDefects: [],
  priceChanges: seedPriceChanges,
  purchasePrices: seedPurchasePrices,
  files: [],
};
