import type { AdminTab, PricingTab, ProductsTab, QCTab, ReportsTab, Section, SourcingTab } from "../uiTypes";

/** Where the user is in the app: the section, the tab last open in each section, and the selected case. */
export interface ViewState {
  section: Section;
  productsTab: ProductsTab;
  sourcingTab: SourcingTab;
  pricingTab: PricingTab;
  qcTab: QCTab;
  reportsTab: ReportsTab;
  adminTab: AdminTab;
  caseId: string;
}

export const defaultViewState: ViewState = {
  section: "Dashboard",
  productsTab: "Models & Items",
  sourcingTab: "Development Cases",
  pricingTab: "Price Analytics",
  qcTab: "Sample Inspections",
  reportsTab: "Scorecard",
  adminTab: "Users",
  caseId: "",
};

type TabKey = Exclude<keyof ViewState, "section" | "caseId">;

interface SectionRoute {
  section: Section;
  slug: string;
  tabKey?: TabKey;
  tabs?: Record<string, string>;
}

// Slugs must not start with api, uploads or assets: the server answers those itself (server/frontend.ts).
const SECTION_ROUTES: SectionRoute[] = [
  { section: "Dashboard", slug: "" },
  { section: "Suppliers", slug: "suppliers" },
  { section: "Products & Drawings", slug: "products", tabKey: "productsTab", tabs: { "Models & Items": "items", "Packaging Sets": "packaging-sets" } },
  { section: "Sourcing Workbench", slug: "sourcing", tabKey: "sourcingTab", tabs: { "Development Cases": "cases", Quotes: "quotes", Comparison: "comparison" } },
  { section: "Pricing", slug: "pricing", tabKey: "pricingTab", tabs: { "Price Analytics": "analytics", "Price Changes": "changes" } },
  { section: "QC Inspections", slug: "qc", tabKey: "qcTab", tabs: { "Sample Inspections": "inspections", "Incoming Defects": "defects" } },
  { section: "Reports", slug: "reports", tabKey: "reportsTab", tabs: { Scorecard: "scorecard", "Score Settings": "settings" } },
  { section: "Admin", slug: "admin", tabKey: "adminTab", tabs: { Users: "users", "Audit log": "audit" } },
];

/** The address of a view, such as `/sourcing/quotes?case=proj-1002`. Only the sourcing tabs depend on a case. */
export function viewPath(view: ViewState): string {
  const route = SECTION_ROUTES.find((candidate) => candidate.section === view.section) ?? SECTION_ROUTES[0];
  if (!route.slug) return "/";
  const tabSlug = route.tabKey && route.tabs ? route.tabs[view[route.tabKey]] : undefined;
  const path = tabSlug ? `/${route.slug}/${tabSlug}` : `/${route.slug}`;
  return route.section === "Sourcing Workbench" && view.caseId ? `${path}?case=${encodeURIComponent(view.caseId)}` : path;
}

/**
 * The view an address names, laid over `current` so the tabs of other sections
 * keep their place. An address the app does not know opens the Dashboard, and
 * a section without a tab in its address opens the tab last used there.
 */
export function viewFromLocation(pathname: string, search: string, current: ViewState = defaultViewState): ViewState {
  const [sectionSlug = "", tabSlug = ""] = pathname.split("/").filter(Boolean);
  const route = SECTION_ROUTES.find((candidate) => candidate.slug === sectionSlug.toLowerCase());
  if (!route) return { ...current, section: "Dashboard" };

  const next: ViewState = { ...current, section: route.section };
  if (route.tabKey && route.tabs) {
    const tab = Object.keys(route.tabs).find((name) => route.tabs?.[name] === tabSlug.toLowerCase());
    if (tab) (next as unknown as Record<string, string>)[route.tabKey] = tab;
  }
  const caseId = new URLSearchParams(search).get("case");
  if (route.section === "Sourcing Workbench" && caseId) next.caseId = caseId;
  return next;
}
