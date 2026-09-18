# Frontend plan: split App.tsx, then apply the SEG design

A handoff brief. Two jobs, in this order: **split the file without changing
behaviour**, then **apply the design**. Doing them together makes review
impossible — a restyle hidden inside a 6,000-line move is unreviewable.

## Ground truth (measured, not assumed)

- `src/App.tsx` is **6,434 lines**: every screen, every modal, every helper.
- `src/styles.css` is **2,290 lines** of global classes, no CSS modules.
- There is **no router**. Navigation is `useState<Section>` in `App()`.
- Data lives in **module-level mutable bindings** — `let suppliers`, `let models`,
  … at `src/App.tsx:161-174`, reassigned mid-render at lines 279-292 from the
  `data` state. Roughly 55 call sites read them directly instead of taking props.
  **This is the single biggest hazard in the split** — see phase 2.
- Backend errors arrive as `Error(message)` from `request()` in
  `src/api.ts:77-92`; the API returns `{ message }` with HTTP 400.
- Tests: `npm test` (32 cases, node:test via tsx). They cover `src/leadTime.ts`,
  `server/storeFile.ts`, `server/rules.ts` — no frontend tests exist yet.

## Verification — run all four after every phase

```bash
npm test                              # 32 passing
npm run typecheck:api                 # server + shared modules
npx tsc -p tsconfig.json --noEmit     # frontend
npm run build                         # vite build
```

Then a manual smoke pass with both servers running (`npm run dev:api`,
`npm run dev`): open each of the seven sections, create one quote, record one
inspection, and confirm the dashboard and scorecard numbers are unchanged from
before the phase. **Back up `data/store.json` first** — it is git-ignored and
exists only on this machine.

Commit once per phase. Never mix a move with an edit in the same commit.

---

## Phase 1 — extract pure helpers (no JSX, no globals)

These functions already take everything they need as arguments. Move them as-is;
do not rewrite them.

| New file | Move from `src/App.tsx` |
| --- | --- |
| `src/lib/format.ts` | `formatMoney` 6193, `formatDecimalPrice` 6197, `csvCell` 6204, `formatMonthTick` 6267, `todayDateString` 6386, `formatFileSize` 6425, `formatAuditDate` 6411, `formatAuditValue` 6418, `clamp` 5935 |
| `src/lib/score.ts` | `scoreIncomingQuality` 5939, `scoreLeadTime` 5946, `scorePricingCompetitiveness` 5955, `quotePriceCompetitiveness` 5964, `pricingDetail` 5981, `scorePaymentTerms` 5990, `paymentTermDays` 6000, `isWithinRecentDays` 6005 |
| `src/lib/defects.ts` | `incomingDefectAcceptedReplacementQty` 6025, `incomingDefectCurrentReceivedQty` 6031, `incomingDefectPendingQty` 6035, `isIncomingDefectComplete` 6042, `isIncomingDefectPendingReceive` 6047, `sumDefectQty` 6012, `sumReturnedDefectQty` 6018 |
| `src/lib/charts.ts` | `buildQuotePriceChartRows` 6209, `buildDashboardPriceTrendRows` 6230, `dashboardPriceDomain` 6243, `priceAnalyticsDomain` 6247, `chartColor` 6274 |
| `src/lib/import.ts` | `parseItemImportRows` 6279, `parseDrawingImportRows` 6298, `buildDrawingRowsFromModelItems` 6312, `nextPackagingSetRevision` 6320, `findDuplicateItemCodes` 5666 |

Line numbers are from today's `App.tsx` and shift as you go — take them as a map,
confirm each by name.

**Write a test for each file you create**, before moving the code: these are pure
functions, so a test is cheap and it is what proves the move changed nothing.
`src/leadTime.test.ts` is the pattern to copy. `parseItemImportRows` and
`incomingDefectPendingQty` carry real business rules and deserve the most cases.

**Do not** move `buildSupplierScorecard` (5815) in this phase — it reads the
module globals. It belongs to phase 2.

## Phase 2 — remove the module-level globals

The blocker for everything else. Today any component can reach `suppliers`
directly, so a component cannot be moved to its own file without dragging the
whole graph with it.

1. Create `src/AppDataContext.tsx`: a provider holding the `AppData` state and
   the `refreshData` callback (today `App()` at `src/App.tsx:176` onwards), plus
   `useAppData()` returning `{ data, refresh, loading, error }`.
2. Convert the lookup helpers that read globals — `supplierName` 6325,
   `projectName` 6329, `modelName` 6337, `itemById` 6366, `itemCode` 6370,
   `drawingSetName` 6341, `quoteLabel` 6375, `fileRecord` 6402, and the case
   helpers at 3440-3860 — into functions that take the slice of data they need as
   their first argument. Mechanical, but there are many call sites; do it
   helper by helper and keep the build green between each.
3. Convert `buildSupplierScorecard` 5815 and `supplierScore` 5808 the same way.
   Note `server/business.ts` has a second copy of this scoring logic — leave the
   server alone for now, but record any drift you find; the two are supposed to
   agree and the backend is authoritative (`GET /api/scorecard`).
4. Delete the `let` bindings at 161-174 and the assignments at 279-292.

Behaviour must not change. The scorecard and the dashboard numbers before and
after this phase are your regression check.

## Phase 3 — split the components

Only now is this safe. One file per screen, one per modal.

| New file | Components |
| --- | --- |
| `src/pages/Dashboard.tsx` | `Dashboard` 576, `RiskGroup` 780 |
| `src/pages/Suppliers.tsx` | `Suppliers` 789 |
| `src/pages/ProductsAndDrawings.tsx` | `ModelsAndItems` 850, `DrawingSets` 989, `PackagingSetTitle` 1083 |
| `src/pages/SourcingWorkbench.tsx` | `SourcingProjects` 1096, `CaseToolbarSearch` 1215, `Quotes` 1274, `Comparison` 1429, `CaseQuoteWorkbench` 3339, `CaseProgressCell` 3801 |
| `src/pages/Pricing.tsx` | `PriceAnalytics` 1919, `PriceChanges` 2042, `QuoteTrend` 2118 |
| `src/pages/QCInspections.tsx` | `SampleInspections` 1570, `IncomingDefects` 1742 |
| `src/pages/Reports.tsx` | `Scorecard` 2212, `ScoreSettings` 2512, `ScoreCell`, `ScoreDonut`, `WeightInput` |
| `src/modals/` | one file each: `SupplierModal` 3870, `ModelModal` 4002, `ItemModal` 4072, `ItemImportModal` 4177, `DrawingSetModal` 4275, `ProjectModal` 4417, `QuoteModal` 4553, `InspectionModal` 4742, `IncomingDefectModal` 4932, `ScoreSettingsModal` 5094, `PriceChangeModal` 5189 |
| `src/modals/record/` | `HistoryModal` 2650, `RecordDetailModal` 2701, `VoidRecordModal` 2827, `EditRecordModal` 2871, `EditFields` 2921, `IncomingDefectEditFields` 3140, `InspectionEditFields` 3232, `buildEditPatch` 3262 |
| `src/components/` | the shared vocabulary: `Panel` 5422, `TableToolbar` 5441, `Metric` 5412, `Field` 5477, `TimelineRow` 5486, `AlertRow` 5495, `EmptyState` 5504, `StatusPill` 5508, `LifecyclePill` 5513, `RecordMenu` 5518, `TagRow` 5675, `SubTabs` 755, `CheckGroup` 5320, `FilterGroup` 5334, `MultiSelectDropdown` 5348, `DocumentCheck` 5718, `FileReference` 5732 and siblings |

`App.tsx` is left holding the shell: section state, sidebar, topbar, modal
routing. Target under 400 lines.

Consider `react-router` only if the team wants shareable URLs — it is not
required for the split and adds a dependency. Ask before adding it.

## Phase 4 — apply the design

The mockups are in `design/` (`design/README.md` has the brand values and the
published canvas link). The brand values are lifted from the segsolar.com
stylesheets, not from a screenshot — do not round them.

| Token | Value |
| --- | --- |
| Primary red | `#E00700` (the app currently uses `#d71920` — replace it) |
| Dark red | `#B51B16` |
| Blue | `#1C5CB0` |
| Ink | `#1E1E1E` |
| Page background | `#EFF2F7` |
| Panel border | `#D9DEE5`, inner rules `#E6E8EB` |
| Heading font | Kanit (Google Fonts), uppercase, `letter-spacing: 0.06em` |
| Body font | Helvetica Neue / Arial |
| Corner radius | **0** — the site is square outside circular elements |

Order: rewrite the tokens in `src/styles.css:1-22` first, then the shell
(sidebar goes dark `#141414` with a red active bar and the real logo from
`design/seg-logo-white.svg`), then page by page against its artboard.

Charts keep the validated series order `#E00700`, `#1C5CB0`, `#B8860B`,
`#00876C`, `#6A4C93` — `chartColor()` currently returns something else, and the
order matters for colour-vision safety. Do not add a sixth hue.

## Phase 5 — the three states

`design/States.dc.html` is the spec. These exist because the backend now enforces
rules the UI does not yet express.

1. **Blocked action.** `POST /api/source-assignments` rejects a role with
   `QC must pass or be conditional before assigning source role.` when the
   supplier+item has no passing inspection. The role control must be disabled
   with the reason and a link to the QC record, not fail after the click.
   `SourceRoleSelect` at 3550 is where this lands.
2. **Rejected request.** Show the server's own `message` — never a generic
   "Something went wrong". A page-level banner for the failure, a red field with
   an inline message where the offending field is known. `actionError` at 186 and
   the notice at 337 are the existing hooks; they are under-used.
3. **Voided record.** Voided records render dimmed with their void reason and
   **must not appear in any picker** — the API now rejects them with
   `<Type> is voided and cannot be used on new records.` Audit every `<select>`
   that lists suppliers, models, items, drawing sets, cases or quotes.

Known consequence to design around: editing a quote whose supplier was voided
afterwards is now rejected too, because the validator re-runs on PATCH. If that
proves wrong for the business, the backend needs to split create-time from
edit-time validation — raise it, do not work around it in the UI.

## Out of scope

- Do not change API contracts, backend rules, or `server/` at all. A UI need that
  requires a backend change is a conversation, not a patch.
- Do not touch `data/store.json` or `uploads/` — live data, git-ignored, and this
  machine holds the only copy.
- Do not add a component library or a CSS framework. The design is plain CSS.
- Do not "improve" behaviour spotted along the way. Write it down instead; the
  open items are in the root `README.md` discussion and
  `Supplier Management Demo Workflow and IT Implementation Guide.docx`.
