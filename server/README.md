# Global Sourcing Backend

Express API for the supplier and packaging sourcing workflow.

Stack:

- TypeScript
- Node.js
- Express
- Zod for request validation

Storage is a JSON file prototype. Records are loaded from `data/store.json` on startup, falling back to the seed data in `server/store.ts` when the file is missing, and the whole store is written back after every change. Uploaded files are saved to `uploads/`. The store is shaped like the future database tables, so `server/store.ts` can later be replaced with PostgreSQL + Prisma without changing the frontend API contract much.

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

- `GET /api/health`
- `GET /api/bootstrap`: the full store, used by the frontend on load
- `GET /api/audit-logs`
- `GET/POST /api/files`: uploads are sent as base64 JSON

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

## Run

Frontend and backend run as two TypeScript processes:

```bash
npm run dev:api
npm run dev:frontend
```

Default URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:5174` (override with `API_PORT`)

The Vite dev server proxies `/api/*` and `/uploads/*` to the backend, so frontend code can call `/api/bootstrap` without hard-coding the API port.
