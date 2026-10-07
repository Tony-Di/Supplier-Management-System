# Global Sourcing Backend

Express API for the supplier and packaging sourcing workflow.

Stack:

- TypeScript
- Node.js
- Express
- Zod for request validation
- PostgreSQL (`pg`) for all data
- `openid-client` for Microsoft Entra ID sign-in

All data is stored in Postgres; the schema is in `migrations/` and applied with `npm run migrate` (and on every start of the Docker image). Each business record type has its own table, and uploaded files are stored in `files`.

A write request is one transaction: it loads the business data, applies the change and the sync passes, then saves the changed rows, the ID counters and the audit entries together, so a rejected request changes nothing. Writes take an advisory lock and run one at a time. Reads use a read-only snapshot and never write.

## Authentication

Every `/api` route except `/api/health` and the sign-in routes requires a session, and so does `/uploads`. Requests without one get `401` JSON rather than a redirect. Admin routes return `403` to other users.

`POST`, `PATCH` and `DELETE` requests must send the session's CSRF token in an `X-CSRF-Token` header. The token is returned by `GET /api/auth/me`.

Deactivating a user or changing their role takes effect on their next request: each change increments the user's `session_epoch`, and sessions carrying an older value are rejected.

## Main Chain

```text
Supplier
-> Model
-> Packaging Item
-> Drawing Set
-> Sourcing Project
-> Quote
-> Sample Inspection
-> Comparison
-> Scorecard
```

## API

General:

- `GET /api/health`: no session required
- `GET /api/bootstrap`: the full store, used by the frontend on load
- `GET/POST /api/files`: uploads are sent as base64 JSON (the request limit is 10 MB). Only the types in `server/uploads.ts` are accepted (PDF, common image, Excel, CSV and Word files), and the server sets the MIME type. `GET /uploads/<id>.<ext>` returns the file with `X-Content-Type-Options: nosniff`: PDFs and images open in the browser, anything else downloads, under the original file name.

Records. Each supports `GET` (list), `POST` (create), `PATCH /:id` (update), `DELETE /:id`, and `POST /:id/void`.

A `PATCH` sets only the fields in its body; a field sent as `null` is cleared. Dates are `YYYY-MM-DD`. A record that other records refer to cannot be deleted.

- `/api/suppliers`
- `/api/models`
- `/api/items` (also `POST /api/items/import`)
- `/api/drawing-sets`
- `/api/projects`
- `/api/quotes`: `status` is one of `Received`, `Sample Requested`, `Selected`, `No Further Action` and `Expired`. Only a Selected quote's price takes effect; a price window (Effective From to Effective To) may not overlap another effective price for the same supplier and item, and Effective To may not fall before Effective From. A `PATCH` that changes Effective To must include `changeReason`, which is recorded in the audit trail.
  - Setting `Selected` by hand needs a supplier that passed QC or had a Selected quote for the item. Otherwise the request must send `statusBasis: "Previous Orders"` (optional `statusReference`, the PO number), the supplier must have a Since date, and `PREVIOUS_ORDER_SELECTION` must not be `off`; anything else is refused with `400` "Request a sample first".
  - `statusBasis` records why a quote holds its status (`QC Pass`, `QC Closed Fail`, `Existing Supplier`, `Previous Orders`, `Migration`); the server sets it, apart from the Previous Orders request above. `closedByQuoteId` names the quote whose selection closed this price, and is set by the server only.
- `/api/inspections`: the sync passes move the related quote. A pass selects a `Sample Requested` quote, and a failed or conditional round with disposition `No Further Action` ends it with `No Further Action`. Voiding or changing that inspection puts the quote back to `Sample Requested`; a status the buyer set is never changed.
- `/api/incoming-defects`
- `/api/price-changes`
- `/api/purchase-prices`

Other:

- `GET/POST /api/source-assignments`: the source quote must be Selected
- `GET /api/projects/:projectId/comparison`
- `GET /api/scorecard`: supplier scores calculated with the saved KPI weights; the frontend reads all scores from here
- `GET /api/score-settings`

Sign-in:

- `GET /api/auth/login`: redirects to Entra ID, or signs in the local account when `AUTH_MODE=dev`
- `GET /api/auth/callback`: Entra redirect target; rate limited to 20 requests a minute per IP
- `GET /api/auth/me`: the signed-in user, CSRF token and `features.previousOrderSelection`, or `401`
- `POST /api/auth/logout`

Admin only:

- `GET /api/audit-logs`: filter with `entityType`, `entityId`, `actorUserId` and `limit`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/role`: `{ "role": "admin" | "user" }`
- `PATCH /api/admin/users/:id/active`: `{ "active": boolean }`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/audit-usage`: audit row count and table size
- `PATCH /api/score-settings`: the six KPI weights, which must add up to 100

Admins cannot deactivate or delete their own account, and the last active admin cannot be demoted, deactivated or deleted.

## Run

Start Postgres and apply the migrations first (see the root README), then run the frontend and backend as two TypeScript processes:

```bash
npm run dev:api
npm run dev:frontend
```

Default URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:5174` (override with `API_PORT`)

The Vite dev server proxies `/api/*` and `/uploads/*` to the backend, so frontend code can call `/api/bootstrap` without hard-coding the API port.
