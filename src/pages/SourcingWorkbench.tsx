import { isUsableRecord } from "../lib/recordOptions";
import { type SourceAssignment, type Quote, type SampleInspection } from "../types";
import { type DeleteHandler, type EditTarget, type HistoryHandler, type VoidHandler } from "../uiTypes";
import { useAppData } from "../AppDataContext";
import { useState, useEffect } from "react";
import { modelName, supplierName, itemCode, drawingSetName, itemById } from "../lib/lookups";
import { TableToolbar } from "../components/TableToolbar";
import { Panel } from "../components/Panel";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { RecordMenu } from "../components/RecordMenu";
import { canDeleteRecord } from "../lib/recordLifecycle";
import { Field } from "../components/Field";
import { caseSupplierIds, quoteHasCaseLink, quoteAppliesToProject, quoteCaseLabel, sourceRoleForQuote, isSelectedQuote, isSampleRequestedQuote, latestInspectionForQuote, qcQueueStatus, buildCaseProgressRows } from "../lib/sourcing";
import { type AppData, type ComparisonRow, fetchComparison } from "../api";
import { exportQuotes } from "../lib/exports";
import { quoteStatusOptions } from "../constants";
import { EmptyState } from "../components/EmptyState";
import { StatusPill } from "../components/StatusPill";
import { formatMoney } from "../lib/format";
import { QuoteStatusSelect } from "../components/QuoteStatusSelect";
import { QuoteValueStack } from "../components/QuoteValueStack";
import { supplierScore } from "../lib/scorecard";
import { QuoteMini } from "../components/QuoteMini";
import { SourceRoleSelect } from "../components/SourceRoleSelect";

export function SourcingProjects({
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
  const { data: appData } = useAppData();
  const [caseSearch, setCaseSearch] = useState("");
  const [showCaseResults, setShowCaseResults] = useState(false);
  const [collapsedCaseIds, setCollapsedCaseIds] = useState<string[]>([]);
  const selectedProject = appData.projects.find((project) => project.id === selectedProjectId) ?? appData.projects[0];
  const selectedProjectCollapsed = selectedProject ? collapsedCaseIds.includes(selectedProject.id) : false;
  const filteredProjects = appData.projects
    .filter((project) => project.recordState !== "Void")
    .filter((project) => {
      const query = caseSearch.trim().toLowerCase();
      if (!query) return true;
      return [
        project.name,
        project.caseReason,
        project.type,
        project.openDate,
        ...project.modelIds.map((value) => modelName(appData, value)),
        ...project.supplierIds.map((value) => supplierName(appData, value)),
        ...project.itemIds.map((value) => itemCode(appData, value)),
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
                canDelete={canDeleteRecord(appData, "projects", selectedProject.id)}
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
                <Field label="Model" value={selectedProject.modelIds.map((value) => modelName(appData, value)).join(", ")} />
                <Field label="Reason" value={selectedProject.caseReason} />
                <Field label="Packaging set" value={drawingSetName(appData, selectedProject.drawingSetId)} />
                <Field label="Open date" value={selectedProject.openDate} />
                <Field label="Suppliers" value={`${caseSupplierIds(appData, selectedProject).length} linked`} />
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

export function CaseToolbarSearch({
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

export function Quotes({
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
  const { data: appData } = useAppData();
  const [modeFilter, setModeFilter] = useState<"All" | Quote["quoteType"]>("All");
  const [projectFilter, setProjectFilter] = useState(selectedProjectId || "All");
  const [modelFilter, setModelFilter] = useState("All");
  const [itemFilter, setItemFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"All" | Quote["status"]>("All");

  const filteredQuotes = appData.quotes
    .filter((quote) => quote.recordState !== "Void")
    .filter((quote) => modeFilter === "All" || (modeFilter === "Case-linked" ? quoteHasCaseLink(appData, quote) : !quoteHasCaseLink(appData, quote)))
    .filter((quote) => projectFilter === "All" || quoteAppliesToProject(appData, quote, projectFilter) || (projectFilter === "Standalone" && !quote.projectId))
    .filter((quote) => modelFilter === "All" || quote.modelId === modelFilter)
    .filter((quote) => itemFilter === "All" || quote.itemId === itemFilter)
    .filter((quote) => supplierFilter === "All" || quote.supplierId === supplierFilter)
    .filter((quote) => statusFilter === "All" || quote.status === statusFilter);

  const itemOptions = appData.items.filter((item) => modelFilter === "All" || item.usedForModels.includes(modelFilter));

  return (
    <section className="pageStack">
      <TableToolbar
        action="Add quote"
        extraActions={<button className="ghostButton" onClick={() => exportQuotes(appData, filteredQuotes)} type="button">Export quotes</button>}
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
              {appData.projects.filter(isUsableRecord).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            Model
            <select value={modelFilter} onChange={(event) => {
              setModelFilter(event.target.value);
              setItemFilter("All");
            }}>
              <option value="All">All models</option>
              {appData.models.filter(isUsableRecord).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label>
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)}>
              <option value="All">All items</option>
              {itemOptions.filter(isUsableRecord).map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
            </select>
          </label>
          <label>
            Supplier
            <select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}>
              <option value="All">All suppliers</option>
              {appData.suppliers.filter(isUsableRecord).map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
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
                  <td>{supplierName(appData, quote.supplierId)}</td>
                  <td>{itemCode(appData, quote.itemId)}</td>
                  <td>{modelName(appData, quote.modelId)}</td>
                  <td>{drawingSetName(appData, quote.drawingSetId)}</td>
                  <td><StatusPill label={quoteCaseLabel(appData, quote, projectFilter)} /></td>
                  <td>{formatMoney(quote.unitPrice)}</td>
                  <td>{quote.effectiveFrom ?? quote.quoteDate}</td>
                  <td>{quote.moq}</td>
                  <td>{quote.leadTime}</td>
                  <td><QuoteStatusSelect quote={quote} onChange={onQuoteStatusChange} /></td>
                  <td><StatusPill label={sourceRoleForQuote(appData, quote) ?? "Not assigned"} /></td>
                  <td>
                    <div className="tableActions">
                      <RecordMenu
                        canDelete={canDeleteRecord(appData, "quotes", quote.id)}
                        label={`${supplierName(appData, quote.supplierId)} ${itemCode(appData, quote.itemId)} quote`}
                        onDelete={() => onDelete("quotes", quote.id, "quote")}
                        onEdit={() => onEdit({ endpoint: "quotes", record: quote })}
                        onHistory={() => onHistory("Quote", quote.id, `${supplierName(appData, quote.supplierId)} / ${itemCode(appData, quote.itemId)}`)}
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

export function Comparison({ projectId }: { projectId: string }) {
  const { data: appData } = useAppData();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || appData.projects[0]?.id || "");
  const selectedProject = appData.projects.find((current) => current.id === selectedProjectId);
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
  }, [selectedProjectId, appData.quotes.length, appData.inspections.length]);

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
    const itemQuotes = appData.quotes.filter((quote) => quoteAppliesToProject(appData, quote, selectedProject.id) && quote.itemId === itemId && quote.recordState !== "Void");
    const supplierIds = Array.from(new Set(itemQuotes.map((quote) => quote.supplierId)));
    const itemInspections = appData.inspections.filter((inspection) => inspection.projectId === selectedProject.id && inspection.itemId === itemId && inspection.recordState !== "Void");
    return {
      item: itemById(appData, itemId),
      suppliers: supplierIds.map((supplierId) => ({
        supplier: appData.suppliers.find((supplier) => supplier.id === supplierId),
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
    .filter((row) => isUsableRecord(row.item) && row.suppliers.some((supplier) => (supplier.quotes?.length ?? 0) > 0 || supplier.quote))
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
                const item = itemById(appData, itemId);
                return <option key={itemId} value={itemId}>{item ? `${item.itemCode} - ${item.type}` : itemCode(appData, itemId)}</option>;
              })}
            </select>
          </label>
        </div>
        {!selectedRow ? (
          <EmptyState text="No quoted item is available for this case yet." />
        ) : (
          <div className="tableViewport"><table className="comparisonTable compactComparison">
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
              const inspection = quote ? latestInspectionForQuote(appData, quote.id) : cell.inspection;
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
                  <td>{quote ? qcQueueStatus(appData, quote) : "-"}</td>
                  <td>{supplier ? supplierScore(appData, supplier.id) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        )}
      </Panel>
    </section>
  );
}

export function CaseQuoteWorkbench({
  onSourceRoleChange,
  project,
}: {
  onSourceRoleChange: (input: Omit<SourceAssignment, "id" | "recordState">) => Promise<void>;
  project: AppData["projects"][number];
}) {
  const { data: appData } = useAppData();
  const [selectedItemId, setSelectedItemId] = useState("All");
  useEffect(() => {
    if (selectedItemId !== "All" && !project.itemIds.includes(selectedItemId)) setSelectedItemId("All");
  }, [project.id, project.itemIds, selectedItemId]);
  const visibleItemIds = project.itemIds.filter((itemId) => selectedItemId === "All" || itemId === selectedItemId);
  const rows = buildCaseProgressRows(appData, project, visibleItemIds);
  return (
    <div className="caseWorkbench">
      <div className="caseProgressHeader">
        <h3>Case progress</h3>
        <div className="caseProgressFilters">
          <label>
            <span>Item</span>
            <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
              <option value="All">All items</option>
              {project.itemIds.filter((id) => isUsableRecord(appData.items.find((item) => item.id === id))).map((itemId) => {
                const item = itemById(appData, itemId);
                return <option key={itemId} value={itemId}>{item ? `${item.itemCode} - ${item.type}` : itemCode(appData, itemId)}</option>;
              })}
            </select>
          </label>
        </div>
      </div>
      <div className="tableViewport"><table className="comparisonTable compactComparison">
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
                    <strong>{row.item ? row.item.itemCode : itemCode(appData, row.itemId)}</strong>
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
                    quoteId={row.quote?.id}
                    projectId={project.id}
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
      </table></div>
    </div>
  );
}

export function CaseProgressCell({ inScope = true, inspection, quote }: { inScope?: boolean; inspection?: SampleInspection; quote?: Quote }) {
  const { data: appData } = useAppData();
  if (!quote) {
    return (
      <div className="progressCell">
        <StatusPill label={inScope ? "No quote" : "Not in scope"} />
        <span className="muted">{inScope ? "Waiting for supplier response" : "Supplier capability does not include this item type"}</span>
      </div>
    );
  }

  const progressLabel = isSampleRequestedQuote(quote)
    ? qcQueueStatus(appData, quote)
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
