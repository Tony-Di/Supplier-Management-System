# Frontend implementation — 2026-09-18

The five phases in `frontend-plan.md` were implemented as separate commits. The changes apply the supplied SEG design while retaining the existing seven sections, API client and backend contracts.

## Structure

- `App.tsx` is below 400 lines (previously 6,434); it holds navigation and modal routing.
- `AppDataContext.tsx` owns the application data and refresh/loading/error state. There are no mutable module-level data bindings. Data-dependent helpers take an explicit data slice.
- `pages/`, `components/`, `modals/` and `modals/record/` separate business screens, reusable UI and dialogs.
- `lib/` contains formatting, imports, defects, charts, scorecards, lookup and workflow helpers. Helpers described as pure in the plan that actually depended on globals were extracted with their dependencies in later phases.

## Design and workflow states

The shell uses the supplied logo, dark sidebar, red active indicator, exact brand tokens, square panels, Kanit headings and Helvetica Neue/Arial body text. The five chart hues follow the supplied order. Supplier search, capability/document filters and server scorecards are connected to live application state. Kanit uses Google Fonts with local sans-serif fallbacks.

Source-role controls follow the backend's latest-inspection ordering and drawing-set scope. Blocked controls explain the QC rule and open the matching inspection; missing inspections can be recorded for the relevant case. API rejection messages remain verbatim in persistent alerts, including dialogs. Duplicate item codes are identified inline. Voided records remain visible in a read-only archive with their reason and history, and are excluded from record pickers. Editing a quote with a voided reference explains the existing backend restriction.

Wide tables scroll inside their containers. All seven sections were checked at a 390 px viewport without document-level horizontal overflow, and desktop views were inspected against the supplied artboards.

## Verification

- 58 automated tests pass, including 26 additional cases for helper behavior, isolated data snapshots, API error messages, voided options and frontend/backend QC parity.
- API type checking, frontend type checking and the production build pass.
- The mechanical refactor was compared against the original App using a fixed copy of the existing data: supplier scorecards, average source lead time, dashboard chart rows and case progress rows remained equal.
- Browser smoke checks covered all seven sections; creating a quote; a failed first inspection followed by a passed second round; disabled/enabled source roles; opening the linked QC record; duplicate-item validation; and voided-record history. Browser checks used an isolated API and data copy. Original runtime data and uploads were not edited.

No backend code, API contracts, dependencies or package lockfile were changed. The original `frontend-plan.md` is retained as user-owned input.

## Existing differences for a later business decision

- Dashboard local score calculations use fixed weights, while `GET /api/scorecard` uses saved configurable weights. On the baseline data, Dashboard showed an average of 88 while the authoritative supplier scores were 79 and 94. These calculations were preserved during the split. Supplier cards and Reports use server scores when available.
- Some Reports refresh dependencies use collection lengths, which can miss edits that do not change the number of records.
- `scoreIssueSummary` can describe a zero-weight quality category as lacking QC passes even when passes exist.
- The existing CSV parser does not fully parse quoted comma-containing cells.
- Bootstrap reconciliation can write to the JSON store on the backend. All smoke testing was performed on a copy to keep the original data untouched.

These are pre-existing behavior differences; resolving them requires a separate scope and, for score consistency, agreement on the authoritative scoring path.
