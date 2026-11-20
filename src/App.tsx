import { availableRecordOptions } from "./lib/recordOptions";
import { sourceRoleEligibility } from "./lib/sourceRoleEligibility";
import { WorkflowActionsProvider } from "./WorkflowActionsContext";
import { ErrorNotice } from "./components/ErrorNotice";
import { type QuoteStatusChange } from "./components/QuoteStatusSelect";
import { VoidedRecords } from "./components/VoidedRecords";
import { useState, useEffect, useMemo } from "react";
import { type ProductsTab, type SourcingTab, type PricingTab, type QCTab, type ReportsTab, type AdminTab, type EditTarget, type VoidTarget, type ViewTarget } from "./uiTypes";
import { rememberRequestedAddress, useNavigation } from "./useNavigation";
import { useSession } from "./SessionContext";
import { SignIn } from "./SignIn";
import { AppDataProvider, useAppData } from "./AppDataContext";
import { type DeleteEndpoint, deleteRecord, voidRecord, updateRecord, upsertSourceAssignment } from "./api";
import { markRecordVoid } from "./lib/recordLifecycle";
import { type SourceAssignment } from "./types";
import { AppShell } from "./components/AppShell";
import { SubTabs } from "./components/SubTabs";
import { Dashboard } from "./pages/Dashboard";
import { Suppliers } from "./pages/Suppliers";
import { ModelsAndItems, DrawingSets } from "./pages/ProductsAndDrawings";
import { SourcingProjects, Quotes, Comparison } from "./pages/SourcingWorkbench";
import { SampleInspections, IncomingDefects } from "./pages/QCInspections";
import { PriceAnalytics, PriceChanges } from "./pages/Pricing";
import { Scorecard, ScoreSettings } from "./pages/Reports";
import { AdminUsers } from "./pages/AdminUsers";
import { AuditLog } from "./pages/AuditLog";
import { SupplierModal } from "./modals/SupplierModal";
import { ItemModal } from "./modals/ItemModal";
import { ModelModal } from "./modals/ModelModal";
import { ProductImportModal } from "./modals/ProductImportModal";
import { ProjectModal } from "./modals/ProjectModal";
import { DrawingSetModal } from "./modals/DrawingSetModal";
import { QuoteModal } from "./modals/QuoteModal";
import { InspectionModal } from "./modals/InspectionModal";
import { IncomingDefectModal } from "./modals/IncomingDefectModal";
import { PriceChangeModal } from "./modals/PriceChangeModal";
import { ScoreSettingsModal } from "./modals/ScoreSettingsModal";
import { EditRecordModal } from "./modals/record/EditRecordModal";
import { VoidRecordModal } from "./modals/record/VoidRecordModal";
import { HistoryModal } from "./modals/record/HistoryModal";
import { RecordDetailModal } from "./modals/record/RecordDetailModal";

export function App() {
  const { user, loading: sessionLoading } = useSession();
  const deactivated = new URLSearchParams(window.location.search).get("error") === "deactivated";
  // A link followed while signed out opens once sign-in has brought the visitor back.
  useEffect(() => {
    if (!sessionLoading && !user) rememberRequestedAddress();
  }, [sessionLoading, user]);
  if (sessionLoading) return <div className="signInLoading">Loading…</div>;
  if (!user) return <SignIn deactivated={deactivated} />;
  return (
    <AppDataProvider>
      <Workbench />
    </AppDataProvider>
  );
}

function Workbench() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const { view, navigate } = useNavigation();
  const { section, productsTab, sourcingTab, pricingTab, qcTab, reportsTab, adminTab, caseId: selectedProjectId } = view;
  const { data, setData, refresh: refreshData, loading, error } = useAppData();
  const recordOptions = useMemo(() => availableRecordOptions(data), [data]);
  const [actionError, setActionError] = useState("");
  const [modal, setModal] = useState<"supplier" | "model" | "item" | "productImport" | "drawingSet" | "project" | "quote" | "inspection" | "incomingDefect" | "priceChange" | "scoreSettings" | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [inspectionCaseContextId, setInspectionCaseContextId] = useState<string | undefined>();
  const [inspectionQuoteId, setInspectionQuoteId] = useState<string | undefined>();
  const [historyTarget, setHistoryTarget] = useState<{ entityType: string; entityId: string; label: string } | null>(null);

  // Not something the user asked for, so neither change adds a history entry.
  useEffect(() => {
    if (!selectedProjectId && data.projects[0]) navigate({ caseId: data.projects[0].id }, { replace: true });
  }, [data.projects, selectedProjectId, navigate]);

  useEffect(() => {
    if (section === "Admin" && !isAdmin) navigate({ section: "Dashboard" }, { replace: true });
  }, [section, isAdmin, navigate]);

  useEffect(() => {
    document.title = section === "Dashboard" ? "Global Sourcing Workbench" : `${section} · Global Sourcing Workbench`;
  }, [section]);

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
      throw requestError;
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
      throw requestError;
    }
  }

  async function handleQuoteStatusChange(quoteId: string, change: QuoteStatusChange) {
    try {
      setActionError("");
      await updateRecord("quotes", quoteId, change);
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
    if (isAdmin) setHistoryTarget({ entityType, entityId, label });
  }

  function openQc(quoteId: string, projectId?: string) {
    const quote = data.quotes.find((record) => record.id === quoteId);
    const { inspection } = sourceRoleEligibility(data, quote, projectId);
    if (inspection) { setViewTarget({ type: "inspection", record: inspection }); return; }
    navigate({ section: "QC Inspections", qcTab: "Sample Inspections" });
    setInspectionQuoteId(quoteId);
    setInspectionCaseContextId(projectId);
    setModal("inspection");
  }

  return (
    <WorkflowActionsProvider openQc={openQc}>
    <AppShell section={section} onSectionChange={(next) => navigate({ section: next })}>
        <ErrorNotice message={actionError} onDismiss={() => setActionError("")} />
        {section === "Products & Drawings" && (
          <SubTabs
            tabs={["Models & Items", "Packaging Sets"]}
            activeTab={productsTab}
            onChange={(tab) => navigate({ productsTab: tab as ProductsTab })}
          />
        )}
        {section === "Sourcing Workbench" && (
          <SubTabs
            tabs={["Development Cases", "Quotes", "Comparison"]}
            activeTab={sourcingTab}
            onChange={(tab) => navigate({ sourcingTab: tab as SourcingTab })}
          />
        )}
        {section === "Pricing" && (
          <SubTabs tabs={["Price Analytics", "Price Changes"]} activeTab={pricingTab} onChange={(tab) => navigate({ pricingTab: tab as PricingTab })} />
        )}
        {section === "QC Inspections" && (
          <SubTabs tabs={["Sample Inspections", "Incoming Defects"]} activeTab={qcTab} onChange={(tab) => navigate({ qcTab: tab as QCTab })} />
        )}
        {section === "Reports" && (
          <SubTabs tabs={["Scorecard", "Score Settings"]} activeTab={reportsTab} onChange={(tab) => navigate({ reportsTab: tab as ReportsTab })} />
        )}
        {section === "Admin" && isAdmin && (
          <SubTabs tabs={["Users", "Audit log"]} activeTab={adminTab} onChange={(tab) => navigate({ adminTab: tab as AdminTab })} />
        )}

        {loading && <div className="notice">Loading backend data...</div>}
        <ErrorNotice message={error} title="Unable to refresh records" />

        {section === "Dashboard" && <Dashboard />}
        {section === "Admin" && isAdmin && adminTab === "Users" && <AdminUsers />}
        {section === "Admin" && isAdmin && adminTab === "Audit log" && <AuditLog />}
        {section === "Suppliers" && <Suppliers onAdd={() => setModal("supplier")} onDelete={handleDelete} onEdit={setEditTarget} onHistory={openHistory} onVoid={handleVoid} />}
        {section === "Products & Drawings" && productsTab === "Models & Items" && (
          <ModelsAndItems
            onAddItem={() => setModal("item")}
            onAddModel={() => setModal("model")}
            onDelete={handleDelete}
            onEdit={setEditTarget}
            onHistory={openHistory}
            onImport={() => setModal("productImport")}
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
            setSelectedProjectId={(id) => navigate({ caseId: id })}
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

        <VoidedRecords section={section} onHistory={openHistory} />
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
            models={recordOptions.models}
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
        {modal === "productImport" && (
          <ProductImportModal
            data={recordOptions}
            onClose={() => setModal(null)}
            onImported={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "project" && (
          <ProjectModal
            data={recordOptions}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "drawingSet" && (
          <DrawingSetModal
            data={recordOptions}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "quote" && (
          <QuoteModal
            data={recordOptions}
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
            data={recordOptions}
            projectId={selectedProject?.id}
            quoteId={inspectionQuoteId}
            caseContextId={inspectionCaseContextId}
            onClose={() => { setModal(null); setInspectionCaseContextId(undefined); }}
            onCreated={async () => {
              setModal(null);
              setInspectionQuoteId(undefined);
              setInspectionCaseContextId(undefined);
              await refreshData();
            }}
          />
        )}
        {modal === "incomingDefect" && (
          <IncomingDefectModal
            data={recordOptions}
            onClose={() => setModal(null)}
            onCreated={async () => {
              setModal(null);
              await refreshData();
            }}
          />
        )}
        {modal === "priceChange" && (
          <PriceChangeModal
            data={recordOptions}
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
        {historyTarget && isAdmin && (
          <HistoryModal
            entityId={historyTarget.entityId}
            entityType={historyTarget.entityType}
            label={historyTarget.label}
            onClose={() => setHistoryTarget(null)}
          />
        )}
        {viewTarget && <RecordDetailModal onClose={() => setViewTarget(null)} target={viewTarget} />}
    </AppShell>
    </WorkflowActionsProvider>
  );
}
