import { useAppData } from "../AppDataContext";
import { isPublishedRecord, canDeleteRecord } from "../lib/recordLifecycle";
import { useState } from "react";
import { isSelectedQuote } from "../lib/sourcing";
import { supplierName, itemCode, modelName, priceChangeReference } from "../lib/lookups";
import { buildQuotePriceChartRows } from "../lib/priceCharts";
import { Panel } from "../components/Panel";
import { FilterGroup } from "../components/FilterGroup";
import { EmptyState } from "../components/EmptyState";
import { ResponsiveContainer, LineChart as RechartsLineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Line } from "recharts";
import { priceAnalyticsDomain, chartColor } from "../lib/charts";
import { formatMoney } from "../lib/format";
import { type DeleteHandler, type EditTarget, type HistoryHandler, type VoidHandler } from "../uiTypes";
import { StatusPill } from "../components/StatusPill";
import { LifecyclePill } from "../components/LifecyclePill";
import { RecordMenu } from "../components/RecordMenu";

export function PriceAnalytics() {
  const { data: appData } = useAppData();
  const activeItems = appData.items.filter((item) => isPublishedRecord(item) && item.recordState !== "Void");
  const activeSuppliers = appData.suppliers.filter((supplier) => isPublishedRecord(supplier) && supplier.recordState !== "Void");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>(activeItems.slice(0, 3).map((item) => item.id));
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>(activeSuppliers.slice(0, 3).map((supplier) => supplier.id));
  const [sourceFilter, setSourceFilter] = useState<"All Quotes" | "Selected Quotes">("Selected Quotes");

  const visibleQuotes = appData.quotes.filter(
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
      ...(includeAllQuoteSeries ? chartQuotes.map((quote) => `${supplierName(appData, quote.supplierId)} all quotes`) : []),
      ...(includeSelectedSeries ? chartQuotes.filter(isSelectedQuote).map((quote) => `${supplierName(appData, quote.supplierId)} selected`) : []),
    ]),
  );
  const chartRows = buildQuotePriceChartRows(appData, chartQuotes, includeAllQuoteSeries, includeSelectedSeries);
  const detailRows = chartQuotes.map((quote) => ({
      id: quote.id,
      date: quote.effectiveFrom ?? quote.quoteDate,
      source: isSelectedQuote(quote) ? "Selected Quote" : "Quote",
      supplier: supplierName(appData, quote.supplierId),
      item: itemCode(appData, quote.itemId),
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
        <div className="tableViewport"><table>
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
        </table></div>
      </Panel>
    </section>
  );
}

export function PriceChanges({
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
  const { data: appData } = useAppData();
  const activePriceChanges = appData.priceChanges.filter((change) => change.recordState !== "Void");
  return (
    <section className="pageStack">
      <Panel title="Price change events">
        <div className="tableViewport"><table>
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
                  <td>{supplierName(appData, change.supplierId)}</td>
                  <td>{modelName(appData, change.modelId)}</td>
                  <td>{itemCode(appData, change.itemId)}</td>
                  <td>{change.sourceType}</td>
                  <td>{priceChangeReference(appData, change.previousQuoteId, change.previousPurchasePriceId)}</td>
                  <td>{priceChangeReference(appData, change.sourceQuoteId, change.sourcePurchasePriceId)}</td>
                  <td>{formatMoney(change.oldPrice)}</td>
                  <td>{formatMoney(change.newPrice)}</td>
                  <td className={percent < 0 ? "positive" : "negative"}>{percent.toFixed(1)}%</td>
                  <td>{change.reason}</td>
                  <td><StatusPill label={change.status} /></td>
                  <td>
                    <div className="tableActions">
                      <LifecyclePill record={change} />
                      <RecordMenu
                        canDelete={canDeleteRecord(appData, "price-changes", change.id)}
                        label={`${supplierName(appData, change.supplierId)} ${itemCode(appData, change.itemId)} price change`}
                        onDelete={() => onDelete("price-changes", change.id, "price change")}
                        onEdit={() => onEdit({ endpoint: "price-changes", record: change })}
                        onHistory={() => onHistory("PriceChange", change.id, `${supplierName(appData, change.supplierId)} / ${itemCode(appData, change.itemId)} price change`)}
                        onVoid={() => onVoid("price-changes", change.id, "price change")}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Panel>
    </section>
  );
}
