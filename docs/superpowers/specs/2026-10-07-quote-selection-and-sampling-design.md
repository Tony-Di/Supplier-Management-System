# Quote selection and sampling rules — design

Date: 2026-10-07
Business write-up shared with the team: "报价选中与送样规则说明" (Claude Docs).

## Goal

A quote's price takes effect only when the quote is Selected, and a new
supplier's quote can only become Selected by passing sample QC. Purchasing keeps
the final say: a decision not to continue with a supplier is never overwritten
by the system.

## Problems this fixes

1. A buyer can set a new supplier's quote to Selected before any sample. The
   price takes effect at once, and the quote never reaches the QC sample queue,
   which only lists `Sample Requested` quotes.
2. A passed inspection forces its quote to Selected on every write
   (`syncQuoteStatusesFromPassedInspections` in `reconcile`). A buyer's
   `Not Selected` is reverted inside the same save.
3. A supplier that has supplied the item for years, but has no inspection in the
   system, can only be qualified by sampling again.

It also closes two gaps found on the way: a quote that stops being Selected
never gives the previous price its window back, and the inspection edit form
cannot upload files.

## Decisions (agreed 2026-10-07)

| # | Decision |
| --- | --- |
| D1 | A quote's price is effective only when its status is Selected. `Requote` and `Change Work Order` no longer make a price effective on their own. |
| D2 | New supplier: Received → Sample Requested → QC Pass → Selected (set by the system). |
| D3 | Supplier that has supplied the item before (requotes included): Received → the buyer chooses Selected or No Further Action. No sample. |
| D4 | Before ERP data exists, "supplied before" may be confirmed by the buyer ("previous orders", optional PO number). Only for suppliers with a Since date. The entry point is switched off once the data is built up. |
| D5 | Conditional counts as a failed sample: it needs another round. It no longer adds to the sample-quality score. |
| D6 | Source roles stay manual and can only be assigned to a Selected quote. |
| D7 | Statuses: Received, Sample Requested, Selected, No Further Action, Expired. `Under Review` is removed; `Not Selected` is renamed `No Further Action`. |
| D8 | No Further Action can be set by the buyer at any stage. QC closing a sample as failed ("No Further Action" disposition) sets it too. |
| D9 | When a quote becomes Selected, the same supplier's previous price for the item closes the day before. When a Selected quote stops being Selected, that previous price reopens. |
| D10 | The price trend keeps every quote, Selected or not. |
| D11 | Existing `Requote` / `Change Work Order` quotes that are effective today become Selected in the migration, so current prices do not change. |

## Status model

| Status | Set by | Meaning |
| --- | --- | --- |
| Received | Buyer (default) | Quote recorded |
| Sample Requested | Buyer | Price acceptable, sample needed. The quote is in the QC queue. It stays here through rejected rounds. |
| Selected | System on QC Pass; buyer for a supplier that has supplied the item before | Approved source; the price is effective; source roles may be assigned |
| No Further Action | Buyer at any stage; system when QC closes a sample as failed | Not continuing with this quote |
| Expired | Buyer | Quote no longer valid |

Each quote records why it holds a system-relevant status:

- `statusBasis`: `QC Pass` | `QC Closed Fail` | `Existing Supplier` | `Previous Orders` | `Migration`, or absent.
- `statusReference`: free text, used for the PO number of a `Previous Orders` selection.

The system only reverts statuses it set (`QC Pass`, `QC Closed Fail`). A
status the buyer set is never changed by a QC result.

## Rules

### R1 — Effective price

`isEffectivePriceQuote` (`server/priceWindows.ts`) becomes
`status === "Selected"`. Price windows, price-change records and the previous
quote link follow from it through the existing `reconcileQuotePriceChanges`
pass, so they update on every write as today.

### R2 — QC drives Sample Requested quotes only

Replace `syncQuoteStatusesFromPassedInspections` / `syncQuoteStatusFromInspection`
(`server/workflow.ts`) with one pass in `reconcile`, over every non-void quote
that has a linked inspection. "Latest" is the latest non-void inspection by round,
then received date (as `latestInspectionForQuote` does).

| Quote now | Latest inspection | Quote becomes | Basis |
| --- | --- | --- | --- |
| Sample Requested | Pass | Selected | QC Pass |
| Sample Requested | Fail or Conditional, disposition No Further Action | No Further Action | QC Closed Fail |
| Selected, basis QC Pass | not Pass (voided, edited, or a later round) | Sample Requested | cleared |
| No Further Action, basis QC Closed Fail | not a closed fail | Sample Requested | cleared |
| anything else | anything | unchanged | — |

Every change is audited with actor `System`. The inspection routes stop calling
the sync directly; `reconcile` covers create, edit, void and delete.

### R3 — Who may set Selected by hand

On quote create and edit, a change to `Selected` (not a quote that is already
Selected) is allowed when either:

- the supplier is **qualified for the item**: a non-void inspection with result
  Pass for the same supplier and item, or another non-void Selected quote for the
  same supplier and item. Basis `Existing Supplier`.
- the request carries `statusBasis: "Previous Orders"`, the previous-order entry
  point is switched on, and the supplier has a Since date. `statusReference`
  holds the optional PO number. Basis `Previous Orders`.

Otherwise the API refuses with 400: "Request a sample first: this supplier has
not passed QC for this item." The rule lives in one function shared by the API
and the UI (the UI uses it to decide what to offer; the API enforces it).

Any manual status change away from Selected or No Further Action clears
`statusBasis` and `statusReference`.

### R4 — Previous price reopens (D9)

When `closePreviousSelectedQuote` closes a price, it records the closer on the
closed quote: `closedByQuoteId`. A reconcile step then reopens any quote whose
`closedByQuoteId` points at a quote that is no longer Selected (or is void):
`effectiveTo` and `closedByQuoteId` are cleared. The `Pending` price change
created from the closer is voided with reason "Quote no longer selected".
`Approved` or `Rejected` price changes are left as they are. A
`previousQuoteId` that points at a quote no longer Selected is cleared too, so
when A1 → A2 → A3 and A2 leaves, the next pass links A3 to A1 and closes A1
again.

Windows closed before this release have no `closedByQuoteId` and are not
reopened. Editing `effectiveTo` by hand clears `closedByQuoteId`.

### R5 — Source roles need a Selected quote

`ensureSourceAssignmentLinks` (`server/workflow.ts`) requires `sourceQuoteId`,
and that quote must be Selected. This replaces the QC check
(`qcAllowsSourceRole`). Case Progress enables the role picker on the same
condition, with the reason "Quote must be Selected before assigning a source
role." Existing assignments are kept.

### R6 — Conditional is a failed round (D5)

- `qcAllowsSourceRole`, `sampleRequirementForQuoteInProject` and the Case
  Progress label stop treating Conditional as a pass.
- `defaultDispositionForResult("Conditional")` becomes `Re-sample Required`.
- `buildSupplierScorecard` drops the `+ conditional * 2` term. Conditional still
  counts as a reviewed sample.

### R7 — QC progress shows the round

One label function replaces `qcQueueStatus` and `caseQcLabel`, used by the QC
queue, the Case Progress QC column and the comparison QC column.

| Situation | Label |
| --- | --- |
| No sample yet | Round 1 – Waiting for Sample |
| Round N received, not inspected | Round N – Pending Inspection |
| Round N Fail or Conditional, re-sample | Round N Rejected – Waiting for Round N+1 |
| Round N closed as failed | Round N Rejected – No Further Action |
| Round N Pass | Round N Passed |
| Selected without sampling | No Sample Needed – Existing Supplier / Previous Orders (basis `Migration` shows as Existing Supplier) |

The QC queue lists exactly the non-void `Sample Requested` quotes.

### R8 — Price trend keeps every quote (D10)

The Pricing page defaults to all quotes. Per supplier, Selected quotes draw the
price line and other quotes show as separate markers; the detail table shows each
quote's status.

### R9 — Inspection attachments

The inspection form's "Problem Photos" becomes "Photos / attachments", and the
inspection edit form ("Complete inspection") can add files to the same list.

## Previous-order entry point (D4)

- Switch: `PREVIOUS_ORDER_SELECTION` in the environment, `on` by default. The
  API reports it in `GET /api/auth/me` as `features.previousOrderSelection`.
- UI: choosing Selected on a quote that is not qualified opens a confirmation:
  "This supplier has supplied this item before; no sample is needed?" with an
  optional PO number. Offered only when the switch is on and the supplier has a
  Since date; otherwise the UI says to request a sample.
- Turning it off later needs no code change. From then on, a requote is
  qualified by the earlier Selected quote of the same supplier and item.

## Data changes

`migrations/006_quote_selection_rules.sql`:

1. Add `status_basis text`, `status_reference text`, `closed_by_quote_id text`
   to `quotes`.
2. Non-void `Requote` / `Change Work Order` quotes whose status is not Selected
   become Selected with basis `Migration` (D11), so their prices stay effective.
3. `Under Review` → `Received`; `Not Selected` → `No Further Action`.
4. One audit row per changed quote (actor `System`, source `Migration`).

Before deploying, run this on the server and review the list. A quote listed as
`Not Selected` or `Expired` is effective today only because of its reason; decide
it with purchasing before the migration runs:

```sql
SELECT id, supplier_id, item_id, status, quote_reason, unit_price, effective_from
FROM quotes
WHERE coalesce(record_state, 'Active') <> 'Void'
  AND quote_reason IN ('Requote', 'Change Work Order')
  AND status <> 'Selected';
```

Type and schema updates: `Quote["status"]` and `quoteSchema.status` take the new
list; `Quote` gains `statusBasis?`, `statusReference?`, `closedByQuoteId?`;
`server/storeTables.ts` maps the three columns.

## Places that change

| Area | Files |
| --- | --- |
| Effective price, reopen | `server/priceWindows.ts`, `server/business.ts` (`closePreviousSelectedQuote`, `reconcileQuotePriceChanges`) |
| QC sync | `server/workflow.ts` (`reconcile`), `server/app.ts` inspection routes |
| Manual Selected rule | new `src/lib/selection.ts` (imported by the API, as `src/leadTime.ts` is), `server/app.ts` quote routes |
| Source role gate | `server/workflow.ts` (`ensureSourceAssignmentLinks`), `server/rules.ts`, `src/lib/sourcing.ts` (`buildCaseProgressRow`) |
| Conditional | `server/rules.ts`, `server/business.ts` (sample requirement, scorecard), `src/lib/sourcing.ts` |
| Statuses | `src/types.ts`, `server/schemas.ts`, `src/constants.ts`, `src/components/QuoteStatusSelect.tsx`, `src/modals/QuoteModal.tsx`, `src/modals/record/EditFields.tsx`, `src/styles.css` (pill for No Further Action) |
| Previous-order confirmation | `server/config.ts`, `server/routes/auth.ts`, `src/SessionContext.tsx`, a small confirmation dialog |
| QC labels and queue | `src/lib/sourcing.ts`, `src/pages/QCInspections.tsx`, `src/pages/SourcingWorkbench.tsx` |
| Price trend | `src/pages/Pricing.tsx`, `src/lib/priceCharts.ts` |
| Inspection attachments | `src/modals/InspectionModal.tsx`, `src/modals/record/InspectionEditFields.tsx`, `src/modals/record/EditRecordModal.tsx` |
| Data | `migrations/006_quote_selection_rules.sql`, `server/storeTables.ts`, `server/testFixtures.ts` |
| Docs | `server/README.md` (status values, new error) |

## Testing

Unit (`npm test`):

- `isEffectivePriceQuote`: only Selected is effective; a Requote in Received is not.
- QC sync table R2, row by row, including "No Further Action set by the buyer is
  never changed".
- Manual Selected rule R3: qualified by a Pass, by an earlier Selected quote, by
  previous orders (switch on, Since set), refused otherwise.
- Reopen R4: a quote leaving Selected reopens the price it closed and voids its
  Pending price change; a hand-edited `effectiveTo` is not reopened; with
  A1 → A2 → A3, A2 leaving links A3 back to A1.
- QC labels R7 for each row; Conditional default disposition; scorecard without
  the Conditional bonus.

Postgres (`npm run test:db`):

- A passed inspection on a Sample Requested quote stores Selected with its price
  change (replaces the existing test of the same name).
- Two suppliers pass; one is set to No Further Action and stays that way.
- Voiding the passing inspection returns the quote to Sample Requested and reopens
  the previous price.
- Setting Selected on a new supplier's quote is refused with 400 and stores
  nothing.
- A source role on a quote that is not Selected is refused.
- The migration turns an effective Requote into Selected and renames the two
  statuses (`server/db/migrate.test.ts`).

Then drive the app: a new supplier through two rejected rounds to a pass, an
existing supplier's requote set to Selected and to No Further Action, and the
previous-order confirmation.

## Out of scope

- Importing ERP purchase history (the switch in D4 covers the gap).
- Which drawing revision a QC pass applies to. Qualification stays at supplier +
  item; a drawing change still needs a buyer to request a new sample.
- Role-based access for QC, purchasing and finance.
- Notifying buyers when a sample passes.

## Rollout

One branch, one pull request, committed in this order so each step keeps the
tests green: data and types → R1 and R4 → R2 → R3 and the previous-order
switch → R5 and R6 → R7 to R9 → docs. Deploying runs the migration on start; run
the preview query above first.
