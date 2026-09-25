# Supplier Management System

A prototype workbench for sourcing packaging materials for solar module models. It covers the full chain from models and packaging items through drawing sets, supplier quotes, sample and incoming QC, price changes, and supplier scorecards.

See `Supplier Management Demo Workflow and IT Implementation Guide.docx` for the business workflow and production implementation notes.

## Stack

- Frontend: React 19, TypeScript, Vite, Recharts, lucide-react (`src/`)
- Backend: Node.js, Express, Zod, run with `tsx` (`server/`)
- Sign-in: Microsoft Entra ID (OpenID Connect via `openid-client`) with server-side sessions
- Storage: PostgreSQL for users, sessions and the audit trail; a JSON file prototype (`data/store.json`) for business records; local file uploads (`uploads/`)

## Getting Started

Requires Node.js 20.19 or later (needed by Vite 7) and Docker.

```bash
npm install
docker compose -f compose.dev.yml up -d   # Postgres on 127.0.0.1:5433
cp .env.example .env
```

In `.env`, set `SESSION_SECRET` to at least 32 random characters (`openssl rand -hex 32`); the API refuses to start without it. Then create the tables:

```bash
npm run migrate
```

Run the API and the frontend in two terminals:

```bash
npm run dev:api   # API on http://127.0.0.1:5174
npm run dev       # App on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173. The Vite dev server proxies `/api/*` and `/uploads/*` to the API.

Set `API_PORT` to run the API on a different port. The Vite proxy target in `vite.config.ts` and the CORS origins in `server/app.ts` would need to change with it.

### Signing in

`.env.example` sets `AUTH_MODE=dev`, which signs in a fixed local account (`dev@segsolar.com`) without contacting Microsoft, so the app runs offline. The server refuses to start when `AUTH_MODE=dev` is combined with `NODE_ENV=production`.

To sign in with Entra ID instead, remove `AUTH_MODE` (or set it to `entra`) and fill in `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`. The app registration needs one redirect URI, `<APP_ORIGIN>/api/auth/callback`, and the delegated `openid`, `profile` and `email` scopes. Only accounts from the configured tenant are accepted.

### The first admin

Every account is created with the `user` role the first time it signs in. Admins manage users and read the audit trail. The first admin cannot be granted from the UI, so after that person has signed in once, promote them from the command line:

```bash
npm run admin -- dev@segsolar.com
```

Further admins can then be promoted from **Admin → Users**.

## Scripts

| Script | Description |
| --- | --- |
| `npm test` | Run frontend helper and server regression tests (no database needed) |
| `npm run test:db` | Run the Postgres integration tests against `DATABASE_URL_TEST` |
| `npm run dev` | Start the Vite dev server (same as `dev:frontend`) |
| `npm run dev:api` | Start the Express API |
| `npm run migrate` | Apply pending SQL migrations from `migrations/` |
| `npm run admin -- <email>` | Promote an existing user to admin |
| `npm run typecheck:api` | Type-check the server code |
| `npm run build` | Type-check and build the frontend into `dist/` |
| `npm run preview` | Serve the built frontend |

`npm run test:db` expects the `sourcing_test` database named in `.env.example`. Create it once with:

```bash
docker compose -f compose.dev.yml exec postgres createdb -U sourcing sourcing_test
```

## App Sections

- **Dashboard**
- **Suppliers**
- **Products & Drawings**: Models & Items, Packaging Sets
- **Sourcing Workbench**: Development Cases, Quotes, Comparison
- **Pricing**: Price Analytics, Price Changes
- **QC Inspections**: Sample Inspections, Incoming Defects
- **Reports**: Scorecard, Score Settings
- **Admin** (admins only): Users, Audit Log

## Data

Users, sessions and the audit trail live in Postgres. Business records still live in `data/store.json`; moving them into Postgres is planned separately.

`data/` and `uploads/` are runtime data and are not committed. The seed arrays in `src/data.ts` are empty, so a fresh clone starts with no records; the API writes `data/store.json` as soon as any data changes. Delete `data/store.json` (and `uploads/`) to start over from an empty system.

Stores created before the audit trail moved to Postgres keep their old entries in `data/store.json`. Copy them across once with `npx tsx --env-file=.env scripts/import-audit-logs.ts`; the script refuses to run a second time.

## Project Layout

```text
src/
  App.tsx               Section state and modal routing
  AppDataContext.tsx    Data ownership and refresh state
  SessionContext.tsx    Signed-in user and CSRF token
  SignIn.tsx            Sign-in screen
  components/           Shared UI and application shell
  pages/                Business sections plus the admin screens
  modals/               Create, edit, history and lifecycle dialogs
  lib/                  Explicit-data helpers and regression tests
  assets/               SEG brand assets
  api.ts                API client
  types.ts              Shared record types
  data.ts               Seed arrays (currently empty)
server/
  index.ts      Entry point
  app.ts        Express app and business routes
  routes/       Sign-in and admin routes
  auth/         Entra client and token claim validation
  session.ts    Sessions, auth guards and CSRF
  config.ts     Environment validation
  db.ts         Postgres pool
  users.ts      User repository and admin guards
  auditLog.ts   Audit trail repository
  schemas.ts    Zod request schemas
  business.ts   Validation, comparison, scorecard, and sync rules
  store.ts      JSON file store, seed data, ID counters
migrations/     Plain SQL migrations applied by npm run migrate
scripts/        Migration, admin promotion and audit import scripts
```

See [docs/deployment.md](docs/deployment.md) to run it on an intranet server with Docker.

See [server/README.md](server/README.md) for the API reference.

See [docs/frontend-implementation.md](docs/frontend-implementation.md) for the frontend refactor, validation and remaining business-rule differences.
