import { CSSProperties, Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Factory,
  FileStack,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LineChart,
  Menu,
  MoreHorizontal,
  PackageSearch,
  Plus,
  CircleHelp,
  Search,
  UserRound,
} from "lucide-react";
import {
  drawingSets as seedDrawingSets,
  inspections as seedInspections,
  items as seedItems,
  models as seedModels,
  priceChanges as seedPriceChanges,
  projects as seedProjects,
  purchasePrices as seedPurchasePrices,
  quotes as seedQuotes,
  suppliers as seedSuppliers,
} from "./data";
import {
  createInspection,
  createIncomingDefect,
  createDrawingSet,
  createItem,
  createModel,
  createPriceChange,
  createProject,
  createQuote,
  createSupplier,
  deleteRecord,
  fetchBootstrap,
  fetchComparison,
  fetchScorecard,
  importItems,
  updateScoreWeights,
  upsertSourceAssignment,
  uploadFile,
  type AppData,
  type ComparisonRow,
  type DeleteEndpoint,
  type ScorecardRow,
  updateRecord,
  voidRecord,
} from "./api";
import type {
  AuditLogRecord,
  DrawingSet,
  IncomingDefectRecord,
  Model,
  PackagingItem,
  PackagingItemType,
  PriceChange,
  Quote,
  SampleInspection,
  ScoreWeights,
  SourceAssignment,
  Supplier,
  UploadedFileRecord,
} from "./types";

type Section =
  | "Dashboard"
  | "Suppliers"
  | "Products & Drawings"
  | "Sourcing Workbench"
  | "Pricing"
  | "QC Inspections"
  | "Reports";

type ProductsTab = "Models & Items" | "Packaging Sets";
type SourcingTab = "Development Cases" | "Quotes" | "Comparison";
type PricingTab = "Price Analytics" | "Price Changes";
type QCTab = "Sample Inspections" | "Incoming Defects";
type ReportsTab = "Scorecard" | "Score Settings";

const navItems: { section: Section; icon: typeof LayoutDashboard }[] = [
  { section: "Dashboard", icon: LayoutDashboard },
  { section: "Suppliers", icon: UserRound },
  { section: "Products & Drawings", icon: PackageSearch },
  { section: "Sourcing Workbench", icon: FolderKanban },
  { section: "Pricing", icon: LineChart },
  { section: "QC Inspections", icon: ClipboardCheck },
  { section: "Reports", icon: Gauge },
];

const fallbackData: AppData = {
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
  auditLogs: [],
};

const packagingItemOptions: PackagingItemType[] = [
  "Paper Corner Protector",
  "Long Paper Protector",
  "Short Paper Protector",
  "Upper Cover",
  "Paper Plate",
  "Pallet",
  "Strapping",
  "Stretch Film",
];

const quoteStatusOptions: Quote["status"][] = ["Received", "Under Review", "Sample Requested", "Selected", "Not Selected", "Expired"];
const incomingDefectTypes: IncomingDefectRecord["defectType"][] = ["Damage", "Dimension", "Quantity Shortage", "Material", "Labeling", "Other"];
type ScorecardSortKey = "Score" | "Quality" | "Pricing" | "Responsiveness" | "Scope Fit" | "Lead Time";
const scorecardSortOptions: ScorecardSortKey[] = ["Score", "Quality", "Pricing", "Responsiveness", "Scope Fit", "Lead Time"];

type DeleteHandler = (endpoint: DeleteEndpoint, id: string, label: string) => void;
type VoidHandler = (endpoint: DeleteEndpoint, id: string, label: string) => void;
type HistoryHandler = (entityType: string, entityId: string, label: string) => void;
type VoidTarget = { endpoint: DeleteEndpoint; id: string; label: string };
type ViewTarget =
  | { type: "inspection"; record: SampleInspection }
  | { type: "incoming-defect"; record: IncomingDefectRecord };
type EditTarget =
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

let suppliers: Supplier[] = fallbackData.suppliers;
let models = fallbackData.models;
let items = fallbackData.items;
let drawingSets = fallbackData.drawingSets;
let projects = fallbackData.projects;
let quotes = fallbackData.quotes;
let quoteCaseLinks = fallbackData.quoteCaseLinks;
let sourceAssignments = fallbackData.sourceAssignments;
let inspections = fallbackData.inspections;
let incomingDefects = fallbackData.incomingDefects;
let priceChanges = fallbackData.priceChanges;
let purchasePrices = fallbackData.purchasePrices;
let files = fallbackData.files;
let auditLogs = fallbackData.auditLogs;

export function App() {
  const [section, setSection] = useState<Section>("Dashboard");
  const [productsTab, setProductsTab] = useState<ProductsTab>("Models & Items");
  const [sourcingTab, setSourcingTab] = useState<SourcingTab>("Development Cases");
  const [pricingTab, setPricingTab] = useState<PricingTab>("Price Analytics");
  const [qcTab, setQcTab] = useState<QCTab>("Sample Inspections");
  const [reportsTab, setReportsTab] = useState<ReportsTab>("Scorecard");
  const [data, setData] = useState<AppData>(fallbackData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [modal, setModal] = useState<"supplier" | "model" | "item" | "itemImport" | "drawingSet" | "project" | "quote" | "inspection" | "incomingDefect" | "priceChange" | "scoreSettings" | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(fallbackData.projects[0]?.id ?? "");
  const [inspectionQuoteId, setInspectionQuoteId] = useState<string | undefined>();
  const [historyTarget, setHistoryTarget] = useState<{ entityType: string; entityId: string; label: string } | null>(null);

  useEffect(() => {
    void refreshData();
  }, []);

  async function refreshData() {
    try {
      setError("");
      const nextData = await fetchBootstrap();
      setData(nextData);
      setSelectedProjectId((current) => current || nextData.projects[0]?.id || "");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load backend data.");
    } finally {
      setLoading(false);
    }
  }

  const selectedProject = data.projects.find((project) => project.id === selectedProjectId) ?? data.projects[0];

  async function handleDelete(endpoint: DeleteEndpoint, id: string, label: string) {
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!confirmed) return;

    try {
      setActionError("");
      await deleteRecord(endpoint, id);
      await refreshData();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to delete record.");
    }
  }

  function handleVoid(endpoint: DeleteEndpoint, id: string, label: string) {
    setVoidTarget({ endpoint, id, label });
  }

  async function confirmVoid(target: VoidTarget, reason: string) {
    try {
      setActionError("");
      await voidRecord(target.endpoint, target.id, reason);
      setVoidTarget(null);
      setData((current) => markRecordVoid(current, target.endpoint, target.id, reason));
      await refreshData();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to void record.");
    }
  }

  async function handleEditSave(target: EditTarget, patch: Record<string, unknown>) {
    try {
      setActionError("");
      await updateRecord(target.endpoint, target.record.id, patch);
      setEditTarget(null);
      await refreshData();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to edit record.");
    }
  }

  async function handleQuoteStatusChange(quoteId: string, status: Quote["status"]) {
    try {
      setActionError("");
      await updateRecord("quotes", quoteId, { status });
      await refreshData();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to update quote status.");
    }
  }

  async function handleSourceRoleChange(input: Omit<SourceAssignment, "id" | "recordState">) {
    try {
      setActionError("");
      await upsertSourceAssignment(input);
      await refreshData();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "Unable to update source role.");
    }
  }

  function openHistory(entityType: string, entityId: string, label: string) {
    setHistoryTarget({ entityType, entityId, label });
  }

  suppliers = data.suppliers;
  models = data.models;
  items = data.items;
  drawingSets = data.drawingSets;
  projects = data.projects;
  quotes = data.quotes;
  quoteCaseLinks = data.quoteCaseLinks ?? [];
  sourceAssignments = data.sourceAssignments;
  inspections = data.inspections;
  incomingDefects = data.incomingDefects;
  priceChanges = data.priceChanges;
  purchasePrices = data.purchasePrices;
  files = data.files;
  auditLogs = data.auditLogs;

  return (
    <div className={sidebarCollapsed ? "appShell sidebarCollapsed" : "appShell"}>
      <aside className="sidebar">
        <div className="brandBlock">
          <div className="brandMark">SEG</div>
          <div>
            <strong>Supplier Management</strong>
            <span>Supplier workbench</span>
          </div>
        </div>

        <nav className="navList" aria-label="Main navigation">
          {navItems.map(({ section: item, icon: Icon }) => (
            <button
              className={section === item ? "navButton active" : "navButton"}
              key={item}
              onClick={() => setSection(item)}
              type="button"
              title={item}
            >
              <Icon size={18} />
              <span>{item}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="mainArea">
        <header className="topbar">
          <div>
            <h1>{section}</h1>
          </div>
          <button
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="sidebarToggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            type="button"
          >
            <Menu size={20} />
          </button>
        </header>

        {actionError && <div className="notice errorNotice">{actionError}</div>}
        {section === "Products & Drawings" && (
          <SubTabs
            tabs={["Models & Items", "Packaging Sets"]}
            activeTab={productsTab}
            onChange={(tab) => setProductsTab(tab as ProductsTab)}
          />
        )}
        {section === "Sourcing Workbench" && (
          <SubTabs
            tabs={["Development Cases", "Quotes", "Comparison"]}
            activeTab={sourcingTab}
            onChange={(tab) => setSourcingTab(tab as SourcingTab)}
          />
        )}
        {section === "Pricing" && (
          <SubTabs tabs={["Price Analytics", "Price Changes"]} activeTab={pricingTab} onChange={(tab) => setPricingTab(tab as PricingTab)} />
        )}
        {section === "QC Inspections" && (
          <SubTabs tabs={["Sample Inspections", "Incoming Defects"]} activeTab={qcTab} onChange={(tab) => setQcTab(tab as QCTab)} />
        )}
        {section === "Reports" && (
          <SubTabs tabs={["Scorecard", "Score Settings"]} activeTab={reportsTab} onChange={(tab) => setReportsTab(tab as ReportsTab)} />
        )}

        {loading && <div className="notice">Loading backend data...</div>}
        {error && <div className="notice errorNotice">Backend data issue: {error}. Showing fallback prototype data.</div>}

        {section === "Dashboard" && <Dashboard />}
        {section === "Suppliers" && <Suppliers onAdd={() => setModal("supplier")} onDelete={handleDelete} onEdit={setEditTarget} onHistory={openHistory} onVoid={handleVoid} />}
        {section === "Products & Drawings" && productsTab === "Models & Items" && (
          <ModelsAndItems
            onAddItem={() => setModal("item")}
            onAddModel={() => setModal("model")}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onImportItems={() => setModal("itemImport")}
            onVoid={handleVoid}
          />
        )}
        {section === "Products & Drawings" && productsTab === "Packaging Sets" && (
          <DrawingSets onAdd={() => setModal("drawingSet")} onDelete={handleDelete} onEdit={setEditTarget} onHistory={openHistory} onVoid={handleVoid} />
        )}
        {section === "Sourcing Workbench" && sourcingTab === "Development Cases" && (
          <SourcingProjects
            onSourceRoleChange={handleSourceRoleChange}
            onAdd={() => setModal("project")}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onVoid={handleVoid}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
          />
        )}
        {section === "Sourcing Workbench" && sourcingTab === "Quotes" && (
          <Quotes
            onAdd={() => setModal("quote")}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onQuoteStatusChange={handleQuoteStatusChange}
            onVoid={handleVoid}
            selectedProjectId={selectedProject?.id ?? ""}
          />
        )}
        {section === "Sourcing Workbench" && sourcingTab === "Comparison" && selectedProject && <Comparison projectId={selectedProject.id} />}
        {section === "QC Inspections" && qcTab === "Sample Inspections" && (
          <SampleInspections
            onAdd={() => {
              setInspectionQuoteId(undefined);
              setModal("inspection");
            }}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onRecordQuote={(quoteId) => {
              setInspectionQuoteId(quoteId);
              setModal("inspection");
            }}
            onView={(inspection) => setViewTarget({ type: "inspection", record: inspection })}
            onVoid={handleVoid}
          />
        )}
        {section === "QC Inspections" && qcTab === "Incoming Defects" && (
          <IncomingDefects
            onAdd={() => setModal("incomingDefect")}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onView={(defect) => setViewTarget({ type: "incoming-defect", record: defect })}
            onVoid={handleVoid}
          />
        )}
        {section === "Pricing" && pricingTab === "Price Analytics" && <PriceAnalytics />}
        {section === "Pricing" && pricingTab === "Price Changes" && <PriceChanges onDelete={handleDelete} onEdit={setEditTarget} onHistory={openHistory} onVoid={handleVoid} />}
        {section === "Reports" && reportsTab === "Scorecard" && <Scorecard />}
        {section === "Reports" && reportsTab === "Score Settings" && <ScoreSettings onSaved={refreshData} />}

        {modal === "supplier" && (
          <SupplierModal
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "item" && (
          <ItemModal
            models={data.models}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "model" && (
          <ModelModal
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "itemImport" && (
          <ItemImportModal
            models={data.models}
            onClose={() => setModal(null)}
            onImported={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "project" && (
          <ProjectModal
            data={data}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "drawingSet" && (
          <DrawingSetModal
            data={data}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "quote" && (
          <QuoteModal
            data={data}
            projectId={selectedProject?.id}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "inspection" && (
          <InspectionModal
            data={data}
            projectId={selectedProject?.id}
            quoteId={inspectionQuoteId}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              setInspectionQuoteId(undefined);
              await refreshData();
            }}
          />
        )}
        {modal === "incomingDefect" && (
          <IncomingDefectModal
            data={data}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "priceChange" && (
          <PriceChangeModal
            data={data}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "scoreSettings" && (
          <ScoreSettingsModal
            onClose={() => setModal(null)}
            onSaved={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {editTarget && (
          <EditRecordModal
            target={editTarget}
            onClose={() => setEditTarget(null)}
            onSave={(patch) => handleEditSave(editTarget, patch)}
          />
        )}
        {voidTarget && (
          <VoidRecordModal
            onClose={() => setVoidTarget(null)}
            onVoid={(reason) => confirmVoid(voidTarget, reason)}
            target={voidTarget}
          />
        )}
        {historyTarget && (
          <HistoryModal
            entityId={historyTarget.entityId}
            entityType={historyTarget.entityType}
            label={historyTarget.label}
            onClose={() => setHistoryTarget(null)}
          />
        )}
        {viewTarget && <RecordDetailModal onClose={() => setViewTarget(null)} target={viewTarget} />}
      </main>
    </div>
  );
}

function Dashboard() {
  const activeItems = items.filter((item) => item.recordState !== "Void");
  const activeSuppliers = suppliers.filter((supplier) => supplier.recordState !== "Void");
  const [selectedItemId, setSelectedItemId] = useState(activeItems[0]?.id ?? "");
  useEffect(() => {
    if (!selectedItemId && activeItems[0]) setSelectedItemId(activeItems[0].id);
    if (selectedItemId && !activeItems.some((item) => item.id === selectedItemId)) setSelectedItemId(activeItems[0]?.id ?? "");
  }, [activeItems, selectedItemId]);
  const selectedItem = activeItems.find((item) => item.id === selectedItemId);
  const activeSourceAssignments = sourceAssignments.filter((assignment) => assignment.recordState !== "Void");
  const activeSourceSupplierIds = new Set(activeSourceAssignments.filter((assignment) => isActiveSourceRole(assignment.role)).map((assignment) => assignment.supplierId));
  const activeSupplierCount = activeSourceSupplierIds.size;
  const activeSupplierLeadTimeDays = averageLeadTimeForActiveSourceSuppliers(activeSourceAssignments);
  const selectedQuotes = quotes.filter((quote) => quote.recordState !== "Void" && isSelectedQuote(quote));
  const selectedItemQuotes = selectedItem ? selectedQuotes.filter((quote) => quote.itemId === selectedItem.id) : [];
  const priceTrendRows = buildDashboardPriceTrendRows(selectedItemQuotes);
  const selectedSeries = Array.from(new Set(selectedItemQuotes.map((quote) => supplierName(quote.supplierId))));
  const latestChanges = [...priceChanges]
    .filter((change) => change.recordState !== "Void")
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))
    .slice(0, 4);
  const coverageRiskItems = activeItems.filter((item) => {
    const itemAssignments = activeSourceAssignments.filter((assignment) => assignment.itemId === item.id);
    return itemAssignments.some((assignment) => isActiveSourceRole(assignment.role)) && !itemAssignments.some((assignment) => assignment.role === "Backup");
  });
  const itemSupplierOptions = selectedItem
    ? activeSuppliers.filter((supplier) => supplier.capableItems.includes(selectedItem.type))
    : [];
  const selectedItemAssignments = selectedItem
    ? activeSourceAssignments
        .filter((assignment) => assignment.itemId === selectedItem.id)
        .sort((a, b) => sourceRoleRank(a.role) - sourceRoleRank(b.role) || supplierName(a.supplierId).localeCompare(supplierName(b.supplierId)))
    : [];
  const unassignedCapableSuppliers = selectedItem
    ? itemSupplierOptions.filter((supplier) => !selectedItemAssignments.some((assignment) => assignment.supplierId === supplier.id))
    : [];
  const supplierScoreRows = activeSuppliers.map((supplier) => buildSupplierScorecard(supplier));
  const activeSupplierScoreRows = supplierScoreRows.filter((row) => activeSourceSupplierIds.has(row.supplier.id));
  const activeAverageSupplierScore = averageScore(activeSupplierScoreRows);
  const lowScoreSuppliers = supplierScoreRows.filter((row) => row.score < 55).sort((a, b) => a.score - b.score).slice(0, 4);
  const recentDefectQtyBySupplier = aggregateRecentDefectsBySupplier(90);
  const defectRiskRows = Array.from(recentDefectQtyBySupplier.entries())
    .filter(([, qty]) => qty >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <section className="pageStack">
      <div className="metricGrid">
        <Metric label="Total Suppliers" value={activeSuppliers.length.toString()} sub="all non-deleted supplier records" />
        <Metric label="Active Suppliers" value={activeSupplierCount.toString()} sub="suppliers assigned as primary, secondary, or tertiary" />
        <Metric label="Supplier Average Lead Time" value={activeSupplierLeadTimeDays === undefined ? "-" : `${Math.round(activeSupplierLeadTimeDays)} days`} sub="average quoted lead time for active suppliers" />
        <Metric label="Average Score" value={activeAverageSupplierScore.toString()} sub="average score for active suppliers only" />
      </div>

      <Panel title="Selected item price and coverage">
        <div className="inlineFilter dashboardItemFilter">
          <label>
            Item
            <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
              {activeItems.length === 0 ? (
                <option value="">No active items</option>
              ) : (
                activeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.itemCode} - {item.itemName}
                  </option>
                ))
              )}
            </select>
          </label>
          <strong>{itemSupplierOptions.length} capable suppliers</strong>
        </div>

        <div className="dashboardSplitBody">
          <section className="dashboardSplitSection">
            <h3>Selected quote price trend</h3>
            <div className="chartBox dashboardChart">
              {priceTrendRows.length === 0 ? (
                <EmptyState text="No selected quote price records for this item yet." />
              ) : (
                <ResponsiveContainer height={260} width="100%">
                  <RechartsLineChart data={priceTrendRows} margin={{ top: 10, right: 20, bottom: 4, left: 2 }}>
                    <CartesianGrid stroke="#e7ecee" />
                    <XAxis dataKey="date" tickFormatter={formatMonthTick} />
                    <YAxis domain={dashboardPriceDomain(selectedItemQuotes)} hide />
                    <Tooltip formatter={(value, name) => [formatMoney(Number(value)), String(name)]} labelFormatter={(label) => `Date: ${label}`} />
                    {selectedSeries.map((series, index) => (
                      <Line connectNulls dataKey={series} dot={{ r: 3 }} key={series} stroke={chartColor(index)} strokeWidth={3} type="monotone" />
                    ))}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="dashboardSplitSection">
            <h3>Supplier coverage</h3>
            {selectedItem ? (
              itemSupplierOptions.length === 0 ? (
                <EmptyState text="No supplier is linked to this item type yet." />
              ) : (
                <>
                  {selectedItemAssignments.map((assignment) => (
                    <AlertRow
                      key={assignment.id}
                      title={`${sourceRoleLabel(assignment.role)} - ${supplierName(assignment.supplierId)}`}
                      text={`Effective ${assignment.effectiveFrom}`}
                    />
                  ))}
                  {unassignedCapableSuppliers.map((supplier) => (
                    <AlertRow
                      key={supplier.id}
                      title={`Not assigned - ${supplier.name}`}
                      text={`Capable for ${selectedItem.type}`}
                    />
                  ))}
                </>
              )
            ) : (
              <EmptyState text="Add or approve items to review supplier coverage." />
            )}
          </section>
        </div>
      </Panel>

      <Panel title="Risk watch">
        <div className="riskGroups">
          <RiskGroup title="Score risk">
            {lowScoreSuppliers.length === 0 ? (
              <EmptyState text="No supplier score below 55." />
            ) : (
              lowScoreSuppliers.map((row) => (
                <AlertRow key={`score-${row.supplier.id}`} title={row.supplier.name} text={`Low supplier score: ${row.score} / ${scoreIssueSummary(row)}`} />
              ))
            )}
          </RiskGroup>
          <RiskGroup title="Quality risk">
            {defectRiskRows.length === 0 ? (
              <EmptyState text="No supplier above the recent defect threshold." />
            ) : (
              defectRiskRows.map(([supplierId, qty]) => (
                <AlertRow key={`defect-${supplierId}`} title={supplierName(supplierId)} text={`${qty} incoming defect qty in last 90 days`} />
              ))
            )}
          </RiskGroup>
          <RiskGroup title="Coverage risk">
            {coverageRiskItems.length === 0 ? (
              <EmptyState text="Coverage looks good." />
            ) : (
              <div className="riskSummary">
                <strong>{coverageRiskItems.length} item{coverageRiskItems.length === 1 ? "" : "s"} need backup</strong>
                <span>active sourced items without Backup source</span>
                <div className="riskCodeList">
                  {coverageRiskItems.slice(0, 3).map((item) => <span key={item.id}>{item.itemCode}</span>)}
                  {coverageRiskItems.length > 3 && <span>+{coverageRiskItems.length - 3} more</span>}
                </div>
              </div>
            )}
          </RiskGroup>
          <RiskGroup title="Price risk">
            {latestChanges.length === 0 ? (
              <EmptyState text="No recent price change events." />
            ) : (
              latestChanges.map((change) => (
                <AlertRow
                  key={change.id}
                  title={`${itemCode(change.itemId)} ${change.sourceType.toLowerCase()}`}
                  text={`${supplierName(change.supplierId)} effective ${change.effectiveDate}`}
                />
              ))
            )}
          </RiskGroup>
        </div>
      </Panel>
    </section>
  );
}

function SubTabs({
  activeTab,
  onChange,
  tabs,
}: {
  activeTab: string;
  onChange: (tab: string) => void;
  tabs: string[];
}) {
  return (
    <div className="subTabs" role="tablist">
      {tabs.map((tab) => (
        <button
          className={tab === activeTab ? "subTab active" : "subTab"}
          key={tab}
          onClick={() => onChange(tab)}
          type="button"
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function RiskGroup({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="riskGroup">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Suppliers({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onVoid: VoidHandler;
}) {
  const approvedSuppliers = suppliers.filter((supplier) => supplier.recordState !== "Void");
  return (
    <section className="pageStack">
      <TableToolbar
        action="Add supplier"
        help="Use Edit to update payment terms, W-9, bank/payment info, and capable packaging items."
        onAction={onAdd}
        title="Supplier master"
      />
      <div className="dataGrid supplierGrid">
        {approvedSuppliers.map((supplier) => (
          <article className="recordCard" key={supplier.id}>
            <div className="recordHeader">
              <div>
                <h3>{supplier.name}</h3>
                <p>{supplier.erpVendorId ? `ERP Vendor ID ${supplier.erpVendorId}` : "Pre-ERP supplier record"}</p>
              </div>
              <div className="recordActions">
                <LifecyclePill record={supplier} />
                <RecordMenu
                  canDelete={canDeleteRecord("suppliers", supplier.id)}
                  label={supplier.name}
                  onDelete={() => onDelete("suppliers", supplier.id, supplier.name)}
                  onEdit={() => onEdit({ endpoint: "suppliers", record: supplier })}
                  onHistory={() => onHistory("Supplier", supplier.id, supplier.name)}
                  onVoid={() => onVoid("suppliers", supplier.id, supplier.name)}
                />
              </div>
            </div>
            <div className="fieldGrid">
              <Field label="Location" value={supplierLocation(supplier)} />
              <Field label="Contact" value={supplier.primaryContact} />
              <Field label="Email" value={supplier.email} />
              <Field label="Phone" value={supplier.phone} />
              <Field label="Payment Terms" value={supplier.paymentTerms || "Not set"} />
            </div>
            <TagRow tags={supplier.capableItems} />
            <div className="documentChecks">
              <DocumentCheck ok={supplier.hasW9} label="W-9" fileId={supplier.w9FileId} />
              <DocumentCheck ok={supplier.hasPaymentInfo} label="Payment info" fileId={supplier.paymentInfoFileId} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ModelsAndItems({
  onAddItem,
  onAddModel,
  onDelete,
  onEdit,
  onHistory,
  onImportItems,
  onVoid,
}: {
  onAddItem: () => void;
  onAddModel: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onImportItems: () => void;
  onVoid: VoidHandler;
}) {
  const approvedModels = models.filter((model) => model.recordState !== "Void");
  const [masterView, setMasterView] = useState<"Items" | "Models">("Items");
  const approvedItems = items.filter((item) => item.recordState !== "Void");
  const duplicateItemCodes = findDuplicateItemCodes(items.filter((item) => item.recordState !== "Void"));
  return (
    <section className="pageStack">
      <Panel title="Product master list">
        <div className="itemMasterHeader">
          <div className="itemMasterControls">
            <label className="modelFilterControl">
              View
              <select value={masterView} onChange={(event) => setMasterView(event.target.value as "Items" | "Models")}>
                <option value="Items">Packaging items</option>
                <option value="Models">Models</option>
              </select>
            </label>
          </div>
          <div className="itemMasterActions">
            {masterView === "Items" && (
              <button className="ghostButton" onClick={onImportItems} type="button">
                <FileStack size={16} />
                Import items
              </button>
            )}
            {masterView === "Items" ? (
              <button className="primaryButton" onClick={onAddItem} type="button">
                <Plus size={16} />
                Add item
              </button>
            ) : (
              <button className="primaryButton" onClick={onAddModel} type="button">
                <Plus size={16} />
                Add model
              </button>
            )}
          </div>
        </div>
        <div className="tableScroll">
          {masterView === "Items" ? (
            <table>
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Type</th>
                  <th>Used For</th>
                  <th>UOM</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="stackedCell">
                        <span>{item.itemCode}</span>
                        {duplicateItemCodes.has(item.itemCode.toLowerCase()) && <StatusPill label="Duplicate" />}
                      </div>
                    </td>
                    <td>{item.itemName}</td>
                    <td>{item.type}</td>
                    <td>{item.usedForModels.map(modelName).join(", ")}</td>
                    <td>{item.uom}</td>
                    <td>
                      <div className="tableActions">
                        <LifecyclePill record={item} />
                        <RecordMenu
                          canDelete={canDeleteRecord("items", item.id)}
                          label={item.itemCode}
                          onDelete={() => onDelete("items", item.id, item.itemCode)}
                          onEdit={() => onEdit({ endpoint: "items", record: item })}
                          onHistory={() => onHistory("Item", item.id, item.itemCode)}
                          onVoid={() => onVoid("items", item.id, item.itemCode)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Product Family</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {approvedModels.map((model) => (
                  <tr key={model.id}>
                    <td>{model.name}</td>
                    <td>{model.productFamily}</td>
                    <td>{model.status}</td>
                    <td>{model.notes}</td>
                    <td>
                      <div className="tableActions">
                        <LifecyclePill record={model} />
                        <RecordMenu
                          canDelete={canDeleteRecord("models", model.id)}
                          label={model.name}
                          onDelete={() => onDelete("models", model.id, model.name)}
                          onEdit={() => onEdit({ endpoint: "models", record: model })}
                          onHistory={() => onHistory("Model", model.id, model.name)}
                          onVoid={() => onVoid("models", model.id, model.name)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </section>
  );
}

function DrawingSets({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onVoid: VoidHandler;
}) {
  const [modelFilter, setModelFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"All" | DrawingSet["status"]>("Active");
  const approvedDrawingSets = drawingSets
    .filter((drawingSet) => drawingSet.recordState !== "Void")
    .filter((drawingSet) => modelFilter === "All" || drawingSet.modelId === modelFilter)
    .filter((drawingSet) => statusFilter === "All" || drawingSet.status === statusFilter);
  return (
    <section className="pageStack">
      <TableToolbar
        action="Import packaging set"
        help="A packaging set is one model packaging package: one package PDF can cover multiple items while item-level links remain available for quote and QC."
        onAction={onAdd}
        title="Packaging sets"
      />
      <div className="filterBar">
        <label>
          Model
          <select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}>
            <option value="All">All models</option>
            {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            {["All", "Active", "Superseded", "Draft", "Obsolete"].map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </div>
      {approvedDrawingSets.length === 0 && <EmptyState text="No packaging sets match the selected filters." />}
      {approvedDrawingSets.map((set) => (
        <Panel key={set.id} title={<PackagingSetTitle set={set} />}>
          <div className="packagingSetHeader">
            <div className="packagingSetSummary">
              <Field label="Model" value={modelName(set.modelId)} />
              <Field label="Effective date" value={set.effectiveDate} />
              <Field label="Maintained by" value={set.maintainedBy} />
              <Field label="Covered items" value={`${set.drawingItems.length} included`} />
            </div>
            <div className="recordActions">
              {set.status !== "Active" && <StatusPill label={set.status} />}
              <LifecyclePill record={set} />
              <RecordMenu
                canDelete={canDeleteRecord("drawing-sets", set.id)}
                label={set.name}
                onDelete={() => onDelete("drawing-sets", set.id, set.name)}
                onEdit={() => onEdit({ endpoint: "drawing-sets", record: set })}
                onHistory={() => onHistory("DrawingSet", set.id, set.name)}
                onVoid={() => onVoid("drawing-sets", set.id, set.name)}
              />
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Packaging Type</th>
                <th>Used For</th>
              </tr>
            </thead>
            <tbody>
              {set.drawingItems.map((drawingItem) => {
                const item = itemById(drawingItem.itemId);
                return (
                  <tr key={drawingItem.id}>
                    <td>{item?.itemCode}</td>
                    <td>{item?.itemName}</td>
                    <td>{item?.type}</td>
                    <td>{item?.usedForModels.map(modelName).join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ))}
    </section>
  );
}

function PackagingSetTitle({ set }: { set: DrawingSet }) {
  const title = `${set.name} ${set.revision}`;
  const file = fileRecord(set.packageFileId);
  if (file) {
    return (
      <a className="packagingSetTitleLink" href={fileUrl(file)} rel="noreferrer" target="_blank" title={`Open ${file.fileName}`}>
        {title}
      </a>
    );
  }
  return <span>{title}</span>;
}

function SourcingProjects({
  onSourceRoleChange,
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onVoid,
  selectedProjectId,
  setSelectedProjectId,
}: {
  onSourceRoleChange: (input: Omit<SourceAssignment, "id" | "recordState">) => Promise<void>;
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onVoid: VoidHandler;
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
}) {
  const [caseSearch, setCaseSearch] = useState("");
  const [showCaseResults, setShowCaseResults] = useState(false);
  const [collapsedCaseIds, setCollapsedCaseIds] = useState<string[]>([]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedProjectCollapsed = selectedProject ? collapsedCaseIds.includes(selectedProject.id) : false;
  const filteredProjects = projects
    .filter((project) => project.recordState !== "Void")
    .filter((project) => {
      const query = caseSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        project.name,
        project.caseReason,
        project.type,
        project.openDate,
        ...project.modelIds.map(modelName),
        ...project.supplierIds.map(supplierName),
        ...project.itemIds.map(itemCode),
      ].join(" ").toLowerCase().includes(query);
    });

  return (
    <section className="pageStack">
      <TableToolbar
        action="Create case"
        extraActions={
          <CaseToolbarSearch
            caseSearch={caseSearch}
            filteredProjects={filteredProjects}
            onSearchChange={setCaseSearch}
            onSelect={(project) => {
              setSelectedProjectId(project.id);
              setCaseSearch(project.name);
              setShowCaseResults(false);
            }}
            selectedProjectId={selectedProjectId}
            setShowCaseResults={setShowCaseResults}
            showCaseResults={showCaseResults}
          />
        }
        help="Cases track sourcing progress for a selected model, packaging set, invited suppliers, and included items."
        onAction={onAdd}
        title="Development cases"
      />
      {selectedProject && (
        <Panel
          actions={(
            <>
              {selectedProjectCollapsed && (
                <button
                  aria-label={`Expand ${selectedProject.name}`}
                  className="iconButton"
                  onClick={() => setCollapsedCaseIds((current) => current.filter((id) => id !== selectedProject.id))}
                  type="button"
                >
                  <ChevronDown size={17} />
                </button>
              )}
              <RecordMenu
                canDelete={canDeleteRecord("projects", selectedProject.id)}
                label={selectedProject.name}
                onDelete={() => onDelete("projects", selectedProject.id, selectedProject.name)}
                onEdit={() => onEdit({ endpoint: "projects", record: selectedProject })}
                onHistory={() => onHistory("Case", selectedProject.id, selectedProject.name)}
                onVoid={() => onVoid("projects", selectedProject.id, selectedProject.name)}
              />
            </>
          )}
          key={selectedProject.id}
          title={selectedProject.name}
        >
          {!selectedProjectCollapsed && (
            <>
              <div className="caseSummaryGrid">
                <Field label="Model" value={selectedProject.modelIds.map(modelName).join(", ")} />
                <Field label="Reason" value={selectedProject.caseReason} />
                <Field label="Packaging set" value={drawingSetName(selectedProject.drawingSetId)} />
                <Field label="Open date" value={selectedProject.openDate} />
                <Field label="Suppliers" value={`${caseSupplierIds(selectedProject).length} linked`} />
                <Field label="Drawing items" value={`${selectedProject.itemIds.length} included`} />
              </div>
              <CaseQuoteWorkbench onSourceRoleChange={onSourceRoleChange} project={selectedProject} />
              <div className="caseCollapseFooter">
                <button
                  aria-label={`Collapse ${selectedProject.name}`}
                  className="iconButton"
                  onClick={() => setCollapsedCaseIds((current) => Array.from(new Set([...current, selectedProject.id])))}
                  type="button"
                >
                  <ChevronUp size={17} />
                </button>
              </div>
            </>
          )}
        </Panel>
      )}
    </section>
  );
}

function CaseToolbarSearch({
  caseSearch,
  filteredProjects,
  onSearchChange,
  onSelect,
  selectedProjectId,
  setShowCaseResults,
  showCaseResults,
}: {
  caseSearch: string;
  filteredProjects: AppData["projects"];
  onSearchChange: (value: string) => void;
  onSelect: (project: AppData["projects"][number]) => void;
  selectedProjectId: string;
  setShowCaseResults: (value: boolean) => void;
  showCaseResults: boolean;
}) {
  return (
    <div className="caseToolbarSearch">
      <Search size={16} />
      <input
        onBlur={() => window.setTimeout(() => setShowCaseResults(false), 120)}
        onChange={(event) => {
          onSearchChange(event.target.value);
          setShowCaseResults(true);
        }}
        onFocus={() => setShowCaseResults(true)}
        placeholder="Search case"
        value={caseSearch}
      />
      {caseSearch && (
        <button aria-label="Clear case search" onMouseDown={(event) => event.preventDefault()} onClick={() => onSearchChange("")} type="button">
          x
        </button>
      )}
      {showCaseResults && (
        <div className="caseSearchResults">
          {filteredProjects.length === 0 ? (
            <span className="caseSearchEmpty">No matching case</span>
          ) : (
            filteredProjects.slice(0, 8).map((project) => (
              <button
                className={project.id === selectedProjectId ? "caseSearchResult active" : "caseSearchResult"}
                key={project.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(project)}
                type="button"
              >
                <strong>{project.name}</strong>
                <span>{project.caseReason} - {project.itemIds.length} items, {project.supplierIds.length} suppliers</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Quotes({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onQuoteStatusChange,
  onVoid,
  selectedProjectId,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onQuoteStatusChange: (quoteId: string, status: Quote["status"]) => Promise<void>;
  onVoid: VoidHandler;
  selectedProjectId: string;
}) {
  const [modeFilter, setModeFilter] = useState<"All" | Quote["quoteType"]>("All");
  const [projectFilter, setProjectFilter] = useState(selectedProjectId || "All");
  const [modelFilter, setModelFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"All" | Quote["status"]>("All");

  const filteredQuotes = quotes
    .filter((quote) => quote.recordState !== "Void")
    .filter((quote) => modeFilter === "All" || (modeFilter === "Case-linked" ? quoteHasCaseLink(quote) : !quoteHasCaseLink(quote)))
    .filter((quote) => projectFilter === "All" || quoteAppliesToProject(quote, projectFilter) || (projectFilter === "Standalone" && !quote.projectId))
    .filter((quote) => modelFilter === "All" || quote.modelId === modelFilter)
    .filter((quote) => itemFilter === "All" || quote.itemId === itemFilter)
    .filter((quote) => supplierFilter === "All" || quote.supplierId === supplierFilter)
    .filter((quote) => statusFilter === "All" || quote.status === statusFilter);

  const itemOptions = items.filter((item) => modelFilter === "All" || item.usedForModels.includes(modelFilter));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Add quote"
        extraActions={<button className="ghostButton" onClick={() => exportQuotes(filteredQuotes)} type="button">Export quotes</button>}
        help="Quote Status is edited here. Source Role is decided in Case Progress after QC pass."
        onAction={onAdd}
        title="Quotation entry"
      />
      <Panel title="Quote filters">
        <div className="quoteFilters scorecardFilters">
          <label>
            Quote mode
            <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as typeof modeFilter)}>
              <option>All</option>
              <option>Case-linked</option>
              <option>Standalone</option>
            </select>
          </label>
          <label>
            Case
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="All">All cases</option>
              <option value="Standalone">Standalone only</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelFilter} onChange={(event) => {
              setModelFilter(event.target.value);
              setItemFilter("All");
            }}>
              <option value="All">All models</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option>All</option>
              {quoteStatusOptions.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
      </Panel>
      <Panel title="Item-level quotes, standalone or case-linked">
        <div className="tableScroll">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Item</th>
                <th>Model</th>
                <th>Drawing</th>
                <th>Case Link</th>
                <th>Unit Price</th>
                <th>Effective From</th>
                <th>MOQ</th>
                <th>Lead Time</th>
                <th>Status</th>
                <th>Source Role</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuotes.length === 0 && (
                <tr>
                  <td colSpan={12}><EmptyState text="No quotes match the selected filters." /></td>
                </tr>
              )}
              {filteredQuotes.map((quote) => (
                <tr key={quote.id}>
                  <td>{supplierName(quote.supplierId)}</td>
                  <td>{itemCode(quote.itemId)}</td>
                  <td>{modelName(quote.modelId)}</td>
                  <td>{drawingSetName(quote.drawingSetId)}</td>
                  <td><StatusPill label={quoteCaseLabel(quote, projectFilter)} /></td>
                  <td>{formatMoney(quote.unitPrice)}</td>
                  <td>{quote.effectiveFrom ?? quote.quoteDate}</td>
                  <td>{quote.moq}</td>
                  <td>{quote.leadTime}</td>
                  <td><QuoteStatusSelect quote={quote} onChange={onQuoteStatusChange} /></td>
                  <td><StatusPill label={sourceRoleForQuote(quote) ?? "Not assigned"} /></td>
                  <td>
                    <div className="tableActions">
                      <RecordMenu
                        canDelete={canDeleteRecord("quotes", quote.id)}
                        label={`${supplierName(quote.supplierId)} ${itemCode(quote.itemId)} quote`}
                        onDelete={() => onDelete("quotes", quote.id, "quote")}
                        onEdit={() => onEdit({ endpoint: "quotes", record: quote })}
                        onHistory={() => onHistory("Quote", quote.id, `${supplierName(quote.supplierId)} / ${itemCode(quote.itemId)}`)}
                        onVoid={() => onVoid("quotes", quote.id, "quote")}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function Comparison({ projectId }: { projectId: string }) {
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || projects[0]?.id || "");
  const selectedProject = projects.find((current) => current.id === selectedProjectId);
  const [selectedItemId, setSelectedItemId] = useState(selectedProject?.itemIds[0] ?? "");
  const [serverRows, setServerRows] = useState<ComparisonRow[] | null>(null);
  const [comparisonError, setComparisonError] = useState("");

  useEffect(() => {
    if (projectId) setSelectedProjectId(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!selectedProject) {
      setSelectedItemId("");
      return;
    }
    if (!selectedProject.itemIds.includes(selectedItemId)) {
      setSelectedItemId(selectedProject.itemIds[0] ?? "");
    }
  }, [selectedProject, selectedItemId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setServerRows(null);
      setComparisonError("");
      return;
    }
    let isMounted = true;
    setComparisonError("");
    fetchComparison(selectedProjectId)
      .then((rows) => {
        if (isMounted) setServerRows(rows);
      })
      .catch((requestError) => {
        if (isMounted) {
          setServerRows(null);
          setComparisonError(requestError instanceof Error ? requestError.message : "Unable to load backend comparison.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [selectedProjectId, quotes.length, inspections.length]);

  if (!selectedProject) {
    return (
      <section className="pageStack">
        <Panel title="No case selected">
          <EmptyState text="Create or select a development case before comparing suppliers." />
        </Panel>
      </section>
    );
  }

  const fallbackRows: ComparisonRow[] = selectedProject.itemIds.map((itemId) => {
    const itemQuotes = quotes.filter((quote) => quoteAppliesToProject(quote, selectedProject.id) && quote.itemId === itemId && quote.recordState !== "Void");
    const supplierIds = Array.from(new Set(itemQuotes.map((quote) => quote.supplierId)));
    const itemInspections = inspections.filter((inspection) => inspection.projectId === selectedProject.id && inspection.itemId === itemId && inspection.recordState !== "Void");
    return {
      item: itemById(itemId),
      suppliers: supplierIds.map((supplierId) => ({
        supplier: suppliers.find((supplier) => supplier.id === supplierId),
        quote: itemQuotes
          .filter((quote) => quote.supplierId === supplierId)
          .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate))[0],
        quotes: itemQuotes
          .filter((quote) => quote.supplierId === supplierId)
          .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate)),
        inspection: itemInspections.find((inspection) => inspection.supplierId === supplierId),
      })),
      recommendedSupplierId: null,
    };
  });
  const matrix = serverRows ?? fallbackRows;
  const comparableItemIds = matrix
    .filter((row) => row.suppliers.some((supplier) => (supplier.quotes?.length ?? 0) > 0 || supplier.quote))
    .map((row) => row.item?.id)
    .filter((itemId): itemId is string => Boolean(itemId));
  const effectiveSelectedItemId = comparableItemIds.includes(selectedItemId) ? selectedItemId : comparableItemIds[0] ?? "";
  const selectedRow = matrix.find((row) => row.item?.id === effectiveSelectedItemId)
    ?? fallbackRows.find((row) => row.item?.id === effectiveSelectedItemId);
  return (
    <section className="pageStack">
      {comparisonError && <div className="notice errorNotice">Backend comparison unavailable: {comparisonError}. Showing local fallback.</div>}
      <Panel title="Single item comparison">
        <div className="comparisonFilters">
          <label>
            <span>Display Item</span>
            <select value={effectiveSelectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
              {comparableItemIds.map((itemId) => {
                const item = itemById(itemId);
                return <option key={itemId} value={itemId}>{item ? `${item.itemCode} - ${item.type}` : itemCode(itemId)}</option>;
              })}
            </select>
          </label>
        </div>
        {!selectedRow ? (
          <EmptyState text="No quoted item is available for this case yet." />
        ) : (
          <table className="comparisonTable compactComparison">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Status</th>
              <th>Unit Price</th>
              <th>MOQ</th>
              <th>Lead Time</th>
              <th>Extra Cost</th>
              <th>Payment Terms</th>
              <th>QC Result</th>
              <th>Supplier Score</th>
            </tr>
          </thead>
          <tbody>
            {selectedRow.suppliers.map((cell, cellIndex) => {
              const offerQuotes = cell.quotes?.length ? cell.quotes : cell.quote ? [cell.quote] : [];
              const quote = offerQuotes.find(isSelectedQuote) ?? offerQuotes.find(isSampleRequestedQuote) ?? offerQuotes[0];
              const inspection = quote ? latestInspectionForQuote(quote.id) : cell.inspection;
              const supplier = cell.supplier;
              return (
                <tr key={`single-${supplier?.id ?? quote?.supplierId ?? cellIndex}`}>
                  <td>{supplier?.name ?? "Unknown supplier"}</td>
                  <td>{offerQuotes.length ? <div className="quoteStack">{offerQuotes.map((offer) => <StatusPill key={offer.id} label={offer.status} />)}</div> : <span className="muted">No quote</span>}</td>
                  <td>{offerQuotes.length ? <QuoteValueStack quotes={offerQuotes} field="price" /> : "-"}</td>
                  <td>{offerQuotes.length ? <QuoteValueStack quotes={offerQuotes} field="moq" /> : "-"}</td>
                  <td>{offerQuotes.length ? <QuoteValueStack quotes={offerQuotes} field="leadTime" /> : "-"}</td>
                  <td>{offerQuotes.length ? <QuoteValueStack quotes={offerQuotes} field="extraCost" /> : "-"}</td>
                  <td>{supplier?.paymentTerms || "-"}</td>
                  <td>{quote ? qcQueueStatus(quote) : "-"}</td>
                  <td>{supplier ? supplierScore(supplier.id) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </Panel>
    </section>
  );
}

function SampleInspections({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onRecordQuote,
  onView,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onRecordQuote: (quoteId: string) => void;
  onView: (inspection: SampleInspection) => void;
  onVoid: VoidHandler;
}) {
  const [sourceFilter, setSourceFilter] = useState<"All" | "From Quote" | "Standalone">("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [resultFilter, setResultFilter] = useState<"All" | SampleInspection["result"]>("All");
  const sampleRequestedQuotes = quotes.filter((quote) => isSampleRequestedQuote(quote) && quote.recordState !== "Void");
  const queueQuotes = sampleRequestedQuotes.filter((quote) => isQuoteInQcQueue(quote));
  const visibleInspections = inspections
    .filter((inspection) => inspection.recordState !== "Void")
    .filter((inspection) => sourceFilter === "All" || (sourceFilter === "Standalone" ? !inspection.relatedQuoteId : Boolean(inspection.relatedQuoteId)))
    .filter((inspection) => supplierFilter === "All" || inspection.supplierId === supplierFilter)
    .filter((inspection) => itemFilter === "All" || inspection.itemId === itemFilter)
    .filter((inspection) => resultFilter === "All" || inspection.result === resultFilter)
    .sort((a, b) => (b.inspectionDate ?? b.sampleReceivedDate).localeCompare(a.inspectionDate ?? a.sampleReceivedDate));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Add standalone inspection"
        help="Sample Requested quotes enter this queue. Waiting sample and pending inspection are shown in one place."
        onAction={onAdd}
        title="QC sample inspection"
      />
      <Panel title="QC sample queue">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Item</th>
              <th>Quote</th>
              <th>Drawing</th>
              <th>Round</th>
              <th>QC Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {queueQuotes.length === 0 && (
              <tr>
                <td colSpan={7}><EmptyState text="No sample requested quotes are waiting for QC." /></td>
              </tr>
            )}
            {queueQuotes.map((quote) => {
              const latestInspection = latestInspectionForQuote(quote.id);
              const nextRound = latestInspection?.result === "Not Submitted" ? latestInspection.sampleRound : (latestInspection?.sampleRound ?? 0) + 1;
              return (
                <tr key={`qc-queue-${quote.id}`}>
                  <td>{supplierName(quote.supplierId)}</td>
                  <td>{itemCode(quote.itemId)}</td>
                  <td>{formatMoney(quote.unitPrice)} / {quote.effectiveFrom ?? quote.quoteDate}</td>
                  <td>{drawingSetName(quote.drawingSetId)}</td>
                  <td>Round {nextRound}</td>
                  <td><StatusPill label={qcQueueStatus(quote)} /></td>
                  <td>
                    {latestInspection?.result === "Not Submitted" ? (
                      <button className="ghostButton" onClick={() => onEdit({ endpoint: "inspections", record: latestInspection })} type="button">Complete inspection</button>
                    ) : (
                      <button className="ghostButton" onClick={() => onRecordQuote(quote.id)} type="button">{qcQueueActionLabel(quote)}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <Panel title="Inspection records">
        <div className="quoteFilters compactRecordFilters">
          <label>
            Source
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
              <option>All</option>
              <option>From Quote</option>
              <option>Standalone</option>
            </select>
          </label>
          <label>
            Comparison Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.itemCode}</option>)}
            </select>
          </label>
          <label>
            Result
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value as typeof resultFilter)}>
              <option>All</option>
              <option>Pass</option>
              <option>Fail</option>
              <option>Conditional</option>
              <option>Not Submitted</option>
            </select>
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Round</th>
              <th>Received</th>
              <th>Inspected</th>
              <th>Result</th>
              <th>Photos</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleInspections.length === 0 && (
              <tr>
                <td colSpan={8}><EmptyState text="No inspection records match the filters." /></td>
              </tr>
            )}
            {visibleInspections.map((inspection) => {
              return (
                <tr key={`inspection-record-${inspection.id}`}>
                  <td>{inspection.relatedQuoteId ? "From Quote" : "Standalone"}</td>
                  <td>{supplierName(inspection.supplierId)}</td>
                  <td>{itemCode(inspection.itemId)}</td>
                  <td>Round {inspection.sampleRound}</td>
                  <td>{inspection.sampleReceivedDate}</td>
                  <td>{inspection.inspectionDate ?? "Pending"}</td>
                  <td><StatusPill label={inspection.result} /></td>
                  <td><PhotoFileReferences inspection={inspection} /></td>
                  <td>
                    <div className="tableActions">
                      <LifecyclePill record={inspection} />
                      <RecordMenu
                        canDelete={canDeleteRecord("inspections", inspection.id)}
                        label={`${supplierName(inspection.supplierId)} ${itemCode(inspection.itemId)} inspection`}
                        onDelete={() => onDelete("inspections", inspection.id, "inspection")}
                        onEdit={() => onEdit({ endpoint: "inspections", record: inspection })}
                        onHistory={() => onHistory("Inspection", inspection.id, `${supplierName(inspection.supplierId)} / ${itemCode(inspection.itemId)} Round ${inspection.sampleRound}`)}
                        onView={() => onView(inspection)}
                        onVoid={() => onVoid("inspections", inspection.id, "inspection")}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function IncomingDefects({
  onAdd,
  onDelete,
  onEdit,
  onHistory,
  onView,
  onVoid,
}: {
  onAdd: () => void;
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onView: (defect: IncomingDefectRecord) => void;
  onVoid: VoidHandler;
}) {
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [poFilter, setPoFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Pending" | "Complete">("All");
  const [actionFilter, setActionFilter] = useState<"All" | IncomingDefectRecord["defectAction"]>("All");
  const allActiveDefects = incomingDefects
    .filter((defect) => defect.recordState !== "Void")
    .sort((a, b) => b.defectDate.localeCompare(a.defectDate));
  const filteredDefects = allActiveDefects
    .filter((defect) => defect.recordState !== "Void")
    .filter((defect) => supplierFilter === "All" || defect.supplierId === supplierFilter)
    .filter((defect) => itemFilter === "All" || defect.itemId === itemFilter)
    .filter((defect) => !poFilter.trim() || (defect.poNumber ?? "").toLowerCase().includes(poFilter.trim().toLowerCase()))
    .filter((defect) => actionFilter === "All" || defect.defectAction === actionFilter)
    .filter((defect) => statusFilter === "All" || (statusFilter === "Pending" ? isIncomingDefectPendingReceive(defect) : isIncomingDefectComplete(defect)))
    .sort((a, b) => b.defectDate.localeCompare(a.defectDate));
  const pendingReceiveDefects = allActiveDefects.filter((defect) => isIncomingDefectPendingReceive(defect));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Record incoming defect"
        extraActions={<button className="ghostButton" onClick={() => exportIncomingDefectHistory(filteredDefects)} type="button">Export historical record</button>}
        help="Incoming defects track rejected or returned production receipts and feed the supplier Incoming Quality score."
        onAction={onAdd}
        title="Incoming defects and returns"
      />
      <Panel title="Pending receive queue">
        <table className="compactComparison">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>PO Qty</th>
              <th>Received Qty</th>
              <th>Defect Qty</th>
              <th>Pending Qty</th>
              <th>Returned</th>
              <th>Menu</th>
            </tr>
          </thead>
          <tbody>
            {pendingReceiveDefects.length === 0 && (
              <tr>
                <td colSpan={10}><EmptyState text="No replacement receipt is pending." /></td>
              </tr>
            )}
            {pendingReceiveDefects.map((defect) => (
              <tr key={defect.id}>
                <td>{defect.poNumber ?? "-"}</td>
                <td>{defect.defectDate}</td>
                <td>{supplierName(defect.supplierId)}</td>
                <td>{itemCode(defect.itemId)}</td>
                <td>{defect.poQty ?? "-"}</td>
                <td>{incomingDefectCurrentReceivedQty(defect) || "-"}</td>
                <td>{defect.defectQty}</td>
                <td>{incomingDefectPendingQty(defect)}</td>
                <td>{defect.materialReturned ? `Yes${defect.returnDate ? ` / ${defect.returnDate}` : ""}` : "No"}</td>
                <td>
                  <div className="tableActions">
                    <LifecyclePill record={defect} />
                    <RecordMenu
                      canDelete={canDeleteRecord("incoming-defects", defect.id)}
                      label={`${supplierName(defect.supplierId)} ${itemCode(defect.itemId)} incoming defect`}
                      onDelete={() => onDelete("incoming-defects", defect.id, "incoming defect")}
                      onEdit={() => onEdit({ endpoint: "incoming-defects", record: defect })}
                      onHistory={() => onHistory("IncomingDefect", defect.id, `${supplierName(defect.supplierId)} / ${itemCode(defect.itemId)}`)}
                      onView={() => onView(defect)}
                      onVoid={() => onVoid("incoming-defects", defect.id, "incoming defect")}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Incoming defect records">
        <div className="quoteFilters compactRecordFilters">
          <label>
            Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            PO Number
            <input placeholder="Search PO" value={poFilter} onChange={(event) => setPoFilter(event.target.value)} />
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option>All</option>
              <option>Pending</option>
              <option>Complete</option>
            </select>
          </label>
          <label>
            Action
            <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as typeof actionFilter)}>
              <option>All</option>
              <option>Request Credit</option>
              <option>Request Replacement</option>
            </select>
          </label>
        </div>
        <table className="compactComparison">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Defect Type</th>
              <th>Defect Qty</th>
              <th>Action</th>
              <th>Status</th>
              <th>Files</th>
              <th>Menu</th>
            </tr>
          </thead>
          <tbody>
            {filteredDefects.length === 0 && (
              <tr>
                <td colSpan={10}><EmptyState text="No incoming defect records match the filters." /></td>
              </tr>
            )}
            {filteredDefects.map((defect) => (
              <tr key={`defect-record-${defect.id}`}>
                <td>{defect.poNumber ?? "-"}</td>
                <td>{defect.defectDate}</td>
                <td>{supplierName(defect.supplierId)}</td>
                <td>{itemCode(defect.itemId)}</td>
                <td>{defect.defectType}</td>
                <td>{defect.defectQty}</td>
                <td><StatusPill label={incomingDefectActionLabel(defect)} /></td>
                <td><StatusPill label={isIncomingDefectPendingReceive(defect) ? "Pending" : "Complete"} /></td>
                <td><IncomingDefectFiles defect={defect} /></td>
                <td>
                  <div className="tableActions">
                    <button className="ghostButton smallButton" onClick={() => onView(defect)} type="button">View</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function PriceAnalytics() {
  const activeItems = items.filter((item) => isPublishedRecord(item) && item.recordState !== "Void");
  const activeSuppliers = suppliers.filter((supplier) => isPublishedRecord(supplier) && supplier.recordState !== "Void");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(activeItems.slice(0, 3).map((item) => item.id));
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(activeSuppliers.slice(0, 3).map((supplier) => supplier.id));
  const [sourceFilter, setSourceFilter] = useState<"All Quotes" | "Selected Quotes">("Selected Quotes");

  const visibleQuotes = quotes.filter(
    (quote) =>
      quote.recordState !== "Void" &&
      selectedItemIds.includes(quote.itemId) &&
      selectedSupplierIds.includes(quote.supplierId) &&
      (sourceFilter === "All Quotes" || isSelectedQuote(quote)),
  );
  const chartQuotes = visibleQuotes;
  const includeAllQuoteSeries = sourceFilter === "All Quotes";
  const includeSelectedSeries = sourceFilter === "Selected Quotes";
  const seriesNames = Array.from(
    new Set([
      ...(includeAllQuoteSeries ? chartQuotes.map((quote) => `${supplierName(quote.supplierId)} all quotes`) : []),
      ...(includeSelectedSeries ? chartQuotes.filter(isSelectedQuote).map((quote) => `${supplierName(quote.supplierId)} selected`) : []),
    ]),
  );
  const chartRows = buildQuotePriceChartRows(chartQuotes, includeAllQuoteSeries, includeSelectedSeries);
  const detailRows = chartQuotes.map((quote) => ({
      id: quote.id,
      date: quote.effectiveFrom ?? quote.quoteDate,
      source: isSelectedQuote(quote) ? "Selected Quote" : "Quote",
      supplier: supplierName(quote.supplierId),
      item: itemCode(quote.itemId),
      price: quote.unitPrice,
      quantity: quote.moq,
      reference: `${quote.status} - ${quote.projectId ? "Case-linked" : "Standalone"}`,
      record: quote,
    })).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="pageStack">
      <Panel title="Quote price vs selected final price">
        <div className="analyticsFilters">
          <FilterGroup
            items={activeItems.map((item) => ({ id: item.id, label: item.itemCode }))}
            label="Items"
            selectedIds={selectedItemIds}
            setSelectedIds={setSelectedItemIds}
          />
          <FilterGroup
            items={activeSuppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
            label="Vendors"
            selectedIds={selectedSupplierIds}
            setSelectedIds={setSelectedSupplierIds}
          />
          <label className="sourceFilter">
            Source
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
              {["Selected Quotes", "All Quotes"].map((source) => <option key={source}>{source}</option>)}
            </select>
          </label>
        </div>
        <div className="chartBox">
          {chartRows.length === 0 ? (
            <EmptyState text="No price records match the selected filters." />
          ) : (
            <ResponsiveContainer height={320} width="100%">
              <RechartsLineChart data={chartRows} margin={{ top: 12, right: 24, bottom: 6, left: 6 }}>
                <CartesianGrid stroke="#e7ecee" />
                <XAxis dataKey="date" />
                <YAxis domain={priceAnalyticsDomain(chartQuotes)} tickFormatter={(value) => `$${value}`} width={54} />
                <Tooltip formatter={(value) => [formatMoney(Number(value)), "Price"]} />
                <Legend />
                {seriesNames.map((series, index) => (
                  <Line
                    connectNulls
                    dataKey={series}
                    dot={{ r: 3 }}
                    key={series}
                    stroke={chartColor(index)}
                    strokeDasharray={series.endsWith("all quotes") ? "5 5" : undefined}
                    strokeWidth={series.endsWith("selected") ? 3 : 2}
                    type="monotone"
                  />
                ))}
              </RechartsLineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>
      <Panel title="Price detail records">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Vendor</th>
              <th>Item</th>
              <th>Price</th>
              <th>Qty / MOQ</th>
              <th>Reference</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.map((row) => (
              <tr key={`${row.source}-${row.id}`}>
                <td>{row.date}</td>
                <td>{row.source}</td>
                <td>{row.supplier}</td>
                <td>{row.item}</td>
                <td>{formatMoney(row.price)}</td>
                <td>{row.quantity}</td>
                <td>{row.reference}</td>
                <td>
                  <span className="muted">Edit in Quotes</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function PriceChanges({
  onDelete,
  onEdit,
  onHistory,
  onVoid,
}: {
  onDelete: DeleteHandler;
  onEdit: (target: EditTarget) => void;
  onHistory: HistoryHandler;
  onVoid: VoidHandler;
}) {
  const activePriceChanges = priceChanges.filter((change) => change.recordState !== "Void");
  return (
    <section className="pageStack">
      <Panel title="Price change events">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Model</th>
              <th>Item</th>
              <th>Source</th>
              <th>Previous Ref</th>
              <th>Source Ref</th>
              <th>Old</th>
              <th>New</th>
              <th>Change</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {activePriceChanges.length === 0 && (
              <tr>
                <td colSpan={12}><EmptyState text="Price change events will appear when a selected quote changes the effective price history." /></td>
              </tr>
            )}
            {activePriceChanges.map((change) => {
              const percent = ((change.newPrice - change.oldPrice) / change.oldPrice) * 100;
              return (
                <tr key={change.id}>
                  <td>{supplierName(change.supplierId)}</td>
                  <td>{modelName(change.modelId)}</td>
                  <td>{itemCode(change.itemId)}</td>
                  <td>{change.sourceType}</td>
                  <td>{priceChangeReference(change.previousQuoteId, change.previousPurchasePriceId)}</td>
                  <td>{priceChangeReference(change.sourceQuoteId, change.sourcePurchasePriceId)}</td>
                  <td>{formatMoney(change.oldPrice)}</td>
                  <td>{formatMoney(change.newPrice)}</td>
                  <td className={percent < 0 ? "positive" : "negative"}>{percent.toFixed(1)}%</td>
                  <td>{change.reason}</td>
                  <td><StatusPill label={change.status} /></td>
                  <td>
                    <div className="tableActions">
                      <LifecyclePill record={change} />
                      <RecordMenu
                        canDelete={canDeleteRecord("price-changes", change.id)}
                        label={`${supplierName(change.supplierId)} ${itemCode(change.itemId)} price change`}
                        onDelete={() => onDelete("price-changes", change.id, "price change")}
                        onEdit={() => onEdit({ endpoint: "price-changes", record: change })}
                        onHistory={() => onHistory("PriceChange", change.id, `${supplierName(change.supplierId)} / ${itemCode(change.itemId)} price change`)}
                        onVoid={() => onVoid("price-changes", change.id, "price change")}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function QuoteTrend() {
  const groups = Array.from(
    quotes.reduce((map, quote) => {
      const key = `${quote.supplierId}::${quote.itemId}`;
      const current = map.get(key) ?? [];
      current.push(quote);
      map.set(key, current);
      return map;
    }, new Map<string, Quote[]>()),
  ).map(([key, groupQuotes]) => {
    const [supplierId, itemId] = key.split("::");
    const sortedQuotes = [...groupQuotes].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
    const prices = sortedQuotes.map((quote) => quote.unitPrice);
    const relatedChanges = priceChanges.filter((change) => change.supplierId === supplierId && change.itemId === itemId);
    return {
      supplierId,
      itemId,
      firstQuote: sortedQuotes[0],
      latestQuote: sortedQuotes[sortedQuotes.length - 1],
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      quoteCount: sortedQuotes.length,
      relatedChanges,
    };
  });

  return (
    <section className="pageStack">
      <Panel title="Supplier + item quote trend">
        <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Item</th>
              <th>Quotes</th>
              <th>First Quote</th>
              <th>Latest Quote</th>
              <th>Lowest</th>
              <th>Highest</th>
              <th>Price Changes</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={`${group.supplierId}-${group.itemId}`}>
                <td>{supplierName(group.supplierId)}</td>
                <td>{itemCode(group.itemId)}</td>
                <td>{group.quoteCount}</td>
                <td>{group.firstQuote.quoteDate} - {formatMoney(group.firstQuote.unitPrice)}</td>
                <td>{group.latestQuote.quoteDate} - {formatMoney(group.latestQuote.unitPrice)}</td>
                <td>{formatMoney(group.minPrice)}</td>
                <td>{formatMoney(group.maxPrice)}</td>
                <td>{group.relatedChanges.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Quote history">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Supplier</th>
              <th>Item</th>
              <th>Model</th>
              <th>Type</th>
              <th>Reason</th>
              <th>Unit Price</th>
              <th>Previous Quote</th>
            </tr>
          </thead>
          <tbody>
            {[...quotes]
              .sort((a, b) => b.quoteDate.localeCompare(a.quoteDate))
              .map((quote) => (
                <tr key={quote.id}>
                  <td>{quote.quoteDate}</td>
                  <td>{supplierName(quote.supplierId)}</td>
                  <td>{itemCode(quote.itemId)}</td>
                  <td>{modelName(quote.modelId)}</td>
                  <td>{quote.quoteType}</td>
                  <td>{quote.quoteReason}</td>
                  <td>{formatMoney(quote.unitPrice)}</td>
                  <td>{quoteLabel(quote.previousQuoteId)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function Scorecard() {
  const [serverRows, setServerRows] = useState<ScorecardRow[] | null>(null);
  const [scorecardError, setScorecardError] = useState("");
  const [itemFilter, setItemFilter] = useState("All");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(() => suppliers.map((supplier) => supplier.id));
  const [featuredSupplierId, setFeaturedSupplierId] = useState(suppliers[0]?.id ?? "");
  const [sortBy, setSortBy] = useState<ScorecardSortKey>("Score");

  useEffect(() => {
    let isMounted = true;
    setScorecardError("");
    fetchScorecard()
      .then((response) => {
        if (isMounted) setServerRows(response.rows);
      })
      .catch((requestError) => {
        if (isMounted) {
          setServerRows(null);
          setScorecardError(requestError instanceof Error ? requestError.message : "Unable to load backend scorecard.");
        }
      });
    return () => {
      isMounted = false;
    };
  }, [suppliers.length, quotes.length, inspections.length, incomingDefects.length]);

  const fallbackRows: ScorecardRow[] = useMemo(() => suppliers.map((supplier) => buildSupplierScorecard(supplier)), [suppliers.length, quotes.length, inspections.length, incomingDefects.length]);
  const allRows = serverRows ?? fallbackRows;
  useEffect(() => {
    const availableIds = allRows.map((row) => row.supplier.id);
    if (!featuredSupplierId && availableIds[0]) setFeaturedSupplierId(availableIds[0]);
    if (featuredSupplierId && !availableIds.includes(featuredSupplierId) && availableIds[0]) setFeaturedSupplierId(availableIds[0]);
    setSelectedSupplierIds((current) => {
      const visible = current.filter((id) => availableIds.includes(id));
      return visible.length > 0 ? visible : availableIds;
    });
  }, [allRows, featuredSupplierId]);
  const itemScopedRows = useMemo(() => allRows.filter((row) => {
    const item = itemFilter === "All" ? undefined : items.find((candidate) => candidate.id === itemFilter);
    return !item || row.supplier.capableItems.includes(item.type);
  }), [allRows, itemFilter]);
  const itemScopedSupplierIds = itemScopedRows.map((row) => row.supplier.id);
  const comparisonSelectedSupplierIds = selectedSupplierIds.filter((id) => itemScopedSupplierIds.includes(id));
  const rows = itemScopedRows
    .filter((row) => comparisonSelectedSupplierIds.includes(row.supplier.id))
    .sort((a, b) => scorecardSortValue(b, sortBy) - scorecardSortValue(a, sortBy));
  const featuredRow = allRows.find((row) => row.supplier.id === featuredSupplierId) ?? allRows[0];
  const featuredCategories = featuredRow ? sortedScoreCategories(featuredRow) : [];

  return (
    <section className="pageStack">
      {scorecardError && <div className="notice errorNotice">Backend scorecard unavailable: {scorecardError}. Showing local fallback.</div>}
      {featuredRow && (
        <Panel
          help="Scorecard compares suppliers with configurable KPI weights. Quality is one KPI with Sample Quality and Incoming Quality as detail lines."
          title={(
            <span className="inlineTitleSelect">
              Supplier score -
              <select aria-label="Select supplier score vendor" value={featuredRow.supplier.id} onChange={(event) => setFeaturedSupplierId(event.target.value)}>
                {allRows.map((row) => <option key={row.supplier.id} value={row.supplier.id}>{row.supplier.name}</option>)}
              </select>
            </span>
          )}
        >
          <div className="scoreSummary">
            <div className="scoreDonutBlock">
              <ScoreDonut row={featuredRow} />
              <div className="scoreLegend">
                {featuredCategories.map((category) => (
                  <span key={category.key}>
                    <i style={{ background: scoreCategoryColor(category.key) }} />
                    {category.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="scoreBreakdown">
              <table className="scoreBreakdownTable">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Score</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {featuredCategories.map((category) => (
                    <tr key={category.key}>
                      <td>{category.label}</td>
                      <td><ScoreCell category={category} /></td>
                      <td>
                        {category.children?.length ? (
                          category.children.map((child) => (
                            <span className="scoreDetailLine" key={child.key}>{child.label}: {child.score}/{child.max} - {child.detail}</span>
                          ))
                        ) : (
                          <span className="scoreDetailLine">{category.detail}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Supplier comparison">
        <div className="quoteFilters scorecardFilters comparisonScoreFilters">
          <label>
            Product / Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <FilterGroup
            items={itemScopedRows.map((row) => ({ id: row.supplier.id, label: row.supplier.name }))}
            label="Supplier"
            selectedIds={comparisonSelectedSupplierIds}
            setSelectedIds={setSelectedSupplierIds}
          />
          <label>
            Sort By
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ScorecardSortKey)}>
              {scorecardSortOptions.map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
        </div>
        <div className="tableScroll">
          <table>
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Supply Scope</th>
              <th>Quality</th>
              <th>Pricing</th>
              <th>Response</th>
              <th>Scope Fit</th>
              <th>Lead Time</th>
              <th>Key Issues</th>
              <th>Score</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10}><EmptyState text="No suppliers match the selected scorecard filters." /></td>
              </tr>
            )}
            {rows.map(({ supplier, score, documentsComplete, grade, categories, scopeLabel }) => {
              const categoryMap = Object.fromEntries(categories.map((category) => [category.key, category])) as Record<
                ScorecardRow["categories"][number]["key"],
                ScorecardRow["categories"][number]
              >;
              return (
                <tr key={supplier.id}>
                  <td>{supplier.name}</td>
                  <td>{scopeLabel}</td>
                  <td><ScoreCell category={categoryMap.quality} /></td>
                  <td><ScoreCell category={categoryMap.pricing} /></td>
                  <td><ScoreCell category={categoryMap.responsiveness} /></td>
                  <td><ScoreCell category={categoryMap.scope} /></td>
                  <td><ScoreCell category={categoryMap.setup} /></td>
                  <td>{scoreIssueSummary({ supplier, score, documentsComplete, grade, categories, scopeLabel } as ScorecardRow)}</td>
                  <td><strong>{score}</strong></td>
                  <td>{grade}</td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}

function ScoreCell({ category }: { category?: ScorecardRow["categories"][number] }) {
  if (!category) return <span className="muted">Not scored</span>;
  return (
    <span className="scoreCell" title={category.detail}>
      <strong>{category.score}</strong>
      <span>/{category.max}</span>
    </span>
  );
}

function ScoreDonut({ row }: { row: ScorecardRow }) {
  const segments = scoreDonutSegments(row);
  return (
    <div className="scoreDonut" style={{ "--segments": segments } as CSSProperties}>
      <div>
        <strong>{row.score}</strong>
        <span>{row.grade}</span>
      </div>
    </div>
  );
}

function averageScore(rows: ScorecardRow[]) {
  if (rows.length === 0) return 0;
  return Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length);
}

function bestScore(rows: ScorecardRow[]) {
  return rows.reduce((best, row) => Math.max(best, row.score), 0);
}

function bestSupplierName(rows: ScorecardRow[]) {
  const best = [...rows].sort((a, b) => b.score - a.score)[0];
  return best ? best.supplier.name : "no visible suppliers";
}

function scorecardSortValue(row: ScorecardRow, sortBy: ScorecardSortKey) {
  if (sortBy === "Score") return row.score;
  const keyBySort: Record<Exclude<ScorecardSortKey, "Score">, ScorecardRow["categories"][number]["key"]> = {
    Quality: "quality",
    Pricing: "pricing",
    Responsiveness: "responsiveness",
    "Scope Fit": "scope",
    "Lead Time": "setup",
  };
  return row.categories.find((category) => category.key === keyBySort[sortBy])?.score ?? 0;
}

function scoreIssueSummary(row: ScorecardRow) {
  const issues: string[] = [];
  const quality = row.categories.find((category) => category.key === "quality");
  const pricing = row.categories.find((category) => category.key === "pricing");
  const response = row.categories.find((category) => category.key === "responsiveness");
  const scope = row.categories.find((category) => category.key === "scope");
  const leadTime = row.categories.find((category) => category.key === "setup");
  const sampleQuality = quality?.children?.find((child) => child.key === "sampleQuality");
  const incomingQuality = quality?.children?.find((child) => child.key === "incomingQuality");
  const supplierDefectQty = incomingDefects
    .filter((defect) => defect.supplierId === row.supplier.id && defect.recordState !== "Void" && isWithinRecentDays(defect.defectDate, 90))
    .reduce((sum, defect) => sum + defect.defectQty, 0);

  if (sampleQuality && sampleQuality.score === 0) issues.push("No QC pass");
  if (incomingQuality && incomingQuality.score < incomingQuality.max && supplierDefectQty > 0) issues.push(`${supplierDefectQty} defect qty`);
  if (pricing && pricing.score < pricing.max * 0.35) issues.push("Not price competitive");
  if (response && response.score < response.max * 0.5) issues.push("Weak response data");
  if (scope && scope.score < scope.max * 0.6) issues.push("Scope not proven");
  if (leadTime && leadTime.score < leadTime.max * 0.5) issues.push("Long lead time");
  if (issues.length === 0) return "None";
  return issues.slice(0, 3).join(", ");
}

function averageCategoryScore(rows: ScorecardRow[], key: ScorecardRow["categories"][number]["key"]) {
  if (rows.length === 0) return "0/0";
  const totals = rows.reduce(
    (sum, row) => {
      const category = row.categories.find((candidate) => candidate.key === key);
      return {
        score: sum.score + (category?.score ?? 0),
        max: sum.max + (category?.max ?? 0),
      };
    },
    { score: 0, max: 0 },
  );
  return `${Math.round(totals.score / rows.length)}/${Math.round(totals.max / rows.length)}`;
}

function aggregateRecentDefectsBySupplier(days: number) {
  const map = new Map<string, number>();
  for (const defect of incomingDefects.filter((record) => record.recordState !== "Void" && isWithinRecentDays(record.defectDate, days))) {
    map.set(defect.supplierId, (map.get(defect.supplierId) ?? 0) + defect.defectQty);
  }
  return map;
}

function scoreDonutSegments(row: ScorecardRow) {
  let cursor = 0;
  const segments = sortedScoreCategories(row).flatMap((category) => {
    const start = cursor;
    const end = cursor + Math.max(0, Math.min(100, category.score));
    cursor = end;
    return [`${scoreCategoryColor(category.key)} ${start}% ${end}%`];
  });
  segments.push(`#eef0f3 ${cursor}% 100%`);
  return `conic-gradient(${segments.join(", ")})`;
}

function sortedScoreCategories(row: ScorecardRow) {
  return [...row.categories].sort((a, b) => b.max - a.max || b.score - a.score);
}

function scoreCategoryColor(key: ScorecardRow["categories"][number]["key"]) {
  const colors: Record<ScorecardRow["categories"][number]["key"], string> = {
    quality: "#d71920",
    pricing: "#25282d",
    responsiveness: "#c84d52",
    scope: "#6b7280",
    setup: "#8f2b31",
  };
  return colors[key];
}

function ScoreSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const [weights, setWeights] = useState<ScoreWeights>({
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  });
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const qualityTotal = weights.sampleQuality + weights.incomingQuality;

  useEffect(() => {
    let isMounted = true;
    fetchScorecard()
      .then((response) => {
        if (isMounted) setWeights(response.weights);
      })
      .catch((requestError) => {
        if (isMounted) setSettingsError(requestError instanceof Error ? requestError.message : "Unable to load score settings.");
      });
    return () => {
      isMounted = false;
    };
  }, []);

  function updateWeight(key: keyof ScoreWeights, value: number) {
    setWeights((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (total !== 100) {
      setSettingsError("Score weights must add up to 100.");
      return;
    }
    setSaving(true);
    setSettingsError("");
    setSavedMessage("");
    try {
      await updateScoreWeights(weights);
      setSavedMessage("KPI weights saved.");
      await onSaved();
    } catch (requestError) {
      setSettingsError(requestError instanceof Error ? requestError.message : "Unable to save score settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pageStack">
      {settingsError && <div className="notice errorNotice">{settingsError}</div>}
      {savedMessage && <div className="notice successNotice">{savedMessage}</div>}
      <Panel
        help="KPI weights control how supplier score is calculated. Quality is shown as one KPI, while sample and incoming quality remain editable sub-weights."
        title="KPI weight settings"
      >
        <div className="scoreSettingsSummary">
          <Metric label="Quality Total" value={qualityTotal.toString()} sub="sample + incoming quality" />
          <Metric label="Other KPI Total" value={(total - qualityTotal).toString()} sub="pricing, response, scope, lead time" />
          <Metric label="Total Weight" value={total.toString()} sub={total === 100 ? "ready to save" : "must equal 100"} />
        </div>
        <div className="scoreSettingsGrid">
          <WeightInput help="Uses QC sample pass/fail rounds. It is a Quality sub-weight, not a standalone KPI column." label="Sample Quality" onChange={(value) => updateWeight("sampleQuality", value)} value={weights.sampleQuality} />
          <WeightInput help="Uses incoming rejected or defect quantity in the last 90 days: under 5 full score, under 10 about 75%, under 20 about 45%, 20+ about 15%." label="Incoming Quality" onChange={(value) => updateWeight("incomingQuality", value)} value={weights.incomingQuality} />
          <WeightInput help="Improves with selected and shortlisted quote history for the supplier." label="Pricing" onChange={(value) => updateWeight("pricing", value)} value={weights.pricing} />
          <WeightInput help="Currently uses quote activity and quoted lead time as the first response proxy." label="Responsiveness" onChange={(value) => updateWeight("responsiveness", value)} value={weights.responsiveness} />
          <WeightInput help="Checks whether the supplier performs within its declared supply scope, without penalizing single-category specialists." label="Scope Fit" onChange={(value) => updateWeight("scopeFit", value)} value={weights.scopeFit} />
          <WeightInput help="Scores quoted lead time. Shorter average lead time earns a higher score." label="Lead Time" onChange={(value) => updateWeight("setup", value)} value={weights.setup} />
        </div>
        <div className="scoreSettingsFooter">
          <strong className={total === 100 ? "positive" : "negative"}>Total {total}</strong>
          <button className="primaryButton" disabled={saving || total !== 100} onClick={save} type="button">
            {saving ? "Saving..." : "Save KPI weights"}
          </button>
        </div>
      </Panel>
    </section>
  );
}

function WeightInput({
  help,
  label,
  onChange,
  readOnly,
  value,
}: {
  help?: string;
  label: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  value: number;
}) {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  function handleChange(rawValue: string) {
    setDraftValue(rawValue);
    if (rawValue !== "") onChange?.(Number(rawValue));
  }

  function handleBlur() {
    if (draftValue === "") {
      setDraftValue("0");
      onChange?.(0);
    }
  }

  return (
    <label className={readOnly ? "weightInput readonly" : "weightInput"}>
      <span>
        {label}
        {help && (
          <span className="helpIcon compactHelpIcon" data-help={help}>
            <CircleHelp size={14} />
          </span>
        )}
      </span>
      <input
        min="0"
        onBlur={handleBlur}
        onChange={(event) => handleChange(event.target.value)}
        readOnly={readOnly}
        step="1"
        type="number"
        value={draftValue}
      />
    </label>
  );
}

function HistoryModal({
  entityId,
  entityType,
  label,
  onClose,
}: {
  entityId: string;
  entityType: string;
  label: string;
  onClose: () => void;
}) {
  const records = auditLogs
    .filter((record) => record.entityType === entityType && record.entityId === entityId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modalPanel historyModal">
        <div className="modalHeader">
          <div>
            <h2>History</h2>
            <p>{label}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {records.length === 0 ? (
          <div className="historyEmpty">
            <EmptyState text="No history has been recorded for this record yet." />
          </div>
        ) : (
          <div className="historyList">
            {records.map((record) => (
              <article className="historyRow" key={record.id}>
                <div className="historyRowHeader">
                  <div>
                    <strong>{record.action}</strong>
                    <span>{formatAuditDate(record.timestamp)} by {record.actor}</span>
                  </div>
                  <StatusPill label={record.source} />
                </div>
                {record.reason && <p className="historyReason">{record.reason}</p>}
                <AuditDiff record={record} />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RecordDetailModal({ onClose, target }: { onClose: () => void; target: ViewTarget }) {
  return (
    <div className="modalBackdrop" role="presentation">
      <section className="modalPanel detailModal">
        <div className="modalHeader">
          <div>
            <h2>{target.type === "inspection" ? "Inspection record" : "Incoming defect record"}</h2>
            <p>{target.type === "inspection" ? `${supplierName(target.record.supplierId)} / ${itemCode(target.record.itemId)}` : `${target.record.poNumber ?? "No PO"} / ${supplierName(target.record.supplierId)}`}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {target.type === "inspection" ? <InspectionRecordDetails inspection={target.record} /> : <IncomingDefectRecordDetails defect={target.record} />}
      </section>
    </div>
  );
}

function InspectionRecordDetails({ inspection }: { inspection: SampleInspection }) {
  const drawingItem = drawingItemForInspection(inspection);
  return (
    <div className="recordDetailStack">
      <div className="fieldGrid large">
        <Field label="Source" value={inspection.relatedQuoteId ? "From Quote" : "Standalone"} />
        <Field label="Supplier" value={supplierName(inspection.supplierId)} />
        <Field label="Item" value={itemCode(inspection.itemId)} />
        <Field label="Model" value={modelName(inspection.modelId)} />
        <Field label="Packaging set" value={drawingSetName(inspection.drawingSetId)} />
        <Field label="Drawing revision" value={drawingItem?.revision ?? "-"} />
        <Field label="Related quote" value={quoteLabel(inspection.relatedQuoteId)} />
        <Field label="Sample round" value={`Round ${inspection.sampleRound}`} />
        <Field label="Sample received" value={inspection.sampleReceivedDate} />
        <Field label="Inspection date" value={inspection.inspectionDate ?? "Pending"} />
        <Field label="Inspector" value={inspection.inspector || "-"} />
        <Field label="Result" value={inspection.result} />
        <Field label="Action" value={inspection.disposition} />
        <Field label="Signed date" value={inspection.signedDate ?? "-"} />
      </div>
      <section className="detailSection">
        <h3>Drawing file</h3>
        <DrawingFileReference drawingItem={drawingItem} drawingSet={drawingSets.find((set) => set.id === inspection.drawingSetId)} />
      </section>
      <section className="detailSection">
        <h3>Problem photos</h3>
        <PhotoFileReferences inspection={inspection} />
      </section>
      <section className="detailSection">
        <h3>Notes</h3>
        <p>{inspection.notes || "-"}</p>
      </section>
    </div>
  );
}

function IncomingDefectRecordDetails({ defect }: { defect: IncomingDefectRecord }) {
  return (
    <div className="recordDetailStack">
      <div className="fieldGrid large">
        <Field label="PO number" value={defect.poNumber ?? "-"} />
        <Field label="Supplier" value={supplierName(defect.supplierId)} />
        <Field label="Item" value={itemCode(defect.itemId)} />
        <Field label="Model" value={defect.modelId ? modelName(defect.modelId) : "-"} />
        <Field label="Defect date" value={defect.defectDate} />
        <Field label="Defect type" value={defect.defectType} />
        <Field label="PO qty" value={String(defect.poQty ?? "-")} />
        <Field label="Original received qty" value={String(defect.receivedQty ?? "-")} />
        <Field label="Defect qty" value={String(defect.defectQty)} />
        <Field label="Action" value={defect.defectAction} />
        <Field label="Pending qty" value={String(incomingDefectPendingQty(defect))} />
        <Field label="Status" value={isIncomingDefectPendingReceive(defect) ? "Pending" : "Complete"} />
        <Field label="Defect material returned" value={defect.materialReturned ? "Yes" : "No"} />
        <Field label="Return date" value={defect.returnDate ?? "-"} />
      </div>
      <section className="detailSection">
        <h3>Replacement timeline</h3>
        {(defect.replacementReceipts ?? []).length === 0 ? (
          <p>{incomingDefectTimeline(defect)}</p>
        ) : (
          <table className="compactComparison">
            <thead>
              <tr>
                <th>Date</th>
                <th>Received Qty</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {(defect.replacementReceipts ?? []).map((receipt, index) => (
                <tr key={`${defect.id}-receipt-${index}`}>
                  <td>{receipt.receivedDate}</td>
                  <td>{receipt.receivedQty}</td>
                  <td><StatusPill label={receipt.result} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="detailSection">
        <h3>Files</h3>
        <IncomingDefectFiles defect={defect} />
      </section>
      <section className="detailSection">
        <h3>Notes</h3>
        <p>{defect.notes || "-"}</p>
      </section>
    </div>
  );
}

function AuditDiff({ record }: { record: AuditLogRecord }) {
  const keys = Array.from(new Set([...Object.keys(record.before ?? {}), ...Object.keys(record.after ?? {})]));
  if (keys.length === 0) return <p className="historyReason">No field-level diff stored.</p>;

  return (
    <div className="historyDiff">
      {keys.map((key) => (
        <div className="historyDiffRow" key={key}>
          <span>{key}</span>
          <strong>{formatAuditValue(record.before?.[key])}</strong>
          <strong>{formatAuditValue(record.after?.[key])}</strong>
        </div>
      ))}
    </div>
  );
}

function VoidRecordModal({
  onClose,
  onVoid,
  target,
}: {
  onClose: () => void;
  onVoid: (reason: string) => Promise<void>;
  target: VoidTarget;
}) {
  const [reason, setReason] = useState("Entered in error");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    await onVoid(reason.trim() || "Entered in error");
    setSaving(false);
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Void record</h2>
            <p>{target.label}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <label className="fullWidthLabel">
          Void reason
          <textarea onChange={(event) => setReason(event.target.value)} rows={3} value={reason} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="dangerButton" disabled={saving} type="submit">
            {saving ? "Voiding..." : "Void record"}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditRecordModal({
  onClose,
  onSave,
  target,
}: {
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  target: EditTarget;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      const patch = buildEditPatch(target, form);
      setSaving(true);
      setFormError("");
      await onSave(patch);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Edit record</h2>
            <p>{editTitle(target)}</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        <div className="formGrid">
          <EditFields target={target} />
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}

function EditFields({ target }: { target: EditTarget }) {
  if (target.endpoint === "suppliers") {
    const record = target.record;
    const [capableItems, setCapableItems] = useState<PackagingItemType[]>(record.capableItems);
    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>Supplier Type<select name="type" defaultValue={record.type}>{["Manufacturer", "Distributor", "Service", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>ERP Vendor ID<input name="erpVendorId" defaultValue={record.erpVendorId ?? ""} /></label>
        <label>Country<input name="country" defaultValue={record.country} /></label>
        <label>Region<input name="region" defaultValue={record.region} /></label>
        <label>Contact<input name="primaryContact" defaultValue={record.primaryContact} /></label>
        <label>Email<input name="email" defaultValue={record.email} /></label>
        <label>Phone<input name="phone" defaultValue={record.phone} /></label>
        <label>Payment Terms<input name="paymentTerms" defaultValue={record.paymentTerms} placeholder="Net 30, Net 45..." /></label>
        <label>W-9<select name="hasW9" defaultValue={record.hasW9 ? "true" : "false"}>{["true", "false"].map((value) => <option key={value} value={value}>{value === "true" ? "Uploaded" : "Missing"}</option>)}</select></label>
        <label>Payment Info<select name="hasPaymentInfo" defaultValue={record.hasPaymentInfo ? "true" : "false"}>{["true", "false"].map((value) => <option key={value} value={value}>{value === "true" ? "Uploaded" : "Missing"}</option>)}</select></label>
        <input name="capableItemsJson" type="hidden" value={JSON.stringify(capableItems)} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={packagingItemOptions.map((item) => ({ id: item, label: item }))}
            label="Capable packaging items"
            selectedIds={capableItems}
            setSelectedIds={setCapableItems}
          />
        </div>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "models") {
    const record = target.record;
    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>Product Family<input name="productFamily" defaultValue={record.productFamily} /></label>
        <label>Status<select name="status" defaultValue={record.status}>{["Active", "Inactive"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "items") {
    const record = target.record;
    const [usedForModels, setUsedForModels] = useState<string[]>(record.usedForModels);
    return (
      <>
        <label>Item Code<input name="itemCode" defaultValue={record.itemCode} required /></label>
        <label>Item Name<input name="itemName" defaultValue={record.itemName} required /></label>
        <label>Type<select name="type" defaultValue={record.type}>{packagingItemOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>UOM<select name="uom" defaultValue={record.uom}>{["pcs", "set", "bundle", "lb", "kg"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Status<select name="status" defaultValue={record.status}>{["Active", "Inactive"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <input name="usedForModelsJson" type="hidden" value={JSON.stringify(usedForModels)} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={models.filter((model) => model.recordState !== "Void").map((model) => ({ id: model.id, label: model.name }))}
            label="Used for models"
            selectedIds={usedForModels}
            setSelectedIds={setUsedForModels}
          />
        </div>
      </>
    );
  }

  if (target.endpoint === "drawing-sets") {
    const record = target.record;
    const modelItems = items.filter((item) => isPublishedRecord(item) && item.usedForModels.includes(record.modelId));
    const syncedDrawingItems = modelItems.map((item) => ({
      itemId: item.id,
      revision: record.revision,
      status: "Active",
      drawingSource: "Package PDF",
    }));
    return (
      <>
        <label>Packaging Set Name<input name="name" defaultValue={record.name} required /></label>
        <label>Effective Date<input name="effectiveDate" defaultValue={record.effectiveDate} type="date" required /></label>
        <label>Maintained By<input name="maintainedBy" defaultValue={record.maintainedBy} /></label>
        <input name="drawingItemsJson" type="hidden" value={JSON.stringify(syncedDrawingItems)} />
        <div className="notice modalNotice fullSpan">
          This packaging set covers all {modelItems.length} active item{modelItems.length === 1 ? "" : "s"} linked to {modelName(record.modelId)}. Import a new packaging set to replace the PDF/version.
        </div>
      </>
    );
  }

  if (target.endpoint === "projects") {
    const record = target.record;
    const [modelId, setModelId] = useState(record.modelIds[0] ?? models[0]?.id ?? "");
    const drawingSetOptions = activeDrawingSetsForModel(drawingSets, modelId, record.drawingSetId);
    const [drawingSetId, setDrawingSetId] = useState(
      drawingSetOptions.some((drawingSet) => drawingSet.id === record.drawingSetId)
        ? record.drawingSetId
        : drawingSetOptions[0]?.id ?? "",
    );
    const selectedDrawingSet = drawingSets.find((drawingSet) => drawingSet.id === drawingSetId);
    const drawingSetItemOptions = selectedDrawingSet?.drawingItems.map((drawingItem) => {
      const item = itemById(drawingItem.itemId);
      return {
        id: drawingItem.itemId,
        label: `${item?.itemCode ?? "Unknown item"} - ${item?.itemName ?? ""} / ${drawingItem.revision}`,
      };
    }) ?? [];
    const [supplierIds, setSupplierIds] = useState<string[]>(record.supplierIds);
    const [itemIds, setItemIds] = useState<string[]>(record.itemIds);

    useEffect(() => {
      const nextDrawingSet = activeDrawingSetsForModel(drawingSets, modelId, record.drawingSetId)[0];
      setDrawingSetId((current) => drawingSetOptions.some((drawingSet) => drawingSet.id === current) ? current : nextDrawingSet?.id ?? "");
    }, [modelId]);

    useEffect(() => {
      const drawingItemIds = drawingSetItemOptions.map((item) => item.id);
      setItemIds((current) => {
        const kept = current.filter((itemId) => drawingItemIds.includes(itemId));
        return kept.length > 0 ? kept : drawingItemIds;
      });
    }, [drawingSetId]);

    return (
      <>
        <label>Name<input name="name" defaultValue={record.name} required /></label>
        <label>
          Model
          <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
            {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
        </label>
        <label>
          Packaging Set
          <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
            {drawingSetOptions.map((drawingSet) => <option key={drawingSet.id} value={drawingSet.id}>{drawingSet.name} {drawingSet.revision}</option>)}
          </select>
        </label>
        <label>
          Reason
          <select name="caseReason" defaultValue={record.caseReason}>
            {["New Supplier Intro", "Change Work Order", "Requote", "Re-source", "Backup Supplier", "Price Check"].map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
        </label>
        <input name="supplierIdsJson" type="hidden" value={JSON.stringify(supplierIds)} />
        <input name="itemIdsJson" type="hidden" value={JSON.stringify(itemIds)} />
        <input name="modelId" type="hidden" value={modelId} />
        <input name="drawingSetId" type="hidden" value={drawingSetId} />
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={suppliers.filter((supplier) => supplier.recordState !== "Void").map((supplier) => ({ id: supplier.id, label: supplier.name }))}
            label="Suppliers linked"
            selectedIds={supplierIds}
            setSelectedIds={setSupplierIds}
          />
        </div>
        <div className="formSection fullSpan">
          <MultiSelectDropdown
            items={drawingSetItemOptions}
            label="Drawing items in this case"
            selectedIds={itemIds}
            setSelectedIds={setItemIds}
          />
        </div>
      </>
    );
  }

  if (target.endpoint === "quotes") {
    const record = target.record;
    return (
      <>
        <label>Unit Price<input min="0" name="unitPrice" defaultValue={record.unitPrice} step="0.001" type="number" required /></label>
        <label>MOQ<input name="moq" defaultValue={record.moq} required /></label>
        <label>Lead Time<input name="leadTime" defaultValue={record.leadTime} required /></label>
        <label>Effective From<input name="effectiveFrom" defaultValue={record.effectiveFrom ?? record.quoteDate} type="date" required /></label>
        <label>Effective To<input name="effectiveTo" defaultValue={record.effectiveTo ?? ""} type="date" /></label>
        <label>Extra Cost Type<select name="extraCostType" defaultValue={record.extraCostType ?? "None"}>{["None", "Freight", "Sample", "Tooling", "Packaging Test", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Extra Cost Amount<input min="0" name="extraCostAmount" defaultValue={record.extraCostAmount ?? 0} step="0.001" type="number" /></label>
        <label>Status<select name="status" defaultValue={record.status}>{quoteStatusOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  if (target.endpoint === "inspections") {
    return <InspectionEditFields record={target.record} />;
  }

  if (target.endpoint === "incoming-defects") {
    return <IncomingDefectEditFields record={target.record} />;
  }

  if (target.endpoint === "purchase-prices") {
    const record = target.record;
    return (
      <>
        <label>PO Number<input name="poNumber" defaultValue={record.poNumber} required /></label>
        <label>Order Date<input name="orderDate" defaultValue={record.orderDate} type="date" required /></label>
        <label>Unit Price<input min="0" name="unitPrice" defaultValue={record.unitPrice} step="0.001" type="number" required /></label>
        <label>Quantity<input min="0" name="quantity" defaultValue={record.quantity} step="1" type="number" required /></label>
        <label>Buyer<input name="buyer" defaultValue={record.buyer} /></label>
        <label>Source<select name="sourceType" defaultValue={record.sourceType}>{["ERP Import", "Manual Import"].map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
      </>
    );
  }

  const record = target.record;
  return (
    <>
      <label>Old Price<input min="0" name="oldPrice" defaultValue={record.oldPrice} step="0.001" type="number" required /></label>
      <label>New Price<input min="0" name="newPrice" defaultValue={record.newPrice} step="0.001" type="number" required /></label>
      <label>Status<select name="status" defaultValue={record.status}>{["Pending", "Approved", "Rejected"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Reason<select name="reason" defaultValue={record.reason}>{["Material", "Freight", "Labor", "Negotiated", "Model Change", "Drawing Change", "Requote", "Change Work Order", "Other"].map((value) => <option key={value}>{value}</option>)}</select></label>
    </>
  );
}

function IncomingDefectEditFields({ record }: { record: IncomingDefectRecord }) {
  const [defectQty, setDefectQty] = useState(String(record.defectQty));
  const [defectAction, setDefectAction] = useState<IncomingDefectRecord["defectAction"]>(record.defectAction ?? "Request Replacement");
  const [materialReturned, setMaterialReturned] = useState(Boolean(record.materialReturned));
  const [replacementReceipts, setReplacementReceipts] = useState<NonNullable<IncomingDefectRecord["replacementReceipts"]>>(record.replacementReceipts ?? []);
  const [newReceiptDate, setNewReceiptDate] = useState("");
  const [newReceiptQty, setNewReceiptQty] = useState("");
  const [newReceiptResult, setNewReceiptResult] = useState<"Accepted" | "Rejected">("Accepted");
  const workingDefect = {
    ...record,
    defectAction,
    defectQty: Number(defectQty) || 0,
    replacementQty: defectAction === "Request Replacement" ? Number(defectQty) || 0 : undefined,
    replacementReceipts,
  };
  const showReplacementReceiptEntry = defectAction === "Request Replacement" && incomingDefectPendingQty(workingDefect) > 0;

  function addReplacementReceipt() {
    if (!newReceiptDate || !newReceiptQty) return;
    setReplacementReceipts((current) => [
      ...current,
      {
        receivedDate: newReceiptDate,
        receivedQty: Number(newReceiptQty),
        result: newReceiptResult,
      },
    ]);
    setNewReceiptDate("");
    setNewReceiptQty("");
    setNewReceiptResult("Accepted");
  }

  return (
    <>
      <label>Defect Date<input name="defectDate" defaultValue={record.defectDate} type="date" required /></label>
      <label>PO Number<input name="poNumber" defaultValue={record.poNumber ?? ""} placeholder="PO001" /></label>
      <label>PO Qty<input min="0" name="poQty" defaultValue={record.poQty ?? ""} step="1" type="number" /></label>
      <label>Defect Type<select name="defectType" defaultValue={record.defectType}>{incomingDefectTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Defect Qty<input min="0" name="defectQty" onChange={(event) => setDefectQty(event.target.value)} step="1" type="number" value={defectQty} required /></label>
      <label>Initial Received Qty<input min="0" name="receivedQty" defaultValue={record.receivedQty ?? ""} step="1" type="number" /></label>
      <label>
        Action
        <select name="defectAction" value={defectAction} onChange={(event) => setDefectAction(event.target.value as IncomingDefectRecord["defectAction"])}>
          {["Request Replacement", "Request Credit"].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      {defectAction === "Request Replacement" && (
        <label>Replacement Qty<input min="0" name="replacementQty" readOnly step="1" type="number" value={defectQty} /></label>
      )}
      <label>Defect Material Returned<select name="materialReturned" value={materialReturned ? "true" : "false"} onChange={(event) => setMaterialReturned(event.target.value === "true")}>{["false", "true"].map((value) => <option key={value} value={value}>{value === "true" ? "Yes" : "No"}</option>)}</select></label>
      {materialReturned && <label>Return Date<input name="returnDate" defaultValue={record.returnDate ?? ""} type="date" /></label>}
      <input name="replacementReceiptsJson" type="hidden" value={JSON.stringify(replacementReceipts)} />
      {defectAction === "Request Replacement" && (
        <div className="formSection fullSpan">
          <strong>Replacement receipts</strong>
          {replacementReceipts.length === 0 ? (
            <p className="muted">No replacement receipt recorded yet.</p>
          ) : (
            <div className="receiptList">
              {replacementReceipts.map((receipt, index) => (
                <div className="receiptRow" key={`${receipt.receivedDate}-${index}`}>
                  <span>Round {index + 1}</span>
                  <strong>{receipt.receivedDate}</strong>
                  <span>{receipt.receivedQty} pcs</span>
                  <StatusPill label={receipt.result} />
                  <button onClick={() => setReplacementReceipts((current) => current.filter((_, candidateIndex) => candidateIndex !== index))} type="button">Remove</button>
                </div>
              ))}
            </div>
          )}
          {showReplacementReceiptEntry && (
            <div className="receiptEntry">
              <div className="receiptEntryGrid">
                <label>Replacement Receive Date<input type="date" value={newReceiptDate} onChange={(event) => setNewReceiptDate(event.target.value)} /></label>
                <label>Received This Time<input min="0" step="1" type="number" value={newReceiptQty} onChange={(event) => setNewReceiptQty(event.target.value)} /></label>
                <label>Result<select value={newReceiptResult} onChange={(event) => setNewReceiptResult(event.target.value as "Accepted" | "Rejected")}><option>Accepted</option><option>Rejected</option></select></label>
              </div>
              <div className="receiptEntryActions">
                <button className="primaryButton" disabled={!newReceiptDate || !newReceiptQty} onClick={addReplacementReceipt} type="button">
                  <Plus size={16} />
                  Add receipt
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
    </>
  );
}

function InspectionEditFields({ record }: { record: SampleInspection }) {
  const [result, setResult] = useState<SampleInspection["result"]>(record.result);
  const showAction = result !== "Pass" && result !== "Not Submitted";
  const defaultAction = result === "Conditional" ? "Conditional Approval" : "Re-sample Required";

  return (
    <>
      <label>
        Result
        <select name="result" value={result} onChange={(event) => setResult(event.target.value as SampleInspection["result"])}>
          {["Pass", "Fail", "Conditional", "Not Submitted"].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      {showAction && (
        <label>
          Action
          <select name="disposition" defaultValue={record.disposition === "Accepted" || record.disposition === "No Further Action" ? defaultAction : record.disposition}>
            {["Re-sample Required", "Conditional Approval"].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
      )}
      <label>Sample Round<input min="1" name="sampleRound" defaultValue={record.sampleRound} step="1" type="number" /></label>
      <label>Sample Received<input name="sampleReceivedDate" defaultValue={record.sampleReceivedDate} type="date" required /></label>
      <label>Inspector<input name="inspector" defaultValue={record.inspector ?? ""} /></label>
      <label>Signed Date<input name="signedDate" defaultValue={record.signedDate ?? ""} type="date" /></label>
      <label className="fullWidthLabel">Notes<textarea name="notes" defaultValue={record.notes} rows={3} /></label>
    </>
  );
}

function buildEditPatch(target: EditTarget, form: FormData) {
  const patch: Record<string, unknown> = {
    recordState: String(form.get("recordState") ?? target.record.recordState ?? "Active"),
    voidReason: String(form.get("voidReason") ?? "") || undefined,
  };
  const setString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "");
  };
  const setOptionalString = (name: string) => {
    if (form.has(name)) patch[name] = String(form.get(name) ?? "") || undefined;
  };
  const setNumber = (name: string) => {
    if (form.has(name)) patch[name] = Number(form.get(name) ?? 0);
  };

  for (const field of ["name", "status", "type", "uom", "erpVendorId", "country", "primaryContact", "email", "phone", "paymentTerms", "region", "notes", "itemCode", "itemName", "productFamily", "revision", "effectiveDate", "effectiveFrom", "moq", "leadTime", "extraCostType", "owner", "result", "disposition", "inspector", "reason", "caseReason", "poNumber", "orderDate", "buyer", "sourceType", "sampleReceivedDate", "defectDate", "defectType", "defectAction", "maintainedBy"]) {
    setString(field);
  }
  for (const field of ["targetCloseDate", "signedDate", "effectiveTo", "returnDate"]) setOptionalString(field);
  for (const field of ["unitPrice", "extraCostAmount", "problemPhotos", "sampleRound", "oldPrice", "newPrice", "quantity", "defectQty"]) setNumber(field);
  if (target.endpoint === "quotes" && form.has("effectiveFrom")) {
    patch.quoteDate = String(form.get("effectiveFrom") ?? "");
    patch.validUntil = undefined;
  }
  if (target.endpoint === "projects") {
    const supplierIdsJson = String(form.get("supplierIdsJson") ?? "[]");
    const itemIdsJson = String(form.get("itemIdsJson") ?? "[]");
    const modelId = String(form.get("modelId") ?? "");
    patch.modelIds = modelId ? [modelId] : target.record.modelIds;
    patch.drawingSetId = String(form.get("drawingSetId") ?? target.record.drawingSetId);
    patch.supplierIds = JSON.parse(supplierIdsJson) as string[];
    patch.itemIds = JSON.parse(itemIdsJson) as string[];
    patch.type = caseTypeForReason(String(patch.caseReason ?? target.record.caseReason) as AppData["projects"][number]["caseReason"]);
  }
  if (target.endpoint === "suppliers") {
    patch.hasW9 = String(form.get("hasW9") ?? "false") === "true";
    patch.hasPaymentInfo = String(form.get("hasPaymentInfo") ?? "false") === "true";
    patch.erpVendorId = String(form.get("erpVendorId") ?? "") || undefined;
    patch.capableItems = JSON.parse(String(form.get("capableItemsJson") ?? "[]")) as PackagingItemType[];
  }
  if (target.endpoint === "items") {
    patch.usedForModels = JSON.parse(String(form.get("usedForModelsJson") ?? "[]")) as string[];
  }
  if (target.endpoint === "drawing-sets" && form.has("drawingItemsJson")) {
    patch.drawingItems = JSON.parse(String(form.get("drawingItemsJson") ?? "[]"));
  }
  if (target.endpoint === "incoming-defects") {
    const replacementReceipts = JSON.parse(String(form.get("replacementReceiptsJson") ?? "[]")) as NonNullable<IncomingDefectRecord["replacementReceipts"]>;
    patch.poQty = String(form.get("poQty") ?? "") ? Number(form.get("poQty")) : undefined;
    patch.receivedQty = String(form.get("receivedQty") ?? "") ? Number(form.get("receivedQty")) : undefined;
    patch.materialReturned = String(form.get("materialReturned") ?? "false") === "true";
    patch.replacementReceipts = replacementReceipts;
    patch.replacementQty =
      patch.defectAction === "Request Replacement"
        ? Number(form.get("replacementQty") ?? form.get("defectQty") ?? 0)
        : undefined;
    patch.actionCompleted = isIncomingDefectComplete({
      defectAction: patch.defectAction as IncomingDefectRecord["defectAction"],
      defectQty: Number(patch.defectQty ?? 0),
      poQty: patch.poQty as number | undefined,
      receivedQty: patch.receivedQty as number | undefined,
      replacementQty: patch.replacementQty as number | undefined,
      replacementReceipts,
    });
    patch.actionCompletedDate = patch.actionCompleted ? String(form.get("returnDate") ?? "") || todayDateString() : undefined;
    if (patch.materialReturned && !patch.returnDate) throw new Error("Return date is required when defect material has been returned.");
  }
  return patch;
}

function editTitle(target: EditTarget) {
  if ("name" in target.record) return target.record.name;
  if ("itemCode" in target.record) return target.record.itemCode;
  if (target.endpoint === "quotes") return `${supplierName(target.record.supplierId)} ${itemCode(target.record.itemId)} quote`;
  return `${supplierName(target.record.supplierId)} ${itemCode(target.record.itemId)}`;
}

function CaseQuoteWorkbench({
  onSourceRoleChange,
  project,
}: {
  onSourceRoleChange: (input: Omit<SourceAssignment, "id" | "recordState">) => Promise<void>;
  project: AppData["projects"][number];
}) {
  const [selectedItemId, setSelectedItemId] = useState("All");
  useEffect(() => {
    if (selectedItemId !== "All" && !project.itemIds.includes(selectedItemId)) setSelectedItemId("All");
  }, [project.id, project.itemIds, selectedItemId]);
  const visibleItemIds = project.itemIds.filter((itemId) => selectedItemId === "All" || itemId === selectedItemId);
  const rows = buildCaseProgressRows(project, visibleItemIds);
  return (
    <div className="caseWorkbench">
      <div className="caseProgressHeader">
        <h3>Case progress</h3>
        <div className="caseProgressFilters">
          <label>
            <span>Item</span>
            <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
              <option value="All">All items</option>
              {project.itemIds.map((itemId) => {
                const item = itemById(itemId);
                return <option key={itemId} value={itemId}>{item ? `${item.itemCode} - ${item.type}` : itemCode(itemId)}</option>;
              })}
            </select>
          </label>
        </div>
      </div>
      <table className="comparisonTable compactComparison">
        <thead>
          <tr>
            {selectedItemId === "All" && <th>Item</th>}
            <th>Supplier</th>
            <th>Quote Status</th>
            <th>Latest Quote</th>
            <th>QC Progress</th>
            <th>Source Role</th>
            <th>Last Update</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={selectedItemId === "All" ? 7 : 6}>
                <EmptyState text="No quote has been requested or recorded for the selected case item." />
              </td>
            </tr>
          )}
          {rows.map((row) => {
            return (
              <tr key={`supplier-progress-${row.itemId}-${row.supplierId}`}>
                {selectedItemId === "All" && (
                  <td>
                    <strong>{row.item ? row.item.itemCode : itemCode(row.itemId)}</strong>
                    <span>{row.item?.type ?? ""}</span>
                  </td>
                )}
                <td className="supplierProgressCell">
                  <strong>{row.supplier?.name ?? "Unknown supplier"}</strong>
                  <span>{row.supplier?.paymentTerms ? `Terms: ${row.supplier.paymentTerms}` : "Payment terms not set"}</span>
                </td>
                <td><StatusPill label={row.quoteLabel} /></td>
                <td>
                  {row.quote ? (
                    <div className="quoteMiniStack">
                      <QuoteMini quote={row.quote} />
                      <span className="muted">{row.quoteLinkLabel}</span>
                    </div>
                  ) : (
                    <span className="muted">{row.inScope ? "No quote" : "Not in supplier scope"}</span>
                  )}
                </td>
                <td><StatusPill label={row.qcLabel} /></td>
                <td>
                  <SourceRoleSelect
                    disabledReason={row.canAssign ? undefined : row.assignDisabledReason}
                    onAssign={(role) => onSourceRoleChange({
                      projectId: project.id,
                      modelId: row.quote?.modelId ?? project.modelIds[0],
                      itemId: row.itemId,
                      supplierId: row.supplierId,
                      sourceQuoteId: row.quote?.id,
                      role,
                      effectiveFrom: row.quote?.effectiveFrom ?? new Date().toISOString().slice(0, 10),
                      notes: "",
                    })}
                    value={row.sourceRole}
                  />
                </td>
                <td>{row.lastUpdate}</td>
            </tr>
          );
        })}
        </tbody>
      </table>
    </div>
  );
}

function caseSupplierIds(project: AppData["projects"][number]) {
  const quotedSupplierIds = quotes
    .filter((quote) => quoteAppliesToProject(quote, project.id) && quote.recordState !== "Void")
    .map((quote) => quote.supplierId);
  return Array.from(new Set([...project.supplierIds, ...quotedSupplierIds]));
}

function buildCaseProgressRows(project: AppData["projects"][number], visibleItemIds: string[]) {
  const rowKeys = new Set(
    quotes
      .filter((quote) =>
        quote.recordState !== "Void" &&
        visibleItemIds.includes(quote.itemId) &&
        quoteAppliesToProject(quote, project.id))
      .map((quote) => `${quote.itemId}::${quote.supplierId}`),
  );

  return Array.from(rowKeys)
    .map((key) => {
      const [itemId, supplierId] = key.split("::");
      return buildCaseProgressRow(project, itemId, supplierId);
    })
    .sort((a, b) =>
      itemCode(a.itemId).localeCompare(itemCode(b.itemId)) ||
      supplierName(a.supplierId).localeCompare(supplierName(b.supplierId)),
    );
}

function buildCaseProgressRow(project: AppData["projects"][number], itemId: string, supplierId: string) {
  const item = itemById(itemId);
  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  const inScope = !item || !supplier || supplier.capableItems.includes(item.type);
  const itemQuotes = quotesForCaseItemSupplier(project, itemId, supplierId);
  const quote = itemQuotes.find(isSelectedQuote) ?? itemQuotes.find(isSampleRequestedQuote) ?? itemQuotes[0];
  const quoteInspections = quote ? inspectionsForQuote(quote.id) : [];
  const latestInspection = quote ? latestCaseInspection(project, quote) : undefined;
  const quoteCaseLink = quote ? quoteCaseLinkFor(quote.id, project.id) : undefined;
  const assignment = sourceAssignments
    .filter((current) =>
      current.recordState !== "Void" &&
      current.projectId === project.id &&
      current.itemId === itemId &&
      current.supplierId === supplierId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const canAssign = Boolean(quote && latestInspection && (latestInspection.result === "Pass" || latestInspection.result === "Conditional"));

  return {
    assignDisabledReason: quote
      ? latestInspection
        ? "QC must pass or be conditional before assigning source role."
        : "QC inspection is required before assigning source role."
      : "Quote is required before assigning source role.",
    canAssign,
    inScope,
    item,
    itemId,
    lastUpdate: latestActivityDate(itemQuotes, quoteInspections),
    qcLabel: quote ? caseQcLabel(project, quote, latestInspection) : "No sample requested",
    quoteCaseLink,
    quoteLinkLabel: quote ? quoteCaseLabel(quote, project.id) : "",
    quote,
    quoteLabel: quote ? quote.status : inScope ? "No quote" : "Not in scope",
    sourceRole: assignment?.role,
    supplier,
    supplierId,
  };
}

function sourceRoleForQuote(quote: Quote) {
  return sourceAssignments.find((assignment) =>
    assignment.recordState !== "Void" &&
    assignment.sourceQuoteId === quote.id)?.role;
}

function sourceRoleRank(role: SourceAssignment["role"]) {
  return { Primary: 1, Secondary: 2, Tertiary: 3, Backup: 4 }[role];
}

function sourceRoleLabel(role: SourceAssignment["role"]) {
  return role === "Backup" ? "Backup pool" : role;
}

function isActiveSourceRole(role: SourceAssignment["role"]) {
  return role === "Primary" || role === "Secondary" || role === "Tertiary";
}

function averageLeadTimeForActiveSourceSuppliers(assignments: SourceAssignment[]) {
  const activeAssignments = assignments.filter((assignment) => assignment.recordState !== "Void" && isActiveSourceRole(assignment.role));
  const quoteIds = new Set(activeAssignments.map((assignment) => assignment.sourceQuoteId).filter(Boolean));
  let sourceQuotes = quotes.filter((quote) => quote.recordState !== "Void" && quoteIds.has(quote.id));
  if (sourceQuotes.length === 0) {
    const supplierIds = new Set(activeAssignments.map((assignment) => assignment.supplierId));
    sourceQuotes = quotes.filter((quote) => quote.recordState !== "Void" && supplierIds.has(quote.supplierId) && isSelectedQuote(quote));
  }
  const leadTimes = sourceQuotes
    .map((quote) => parseLeadTimeDays(quote.leadTime))
    .filter((leadTime): leadTime is number => leadTime !== undefined);
  return leadTimes.length === 0 ? undefined : leadTimes.reduce((sum, leadTime) => sum + leadTime, 0) / leadTimes.length;
}

function QuoteMini({ quote }: { quote: Quote }) {
  return (
    <div className="quoteMini">
      <strong>{formatMoney(quote.unitPrice)}</strong>
      <span>MOQ {quote.moq}</span>
      <span>{quote.effectiveFrom}</span>
    </div>
  );
}

function SourceRoleSelect({
  disabledReason,
  onAssign,
  value,
}: {
  disabledReason?: string;
  onAssign: (role: SourceAssignment["role"]) => Promise<void>;
  value?: SourceAssignment["role"];
}) {
  const [saving, setSaving] = useState(false);
  async function assign(role: SourceAssignment["role"]) {
    if (disabledReason) return;
    setSaving(true);
    await onAssign(role);
    setSaving(false);
  }

  return (
    <label className={disabledReason ? "sourceRoleSelect disabled" : "sourceRoleSelect"} title={disabledReason ?? "Assign source role"}>
      <select
        aria-label="Source role"
        disabled={saving || Boolean(disabledReason)}
        onChange={(event) => void assign(event.target.value as SourceAssignment["role"])}
        value={value ?? ""}
      >
        <option value="">Not assigned</option>
        {(["Primary", "Secondary", "Tertiary", "Backup"] as SourceAssignment["role"][]).map((role) => (
          <option key={role} value={role}>{role}</option>
        ))}
      </select>
    </label>
  );
}

function supplierCaseProgress(project: AppData["projects"][number], supplierId: string, visibleItemIds = project.itemIds) {
  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  const inScopeItemIds = visibleItemIds.filter((itemId) => {
    const item = itemById(itemId);
    return !item || !supplier || supplier.capableItems.includes(item.type);
  });
  const supplierQuotes = quotes.filter(
    (quote) => quoteAppliesToProject(quote, project.id)
      && quote.supplierId === supplierId
      && visibleItemIds.includes(quote.itemId)
      && quote.recordState !== "Void",
  );
  const quotedItemIds = new Set(supplierQuotes.map((quote) => quote.itemId));
  const sampleRequestedQuotes = supplierQuotes.filter(isSampleRequestedQuote);
  const selectedQuotes = supplierQuotes.filter(isSelectedQuote);
  const selectedCount = selectedQuotes.length;
  const pendingQc = sampleRequestedQuotes.filter(isQuoteInQcQueue).length;
  const passedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(quote.id)?.result === "Pass").length;
  const failedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(quote.id)?.result === "Fail").length;

  return {
    lastUpdate: latestActivityDate(supplierQuotes, sampleRequestedQuotes.flatMap((quote) => inspectionsForQuote(quote.id))),
    qcLabel: sampleRequestedQuotes.length === 0
      ? "No sample requested"
      : pendingQc > 0
        ? `${pendingQc} QC pending`
        : failedQc > 0
          ? "Re-sample required"
          : passedQc === sampleRequestedQuotes.length
            ? "QC pass"
            : "QC in review",
    quoteLabel: supplierQuotes.length === 0
      ? "No quote"
      : quotedItemIds.size < inScopeItemIds.length
        ? `${quotedItemIds.size}/${inScopeItemIds.length} quoted`
        : selectedCount > 0
          ? `${selectedCount} selected`
          : "Quote received",
    scopeCount: inScopeItemIds.length,
    selectedCount,
  };
}

function itemCaseProgress(project: AppData["projects"][number], itemId: string, supplierIds: string[]) {
  const item = itemById(itemId);
  const inScopeSupplierIds = supplierIds.filter((supplierId) => {
    const supplier = suppliers.find((candidate) => candidate.id === supplierId);
    return !item || !supplier || supplier.capableItems.includes(item.type);
  });
  const itemQuotes = quotes.filter((quote) => quoteAppliesToProject(quote, project.id) && quote.itemId === itemId && quote.recordState !== "Void");
  const sampleRequestedQuotes = itemQuotes.filter(isSampleRequestedQuote);
  const selectedQuotes = itemQuotes.filter(isSelectedQuote);
  const selectedQuote = selectedQuotes[0];
  const pendingQc = sampleRequestedQuotes.filter(isQuoteInQcQueue).length;
  const passedQc = sampleRequestedQuotes.filter((quote) => latestInspectionForQuote(quote.id)?.result === "Pass").length;

  return {
    inScopeCount: inScopeSupplierIds.length,
    lastUpdate: latestActivityDate(itemQuotes, sampleRequestedQuotes.flatMap((quote) => inspectionsForQuote(quote.id))),
    qcLabel: sampleRequestedQuotes.length === 0
      ? "No sample requested"
      : pendingQc > 0
        ? `${pendingQc} QC pending`
        : passedQc > 0
          ? "QC pass"
          : "QC in review",
    quoteCount: new Set(itemQuotes.map((quote) => quote.supplierId)).size,
    selectedSupplier: selectedQuote ? supplierName(selectedQuote.supplierId) : "-",
  };
}

function latestActivityDate(activityQuotes: Quote[], activityInspections: SampleInspection[]) {
  const dates = [
    ...activityQuotes.map((quote) => quote.effectiveFrom ?? quote.quoteDate),
    ...activityInspections.flatMap((inspection) => [inspection.sampleReceivedDate, inspection.inspectionDate ?? ""]),
  ].filter(Boolean);
  return dates.sort((a, b) => b.localeCompare(a))[0] ?? "-";
}

function latestProjectQuote(projectId: string, supplierId: string, itemId: string) {
  return quotes
    .filter((quote) => quoteAppliesToProject(quote, projectId) && quote.supplierId === supplierId && quote.itemId === itemId && quote.recordState !== "Void")
    .sort((a, b) => b.quoteDate.localeCompare(a.quoteDate))[0];
}

function quoteAppliesToProject(quote: Quote, projectId: string) {
  if (quote.projectId === projectId) return true;
  if (quoteCaseLinks.some((link) => link.recordState !== "Void" && link.projectId === projectId && link.quoteId === quote.id)) return true;
  const project = projects.find((candidate) => candidate.id === projectId);
  const item = itemById(quote.itemId);
  return Boolean(
    project &&
      item &&
      project.supplierIds.includes(quote.supplierId) &&
      project.itemIds.includes(quote.itemId) &&
      item.usedForModels.some((modelId) => project.modelIds.includes(modelId)),
  );
}

function quoteCaseLinkFor(quoteId: string, projectId: string) {
  return quoteCaseLinks.find((link) => link.recordState !== "Void" && link.projectId === projectId && link.quoteId === quoteId);
}

function quoteHasCaseLink(quote: Quote) {
  return Boolean(quote.projectId) || quoteCaseLinks.some((link) => link.recordState !== "Void" && link.quoteId === quote.id);
}

function quoteCaseLabel(quote: Quote, projectFilter = "All") {
  if (projectFilter !== "All" && projectFilter !== "Standalone") {
    return quoteCaseLinkFor(quote.id, projectFilter)?.linkType ?? (quote.projectId === projectFilter ? "Origin Case" : "Reused Existing Quote");
  }
  if (!quote.projectId && !quoteCaseLinks.some((link) => link.recordState !== "Void" && link.quoteId === quote.id)) return "Standalone";
  const originProject = quote.projectId ? projectName(quote.projectId) : "";
  const reusedCount = quoteCaseLinks.filter((link) => link.recordState !== "Void" && link.quoteId === quote.id && link.linkType === "Reused Existing Quote").length;
  if (reusedCount > 0) return originProject ? `Origin + ${reusedCount} reused` : `${reusedCount} reused`;
  return originProject ? "Origin Case" : "Linked";
}

function quotesForCaseItemSupplier(project: AppData["projects"][number], itemId: string, supplierId: string) {
  return quotes
    .filter((quote) =>
      quote.recordState !== "Void" &&
      quote.supplierId === supplierId &&
      quote.itemId === itemId &&
      quoteAppliesToProject(quote, project.id))
    .sort((a, b) => (b.effectiveFrom ?? b.quoteDate).localeCompare(a.effectiveFrom ?? a.quoteDate));
}

function latestCaseInspection(project: AppData["projects"][number], quote: Quote) {
  const directInspection = latestInspectionForQuote(quote.id);
  if (directInspection) return directInspection;
  return inspections
    .filter((inspection) =>
      inspection.recordState !== "Void" &&
      inspection.supplierId === quote.supplierId &&
      inspection.itemId === quote.itemId &&
      inspection.drawingSetId === project.drawingSetId)
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate))
    .slice(-1)[0];
}

function caseQcLabel(project: AppData["projects"][number], quote: Quote, inspection?: SampleInspection) {
  const link = quoteCaseLinkFor(quote.id, project.id);
  if (inspection?.result === "Pass" || inspection?.result === "Conditional") return "Existing QC Pass";
  if (isSampleRequestedQuote(quote)) return qcQueueStatus(quote);
  if (link?.sampleRequirement === "Not Required - Existing QC Pass") return "Existing QC Pass";
  if (link?.sampleRequirement === "Required") return "Sample Required";
  return "No sample requested";
}

function inspectionsForQuote(quoteId: string) {
  return inspections
    .filter((inspection) => inspection.relatedQuoteId === quoteId && inspection.recordState !== "Void")
    .sort((a, b) => a.sampleRound - b.sampleRound || a.sampleReceivedDate.localeCompare(b.sampleReceivedDate));
}

function latestInspectionForQuote(quoteId: string) {
  return inspectionsForQuote(quoteId).slice(-1)[0];
}

function isSampleRequestedQuote(quote: Quote) {
  return quote.status === "Sample Requested";
}

function isSelectedQuote(quote: Quote) {
  return quote.status === "Selected";
}

function isQcCandidateQuote(quote: Quote) {
  return isSampleRequestedQuote(quote) || isSelectedQuote(quote);
}

function isQuoteInQcQueue(quote: Quote) {
  const latestInspection = latestInspectionForQuote(quote.id);
  if (!latestInspection) return true;
  if (latestInspection.result === "Pass" || latestInspection.disposition === "Accepted") return false;
  if (latestInspection.disposition === "No Further Action") return false;
  return true;
}

function qcQueueStatus(quote: Quote) {
  const latestInspection = latestInspectionForQuote(quote.id);
  if (!latestInspection) return "Waiting for Sample";
  if (latestInspection.result === "Not Submitted") return "Pending Inspection";
  if (latestInspection.result === "Fail") return latestInspection.disposition === "No Further Action" ? "Closed Fail" : "Re-sample Required";
  if (latestInspection.result === "Conditional") return "Conditional Review";
  return "QC Pass";
}

function qcQueueActionLabel(quote: Quote) {
  const latestInspection = latestInspectionForQuote(quote.id);
  if (!latestInspection) return "Receive sample";
  if (latestInspection.result === "Fail" && latestInspection.disposition !== "No Further Action") return "Receive next sample";
  return "Record inspection";
}

function defaultDispositionForResult(result: SampleInspection["result"]): SampleInspection["disposition"] {
  if (result === "Pass") return "Accepted";
  if (result === "Fail") return "Re-sample Required";
  if (result === "Conditional") return "Conditional Approval";
  return "Pending";
}

function caseTypeForReason(reason: AppData["projects"][number]["caseReason"]): AppData["projects"][number]["type"] {
  if (reason === "New Supplier Intro") return "New Supplier Development";
  if (reason === "Change Work Order") return "Model Change";
  return reason;
}

function nextInspectionRoundForQuote(quoteId: string) {
  return (latestInspectionForQuote(quoteId)?.sampleRound ?? 0) + 1;
}

function drawingItemForQuote(quote: Quote) {
  return drawingSets.find((set) => set.id === quote.drawingSetId)?.drawingItems.find((drawingItem) => drawingItem.id === quote.drawingItemId);
}

function CaseProgressCell({ inScope = true, inspection, quote }: { inScope?: boolean; inspection?: SampleInspection; quote?: Quote }) {
  if (!quote) {
    return (
      <div className="progressCell">
        <StatusPill label={inScope ? "No quote" : "Not in scope"} />
        <span className="muted">{inScope ? "Waiting for supplier response" : "Supplier capability does not include this item type"}</span>
      </div>
    );
  }

  const progressLabel = isSampleRequestedQuote(quote)
    ? qcQueueStatus(quote)
    : inspection
      ? `QC ${inspection.result}`
      : quote.status;

  return (
    <div className="progressCell">
      <StatusPill label={progressLabel} />
      <span>{quote.quoteDate}</span>
      <small>{quote.status}</small>
    </div>
  );
}

async function uploadOptionalFormFile(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  const file = form.get(fieldName);
  if (!(file instanceof File) || file.size === 0) return undefined;
  return uploadSelectedFile(file, purpose, linkedRecordType);
}

async function uploadMultipleFormFiles(
  form: FormData,
  fieldName: string,
  purpose: UploadedFileRecord["purpose"],
  linkedRecordType?: string,
) {
  const selectedFiles = form.getAll(fieldName).filter((file): file is File => file instanceof File && file.size > 0);
  return Promise.all(selectedFiles.map((file) => uploadSelectedFile(file, purpose, linkedRecordType)));
}

async function uploadSelectedFile(file: File, purpose: UploadedFileRecord["purpose"], linkedRecordType?: string) {
  const contentBase64 = await fileToBase64(file);
  return uploadFile({
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    contentBase64,
    purpose,
    linkedRecordType,
  });
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function SupplierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [capableItems, setCapableItems] = useState<PackagingItemType[]>(["Pallet"]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const w9Upload = await uploadOptionalFormFile(form, "w9File", "Supplier W9", "supplier");
      const paymentInfoUpload = await uploadOptionalFormFile(form, "paymentInfoFile", "Supplier Payment Info", "supplier");
      await createSupplier({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        erpVendorId: String(form.get("erpVendorId") ?? "") || undefined,
        status: "Active",
        type: String(form.get("type") ?? "Manufacturer") as Supplier["type"],
        country: String(form.get("country") ?? "United States"),
        region: String(form.get("region") ?? ""),
        capableItems,
        primaryContact: String(form.get("primaryContact") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? ""),
        paymentTerms: String(form.get("paymentTerms") ?? ""),
        hasW9: Boolean(w9Upload),
        hasPaymentInfo: Boolean(paymentInfoUpload),
        w9FileId: w9Upload?.id,
        paymentInfoFileId: paymentInfoUpload?.id,
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create supplier.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add vendor</h2>
            <p>Pre-ERP suppliers can be created here before they receive an ERP Vendor ID.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        {formError && <div className="formError">{formError}</div>}
        {models.length === 0 && <div className="formError">Create a model before adding items.</div>}

        <div className="formGrid">
          <label>
            Supplier Name
            <input name="name" required placeholder="Example Packaging Inc." />
          </label>
          <label>
            ERP Vendor ID
            <input name="erpVendorId" placeholder="Optional until approved" />
          </label>
          <label>
            Supplier Type
            <select name="type" defaultValue="Manufacturer">
              {["Manufacturer", "Distributor", "Service", "Other"].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <label>
            Country
            <input name="country" defaultValue="United States" />
          </label>
          <label>
            State / Region
            <input name="region" placeholder="TX, OH, CA..." />
          </label>
          <label>
            Primary Contact
            <input name="primaryContact" />
          </label>
          <label>
            Email
            <input name="email" type="email" />
          </label>
          <label>
            Phone
            <input name="phone" />
          </label>
          <label>
            Payment Terms
            <input name="paymentTerms" placeholder="Net 30, Net 45..." />
          </label>
        </div>

        <MultiSelectDropdown
          items={packagingItemOptions.map((item) => ({ id: item, label: item }))}
          label="Capable packaging items"
          selectedIds={capableItems}
          setSelectedIds={setCapableItems}
        />

        <div className="formGrid">
          <label>
            W-9 file
            <input name="w9File" type="file" />
          </label>
          <label>
            Bank / payment info file
            <input name="paymentInfoFile" type="file" />
          </label>
        </div>

        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>

        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save vendor"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ModelModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createModel({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        productFamily: String(form.get("productFamily") ?? "Solar Module"),
        status: String(form.get("status") ?? "Active") as Model["status"],
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create model.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel compactModal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add model</h2>
            <p>Create the module/model first so items and drawings can link to it.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        {formError && <div className="formError">{formError}</div>}

        <div className="formGrid">
          <label>
            Model
            <input name="name" required placeholder="BTA, BTC..." />
          </label>
          <label>
            Product Family
            <input name="productFamily" defaultValue="Solar Module" />
          </label>
          <label>
            Status
            <select name="status" defaultValue="Active">
              {["Active", "Inactive"].map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save model"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemModal({
  models,
  onClose,
  onCreated,
}: {
  models: AppData["models"];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [usedForModels, setUsedForModels] = useState<string[]>(models[0] ? [models[0].id] : []);
  const [itemCode, setItemCode] = useState("");
  const duplicateItem = items.find((item) => item.recordState !== "Void" && item.itemCode.toLowerCase() === itemCode.trim().toLowerCase());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (duplicateItem) {
        throw new Error("This Item Code already exists. Edit the existing item and add more models under Used for models.");
      }
      await createItem({
        itemCode: itemCode.trim(),
        itemName: String(form.get("itemName") ?? ""),
        type: String(form.get("type") ?? "Pallet") as PackagingItemType,
        usedForModels,
        uom: String(form.get("uom") ?? "pcs") as PackagingItem["uom"],
        status: "Active",
        recordState: "Active",
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add packaging item</h2>
            <p>Item Code follows your internal system. One item can be linked to multiple models before packaging sets are built.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>

        {formError && <div className="formError">{formError}</div>}

        <div className="formGrid">
          <label>
            Item Code
            <input name="itemCode" onChange={(event) => setItemCode(event.target.value)} required placeholder="PKG-BTA-..." value={itemCode} />
          </label>
          <label>
            Item Name
            <input name="itemName" required placeholder="BTA Pallet" />
          </label>
          <label>
            Packaging Type
            <select name="type" defaultValue="Pallet">
              {packagingItemOptions.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            UOM
            <select name="uom" defaultValue="pcs">
              {["pcs", "set", "bundle", "lb", "kg"].map((uom) => (
                <option key={uom}>{uom}</option>
              ))}
            </select>
          </label>
        </div>
        {duplicateItem && (
          <div className="formError">
            This Item Code already exists as {duplicateItem.itemName}. Edit that item and select additional models instead of creating a duplicate.
          </div>
        )}

        <MultiSelectDropdown
          items={models.map((model) => ({ id: model.id, label: model.name }))}
          label="Used for models"
          selectedIds={usedForModels}
          setSelectedIds={setUsedForModels}
        />

        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || usedForModels.length === 0 || Boolean(duplicateItem)} type="submit">
            {saving ? "Saving..." : "Save item"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ItemImportModal({
  models,
  onClose,
  onImported,
}: {
  models: AppData["models"];
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof parseItemImportRows>>([]);
  const [rawText, setRawText] = useState("Item Code\tDescription\tType\tUsed for\n");

  function updatePreview(value: string) {
    setRawText(value);
    setPreview(parseItemImportRows(value));
  }

  useEffect(() => {
    setPreview(parseItemImportRows(rawText));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    try {
      const rows = parseItemImportRows(rawText);
      if (rows.length === 0) throw new Error("No import rows found.");
      const result = await importItems({
        rows,
      });
      window.alert([
        "Item import summary",
        `Total rows: ${result.totalRows}`,
        `Duplicated existing Item Code: ${result.duplicated}`,
        `Successfully imported: ${result.created}`,
        `Skipped: ${result.skipped}`,
      ].join("\n"));
      await onImported();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to import items.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Import items</h2>
            <p>Paste Excel columns: Item Code, Description, Type, Used for. Use comma or semicolon to link one item to multiple models. Existing Item Codes are skipped.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <label className="fullWidthLabel">
          Excel rows
          <textarea onChange={(event) => updatePreview(event.target.value)} rows={8} value={rawText} />
        </label>
        <Panel title="Import preview">
          <table>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Description</th>
                <th>Type</th>
                <th>Used For</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={`${row.itemCode}-${row.description}`}>
                  <td>{row.itemCode}</td>
                  <td>{row.description}</td>
                  <td>{row.type}</td>
                  <td>{row.usedFor.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {models.length === 0 && <div className="notice errorNotice">Create a model before importing items.</div>}
        </Panel>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || preview.length === 0} type="submit">
            {saving ? "Importing..." : "Import items"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DrawingSetModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const modelItems = data.items.filter((item) => isPublishedRecord(item) && item.usedForModels.includes(modelId));
  const nextRevision = nextPackagingSetRevision(data.drawingSets, modelId);
  const drawingRows = buildDrawingRowsFromModelItems(modelItems, nextRevision);
  const activeDrawingSet = data.drawingSets.find((drawingSet) => drawingSet.modelId === modelId && drawingSet.status === "Active" && drawingSet.recordState !== "Void");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const drawingSetRevision = nextRevision;
      const drawingPackageUpload = await uploadOptionalFormFile(form, "drawingPackageFile", "Drawing", "drawing-set");
      const drawingItems = drawingRows.map((row) => {
        const item = modelItems.find((candidate) => candidate.itemCode.toLowerCase() === row.itemCode.toLowerCase());
        if (!item) throw new Error(`Item Code is not active for selected model: ${row.itemCode}`);
        return {
          itemId: item.id,
          revision: row.revision || drawingSetRevision,
          status: "Active" as const,
          drawingSource: "Package PDF" as const,
          fileName: undefined,
          fileId: undefined,
        };
      });
      await createDrawingSet({
        recordState: "Active",
        modelId,
        name: String(form.get("name") ?? ""),
        revision: drawingSetRevision,
        status: "Active",
        effectiveDate: String(form.get("effectiveDate") ?? ""),
        maintainedBy: String(form.get("maintainedBy") ?? "Process Engineering"),
        packageFileId: drawingPackageUpload?.id,
        packageFileName: drawingPackageUpload?.fileName,
        replaceActive: true,
        drawingItems,
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to import packaging set.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Import packaging set</h2>
            <p>Upload one package PDF for a model and link the covered items for quote and QC tracking.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        {data.models.length === 0 && <div className="formError">Create a model before importing a packaging set.</div>}
        {data.models.length > 0 && modelItems.length === 0 && (
          <div className="formError">Create at least one item for this model before importing a packaging set.</div>
        )}
        <div className="formGrid packagingImportGrid">
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set Name
            <input name="name" required placeholder="SEG-620-BTC_BG_210R" />
          </label>
          <label>
            Effective Date
            <input name="effectiveDate" required type="date" />
          </label>
          <label>
            Maintained By
            <input name="maintainedBy" defaultValue="Process Engineering" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Package PDF
          <input name="drawingPackageFile" required type="file" />
        </label>
        <div className="notice modalNotice">
          This packaging set will cover all {modelItems.length} active item{modelItems.length === 1 ? "" : "s"} currently linked to {modelName(modelId)}.
        </div>
        {activeDrawingSet && (
          <div className="notice modalNotice">
            Current active package for {modelName(modelId)} is {activeDrawingSet.name} {activeDrawingSet.revision}. The new import will be saved as version {nextRevision} and replace it for user-facing workflow while keeping the old version in audit history.
          </div>
        )}
        <Panel title={`Version ${nextRevision} covers ${drawingRows.length} item${drawingRows.length === 1 ? "" : "s"}`}>
          <table>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Packaging Type</th>
                <th>Used For</th>
              </tr>
            </thead>
            <tbody>
              {drawingRows.map((row) => {
                const item = modelItems.find((candidate) => candidate.itemCode === row.itemCode);
                return (
                <tr key={`${row.itemCode}-${row.revision}-${row.fileName}`}>
                  <td>{row.itemCode}</td>
                  <td>{item?.itemName ?? "-"}</td>
                  <td>{item?.type ?? "-"}</td>
                  <td>{item?.usedForModels.map(modelName).join(", ") ?? "-"}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !modelId || modelItems.length === 0 || drawingRows.length === 0} type="submit">
            {saving ? "Importing..." : "Import packaging set"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const firstModelId = data.models[0]?.id ?? "";
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [modelId, setModelId] = useState(firstModelId);
  const [caseReason, setCaseReason] = useState<AppData["projects"][number]["caseReason"]>("Requote");
  const drawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId);
  const [drawingSetId, setDrawingSetId] = useState(drawingSetOptions[0]?.id ?? "");
  const selectedDrawingSet = data.drawingSets.find((drawingSet) => drawingSet.id === drawingSetId);
  const drawingSetItemOptions = selectedDrawingSet?.drawingItems.map((drawingItem) => {
    const item = data.items.find((candidate) => candidate.id === drawingItem.itemId);
    return {
      id: drawingItem.itemId,
      label: `${item?.itemCode ?? "Unknown item"} - ${item?.itemName ?? ""} / ${drawingItem.revision}`,
    };
  }) ?? [];
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [itemIds, setItemIds] = useState<string[]>(drawingSetItemOptions.map((item) => item.id));

  useEffect(() => {
    const nextDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId)[0];
    setDrawingSetId(nextDrawingSet?.id ?? "");
  }, [data.drawingSets, modelId]);

  useEffect(() => {
    const drawingItemIds = drawingSetItemOptions.map((item) => item.id);
    setItemIds((current) => {
      const kept = current.filter((itemId) => drawingItemIds.includes(itemId));
      return kept.length > 0 ? kept : drawingItemIds;
    });
  }, [drawingSetId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createProject({
        recordState: "Active",
        name: String(form.get("name") ?? ""),
        modelIds: [modelId],
        drawingSetId,
        type: caseTypeForReason(caseReason),
        caseReason,
        status: "Planning",
        supplierIds,
        itemIds,
        owner: "Purchasing",
        openDate: String(form.get("openDate") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create case.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Create development case</h2>
            <p>A case groups one quoting/sample activity, such as change work order, requote, or full package development.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Case Name
            <input name="name" required placeholder="BTA Packaging Local Supplier Development" />
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
          <label>
            Packaging Set
            <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {drawingSetOptions.map((drawingSet) => (
                <option key={drawingSet.id} value={drawingSet.id}>{drawingSet.name} {drawingSet.revision}</option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <select name="caseReason" value={caseReason} onChange={(event) => setCaseReason(event.target.value as AppData["projects"][number]["caseReason"])}>
              {["New Supplier Intro", "Change Work Order", "Requote", "Re-source", "Backup Supplier", "Price Check"].map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </label>
          <label>
            Open Date
            <input name="openDate" required type="date" defaultValue="2026-08-04" />
          </label>
        </div>
        <CheckGroup
          items={data.suppliers.map((supplier) => ({ id: supplier.id, label: supplier.name }))}
          label="Suppliers linked"
          selectedIds={supplierIds}
          setSelectedIds={setSupplierIds}
        />
        <CheckGroup
          items={drawingSetItemOptions}
          label="Drawing items included"
          selectedIds={itemIds}
          setSelectedIds={setItemIds}
        />
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingSetId || itemIds.length === 0} type="submit">
            {saving ? "Saving..." : "Save case"}
          </button>
        </div>
      </form>
    </div>
  );
}

function QuoteModal({
  data,
  projectId,
  onClose,
  onCreated,
}: {
  data: AppData;
  projectId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const project = data.projects.find((candidate) => candidate.id === projectId);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [quoteType, setQuoteType] = useState<Quote["quoteType"]>(project ? "Case-linked" : "Standalone");
  const [modelId, setModelId] = useState(project?.modelIds[0] ?? data.models[0]?.id ?? "");
  const quoteDrawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId, project?.drawingSetId);
  const [drawingSetId, setDrawingSetId] = useState(project?.drawingSetId ?? quoteDrawingSetOptions[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayDateString());
  const drawingSet = data.drawingSets.find((candidate) => candidate.id === drawingSetId);
  const supplierOptions = data.suppliers.filter((supplier) => supplier.recordState !== "Void");
  const projectItems = project?.itemIds.length ? data.items.filter((item) => project.itemIds.includes(item.id)) : data.items.filter((item) => item.usedForModels.includes(modelId));
  const [supplierId, setSupplierId] = useState(supplierOptions[0]?.id ?? "");
  const selectedSupplier = supplierOptions.find((supplier) => supplier.id === supplierId);
  const modelScopedItems = quoteType === "Case-linked" && project ? projectItems : data.items.filter((item) => item.usedForModels.includes(modelId));
  const itemOptions = modelScopedItems.filter((item) =>
    item.recordState !== "Void" &&
    item.status === "Active" &&
    (!selectedSupplier || selectedSupplier.capableItems.includes(item.type)),
  );
  const [itemId, setItemId] = useState(itemOptions[0]?.id ?? "");
  const drawingItemId = drawingSet?.drawingItems.find((drawingItem) => drawingItem.itemId === itemId)?.id ?? "";

  useEffect(() => {
    if (!supplierOptions.some((supplier) => supplier.id === supplierId)) setSupplierId(supplierOptions[0]?.id ?? "");
    if (!itemOptions.some((item) => item.id === itemId)) setItemId(itemOptions[0]?.id ?? "");
    const matchingDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId)[0];
    if (!matchingDrawingSet || drawingSet?.modelId !== modelId) setDrawingSetId(matchingDrawingSet?.id ?? "");
  }, [data.drawingSets, drawingSet?.modelId, drawingSetId, itemId, itemOptions, modelId, supplierId, supplierOptions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (!drawingSet || !drawingItemId) throw new Error("Packaging set and item link must exist first.");
      const attachmentUpload = await uploadOptionalFormFile(form, "attachmentFile", "Quote Attachment", "quote");
      const effectiveFromValue = String(form.get("effectiveFrom") ?? "");
      await createQuote({
        recordState: "Active",
        supplierId,
        projectId: quoteType === "Case-linked" ? project?.id : undefined,
        quoteType,
        quoteReason: String(form.get("quoteReason") ?? "New Quote") as Quote["quoteReason"],
        previousQuoteId: undefined,
        modelId,
        itemId,
        drawingSetId: drawingSet.id,
        drawingItemId,
        quoteDate: effectiveFromValue,
        effectiveFrom: effectiveFromValue,
        effectiveTo: String(form.get("effectiveTo") ?? "") || undefined,
        validUntil: undefined,
        currency: "USD",
        uom: itemById(itemId)?.uom ?? "pcs",
        unitPrice: Number(form.get("unitPrice") ?? 0),
        moq: String(form.get("moq") ?? ""),
        leadTime: String(form.get("leadTime") ?? ""),
        extraCostType: String(form.get("extraCostType") ?? "None") as Quote["extraCostType"],
        extraCostAmount: Number(form.get("extraCostAmount") ?? 0),
        status: String(form.get("status") ?? "Received") as Quote["status"],
        attachmentFileId: attachmentUpload?.id,
        notes: String(form.get("notes") ?? ""),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create quote.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add quote</h2>
            <p>Quotes can be standalone for single-item supplier intro, or linked to a development case.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Quote Mode
            <select value={quoteType} onChange={(event) => setQuoteType(event.target.value as Quote["quoteType"])}>
              <option>Standalone</option>
              <option disabled={!project}>Case-linked</option>
            </select>
          </label>
          <label>
            Quote Reason
            <select name="quoteReason" defaultValue="New Quote">
              {["New Quote", "Requote", "Price Check", "Change Work Order", "Model Change"].map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set
            <select value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId).map((set) => <option key={set.id} value={set.id}>{set.name} {set.revision}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Effective From
            <input name="effectiveFrom" onChange={(event) => setEffectiveFrom(event.target.value)} required type="date" value={effectiveFrom} />
          </label>
          <label>
            Effective To
            <input name="effectiveTo" type="date" />
          </label>
          <label>
            Unit Price USD
            <input min="0" name="unitPrice" required step="0.001" type="number" />
          </label>
          <label>
            MOQ
            <input name="moq" placeholder="100 pcs, 500 pcs, MOQ 1 truckload" required />
          </label>
          <label>
            Lead Time
            <input name="leadTime" placeholder="8 business days, 2-3 weeks, TBD" required />
          </label>
          <label>
            Extra Cost Type
            <select name="extraCostType" defaultValue="None">
              {["None", "Freight", "Sample", "Tooling", "Packaging Test", "Other"].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Extra Cost Amount
            <input min="0" name="extraCostAmount" step="0.001" type="number" defaultValue="0" />
          </label>
          <label>
            Status
            <select name="status" defaultValue="Received">
              {quoteStatusOptions.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
          <label>
            Quote Attachment
            <input name="attachmentFile" type="file" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingItemId} type="submit">
            {saving ? "Saving..." : "Save quote"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InspectionModal({
  data,
  projectId,
  quoteId,
  onClose,
  onCreated,
}: {
  data: AppData;
  projectId?: string;
  quoteId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const sourceQuote = data.quotes.find((quote) => quote.id === quoteId);
  const project = data.projects.find((candidate) => candidate.id === (sourceQuote?.projectId ?? projectId));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [inspectionMode, setInspectionMode] = useState<"Standalone" | "Case-linked">(sourceQuote?.projectId || project ? "Case-linked" : "Standalone");
  const [modelId, setModelId] = useState(sourceQuote?.modelId ?? project?.modelIds[0] ?? data.models[0]?.id ?? "");
  const inspectionDrawingSetOptions = activeDrawingSetsForModel(data.drawingSets, modelId, sourceQuote?.drawingSetId ?? project?.drawingSetId);
  const [drawingSetId, setDrawingSetId] = useState(sourceQuote?.drawingSetId ?? project?.drawingSetId ?? inspectionDrawingSetOptions[0]?.id ?? "");
  const drawingSet = data.drawingSets.find((candidate) => candidate.id === drawingSetId);
  const supplierOptions = inspectionMode === "Case-linked" && project ? data.suppliers.filter((supplier) => caseSupplierIds(project).includes(supplier.id)) : data.suppliers;
  const itemOptions = inspectionMode === "Case-linked" && project ? data.items.filter((item) => project.itemIds.includes(item.id)) : data.items.filter((item) => item.usedForModels.includes(modelId));
  const [supplierId, setSupplierId] = useState(sourceQuote?.supplierId ?? supplierOptions[0]?.id ?? "");
  const [itemId, setItemId] = useState(sourceQuote?.itemId ?? itemOptions[0]?.id ?? "");
  const drawingItemId = sourceQuote?.drawingItemId ?? drawingSet?.drawingItems.find((drawingItem) => drawingItem.itemId === itemId)?.id ?? "";
  const selectedDrawingItem = drawingSet?.drawingItems.find((drawingItem) => drawingItem.id === drawingItemId);
  const lockedToQuote = Boolean(sourceQuote);
  const nextRound = sourceQuote ? nextInspectionRoundForQuote(sourceQuote.id) : 1;
  const [result, setResult] = useState<SampleInspection["result"]>("Not Submitted");

  useEffect(() => {
    if (sourceQuote) return;
    if (!supplierOptions.some((supplier) => supplier.id === supplierId)) setSupplierId(supplierOptions[0]?.id ?? "");
    if (!itemOptions.some((item) => item.id === itemId)) setItemId(itemOptions[0]?.id ?? "");
    const matchingDrawingSet = activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId)[0];
    if (!matchingDrawingSet || drawingSet?.modelId !== modelId) setDrawingSetId(matchingDrawingSet?.id ?? "");
  }, [data.drawingSets, drawingSet?.modelId, drawingSetId, itemId, itemOptions, modelId, sourceQuote, supplierId, supplierOptions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      if (!drawingSet || !drawingItemId) throw new Error("Packaging set and item link must exist first.");
      const result = String(form.get("result") ?? "Not Submitted") as SampleInspection["result"];
      const photoUploads = await uploadMultipleFormFiles(form, "photoFiles", "QC Photo", "inspection");
      const disposition = result === "Pass" || result === "Not Submitted"
        ? defaultDispositionForResult(result)
        : String(form.get("disposition") ?? defaultDispositionForResult(result)) as SampleInspection["disposition"];
      await createInspection({
        recordState: "Active",
        supplierId,
        projectId: sourceQuote?.projectId ?? (inspectionMode === "Case-linked" ? project?.id : undefined),
        relatedQuoteId: sourceQuote?.id ?? (String(form.get("relatedQuoteId") ?? "") || undefined),
        modelId,
        drawingSetId: drawingSet.id,
        itemId,
        drawingItemId,
        sampleRound: Number(form.get("sampleRound") ?? nextRound),
        sampleReceivedDate: String(form.get("sampleReceivedDate") ?? ""),
        inspectionDate: String(form.get("inspectionDate") ?? "") || undefined,
        inspector: String(form.get("inspector") ?? "") || undefined,
        result,
        disposition,
        problemPhotos: photoUploads.length,
        photoFileIds: photoUploads.map((file) => file.id),
        notes: String(form.get("notes") ?? ""),
        signedDate: result === "Not Submitted" ? undefined : String(form.get("signedDate") ?? "") || undefined,
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to create inspection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Add QC inspection</h2>
            <p>QC records are item-level, even when the drawing is managed as a full model packaging set.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            QC Mode
            <select disabled={lockedToQuote} value={inspectionMode} onChange={(event) => setInspectionMode(event.target.value as "Standalone" | "Case-linked")}>
              <option>Standalone</option>
              <option disabled={!project}>Case-linked</option>
            </select>
          </label>
          <label>
            Related Quote
            <select disabled={lockedToQuote} name="relatedQuoteId" defaultValue={sourceQuote?.id ?? ""}>
              <option value="">No related quote</option>
              {data.quotes
                .filter((quote) => quote.supplierId === supplierId && quote.itemId === itemId)
                .map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Model
            <select disabled={lockedToQuote} value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Packaging Set
            <select disabled={lockedToQuote} value={drawingSetId} onChange={(event) => setDrawingSetId(event.target.value)} required>
              {activeDrawingSetsForModel(data.drawingSets, modelId, drawingSetId).map((set) => <option key={set.id} value={set.id}>{set.name} {set.revision}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select disabled={lockedToQuote} value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select disabled={lockedToQuote} value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {itemOptions.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Sample Round
            <input min="1" name="sampleRound" readOnly={lockedToQuote} step="1" type="number" defaultValue={nextRound} />
          </label>
          <label>
            Sample Received Date
            <input name="sampleReceivedDate" required type="date" />
          </label>
          <label>
            Inspection Date
            <input name="inspectionDate" type="date" />
          </label>
          <label>
            Inspector
            <input name="inspector" placeholder="QC name" />
          </label>
          <label>
            Result
            <select name="result" value={result} onChange={(event) => setResult(event.target.value as SampleInspection["result"])}>
              {["Pass", "Fail", "Conditional", "Not Submitted"].map((option) => <option key={option}>{option}</option>)}
            </select>
          </label>
          {result !== "Pass" && result !== "Not Submitted" && (
            <label>
              Action
              <select name="disposition" defaultValue={result === "Conditional" ? "Conditional Approval" : "Re-sample Required"}>
                {["Re-sample Required", "Conditional Approval"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          )}
          <label>
            Problem Photos
            <input multiple name="photoFiles" type="file" />
          </label>
          <label>
            Signed Date
            <input name="signedDate" type="date" />
          </label>
        </div>
        <div className="notice modalNotice">
          Packaging package: {drawingSet ? `${drawingSet.name} ${drawingSet.revision}` : "-"} / item link: {selectedDrawingItem ? itemCode(selectedDrawingItem.itemId) : "No packaging item linked"} / PDF: {drawingFileLabel(selectedDrawingItem, drawingSet)}
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} placeholder="QC notes or issue summary" />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving || !drawingItemId} type="submit">
            {saving ? "Saving..." : "Save inspection"}
          </button>
        </div>
      </form>
    </div>
  );
}

function IncomingDefectModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const [itemId, setItemId] = useState(data.items[0]?.id ?? "");
  const [defectQty, setDefectQty] = useState("");
  const [defectAction, setDefectAction] = useState<IncomingDefectRecord["defectAction"]>("Request Replacement");
  const [materialReturned, setMaterialReturned] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      const defectActionValue = String(form.get("defectAction") ?? "Request Replacement") as IncomingDefectRecord["defectAction"];
      const materialReturnedValue = String(form.get("materialReturned") ?? "false") === "true";
      const returnDate = String(form.get("returnDate") ?? "") || undefined;
      const poQty = String(form.get("poQty") ?? "") ? Number(form.get("poQty")) : undefined;
      const receivedQty = String(form.get("receivedQty") ?? "") ? Number(form.get("receivedQty")) : undefined;
      const photoUploads = await uploadMultipleFormFiles(form, "photoFiles", "QC Photo", "incoming-defect");
      const attachmentUploads = await uploadMultipleFormFiles(form, "attachmentFiles", "Other", "incoming-defect");
      const actionCompleted = defectActionValue === "Request Credit" || (poQty !== undefined && receivedQty !== undefined && receivedQty >= poQty);
      await createIncomingDefect({
        recordState: "Active",
        supplierId,
        modelId: modelId || undefined,
        itemId,
        poNumber: String(form.get("poNumber") ?? "") || undefined,
        poQty,
        defectType: String(form.get("defectType") ?? "Other") as IncomingDefectRecord["defectType"],
        defectDate: String(form.get("defectDate") ?? ""),
        defectQty: Number(form.get("defectQty") ?? 0),
        receivedQty,
        defectAction: defectActionValue,
        replacementQty: defectActionValue === "Request Replacement" ? Number(form.get("replacementQty") ?? form.get("defectQty") ?? 0) : undefined,
        actionCompleted,
        actionCompletedDate: actionCompleted ? returnDate ?? String(form.get("defectDate") ?? "") : undefined,
        materialReturned: materialReturnedValue,
        returnDate,
        notes: String(form.get("notes") ?? ""),
        photoFileIds: photoUploads.map((file) => file.id),
        attachmentFileIds: attachmentUploads.map((file) => file.id),
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to record incoming defect.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Record incoming defect</h2>
            <p>Incoming defects feed supplier Incoming Quality score by recent rejected quantity.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {data.items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              <option value="">No model link</option>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Defect Date
            <input name="defectDate" required type="date" />
          </label>
          <label>
            PO Number
            <input name="poNumber" placeholder="PO001" />
          </label>
          <label>
            PO Qty
            <input min="0" name="poQty" step="1" type="number" />
          </label>
          <label>
            Defect Type
            <select name="defectType" defaultValue="Other">
              {incomingDefectTypes.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Defect Qty
            <input min="0" name="defectQty" onChange={(event) => setDefectQty(event.target.value)} required step="1" type="number" value={defectQty} />
          </label>
          <label>
            Initial Received Qty
            <input min="0" name="receivedQty" step="1" type="number" />
          </label>
          <label>
            Action for the Defect
            <select name="defectAction" value={defectAction} onChange={(event) => setDefectAction(event.target.value as IncomingDefectRecord["defectAction"])}>
              {["Request Replacement", "Request Credit"].map((action) => <option key={action}>{action}</option>)}
            </select>
          </label>
          {defectAction === "Request Replacement" && (
            <label>
              Replacement Qty
              <input min="0" name="replacementQty" readOnly step="1" type="number" value={defectQty} />
            </label>
          )}
          <label>Defect Material Returned<select name="materialReturned" value={materialReturned ? "true" : "false"} onChange={(event) => setMaterialReturned(event.target.value === "true")}>{["false", "true"].map((value) => <option key={value} value={value}>{value === "true" ? "Yes" : "No"}</option>)}</select></label>
          {materialReturned && (
            <label>
              Return Date
              <input name="returnDate" type="date" />
            </label>
          )}
          <label>
            Photos
            <input multiple name="photoFiles" type="file" />
          </label>
          <label>
            Attachments
            <input multiple name="attachmentFiles" type="file" />
          </label>
        </div>
        <label className="fullWidthLabel">
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save defect record"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScoreSettingsModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const defaultWeights: ScoreWeights = {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const weights: ScoreWeights = {
      sampleQuality: Number(form.get("sampleQuality") ?? 0),
      incomingQuality: Number(form.get("incomingQuality") ?? 0),
      pricing: Number(form.get("pricing") ?? 0),
      responsiveness: Number(form.get("responsiveness") ?? 0),
      scopeFit: Number(form.get("scopeFit") ?? 0),
      setup: Number(form.get("setup") ?? 0),
    };
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (total !== 100) {
      setFormError("Score weights must add up to 100.");
      return;
    }
    setSaving(true);
    setFormError("");

    try {
      await updateScoreWeights(weights);
      await onSaved();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to save score settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Score settings</h2>
            <p>Weights control how supplier scorecard categories add up to 100.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Sample Quality
            <input defaultValue={defaultWeights.sampleQuality} min="0" name="sampleQuality" step="1" type="number" />
          </label>
          <label>
            Incoming Quality
            <input defaultValue={defaultWeights.incomingQuality} min="0" name="incomingQuality" step="1" type="number" />
          </label>
          <label>
            Pricing
            <input defaultValue={defaultWeights.pricing} min="0" name="pricing" step="1" type="number" />
          </label>
          <label>
            Responsiveness
            <input defaultValue={defaultWeights.responsiveness} min="0" name="responsiveness" step="1" type="number" />
          </label>
          <label>
            Scope Fit
            <input defaultValue={defaultWeights.scopeFit} min="0" name="scopeFit" step="1" type="number" />
          </label>
          <label>
            Lead Time
            <input defaultValue={defaultWeights.setup} min="0" name="setup" step="1" type="number" />
          </label>
        </div>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PriceChangeModal({
  data,
  onClose,
  onCreated,
}: {
  data: AppData;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [modelId, setModelId] = useState(data.models[0]?.id ?? "");
  const [itemId, setItemId] = useState(data.items[0]?.id ?? "");
  const quoteOptions = data.quotes.filter((quote) => quote.supplierId === supplierId && quote.itemId === itemId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFormError("");

    try {
      await createPriceChange({
        supplierId,
        modelId,
        itemId,
        sourceQuoteId: String(form.get("sourceQuoteId") ?? "") || undefined,
        previousQuoteId: String(form.get("previousQuoteId") ?? "") || undefined,
        sourceType: String(form.get("sourceType") ?? "Manual") as PriceChange["sourceType"],
        oldPrice: Number(form.get("oldPrice") ?? 0),
        newPrice: Number(form.get("newPrice") ?? 0),
        currency: "USD",
        effectiveDate: String(form.get("effectiveDate") ?? ""),
        reason: String(form.get("reason") ?? "Other") as PriceChange["reason"],
        status: String(form.get("status") ?? "Pending") as PriceChange["status"],
      });
      await onCreated();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "Unable to log price change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modalPanel" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>Log price change</h2>
            <p>Price changes can be manual or linked to quote/requote history for the same supplier and item.</p>
          </div>
          <button className="ghostButton" onClick={onClose} type="button">Close</button>
        </div>
        {formError && <div className="formError">{formError}</div>}
        <div className="formGrid">
          <label>
            Supplier
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              {data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required>
              {data.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} required>
              {data.items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Source Type
            <select name="sourceType" defaultValue="Manual">
              {["Manual", "Requote", "New Quote", "Purchase"].map((source) => <option key={source}>{source}</option>)}
            </select>
          </label>
          <label>
            Previous Quote
            <select name="previousQuoteId" defaultValue="">
              <option value="">No previous quote</option>
              {quoteOptions.map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Source Quote
            <select name="sourceQuoteId" defaultValue="">
              <option value="">No source quote</option>
              {quoteOptions.map((quote) => <option key={quote.id} value={quote.id}>{quote.quoteDate} - {formatMoney(quote.unitPrice)}</option>)}
            </select>
          </label>
          <label>
            Old Price
            <input min="0" name="oldPrice" required step="0.001" type="number" />
          </label>
          <label>
            New Price
            <input min="0" name="newPrice" required step="0.001" type="number" />
          </label>
          <label>
            Effective Date
            <input name="effectiveDate" required type="date" />
          </label>
          <label>
            Reason
            <select name="reason" defaultValue="Other">
              {["Material", "Freight", "Labor", "Negotiated", "Model Change", "Drawing Change", "Requote", "Change Work Order", "Other"].map((reason) => <option key={reason}>{reason}</option>)}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue="Pending">
              {["Pending", "Approved", "Rejected"].map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </div>
        <div className="modalActions">
          <button className="ghostButton" onClick={onClose} type="button">Cancel</button>
          <button className="primaryButton" disabled={saving} type="submit">
            {saving ? "Saving..." : "Save price change"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CheckGroup({
  items,
  label,
  selectedIds,
  setSelectedIds,
}: {
  items: { id: string; label: string }[];
  label: string;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}) {
  return <MultiSelectDropdown items={items} label={label} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
}

function FilterGroup({
  items,
  label,
  selectedIds,
  setSelectedIds,
}: {
  items: { id: string; label: string }[];
  label: string;
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
}) {
  return <MultiSelectDropdown items={items} label={label} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
}

function MultiSelectDropdown<T extends string>({
  items,
  label,
  selectedIds,
  setSelectedIds,
}: {
  items: { id: T; label: string }[];
  label: string;
  selectedIds: T[];
  setSelectedIds: Dispatch<SetStateAction<T[]>>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details?.open) return;
      if (event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function toggle(id: T) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  return (
    <div className="multiSelectField">
      <span>{label}</span>
      <details className="multiSelectDropdown" ref={detailsRef}>
        <summary>
          {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
        </summary>
        <div className="multiSelectMenu">
          <div className="multiSelectQuickActions">
            <button onClick={() => setSelectedIds(items.map((item) => item.id))} type="button">Select all</button>
            <button onClick={() => setSelectedIds([])} type="button">Clear</button>
          </div>
          {items.map((item) => (
            <label key={item.id}>
              <input checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
              {item.label}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <article className="metricCard">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

function Panel({ actions, title, children, help }: { actions?: React.ReactNode; title: React.ReactNode; children: React.ReactNode; help?: string }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="toolbarTitle">
          <h2>{title}</h2>
          {help && (
            <span className="helpIcon" data-help={help}>
              <CircleHelp size={16} />
            </span>
          )}
        </div>
        {actions && <div className="panelHeaderActions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function TableToolbar({
  action,
  extraActions,
  help,
  onAction,
  title,
}: {
  action?: string;
  extraActions?: React.ReactNode;
  help?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <div className="tableToolbar">
      <div className="toolbarTitle">
        <h2>{title}</h2>
        {help && (
          <span className="helpIcon" data-help={help}>
            <CircleHelp size={16} />
          </span>
        )}
      </div>
      <div className="toolbarActions">
        {extraActions}
        {onAction && action && (
          <button onClick={onAction} type="button">
            <Plus size={16} />
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="timelineRow">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AlertRow({ title, text }: { title: string; text: string }) {
  return (
    <div className="alertRow">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="emptyState">{text}</p>;
}

function StatusPill({ label }: { label: string }) {
  const key = label.toLowerCase().replace(/\s+/g, "-");
  return <span className={`statusPill ${key}`}>{label}</span>;
}

function LifecyclePill({ record }: { record: { recordState?: "Draft" | "Active" | "Void" } }) {
  if (!record.recordState || record.recordState === "Active") return null;
  return <span className={`lifecyclePill ${record.recordState.toLowerCase()}`}>{record.recordState}</span>;
}

function RecordMenu({
  canDelete,
  label,
  onDelete,
  onEdit,
  onHistory,
  onView,
  onVoid,
}: {
  canDelete: boolean;
  label: string;
  onDelete: () => void;
  onEdit: () => void;
  onHistory?: () => void;
  onView?: () => void;
  onVoid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuId] = useState(() => `record-menu-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    function closeOtherMenus(event: Event) {
      if (event instanceof CustomEvent && event.detail !== menuId) setOpen(false);
    }
    window.addEventListener("record-menu-open", closeOtherMenus);
    return () => window.removeEventListener("record-menu-open", closeOtherMenus);
  }, [menuId]);

  function runAction(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="recordMenu">
      <button
        aria-expanded={open}
        aria-label={`Actions for ${label}`}
        className="recordMenuTrigger"
        onClick={() => {
          window.dispatchEvent(new CustomEvent("record-menu-open", { detail: menuId }));
          setOpen((current) => !current);
        }}
        title={`Actions for ${label}`}
        type="button"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="recordMenuList">
          {onView && <button onClick={() => runAction(onView)} type="button">View</button>}
          <button onClick={() => runAction(onEdit)} type="button">Edit</button>
          <button onClick={() => runAction(onVoid)} type="button">Void</button>
          {canDelete && <button className="dangerMenuItem" onClick={() => runAction(onDelete)} type="button">Delete</button>}
        </div>
      )}
    </div>
  );
}

function canDeleteRecord(endpoint: DeleteEndpoint, id: string) {
  if (endpoint === "suppliers") {
    return (
      !projects.some((project) => project.supplierIds.includes(id)) &&
      !quotes.some((quote) => quote.supplierId === id) &&
      !quoteCaseLinks.some((link) => link.supplierId === id) &&
      !inspections.some((inspection) => inspection.supplierId === id) &&
      !incomingDefects.some((defect) => defect.supplierId === id) &&
      !priceChanges.some((change) => change.supplierId === id) &&
      !purchasePrices.some((purchase) => purchase.supplierId === id)
    );
  }
  if (endpoint === "models") {
    return (
      !items.some((item) => item.usedForModels.includes(id)) &&
      !drawingSets.some((drawingSet) => drawingSet.modelId === id) &&
      !projects.some((project) => project.modelIds.includes(id)) &&
      !quotes.some((quote) => quote.modelId === id) &&
      !quoteCaseLinks.some((link) => link.modelId === id) &&
      !inspections.some((inspection) => inspection.modelId === id) &&
      !incomingDefects.some((defect) => defect.modelId === id) &&
      !priceChanges.some((change) => change.modelId === id) &&
      !purchasePrices.some((purchase) => purchase.modelId === id)
    );
  }
  if (endpoint === "items") {
    return (
      !drawingSets.some((drawingSet) => drawingSet.drawingItems.some((drawingItem) => drawingItem.itemId === id)) &&
      !projects.some((project) => project.itemIds.includes(id)) &&
      !quotes.some((quote) => quote.itemId === id) &&
      !quoteCaseLinks.some((link) => link.itemId === id) &&
      !inspections.some((inspection) => inspection.itemId === id) &&
      !incomingDefects.some((defect) => defect.itemId === id) &&
      !priceChanges.some((change) => change.itemId === id) &&
      !purchasePrices.some((purchase) => purchase.itemId === id)
    );
  }
  if (endpoint === "drawing-sets") {
    return (
      !projects.some((project) => project.drawingSetId === id) &&
      !quotes.some((quote) => quote.drawingSetId === id) &&
      !inspections.some((inspection) => inspection.drawingSetId === id)
    );
  }
  if (endpoint === "projects") {
    return !quotes.some((quote) => quote.projectId === id) && !quoteCaseLinks.some((link) => link.projectId === id) && !inspections.some((inspection) => inspection.projectId === id);
  }
  if (endpoint === "quotes") {
    return (
      !quotes.some((quote) => quote.previousQuoteId === id) &&
      !quoteCaseLinks.some((link) => link.quoteId === id) &&
      !inspections.some((inspection) => inspection.relatedQuoteId === id) &&
      !priceChanges.some((change) => change.sourceQuoteId === id || change.previousQuoteId === id) &&
      !purchasePrices.some((purchase) => purchase.linkedQuoteId === id)
    );
  }
  if (endpoint === "purchase-prices") return true;
  return true;
}

function isPublishedRecord(record: { recordState?: "Draft" | "Active" | "Void" }) {
  return (record.recordState ?? "Active") !== "Draft";
}

function markRecordVoid(data: AppData, endpoint: DeleteEndpoint, id: string, reason: string): AppData {
  const keyByEndpoint = {
    suppliers: "suppliers",
    models: "models",
    items: "items",
    "drawing-sets": "drawingSets",
    projects: "projects",
    quotes: "quotes",
    inspections: "inspections",
    "incoming-defects": "incomingDefects",
    "price-changes": "priceChanges",
    "purchase-prices": "purchasePrices",
  } satisfies Record<DeleteEndpoint, keyof AppData>;
  const key = keyByEndpoint[endpoint];
  const records = data[key];
  if (!Array.isArray(records)) return data;
  return {
    ...data,
    [key]: records.map((record) =>
      "id" in record && record.id === id ? { ...record, recordState: "Void", voidReason: reason } : record,
    ),
  };
}

function findDuplicateItemCodes(records: PackagingItem[]) {
  const counts = records.reduce((map, item) => {
    const key = item.itemCode.trim().toLowerCase();
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="tagRow">
      {tags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}

function CheckLabel({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "checkLabel ok" : "checkLabel"}>{label}</span>;
}

function QuoteStatusSelect({
  onChange,
  quote,
}: {
  onChange: (quoteId: string, status: Quote["status"]) => Promise<void>;
  quote: Quote;
}) {
  const [saving, setSaving] = useState(false);

  async function changeStatus(status: Quote["status"]) {
    setSaving(true);
    await onChange(quote.id, status);
    setSaving(false);
  }

  return (
    <label className="inlineStatusSelect">
      <select
        aria-label="Quote status"
        disabled={saving}
        onChange={(event) => void changeStatus(event.target.value as Quote["status"])}
        value={quote.status}
      >
        {quoteStatusOptions.map((status) => <option key={status}>{status}</option>)}
      </select>
    </label>
  );
}

function DocumentCheck({ fileId, label, ok }: { fileId?: string; label: string; ok: boolean }) {
  return (
    <span className={ok ? "checkLabel ok" : "checkLabel"}>
      {label}
      {fileId && (
        <>
          {": "}
          <FileReference fileId={fileId} />
        </>
      )}
    </span>
  );
}

function FileReference({ fileId }: { fileId?: string }) {
  const file = fileRecord(fileId);
  if (!file) return <span className="muted">-</span>;
  return (
    <a className="fileLink" href={fileUrl(file)} rel="noreferrer" target="_blank" title={`${file.fileName} (${formatFileSize(file.size)})`}>
      {file.fileName}
    </a>
  );
}

function DrawingFileReference({ drawingItem, drawingSet }: { drawingItem?: DrawingSet["drawingItems"][number]; drawingSet?: DrawingSet }) {
  if (!drawingItem) return <span className="muted">-</span>;
  if (drawingSet?.packageFileId) return <FileReference fileId={drawingSet.packageFileId} />;
  if (drawingItem.drawingSource === "Package PDF" && drawingSet?.packageFileName) return <span>{drawingSet.packageFileName}</span>;
  if (drawingItem.fileId) return <FileReference fileId={drawingItem.fileId} />;
  return <span>{drawingItem.fileName ?? "-"}</span>;
}

function PhotoFileReferences({ inspection }: { inspection: SampleInspection }) {
  if (!inspection.photoFileIds?.length) return <span>{inspection.problemPhotos} uploaded</span>;
  return (
    <div className="fileStack">
      {inspection.photoFileIds.map((fileId) => <FileReference fileId={fileId} key={fileId} />)}
    </div>
  );
}

function IncomingDefectFiles({ defect }: { defect: IncomingDefectRecord }) {
  const fileIds = [...(defect.photoFileIds ?? []), ...(defect.attachmentFileIds ?? [])];
  if (fileIds.length === 0) return <span className="muted">-</span>;
  return (
    <div className="fileStack">
      {fileIds.map((fileId) => <FileReference fileId={fileId} key={fileId} />)}
    </div>
  );
}

function QuoteCell({ quote, inspection }: { quote: Quote; inspection?: SampleInspection }) {
  return (
    <div className="quoteCell">
      <strong>{formatMoney(quote.unitPrice)}</strong>
      <span>MOQ {quote.moq}</span>
      <span>{quote.leadTime}</span>
      <StatusPill label={inspection?.result ?? "Pending"} />
    </div>
  );
}

function QuoteValueStack({ field, quotes: quoteList }: { field: "price" | "moq" | "leadTime" | "extraCost"; quotes: Quote[] }) {
  return (
    <div className="quoteStack">
      {quoteList.map((quote) => {
        const value =
          field === "price" ? formatMoney(quote.unitPrice)
            : field === "moq" ? quote.moq
              : field === "leadTime" ? quote.leadTime
                : quoteExtraCostLabel(quote);
        return <span key={`${quote.id}-${field}`}>{value}</span>;
      })}
    </div>
  );
}

function recommendSupplier(candidateQuotes: Quote[], candidateInspections: SampleInspection[]) {
  const passSupplierIds = new Set(
    candidateInspections.filter((inspection) => inspection.result === "Pass").map((inspection) => inspection.supplierId),
  );
  const candidates = [...candidateQuotes].sort((a, b) => {
    const aPass = passSupplierIds.has(a.supplierId) ? 0 : 1;
    const bPass = passSupplierIds.has(b.supplierId) ? 0 : 1;
    return aPass - bPass || a.unitPrice - b.unitPrice;
  });

  return candidates[0] ? supplierName(candidates[0].supplierId) : "Need quote";
}

function supplierScore(supplierId: string) {
  const supplier = suppliers.find((candidate) => candidate.id === supplierId);
  if (!supplier) return 0;

  return buildSupplierScorecard(supplier).score;
}

function buildSupplierScorecard(supplier: Supplier): ScorecardRow {
  const supplierQuotes = quotes.filter((quote) => quote.supplierId === supplier.id && quote.recordState !== "Void");
  const supplierInspections = inspections.filter((inspection) => inspection.supplierId === supplier.id && inspection.recordState !== "Void");
  const supplierDefects = incomingDefects.filter((defect) => defect.supplierId === supplier.id && defect.recordState !== "Void");
  const pass = supplierInspections.filter((inspection) => inspection.result === "Pass").length;
  const fail = supplierInspections.filter((inspection) => inspection.result === "Fail").length;
  const conditional = supplierInspections.filter((inspection) => inspection.result === "Conditional").length;
  const reviewedSamples = pass + fail + conditional;
  const weights: ScoreWeights = {
    sampleQuality: 25,
    incomingQuality: 20,
    pricing: 20,
    responsiveness: 15,
    scopeFit: 10,
    setup: 10,
  };
  const recentDefectQty = supplierDefects
    .filter((defect) => isWithinRecentDays(defect.defectDate, 90))
    .reduce((sum, defect) => sum + defect.defectQty, 0);
  const incomingQualityScore = scoreIncomingQuality(recentDefectQty, weights.incomingQuality);
  const selectedQuotes = supplierQuotes.filter(isSelectedQuote).length;
  const declaredTypes = supplier.capableItems.length;
  const quotedDeclaredTypes = new Set(
    supplierQuotes
      .map((quote) => items.find((item) => item.id === quote.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const passedDeclaredTypes = new Set(
    supplierInspections
      .filter((inspection) => inspection.result === "Pass")
      .map((inspection) => items.find((item) => item.id === inspection.itemId)?.type)
      .filter((type) => type && supplier.capableItems.includes(type)),
  ).size;
  const numericLeadTimes = supplierQuotes
    .map((quote) => parseLeadTimeDays(quote.leadTime))
    .filter((leadTime): leadTime is number => leadTime !== undefined);
  const averageLeadTime = numericLeadTimes.length > 0 ? numericLeadTimes.reduce((sum, leadTime) => sum + leadTime, 0) / numericLeadTimes.length : undefined;

  const sampleQualityScore =
    reviewedSamples === 0
      ? 0
      : clamp(Math.round((pass / reviewedSamples) * (weights.sampleQuality - 5) + conditional * 2 - fail * 3 + (pass > 0 ? 5 : 0)), 0, weights.sampleQuality);
  const pricingScore = scorePricingCompetitiveness(supplierQuotes, weights.pricing, supplier.paymentTerms);
  const responsivenessScore = clamp((supplierQuotes.length > 0 ? 8 : 0) + (averageLeadTime !== undefined && averageLeadTime <= 14 ? 4 : 0) + (selectedQuotes > 0 ? 3 : 0), 0, weights.responsiveness);
  const scopeScore = clamp((declaredTypes > 0 ? 4 : 0) + (quotedDeclaredTypes > 0 ? 3 : 0) + (passedDeclaredTypes > 0 ? 3 : 0), 0, weights.scopeFit);
  const leadTimeScore = scoreLeadTime(averageLeadTime, weights.setup);
  const qualityScore = sampleQualityScore + incomingQualityScore;
  const qualityMax = weights.sampleQuality + weights.incomingQuality;
  const score = qualityScore + pricingScore + responsivenessScore + scopeScore + leadTimeScore;

  return {
    supplier,
    score,
    grade: score >= 85 ? "A - Preferred" : score >= 70 ? "B - Approved" : score >= 55 ? "C - Conditional" : "D - Not Recommended",
    categories: [
      {
        key: "quality",
        label: "Quality",
        score: qualityScore,
        max: qualityMax,
        detail: `Sample ${sampleQualityScore}/${weights.sampleQuality}; incoming ${incomingQualityScore}/${weights.incomingQuality}`,
        children: [
          {
            key: "sampleQuality",
            label: "Sample Quality",
            score: sampleQualityScore,
            max: weights.sampleQuality,
            detail: reviewedSamples === 0 ? "No QC result yet" : `${pass} pass, ${fail} fail, ${conditional} conditional`,
          },
          {
            key: "incomingQuality",
            label: "Incoming Quality",
            score: incomingQualityScore,
            max: weights.incomingQuality,
            detail: `${recentDefectQty} rejected/defect qty in last 90 days`,
          },
        ],
      },
      {
        key: "pricing",
        label: "Pricing",
        score: pricingScore,
        max: weights.pricing,
        detail: pricingDetail(supplierQuotes, supplier.paymentTerms),
      },
      {
        key: "responsiveness",
        label: "Responsiveness",
        score: responsivenessScore,
        max: weights.responsiveness,
        detail: averageLeadTime === undefined ? "No quote lead time yet" : `Average lead time ${Math.round(averageLeadTime)} days`,
      },
      {
        key: "scope",
        label: "Scope Fit",
        score: scopeScore,
        max: weights.scopeFit,
        detail: declaredTypes === 0 ? "No supply scope declared" : `${quotedDeclaredTypes}/${declaredTypes} declared types quoted`,
      },
      {
        key: "setup",
        label: "Lead Time",
        score: leadTimeScore,
        max: weights.setup,
        detail: averageLeadTime === undefined ? "No quote lead time yet" : `Average lead time ${Math.round(averageLeadTime)} days`,
      },
    ],
    scopeLabel:
      declaredTypes === 0
        ? "Not defined"
        : declaredTypes === 1
          ? `${supplier.capableItems[0]} specialist`
          : `${declaredTypes} declared categories`,
    quoteCount: supplierQuotes.length,
    passCount: pass,
    failCount: fail,
    documentsComplete: supplier.hasW9 && supplier.hasPaymentInfo,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scoreIncomingQuality(recentDefectQty: number, max: number) {
  if (recentDefectQty < 5) return max;
  if (recentDefectQty < 10) return Math.round(max * 0.75);
  if (recentDefectQty < 20) return Math.round(max * 0.45);
  return Math.round(max * 0.15);
}

function scoreLeadTime(averageLeadTime: number | undefined, max: number) {
  if (averageLeadTime === undefined) return 0;
  if (averageLeadTime <= 7) return max;
  if (averageLeadTime <= 14) return Math.round(max * 0.8);
  if (averageLeadTime <= 21) return Math.round(max * 0.55);
  if (averageLeadTime <= 30) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

function scorePricingCompetitiveness(supplierQuotes: Quote[], max: number, paymentTerms = "") {
  if (supplierQuotes.length === 0) return 0;
  const quoteScores = supplierQuotes.map((quote) => quotePriceCompetitiveness(quote));
  const averagePercent = quoteScores.reduce((sum, score) => sum + score, 0) / quoteScores.length;
  const priceMax = Math.round(max * 0.85);
  const termsMax = max - priceMax;
  return Math.round(priceMax * averagePercent) + scorePaymentTerms(paymentTerms, termsMax);
}

function quotePriceCompetitiveness(quote: Quote): number {
  const groupQuotes = quotes.filter(
    (candidate) =>
      candidate.recordState !== "Void" &&
      candidate.itemId === quote.itemId &&
      (candidate.projectId ?? "Standalone") === (quote.projectId ?? "Standalone"),
  );
  const lowestPrice = Math.min(...groupQuotes.map((candidate) => candidate.unitPrice).filter((price) => price > 0));
  if (!Number.isFinite(lowestPrice) || lowestPrice <= 0) return 0;
  const gap = (quote.unitPrice - lowestPrice) / lowestPrice;
  if (gap <= 0) return 1;
  if (gap <= 0.03) return 0.9;
  if (gap <= 0.05) return 0.8;
  if (gap <= 0.1) return 0.6;
  return 0.3;
}

function pricingDetail(supplierQuotes: Quote[], paymentTerms = "") {
  if (supplierQuotes.length === 0) return "No quote for price comparison";
  const selectedCount = supplierQuotes.filter(isSelectedQuote).length;
  const averagePercent = Math.round((supplierQuotes.reduce((sum, quote) => sum + quotePriceCompetitiveness(quote), 0) / supplierQuotes.length) * 100);
  const termsDays = paymentTermDays(paymentTerms);
  const termsLabel = termsDays === undefined ? "payment terms not set" : `Net ${termsDays} payment terms`;
  return `${averagePercent}% price competitiveness, ${termsLabel}, ${selectedCount} selected quote${selectedCount === 1 ? "" : "s"}`;
}

function scorePaymentTerms(paymentTerms: string, max: number) {
  const days = paymentTermDays(paymentTerms);
  if (days === undefined) return 0;
  if (days >= 60) return max;
  if (days >= 45) return Math.round(max * 0.8);
  if (days >= 30) return Math.round(max * 0.6);
  if (days >= 15) return Math.round(max * 0.3);
  return Math.round(max * 0.1);
}

function paymentTermDays(paymentTerms: string) {
  const match = paymentTerms.match(/(?:net\s*)?(\d{1,3})/i);
  return match ? Number(match[1]) : undefined;
}

function isWithinRecentDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}

function sumDefectQty(records: IncomingDefectRecord[], days?: number) {
  return records
    .filter((record) => !days || isWithinRecentDays(record.defectDate, days))
    .reduce((sum, record) => sum + record.defectQty, 0);
}

function sumReturnedDefectQty(records: IncomingDefectRecord[], days?: number) {
  return records
    .filter((record) => record.materialReturned)
    .filter((record) => !days || isWithinRecentDays(record.returnDate ?? record.defectDate, days))
    .reduce((sum, record) => sum + record.defectQty, 0);
}

function incomingDefectAcceptedReplacementQty(defect: Pick<IncomingDefectRecord, "replacementReceipts">) {
  return (defect.replacementReceipts ?? [])
    .filter((receipt) => receipt.result === "Accepted")
    .reduce((sum, receipt) => sum + receipt.receivedQty, 0);
}

function incomingDefectCurrentReceivedQty(defect: Pick<IncomingDefectRecord, "receivedQty" | "replacementReceipts">) {
  return (defect.receivedQty ?? 0) + incomingDefectAcceptedReplacementQty(defect);
}

function incomingDefectPendingQty(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  if (defect.defectAction !== "Request Replacement") return 0;
  const acceptedReplacementQty = incomingDefectAcceptedReplacementQty(defect);
  if (defect.poQty === undefined || defect.receivedQty === undefined) return Math.max((defect.replacementQty ?? defect.defectQty) - acceptedReplacementQty, 0);
  return Math.max(defect.poQty - incomingDefectCurrentReceivedQty(defect), 0);
}

function isIncomingDefectComplete(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  if (defect.defectAction === "Request Credit") return true;
  return incomingDefectPendingQty(defect) === 0;
}

function isIncomingDefectPendingReceive(defect: Pick<IncomingDefectRecord, "defectAction" | "defectQty" | "poQty" | "receivedQty" | "replacementQty" | "replacementReceipts">) {
  return defect.defectAction === "Request Replacement" && !isIncomingDefectComplete(defect);
}

function incomingDefectTimeline(defect: IncomingDefectRecord) {
  const poNumber = defect.poNumber ?? "PO";
  const poQty = defect.poQty ?? (defect.receivedQty ?? 0) + defect.defectQty;
  const firstReceivedQty = defect.receivedQty ?? Math.max(poQty - defect.defectQty, 0);
  const events = [`${defect.defectDate} received ${poNumber} ${firstReceivedQty} pcs`];
  if (defect.materialReturned) events.push(`${defect.returnDate ?? defect.defectDate} returned ${defect.defectQty} pcs`);
  if (defect.defectAction === "Request Credit") events.push(`${defect.defectDate} credit requested`);
  for (const [index, receipt] of (defect.replacementReceipts ?? []).entries()) {
    events.push(`${receipt.receivedDate} replacement ${index + 1} received ${receipt.receivedQty} pcs ${receipt.result.toLowerCase()}`);
  }
  if (isIncomingDefectComplete(defect) && defect.defectAction === "Request Replacement") events.push("PO complete");
  return events.join(" / ");
}

function incomingDefectActionLabel(defect: IncomingDefectRecord) {
  if (isIncomingDefectComplete(defect)) {
    return defect.defectAction === "Request Replacement" ? "Replacement Completed" : "Credit Requested";
  }
  return defect.defectAction;
}

function exportIncomingDefectHistory(records: IncomingDefectRecord[]) {
  const headers = [
    "PO Number",
    "Date",
    "Supplier",
    "Item",
    "PO Qty",
    "Current Received Qty",
    "Defect Qty",
    "Action",
    "Timeline",
  ];
  const rows = records.map((defect) => [
    defect.poNumber ?? "",
    defect.defectDate,
    supplierName(defect.supplierId),
    itemCode(defect.itemId),
    defect.poQty ?? "",
    incomingDefectCurrentReceivedQty(defect) || "",
    defect.defectQty,
    incomingDefectActionLabel(defect),
    incomingDefectTimeline(defect),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `incoming-defect-history-${todayDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportQuotes(records: Quote[]) {
  const headers = [
    "Quote ID",
    "Supplier",
    "ERP Vendor ID",
    "Payment Terms",
    "Item Code",
    "Item Description",
    "Item Type",
    "Model",
    "Packaging Set",
    "Quote Type",
    "Case Link",
    "Case",
    "Quote Reason",
    "Quote Status",
    "Source Role",
    "Effective From",
    "Effective To",
    "Current Open Price",
    "Previous Quote",
    "Price Change",
    "Unit Price",
    "Currency",
    "UOM",
    "MOQ",
    "Lead Time",
    "Extra Cost Type",
    "Extra Cost Amount",
    "Attachment",
    "Notes",
  ];
  const rows = records.map((quote) => {
    const supplier = suppliers.find((candidate) => candidate.id === quote.supplierId);
    const item = itemById(quote.itemId);
    const sourceRole = sourceRoleForQuote(quote) ?? "";
    const priceChange = priceChangeForQuote(quote.id);
    return [
      quote.id,
      supplier?.name ?? supplierName(quote.supplierId),
      supplier?.erpVendorId ?? "",
      supplier?.paymentTerms ?? "",
      item?.itemCode ?? itemCode(quote.itemId),
      item?.itemName ?? "",
      item?.type ?? "",
      modelName(quote.modelId),
      drawingSetName(quote.drawingSetId),
      quote.quoteType,
      quoteCaseLabel(quote),
      quote.projectId ? projectName(quote.projectId) : "Standalone",
      quote.quoteReason,
      quote.status,
      sourceRole,
      quote.effectiveFrom ?? quote.quoteDate,
      quote.effectiveTo ?? "",
      quote.effectiveTo ? "No" : "Yes",
      quote.previousQuoteId ? quoteExportReference(quote.previousQuoteId) : "",
      priceChange ? `${priceChange.effectiveDate}: ${formatMoney(priceChange.oldPrice)} -> ${formatMoney(priceChange.newPrice)} (${priceChange.status})` : "",
      formatDecimalPrice(quote.unitPrice),
      quote.currency,
      quote.uom,
      quote.moq,
      quote.leadTime,
      quote.extraCostType ?? "None",
      quote.extraCostAmount ?? "",
      quote.attachmentFileId ? fileLabel(quote.attachmentFileId) : "",
      quote.notes,
    ];
  });
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quote-export-${todayDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function priceChangeForQuote(quoteId: string) {
  return priceChanges.find((change) => change.recordState !== "Void" && change.sourceQuoteId === quoteId);
}

function quoteExportReference(quoteId: string) {
  const quote = quotes.find((candidate) => candidate.id === quoteId);
  return quote ? `${quote.effectiveFrom ?? quote.quoteDate} / ${supplierName(quote.supplierId)} / ${itemCode(quote.itemId)} / ${formatMoney(quote.unitPrice)}` : quoteId;
}

function formatMoney(value: number) {
  return `$${formatDecimalPrice(value)}`;
}

function formatDecimalPrice(value: number) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildQuotePriceChartRows(visibleQuotes: Quote[], includeAllQuoteSeries: boolean, includeSelectedSeries: boolean) {
  const rows = new Map<string, Record<string, string | number>>();
  const ensureRow = (date: string) => {
    const row = rows.get(date) ?? { date };
    rows.set(date, row);
    return row;
  };

  for (const quote of visibleQuotes) {
    const date = quote.effectiveFrom ?? quote.quoteDate;
    if (includeAllQuoteSeries) {
      ensureRow(date)[`${supplierName(quote.supplierId)} all quotes`] = quote.unitPrice;
    }
    if (includeSelectedSeries && isSelectedQuote(quote)) {
      ensureRow(date)[`${supplierName(quote.supplierId)} selected`] = quote.unitPrice;
    }
  }

  return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function buildDashboardPriceTrendRows(visibleQuotes: Quote[]) {
  const rows = new Map<string, Record<string, string | number>>();

  for (const quote of visibleQuotes) {
    const date = quote.effectiveFrom ?? quote.quoteDate;
    const row = rows.get(date) ?? { date };
    row[supplierName(quote.supplierId)] = quote.unitPrice;
    rows.set(date, row);
  }

  return Array.from(rows.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function dashboardPriceDomain(visibleQuotes: Quote[]): [number, number] | ["auto", "auto"] {
  return priceAnalyticsDomain(visibleQuotes);
}

function priceAnalyticsDomain(visibleQuotes: Quote[]): [number, number] | ["auto", "auto"] {
  const prices = visibleQuotes.map((quote) => quote.unitPrice).filter((price) => Number.isFinite(price));
  if (prices.length === 0) return ["auto", "auto"];

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max <= 1) return [0, 1];

  const range = max - min;
  const padding = range === 0 ? Math.max(max * 0.08, 0.5) : range * 0.18;
  const roughStep = Math.max((max + padding) / 8, 0.01);
  const stepMagnitude = 10 ** Math.floor(Math.log10(roughStep));
  const stepBase = roughStep / stepMagnitude;
  const step = stepBase <= 2 ? 2 * stepMagnitude : stepBase <= 5 ? 5 * stepMagnitude : 10 * stepMagnitude;
  const lower = Math.floor(Math.max(0, min - padding) / step) * step;
  const upper = Math.ceil((max + padding) / step) * step;

  return [lower, upper];
}

function formatMonthTick(dateText: string) {
  const parsedDate = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return dateText;

  return parsedDate.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function chartColor(index: number) {
  const palette = ["#d71920", "#25282d", "#8f2b31", "#6b7280", "#c84d52", "#3f4652", "#a84348", "#9ca3af"];
  return palette[index % palette.length];
}

function parseItemImportRows(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index !== 0 || !/^item code[\t,]/i.test(line))
    .map((line) => {
      const columns = line.includes("\t") ? line.split("\t") : line.split(",");
      const [itemCode = "", description = "", type = "", usedFor = ""] = columns.map((column) => column.trim());
      return {
        itemCode,
        description,
        type: type as PackagingItemType,
        usedFor: usedFor.split(/[;,]/).map((value) => value.trim()).filter(Boolean),
      };
    })
    .filter((row) => row.itemCode && row.description && row.type && row.usedFor.length > 0);
}

function parseDrawingImportRows(rawText: string) {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index) => index !== 0 || !/^item code[\t,]/i.test(line))
    .map((line) => {
      const columns = line.includes("\t") ? line.split("\t") : line.split(",");
      const [itemCode = "", revision = "", fileName = ""] = columns.map((column) => column.trim());
      return { itemCode, revision, fileName };
    })
    .filter((row) => row.itemCode && row.revision);
}

function buildDrawingRowsFromModelItems(modelItems: PackagingItem[], revision: string) {
  return modelItems.map((item) => ({
    itemCode: item.itemCode,
    revision,
    fileName: "",
  }));
}

function nextPackagingSetRevision(sets: DrawingSet[], modelId: string) {
  const existingCount = sets.filter((set) => set.modelId === modelId && set.recordState !== "Void").length;
  return `${existingCount + 1}.0`;
}

function supplierName(id: string) {
  return suppliers.find((supplier) => supplier.id === id)?.name ?? "Unknown supplier";
}

function projectName(id: string) {
  return projects.find((project) => project.id === id)?.name ?? "Unknown case";
}

function supplierLocation(supplier: Supplier) {
  return [supplier.region, supplier.country].filter(Boolean).join(", ") || "Not set";
}

function modelName(id: string) {
  return models.find((model) => model.id === id)?.name ?? "Unknown model";
}

function drawingSetName(id: string) {
  return drawingSets.find((set) => set.id === id)?.name ?? "Unknown packaging set";
}

function activeDrawingSetsForModel(sets: DrawingSet[], modelId: string, keepId?: string) {
  return sets.filter((set) =>
    set.modelId === modelId &&
    set.recordState !== "Void" &&
    (set.status === "Active" || set.id === keepId));
}

function drawingItemForInspection(inspection: SampleInspection) {
  return drawingSets
    .find((set) => set.id === inspection.drawingSetId)
    ?.drawingItems.find((drawingItem) => drawingItem.id === inspection.drawingItemId);
}

function drawingFileLabel(drawingItem?: DrawingSet["drawingItems"][number], drawingSet?: DrawingSet) {
  if (!drawingItem) return "-";
  if (drawingSet?.packageFileId) return fileLabel(drawingSet.packageFileId);
  if (drawingItem.drawingSource === "Package PDF" && drawingSet?.packageFileName) return drawingSet.packageFileName;
  if (drawingItem.fileId) return fileLabel(drawingItem.fileId);
  return drawingItem.fileName ?? "-";
}

function itemById(id: string): PackagingItem | undefined {
  return items.find((item) => item.id === id);
}

function itemCode(id: string) {
  const item = itemById(id);
  return item ? item.itemCode : "Unknown item";
}

function quoteLabel(id?: string) {
  if (!id) return "-";
  const quote = quotes.find((candidate) => candidate.id === id);
  return quote ? `${quote.quoteDate} ${formatMoney(quote.unitPrice)}` : "Missing quote";
}

function quoteExtraCostLabel(quote: Quote) {
  if (!quote.extraCostType || quote.extraCostType === "None") return "-";
  return `${quote.extraCostType}: ${formatMoney(quote.extraCostAmount ?? 0)}`;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function parseLeadTimeDays(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function purchasePriceLabel(id?: string) {
  if (!id) return "-";
  const purchase = purchasePrices.find((candidate) => candidate.id === id);
  return purchase ? `${purchase.poNumber} ${purchase.orderDate} ${formatMoney(purchase.unitPrice)}` : "Missing PO price";
}

function fileLabel(id?: string) {
  if (!id) return "-";
  const file = fileRecord(id);
  return file?.fileName ?? "Missing file";
}

function fileRecord(id?: string) {
  if (!id) return undefined;
  return files.find((candidate) => candidate.id === id);
}

function fileUrl(file: UploadedFileRecord) {
  return `/${file.storagePath.replace(/\\/g, "/")}`;
}

function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAuditValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function priceChangeReference(quoteId?: string, purchasePriceId?: string) {
  if (purchasePriceId) return purchasePriceLabel(purchasePriceId);
  return quoteLabel(quoteId);
}
