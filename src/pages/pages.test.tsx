// Test files are outside tsconfig.json, so the JSX runtime the app uses is named here.
/** @jsxRuntime automatic */
/** @jsxImportSource react */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";

import { sampleStore } from "../../server/testFixtures";
import type { AppData } from "../api";
import { AppDataProvider } from "../AppDataContext";
import { fallbackData } from "../appDefaults";
import { SessionProvider } from "../SessionContext";
import { WorkflowActionsProvider } from "../WorkflowActionsContext";
import { Dashboard } from "./Dashboard";
import { PriceAnalytics, PriceChanges } from "./Pricing";
import { DrawingSets, ModelsAndItems } from "./ProductsAndDrawings";
import { IncomingDefects, SampleInspections } from "./QCInspections";
import { Scorecard } from "./Reports";
import { Quotes, SourcingProjects } from "./SourcingWorkbench";
import { Suppliers } from "./Suppliers";

// These draw each page once, as the server would, against a data set. They catch a
// page that throws while rendering; they do not click anything or run effects.

const noop = () => undefined;
const recordActions = { onDelete: noop, onEdit: noop, onHistory: noop, onVoid: noop };

function sampleData(): AppData {
  const { scoreWeights: _scoreWeights, ...data } = sampleStore();
  return data;
}

function render(page: ReactElement, data: AppData): string {
  // React separates adjacent text with empty comments; dropping them leaves the text as a reader sees it.
  return renderToString(
    <SessionProvider>
      <AppDataProvider initialData={data}>
        <WorkflowActionsProvider openQc={noop}>{page}</WorkflowActionsProvider>
      </AppDataProvider>
    </SessionProvider>,
  ).replaceAll("<!-- -->", "");
}

function pages(data: AppData): Array<[name: string, page: ReactElement]> {
  const caseId = data.projects[0]?.id ?? "";
  return [
    ["Dashboard", <Dashboard />],
    ["Suppliers", <Suppliers onAdd={noop} {...recordActions} />],
    ["Models & Items", <ModelsAndItems onAddItem={noop} onAddModel={noop} onImport={noop} {...recordActions} />],
    ["Packaging Sets", <DrawingSets onAdd={noop} {...recordActions} />],
    ["Development Cases", <SourcingProjects onAdd={noop} onAddQuote={noop} onSourceRoleChange={noop} selectedProjectId={caseId} setSelectedProjectId={noop} {...recordActions} />],
    ["Quotes", <Quotes onAdd={noop} onQuoteStatusChange={noop} selectedProjectId={caseId} {...recordActions} />],
    ["Sample Inspections", <SampleInspections onAdd={noop} onRecordQuote={noop} onView={noop} {...recordActions} />],
    ["Incoming Defects", <IncomingDefects onAdd={noop} onView={noop} {...recordActions} />],
    ["Price Analytics", <PriceAnalytics />],
    ["Price Changes", <PriceChanges {...recordActions} />],
    ["Scorecard", <Scorecard />],
  ];
}

test("every page draws against sample records", () => {
  const data = sampleData();
  for (const [name, page] of pages(data)) {
    assert.doesNotThrow(() => render(page, data), name);
  }
});

test("every page draws against an empty database", () => {
  for (const [name, page] of pages(fallbackData)) {
    assert.doesNotThrow(() => render(page, fallbackData), name);
  }
});

test("the quote table shows one page of a long list and the whole of a short one", () => {
  const data = sampleData();
  const template = data.quotes[0];
  assert.ok(template, "the sample data has a quote");

  const short = render(<Quotes onAdd={noop} onQuoteStatusChange={noop} selectedProjectId="" {...recordActions} />, data);
  assert.ok(!short.includes('class="pager"'));

  const many = { ...data, quotes: Array.from({ length: 120 }, (_, index) => ({ ...template, id: `q-${5000 + index}`, moq: `row-${index}-moq` })) };
  const long = render(<Quotes onAdd={noop} onQuoteStatusChange={noop} selectedProjectId="" {...recordActions} />, many);
  assert.ok(long.includes('class="pager"'));
  assert.ok(long.includes("1–50 of 120"));
  assert.ok(long.includes("Page 1 of 3"));
  assert.ok(long.includes("row-49-moq"));
  assert.ok(!long.includes("row-50-moq"));
});
