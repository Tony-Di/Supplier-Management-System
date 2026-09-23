import { isUsableRecord } from "../lib/recordOptions";
import { useAppData } from "../AppDataContext";
import { useState, useEffect, useMemo, CSSProperties } from "react";
import { type ScorecardRow, fetchScorecard, updateScoreWeights } from "../api";
import { useScorecard } from "../useScorecard";
import { type ScorecardSortKey } from "../uiTypes";
import { scorecardSortValue, sortedScoreCategories, scoreCategoryColor, scoreIssueSummary, scoreDonutSegments } from "../lib/scorecard";
import { Panel } from "../components/Panel";
import { FilterGroup } from "../components/FilterGroup";
import { scorecardSortOptions } from "../constants";
import { EmptyState } from "../components/EmptyState";
import { type ScoreWeights } from "../types";
import { Metric } from "../components/Metric";
import { CircleHelp } from "lucide-react";
import { useSession } from "../SessionContext";

export function Scorecard() {
  const { data: appData } = useAppData();
  const { rows: serverRows, error: scorecardError } = useScorecard();
  const [itemFilter, setItemFilter] = useState("All");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(() => appData.suppliers.map((supplier) => supplier.id));
  const [featuredSupplierId, setFeaturedSupplierId] = useState(appData.suppliers[0]?.id ?? "");
  const [sortBy, setSortBy] = useState<ScorecardSortKey>("Score");

  const allRows = useMemo(() => (serverRows ?? []).filter((row) => isUsableRecord(row.supplier)), [serverRows]);
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
    const item = itemFilter === "All" ? undefined : appData.items.find((candidate) => candidate.id === itemFilter);
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
      {scorecardError && <div className="notice errorNotice">Supplier scores are unavailable: {scorecardError}</div>}
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
              {appData.items.filter(isUsableRecord).map((item) => <option key={item.id} value={item.id}>{item.itemCode} - {item.itemName}</option>)}
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
                  <td>{scoreIssueSummary(appData, { supplier, score, documentsComplete, grade, categories, scopeLabel } as ScorecardRow)}</td>
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

export function ScoreCell({ category }: { category?: ScorecardRow["categories"][number] }) {
  if (!category) return <span className="muted">Not scored</span>;
  return (
    <span className="scoreCell" title={category.detail}>
      <strong>{category.score}</strong>
      <span>/{category.max}</span>
    </span>
  );
}

export function ScoreDonut({ row }: { row: ScorecardRow }) {
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

export function ScoreSettings({ onSaved }: { onSaved: () => Promise<void> }) {
  const { user } = useSession();
  const canEdit = user?.role === "admin";
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
          <WeightInput readOnly={!canEdit} help="Uses QC sample pass/fail rounds. It is a Quality sub-weight, not a standalone KPI column." label="Sample Quality" onChange={(value) => updateWeight("sampleQuality", value)} value={weights.sampleQuality} />
          <WeightInput readOnly={!canEdit} help="Uses incoming rejected or defect quantity in the last 90 days: under 5 full score, under 10 about 75%, under 20 about 45%, 20+ about 15%." label="Incoming Quality" onChange={(value) => updateWeight("incomingQuality", value)} value={weights.incomingQuality} />
          <WeightInput readOnly={!canEdit} help="Improves with selected and shortlisted quote history for the supplier." label="Pricing" onChange={(value) => updateWeight("pricing", value)} value={weights.pricing} />
          <WeightInput readOnly={!canEdit} help="Currently uses quote activity and quoted lead time as the first response proxy." label="Responsiveness" onChange={(value) => updateWeight("responsiveness", value)} value={weights.responsiveness} />
          <WeightInput readOnly={!canEdit} help="Checks whether the supplier performs within its declared supply scope, without penalizing single-category specialists." label="Scope Fit" onChange={(value) => updateWeight("scopeFit", value)} value={weights.scopeFit} />
          <WeightInput readOnly={!canEdit} help="Scores quoted lead time. Shorter average lead time earns a higher score." label="Lead Time" onChange={(value) => updateWeight("setup", value)} value={weights.setup} />
        </div>
        <div className="scoreSettingsFooter">
          <strong className={total === 100 ? "positive" : "negative"}>Total {total}</strong>
          {canEdit ? (
            <button className="primaryButton" disabled={saving || total !== 100} onClick={save} type="button">
              {saving ? "Saving..." : "Save KPI weights"}
            </button>
          ) : (
            <span className="muted">Only admins can change KPI weights.</span>
          )}
        </div>
      </Panel>
    </section>
  );
}

export function WeightInput({
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
