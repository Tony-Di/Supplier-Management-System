import { useState, useEffect } from "react";
import { type Section, type ProductsTab, type SourcingTab, type PricingTab, type QCTab, type ReportsTab, type EditTarget, type VoidTarget, type ViewTarget } from "./uiTypes";
import { useAppData } from "./AppDataContext";
import { fallbackData } from "./appDefaults";
import { type DeleteEndpoint, deleteRecord, voidRecord, updateRecord, upsertSourceAssignment } from "./api";
import { markRecordVoid } from "./lib/recordLifecycle";
import { type Quote, type SourceAssignment } from "./types";
import { AppShell } from "./components/AppShell";
import { SubTabs } from "./components/SubTabs";
import { Dashboard } from "./pages/Dashboard";
import { Suppliers } from "./pages/Suppliers";
import { ModelsAndItems, DrawingSets } from "./pages/ProductsAndDrawings";
import { SourcingProjects, Quotes, Comparison } from "./pages/SourcingWorkbench";
import { SampleInspections, IncomingDefects } from "./pages/QCInspections";
import { PriceAnalytics, PriceChanges } from "./pages/Pricing";
import { Scorecard, ScoreSettings } from "./pages/Reports";
import { SupplierModal } from "./modals/SupplierModal";
import { ItemModal } from "./modals/ItemModal";
import { ModelModal } from "./modals/ModelModal";
import { ItemImportModal } from "./modals/ItemImportModal";
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
  const [section, setSection] = useState<Section>("Dashboard");
  const [productsTab, setProductsTab] = useState<ProductsTab>("Models & Items");
  const [sourcingTab, setSourcingTab] = useState<SourcingTab>("Development Cases");
  const [pricingTab, setPricingTab] = useState<PricingTab>("Price Analytics");
  const [qcTab, setQcTab] = useState<QCTab>("Sample Inspections");
  const [reportsTab, setReportsTab] = useState<ReportsTab>("Scorecard");
  const { data, setData, refresh: refreshData, loading, error } = useAppData();
  const [actionError, setActionError] = useState("");
  const [modal, setModal] = useState<"supplier" | "model" | "item" | "itemImport" | "drawingSet" | "project" | "quote" | "inspection" | "incomingDefect" | "priceChange" | "scoreSettings" | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null);
  const [viewTarget, setViewTarget] = useState<ViewTarget | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState(fallbackData.projects[0]?.id ?? "");
  const [inspectionQuoteId, setInspectionQuoteId] = useState<string | undefined>();
  const [historyTarget, setHistoryTarget] = useState<{ entityType: string; entityId: string; label: string } | null>(null);

  useEffect(() => {
    setSelectedProjectId((current) => current || data.projects[0]?.id || "");
  }, [data.projects]);

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

  return (
    <AppShell section={section} onSectionChange={setSection}>
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
    </AppShell>
  );
}
