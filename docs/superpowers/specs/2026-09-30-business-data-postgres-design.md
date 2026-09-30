# Business data in Postgres — design

Date: 2026-09-30
Status: draft for review
Follows: `2026-09-18-auth-design.md`, which moved users, sessions and the audit
trail into Postgres and left business records for this project ("project B")

## Problem

Postgres holds users, sessions and the audit trail. Everything else lives
outside it: the 13 business record types and the score weights are one JSON
file (`data/store.json`), and uploaded files are loose files in `uploads/`.
The server keeps the whole store in memory, mutates it in place and rewrites
the file after most changes. That has produced these faults, all in the current
code:

1. **Some edits are saved before they are validated.** `updateById` writes the
   store before `PATCH /api/projects`, `/quotes`, `/inspections`,
   `/incoming-defects`, `/price-changes` and `/purchase-prices` validate the
   result. A rejected edit returns 400 and is already on disk.
   `PATCH /api/drawing-sets` changes the in-memory record before validating it.
2. **Some follow-on changes are never saved by the request that makes them.**
   A passed inspection edited through `PATCH /api/inspections` marks its quote
   Selected, creates price changes and closes the previous quote's price
   window — all after the only save. The same holds for the case sync in
   `PATCH /api/projects` and the completion status that
   `PATCH /api/incoming-defects` recalculates. They survive only if a later
   request saves the whole store before the process restarts.
3. **A failed request leaves memory changed.** Nothing is rolled back, so the
   next successful save writes the half-applied change.
4. **Reading writes.** `GET /api/bootstrap` runs five sync passes and saves if
   any of them changed something.
5. **Audit entries can be lost.** They are written to Postgres after the
   response and outside any transaction; a failure is logged and dropped while
   the business change stays.
6. **IDs are reused.** Counters are rebuilt from the highest stored ID at
   startup, so deleting the newest record and restarting hands its ID to the
   next record. Two records then share one audit history, and a new upload can
   overwrite an older file of the same name.
7. **Tests touch real data.** `withTestApp` isolates Postgres only; any test
   that saves goes to the developer's `data/store.json`. Three database test
   files avoid success paths for that reason.
8. **Two stores, two backups.** A restore must pair a database dump with volume
   archives taken at the same moment, and only one app instance can run.

Production was checked on 2026-09-30: Postgres has `audit_logs`,
`schema_migrations`, `session` and `users`; `/app/data` is empty; `audit_logs`
has no rows. No business data exists in production yet.

## Goals

1. Business records, score weights, and uploaded files (metadata and content)
   are stored in Postgres. `data/store.json` and `uploads/` are no longer read
   or written.
2. Each write request is atomic: its business changes, ID counters and audit
   entries commit together or not at all.
3. Read requests do not write.
4. The HTTP API is unchanged. The frontend is not modified.
5. Business rules behave as they do today, except for the changes listed under
   "Behaviour changes".
6. Database integration tests are fully isolated in the test database.

## Non-goals

- **Importing existing data.** The local `data/store.json` and `uploads/` are
  discarded by the user's decision; every environment starts empty. No import
  script is written.
- Removing files that no record references.
- Restricting who may open particular files (W9, payment information).
- Rewriting business rules as SQL queries.
- Detecting two people editing the same record. The later save wins, as today.
- A download button or bulk download in the UI.
- Running more than one app instance. The design allows it; the deployment
  keeps one.

## Approach

Each business record type gets its own table with typed columns and foreign
keys. Every request loads the business data from those tables into the same
in-memory `Store` shape used today, runs the existing handlers and rules
against it, and — for writes — stores the difference back inside one
transaction.

Rejected:

- **One JSONB row holding the whole store.** The smallest change, but it keeps
  every fault above except the file location: no rollback, no integrity, no
  queryable data.
- **Rewriting routes and rules as targeted SQL.** About 2,000 lines of rules in
  `server/app.ts` and `server/business.ts` would be rewritten, with a high risk
  of behaviour changes, for performance the data volume does not need.

Loading all business data per request is acceptable at this scale (thousands to
tens of thousands of rows). File contents are never part of that load.

## Schema

Migration `migrations/003_business_data.sql`, applied at startup like the
existing migrations.

### Tables

| Table | Holds |
| --- | --- |
| `suppliers` | `Supplier` |
| `models` | `Model` |
| `items` | `PackagingItem` |
| `drawing_sets` | `DrawingSet` without its items |
| `drawing_items` | `DrawingSet.drawingItems`, one row each, with `drawing_set_id` and `position` |
| `projects` | `SourcingProject` (development cases) |
| `quotes` | `Quote` |
| `quote_case_links` | `QuoteCaseLink` |
| `source_assignments` | `SourceAssignment` |
| `inspections` | `SampleInspection` |
| `incoming_defects` | `IncomingDefectRecord` |
| `price_changes` | `PriceChange` |
| `purchase_prices` | `PurchasePriceRecord` |
| `files` | `UploadedFileRecord` plus the file content |
| `score_weights` | `ScoreWeights`, a single row (`id = 1`), seeded with today's defaults (25/20/20/15/10/10) |
| `id_counters` | `prefix text PRIMARY KEY, value integer` — the last number issued per ID prefix |

### Column rules

- `id text PRIMARY KEY`, keeping today's `prefix-number` IDs (`sup-1001`). The
  frontend and the audit trail refer to records by these IDs.
- One column per field, named in snake_case (`effectiveFrom` → `effective_from`).
  Each table's field list is declared explicitly in code, which is the single
  source for loading and saving that table.
- An absent optional field is `NULL`; `NULL` loads as an absent field.
  Required fields, and fields the Zod schemas give a default, are `NOT NULL`.
- A prefix missing from `id_counters` starts at 1000, as today, so the first
  supplier is `sup-1001`.
- Dates (`YYYY-MM-DD`) are `date`. The `pg` parser for `date` returns the string
  unchanged, so no time zone conversion happens. The Zod schemas gain a
  `YYYY-MM-DD` check on every date field so malformed dates are a 400, not a
  database error.
- `files.uploaded_at` is `timestamptz`, loaded back with `toISOString()`.
- Prices, costs, purchase quantities and score weights are `numeric`, parsed to
  JavaScript numbers on load. Counts the schemas require to be integers (defect
  and received quantities, sample round, problem photos, file size) are
  `integer`.
- Lists of IDs or item types are `text[]` and keep their order:
  `suppliers.capable_items`, `items.used_for_models`, `projects.model_ids`,
  `supplier_ids`, `item_ids`, and the `photo_file_ids` / `attachment_file_ids`
  columns.
- `incoming_defects.replacement_receipts` is `jsonb`: a short list of values
  with no IDs of its own.
- `record_state` is nullable. Price changes created by the system carry no
  record state today and the frontend treats that as Active; this is kept
  as-is.

### Foreign keys

Every single-valued reference from one record to another is a foreign key,
declared `DEFERRABLE INITIALLY DEFERRED` so the order of writes inside a
transaction does not matter, with no cascading except
`drawing_items.drawing_set_id` (`ON DELETE CASCADE`). This covers the
supplier, model, item, drawing set, project, quote, purchase price and file
references on every table, including `quotes.previous_quote_id`.

Exception: `quotes.drawing_item_id` and `inspections.drawing_item_id` have no
foreign key. Editing a packaging set, and the packaging-set sync, rebuild its
item rows; today a quote may keep pointing at a row that was removed, and a
foreign key would make those edits fail.

ID lists (`text[]`) cannot carry foreign keys; the existing checks in code stay
responsible for them.

## Request flow

### Writes

A wrapper runs every create, edit, void, delete, import and upload route:

1. Take a pooled connection, `BEGIN`, then
   `SELECT pg_advisory_xact_lock(hashtext('business-data'))`. Write requests
   run one at a time, across app instances too.
2. Load the store and the ID counters.
3. Keep a deep copy of the loaded store.
4. Run the route handler against a per-request context holding the store, a
   `nextId` backed by the loaded counters, and an `audit` function that
   collects entries instead of writing them.
5. Run the reconciliation step (below).
6. Compare the store with the copy, table by table: new IDs are inserted,
   missing IDs deleted, and rows that are not deep-equal (ignoring key order)
   updated. Drawing items are compared as their own rows. Changed counters and
   score weights are written.
7. Insert the collected audit entries.
8. `COMMIT`, then send the handler's response.

Any error — a rule rejecting the request, a constraint violation at commit, a
lost connection — rolls the transaction back and goes to the error handler.
Nothing is written, including audit entries. Handlers return their status and
body instead of writing to the response, so nothing is sent before the commit.

### Reconciliation

After every write handler, the passes `GET /api/bootstrap` runs today run in
the same order:

1. `syncActivePackagingSetItems` for all models
2. `syncActiveCasesForModels` for all models
3. `syncReusableQuotesForProjects`
4. `syncQuoteStatusesFromPassedInspections`
5. `reconcileQuotePriceChanges`

The frontend already reloads `/api/bootstrap` after every save, so these passes
run after each save today; moving them into the write keeps what users see and
makes the result part of the same transaction. Their audit entries keep
`source: "System"`; the reason prefix `Bootstrap:` becomes `Auto sync:`.

The helpers these passes use are currently closures inside `createApp`. They
move to their own module and take the request context, like the functions in
`server/business.ts`.

### Reads

`GET` routes, including `/api/bootstrap`, `/api/scorecard` and
`/api/projects/:projectId/comparison`, load the store inside
`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` (one consistent snapshot, no
lock) and never write. The sync passes are removed from `/api/bootstrap` and
from `buildComparison`, since every write has already run them.

### Code shape

- The module-level `store` and its counters are removed. Business functions and
  the moved helpers take the request context as their first parameter.
- `ValidationError` moves out of `server/store.ts` into its own module.
- The load-time normalisation in `server/store.ts` (about 250 lines that
  upgraded early JSON formats) is deleted, not moved: the data it converted no
  longer exists.
- New units, each testable on its own:
  - table definitions and row ↔ record mapping (pure);
  - store difference (pure);
  - loading and applying changes (Postgres);
  - the read and write wrappers.
- The error handler maps Postgres foreign key violations (`23503`) and invalid
  dates (`22007`, `22008`) to 400 with a plain message.
- `/api/health` reports `storage: "postgres"`.

## Files

- **Upload.** `POST /api/files` keeps its request and response. The type
  allowlist is unchanged. The decoded content goes to the request context and
  is inserted with the file's row in the write transaction. The 10 MB request
  limit (about 7.5 MB per file after base64) is unchanged.
- **Response shape.** `storagePath` is no longer stored. It is derived as
  `uploads/<id><lowercased extension of fileName>`, so the frontend's links keep
  working.
- **Download.** `GET /uploads/:name` stays behind sign-in. The route reads the
  ID from the name, returns 404 unless the row exists and its extension matches,
  and sends the content with:
  - `Content-Type` from the stored MIME type, `X-Content-Type-Options: nosniff`;
  - `Content-Disposition: inline` for PDF and images, `attachment` for
    everything else (today's rule), now with the original file name, encoded
    so non-ASCII names survive;
  - `Cache-Control: private, max-age=31536000, immutable`, which is safe
    because a file's content never changes and IDs are never reused.
- **Loading.** The store loads file metadata only. Content is read by the
  download route alone.

## Behaviour changes

1. A rejected edit changes nothing (fixes problem 1).
2. Follow-on changes are saved by the request that causes them (problem 2).
3. Opening the app never writes (problem 4).
4. A change whose audit entry cannot be written is not saved (problem 5).
5. IDs are never reused (problem 6).
6. A purchase price referenced by a price change can no longer be deleted.
   Today the delete succeeds and leaves the price change pointing at nothing.
   A guard in the route gives the same kind of message as the other delete
   guards ("linked to price changes").
7. A restart no longer changes data. Records created before a restart used to
   be rewritten on load: Draft items, cases, quotes and inspections became
   Active, and every drawing set's revision was renumbered by effective date,
   overwriting revisions edited by hand. The frontend always creates these
   records as Active, so only the revision renumbering is visible to users.
8. Downloaded files are saved under their original names.
9. Malformed dates are rejected with 400.

## Testing

Offline (`npm test`):

- Existing business tests updated for the context parameter.
- Round trip: for each table, a record with every field set and one with only
  required fields map to a row and back unchanged.
- Store difference: inserts, updates, deletes, unchanged rows, reordered keys,
  and drawing items added, removed and changed.
- Counters: `nextId` continues from the stored value; deleted IDs are not
  reissued.
- Download headers: inline and attachment types, non-ASCII and quoted file
  names.

Database (`npm run test:db`, all through `withTestApp` against the test
database):

- A rejected `PATCH /api/projects` leaves every table unchanged.
- Passing an inspection through `PATCH /api/inspections` stores the quote as
  Selected and its price change.
- Two concurrent writes both take effect.
- Upload then download returns the same bytes, type and file name.
- `GET /api/bootstrap` changes no table and writes no audit entry.
- A failed write leaves no audit entry.
- The three existing test files that avoid success paths
  (`uploadRoutes`, `auditActor`, `scoreSettingsRoutes`) gain their success
  cases.

Performance: a one-off script seeds about 3,000 quotes with matching cases,
inspections and price changes, then times a quote edit. Over 200 ms adds an
optimisation task to the implementation plan; the likely target is
`reconcileQuotePriceChanges`, which serialises all price changes once per quote.

Browser: on a local build, create a supplier with a W9, a model, items, a
packaging set, a case, a quote and a passed inspection; open and download the
files; confirm the quote becomes Selected and the price change appears.

## Deployment

- `compose.intranet.yml` drops the `app-data` and `app-uploads` volumes; the
  `Dockerfile` drops the step that creates `data/` and `uploads/`.
- Upgrading production is `git pull` and `up -d --build`; the migration runs on
  start. Production has no business data, so nothing is migrated.
- After checking the upgraded app, remove the two unused volumes
  (`docker volume rm sourcing-workbench_app-data sourcing-workbench_app-uploads`).
  `docs/deployment.md` gives the command.
- Backups become one `pg_dump`. The dump grows with uploaded files; PDFs and
  images barely compress.

## Removed

- The JSON persistence in `server/store.ts`, `server/storeFile.ts` and its test.
- `scripts/import-audit-logs.ts`, which imported audit entries from old
  `store.json` files. The only such file has been imported; production never
  had one.

## Documentation

- `README.md` and `server/README.md`: storage is Postgres only; remove the
  `data/` and `uploads/` notes and the audit import instructions.
- `docs/deployment.md`: volumes, backup and restore for the database only, and
  the volume removal step.
- `docs/frontend-implementation.md`: remove the note that bootstrap
  reconciliation writes to the store.

## Observed, out of scope

- Clearing an optional field in an edit form does not clear it: the form sends
  `undefined`, JSON drops the key, and the server keeps the old value. This
  affects, for example, a quote's Effective To. Unchanged by this work.
