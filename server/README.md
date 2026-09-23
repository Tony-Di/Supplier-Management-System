# Global Sourcing Backend

Express API for the supplier and packaging sourcing workflow.

Stack:

- TypeScript
- Node.js
- Express
- Zod for request validation
- PostgreSQL (`pg`) for users, sessions and the audit trail
- `openid-client` for Microsoft Entra ID sign-in

Users, sessions (`connect-pg-simple`) and the audit trail are stored in Postgres; the schema is in `migrations/` and applied with `npm run migrate`.

Business records are still a JSON file prototype. They are loaded from `data/store.json` on startup, starting empty when the file is missing (the seed arrays in `src/data.ts` are empty), and the whole store is written back after every change. Uploaded files are saved to `uploads/`. The store is shaped like the future database tables, so `server/store.ts` can later be replaced with Postgres tables without changing the frontend API contract much.

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
- `GET/POST /api/files`: uploads are sent as base64 JSON. Only the types in `server/uploads.ts` are accepted (PDF, common image, Excel, CSV and Word files); the stored extension and MIME type are set by the server. `/uploads` sends `X-Content-Type-Options: nosniff`, and anything other than a PDF or image is served as a download.

Records. Each supports `GET` (list), `POST` (create), `PATCH /:id` (update), `DELETE /:id`, and `POST /:id/void`:

- `/api/suppliers`
- `/api/models`
- `/api/items` (also `POST /api/items/import`)
- `/api/drawing-sets`
- `/api/projects`
- `/api/quotes`
- `/api/inspections`
- `/api/incoming-defects`
- `/api/price-changes`
- `/api/purchase-prices`

Other:

- `GET/POST /api/source-assignments`
- `GET /api/projects/:projectId/comparison`
- `GET /api/scorecard`
- `GET/PATCH /api/score-settings`

Sign-in:

- `GET /api/auth/login`: redirects to Entra ID, or signs in the local account when `AUTH_MODE=dev`
- `GET /api/auth/callback`: Entra redirect target; rate limited to 20 requests a minute per IP
- `GET /api/auth/me`: the signed-in user and CSRF token, or `401`
- `POST /api/auth/logout`

Admin only:

- `GET /api/audit-logs`: filter with `entityType`, `entityId`, `actorUserId` and `limit`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:id/role`: `{ "role": "admin" | "user" }`
- `PATCH /api/admin/users/:id/active`: `{ "active": boolean }`
- `DELETE /api/admin/users/:id`
- `GET /api/admin/audit-usage`: audit row count and table size

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
