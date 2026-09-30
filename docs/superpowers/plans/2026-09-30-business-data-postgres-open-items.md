# Business data in Postgres — open items

Date: 2026-09-30
Branch: `feat/postgres-business-data`

Recorded after the Task 11 review, the Task 12 checks and a review of the whole
branch. Tasks 1–11 are committed; the drawing-set `null` fix is `0189082`.

## To do before merging

### 1. Write time grows with the price history (Task 11)

`scripts/measure-write-time.ts` seeds no effective price quote: every quote is
`Received` / `New Quote` and every inspection fails. `reconcileQuotePriceChanges`
therefore never loops, and the 70 ms result measures only the fixed cost of a
write.

With the same 3,000 quotes and only the data shape changed, a quote edit took
(median, in a cloud container where the committed script gives 186–196 ms
against 70 ms on the dev machine):

| Data | Now | With Task 11 Step 3 |
| --- | --- | --- |
| As committed (no effective quote) | 193 ms | 191 ms |
| Every third inspection passes (334 Selected) | 465 ms | 310 ms |
| Plus 1,000 Requotes (1,734 price changes) | 3,312 ms | 344 ms |

Cause: for every effective quote, `reconcileQuotePriceChanges`
(`server/business.ts`) serialises the whole price-change list twice to compute a
`changed` flag. Nothing reads that flag any more: `reconcile()` ignores it (on
`main`, `GET /api/bootstrap` used it to decide whether to rewrite `store.json`).
The cost is roughly effective quotes × price changes, so it grows with the
square of the price history, and every write waits for it.

Steps:

1. Apply Task 11 Step 3 (compare once per pass). On the Requote data it
   produced the same store as the current code. Dropping the unused return
   value altogether is also safe.
2. Give the measurement data effective quotes, then re-run
   `npx tsx --env-file-if-exists=.env scripts/measure-write-time.ts` on the dev
   machine. The variants above changed `syntheticStore()` like this:
   - quotes: `quoteReason: q % 3 === 1 ? "Requote" : "New Quote"` and
     `effectiveFrom: addDays("2026-02-01", Math.floor(q / 100) * 3 + (q % 3))`,
     where `addDays` adds calendar days to a `YYYY-MM-DD` string;
   - inspections: `result: n % 3 === 0 ? "Pass" : "Fail"`, with
     `disposition: "Accepted"` for the passes.
3. If the median is still over 200 ms, stop and decide, as the plan says. Most
   of what remains after Step 3 (about 180 ms of the 344 ms above) is
   `findPreviousEffectiveQuote` scanning every quote for each effective quote.

### 2. Two database refusals still return 500

`server/errorHandler.ts` maps 23503, 22007 and 22008 to 400. Two more reach
Postgres from a request that passes validation, and return 500:

- `22003`: an integer above the `integer` range, such as `defectQty: 3000000000`;
- `22021`: a NUL character (`\u0000`) in a text field.

Add both to `DATABASE_REFUSALS` with a plain message, and a test for each.

### 3. Then

Final review of the branch and the merge decision (PR to `main`).

## Checked, no action needed

- Task 12 Step 1: `npm run typecheck:api`, `npm test` (158), `npm run test:db`
  (72 after `0189082`) and `npm run build` pass.
- Task 12 Step 2: the compose stack passed in isolation: `storage: "postgres"`,
  20 tables, only the `pgdata` volume, migrations applied on start. A 3 MB PDF
  with a Chinese name downloaded byte for byte and survived an app restart. The
  cloud sandbox needed its proxy CA added in a scratch Dockerfile; the
  repository files were not changed.
- Task 12 Step 3: all eight steps pass, and a later Requote creates its price
  change. Item 7 cannot be done as written: a quote attachment has no link
  anywhere in the UI (the same on `main`), so an incoming-defect attachment was
  used instead. A browser running under a C locale names any non-ASCII
  download `download`; under a UTF-8 locale the original name is used.
- `POST /api/source-assignments` still updates an existing assignment with
  `Object.assign`. It is a POST, so the rule that `null` clears a field does not
  apply, and it behaves as on `main`.
