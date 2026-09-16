# Global Sourcing Backend

This is the first backend scaffold for the supplier and packaging sourcing workflow.

Stack:

- TypeScript
- Node.js
- Express
- Zod for request validation

Current storage is in-memory. It is intentionally shaped like the future database tables, so the next step can replace `server/store.ts` with PostgreSQL + Prisma without changing the frontend API contract too much.

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

- `GET /api/health`
- `GET /api/bootstrap`
- `GET/POST /api/suppliers`
- `GET/POST /api/models`
- `GET/POST /api/items`
- `GET/POST /api/drawing-sets`
- `GET/POST /api/projects`
- `GET/POST /api/quotes`
- `GET/POST /api/inspections`
- `GET/POST /api/price-changes`
- `GET /api/projects/:projectId/comparison`
- `GET /api/scorecard`

## Run

```bash
npm run dev:api
```

Frontend and backend run as two TypeScript processes:

```bash
npm run dev:frontend
npm run dev:api
```

Default URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:5174`

The Vite dev server proxies `/api/*` to the backend, so frontend code can call `/api/bootstrap` without hard-coding the API port.

## Current Scope

The backend now supports API creation and validation, but the frontend forms are not wired to every `POST` endpoint yet. The next step is to connect each page button to the matching API form:

- Supplier page -> `POST /api/suppliers`
- Model & Items page -> `POST /api/models`, `POST /api/items`
- Drawing Sets page -> `POST /api/drawing-sets`
- Sourcing Projects page -> `POST /api/projects`
- Quotes page -> `POST /api/quotes`
- Sample Inspections page -> `POST /api/inspections`
- Price Changes page -> `POST /api/price-changes`
