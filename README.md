# Supplier Management System

A prototype workbench for sourcing packaging materials for solar module models. It covers the full chain from models and packaging items through drawing sets, supplier quotes, sample and incoming QC, price changes, and supplier scorecards.

See `Supplier Management Demo Workflow and IT Implementation Guide.docx` for the business workflow and production implementation notes.

## Stack

- Frontend: React 19, TypeScript, Vite, Recharts, lucide-react (`src/`)
- Backend: Node.js, Express, Zod, run with `tsx` (`server/`)
- Storage: JSON file prototype (`data/store.json`) plus local file uploads (`uploads/`)

## Getting Started

Requires Node.js 20.19 or later (needed by Vite 7).

```bash
npm install
```

Run the API and the frontend in two terminals:

```bash
npm run dev:api   # API on http://127.0.0.1:5174
npm run dev       # App on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. The Vite dev server proxies `/api/*` and `/uploads/*` to the API.

Set `API_PORT` to run the API on a different port. The Vite proxy target in `vite.config.ts` and the CORS origins in `server/index.ts` would need to change with it.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server (same as `dev:frontend`) |
| `npm run dev:api` | Start the Express API |
| `npm run typecheck:api` | Type-check the server code |
| `npm run build` | Type-check and build the frontend into `dist/` |
| `npm run preview` | Serve the built frontend |

## App Sections

- **Dashboard**
- **Suppliers**
- **Products & Drawings**: Models & Items, Packaging Sets
- **Sourcing Workbench**: Development Cases, Quotes, Comparison
- **Pricing**: Price Analytics, Price Changes
- **QC Inspections**: Sample Inspections, Incoming Defects
- **Reports**: Scorecard, Score Settings

## Data

`data/` and `uploads/` are runtime data and are not committed. The seed arrays in `src/data.ts` are empty, so a fresh clone starts with no records; the API writes `data/store.json` as soon as any data changes. Delete `data/store.json` (and `uploads/`) to start over from an empty system.

## Project Layout

```text
src/
  App.tsx       UI and page logic
  api.ts        API client
  types.ts      Shared record types
  data.ts       Seed arrays (currently empty)
server/
  index.ts      Express routes
  schemas.ts    Zod request schemas
  business.ts   Validation, comparison, scorecard, and sync rules
  store.ts      JSON file store, seed data, ID counters
```

See [server/README.md](server/README.md) for the API reference.
