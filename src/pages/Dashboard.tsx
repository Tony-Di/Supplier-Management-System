import { useAppData } from "../AppDataContext";
import { useState, useEffect } from "react";
import { isActiveSourceRole, averageLeadTimeForActiveSourceSuppliers, isSelectedQuote, sourceRoleRank, sourceRoleLabel } from "../lib/sourcing";
import { buildDashboardPriceTrendRows } from "../lib/priceCharts";
import { supplierName, itemCode } from "../lib/lookups";
import { averageScore, aggregateRecentDefectsBySupplier, scoreIssueSummary } from "../lib/scorecard";
import { isUsableRecord } from "../lib/recordOptions";
import { useScorecard } from "../useScorecard";
import { Metric } from "../components/Metric";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { ResponsiveContainer, LineChart as RechartsLineChart, CartesianGrid, XAxis, YAxis, Tooltip, Line } from "recharts";
import { formatMonthTick, formatMoney } from "../lib/format";
import { dashboardPriceDomain, chartColor } from "../lib/charts";
import { AlertRow } from "../components/AlertRow";

export function Dashboard() {
  const { data: appData } = useAppData();
  const { rows: scorecardRows } = useScorecard();
  const activeItems = appData.items.filter((item) => item.recordState !== "Void");
  const activeSuppliers = appData.suppliers.filter((supplier) => supplier.recordState !== "Void");
  const [selectedItemId, setSelectedItemId] = useState(activeItems[0]?.id ?? "");
  useEffect(() => {
    if (!selectedItemId && activeItems[0]) setSelectedItemId(activeItems[0].id);
    if (selectedItemId && !activeItems.some((item) => item.id === selectedItemId)) setSelectedItemId(activeItems[0]?.id ?? "");
  }, [activeItems, selectedItemId]);
  const selectedItem = activeItems.find((item) => item.id === selectedItemId);
  const activeSourceAssignments = appData.sourceAssignments.filter((assignment) => assignment.recordState !== "Void");
  const activeSourceSupplierIds = new Set(activeSourceAssignments.filter((assignment) => isActiveSourceRole(assignment.role)).map((assignment) => assignment.supplierId));
  const activeSupplierCount = activeSourceSupplierIds.size;
  const activeSupplierLeadTimeDays = averageLeadTimeForActiveSourceSuppliers(appData, activeSourceAssignments);
  const selectedQuotes = appData.quotes.filter((quote) => quote.recordState !== "Void" && isSelectedQuote(quote));
  const selectedItemQuotes = selectedItem ? selectedQuotes.filter((quote) => quote.itemId === selectedItem.id) : [];
  const priceTrendRows = buildDashboardPriceTrendRows(appData, selectedItemQuotes);
  const selectedSeries = Array.from(new Set(selectedItemQuotes.map((quote) => supplierName(appData, quote.supplierId))));
  const latestChanges = [...appData.priceChanges]
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
        .sort((a, b) => sourceRoleRank(a.role) - sourceRoleRank(b.role) || supplierName(appData, a.supplierId).localeCompare(supplierName(appData, b.supplierId)))
    : [];
  const unassignedCapableSuppliers = selectedItem
    ? itemSupplierOptions.filter((supplier) => !selectedItemAssignments.some((assignment) => assignment.supplierId === supplier.id))
    : [];
  const supplierScoreRows = (scorecardRows ?? []).filter((row) => isUsableRecord(row.supplier));
  const activeSupplierScoreRows = supplierScoreRows.filter((row) => activeSourceSupplierIds.has(row.supplier.id));
  const activeAverageSupplierScore = averageScore(activeSupplierScoreRows);
  const lowScoreSuppliers = supplierScoreRows.filter((row) => row.score < 55).sort((a, b) => a.score - b.score).slice(0, 4);
  const recentDefectQtyBySupplier = aggregateRecentDefectsBySupplier(appData, 90);
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
        <Metric label="Average Score" value={scorecardRows ? activeAverageSupplierScore.toString() : "-"} sub="average score for active suppliers only" />
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
                      title={`${sourceRoleLabel(assignment.role)} - ${supplierName(appData, assignment.supplierId)}`}
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
                <AlertRow key={`score-${row.supplier.id}`} title={row.supplier.name} text={`Low supplier score: ${row.score} / ${scoreIssueSummary(appData, row)}`} />
              ))
            )}
          </RiskGroup>
          <RiskGroup title="Quality risk">
            {defectRiskRows.length === 0 ? (
              <EmptyState text="No supplier above the recent defect threshold." />
            ) : (
              defectRiskRows.map(([supplierId, qty]) => (
                <AlertRow key={`defect-${supplierId}`} title={supplierName(appData, supplierId)} text={`${qty} incoming defect qty in last 90 days`} />
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
                  title={`${itemCode(appData, change.itemId)} ${change.sourceType.toLowerCase()}`}
                  text={`${supplierName(appData, change.supplierId)} effective ${change.effectiveDate}`}
                />
              ))
            )}
          </RiskGroup>
        </div>
      </Panel>
    </section>
  );
}

export function RiskGroup({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="riskGroup">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
