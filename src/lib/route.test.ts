import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultViewState, viewFromLocation, viewPath, type ViewState } from "./route";

const view = (patch: Partial<ViewState>): ViewState => ({ ...defaultViewState, ...patch });

test("the Dashboard is the root address", () => {
  assert.equal(viewPath(defaultViewState), "/");
  assert.deepEqual(viewFromLocation("/", ""), defaultViewState);
});

test("a section's address names the tab open in it", () => {
  assert.equal(viewPath(view({ section: "Suppliers" })), "/suppliers");
  assert.equal(viewPath(view({ section: "Products & Drawings", productsTab: "Packaging Sets" })), "/products/packaging-sets");
  assert.equal(viewPath(view({ section: "QC Inspections", qcTab: "Incoming Defects" })), "/qc/defects");
  assert.equal(viewPath(view({ section: "Admin", adminTab: "Audit log" })), "/admin/audit");
});

test("only sourcing addresses carry the selected case", () => {
  assert.equal(viewPath(view({ section: "Sourcing Workbench", sourcingTab: "Comparison", caseId: "proj-1002" })), "/sourcing/comparison?case=proj-1002");
  assert.equal(viewPath(view({ section: "Sourcing Workbench" })), "/sourcing/cases");
  assert.equal(viewPath(view({ section: "Pricing", caseId: "proj-1002" })), "/pricing/analytics");
});

test("every view comes back from its own address", () => {
  const views: ViewState[] = [
    view({ section: "Suppliers" }),
    view({ section: "Products & Drawings", productsTab: "Packaging Sets" }),
    view({ section: "Sourcing Workbench", sourcingTab: "Quotes", caseId: "proj-1002" }),
    view({ section: "Pricing", pricingTab: "Price Changes" }),
    view({ section: "QC Inspections", qcTab: "Incoming Defects" }),
    view({ section: "Reports", reportsTab: "Score Settings" }),
    view({ section: "Admin", adminTab: "Audit log" }),
  ];
  for (const expected of views) {
    const [pathname, search = ""] = viewPath(expected).split("?");
    assert.deepEqual(viewFromLocation(pathname, search ? `?${search}` : ""), expected);
  }
});

test("an address keeps the tabs and case of the sections it does not name", () => {
  const current = view({ section: "Sourcing Workbench", sourcingTab: "Quotes", qcTab: "Incoming Defects", caseId: "proj-1002" });
  assert.deepEqual(viewFromLocation("/pricing/changes", "", current), { ...current, section: "Pricing", pricingTab: "Price Changes" });
});

test("a section address without a tab opens the tab last used there", () => {
  const current = view({ reportsTab: "Score Settings" });
  assert.deepEqual(viewFromLocation("/reports", "", current), { ...current, section: "Reports" });
  assert.deepEqual(viewFromLocation("/reports/nothing", "", current), { ...current, section: "Reports" });
});

test("an unknown address opens the Dashboard", () => {
  assert.deepEqual(viewFromLocation("/nowhere/at-all", "?case=proj-1"), defaultViewState);
});

test("a case ID with reserved characters survives the address", () => {
  const expected = view({ section: "Sourcing Workbench", caseId: "proj 1&2" });
  const [pathname, search] = viewPath(expected).split("?");
  assert.deepEqual(viewFromLocation(pathname, `?${search}`), expected);
});
