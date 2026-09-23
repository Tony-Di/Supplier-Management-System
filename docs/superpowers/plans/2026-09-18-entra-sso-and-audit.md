# Entra ID SSO and Audit Accountability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the workbench behind company sign-in and record which person made every change.

**Architecture:** Employees authenticate against the SEG Microsoft Entra ID tenant over OpenID Connect (authorization code + PKCE, confidential client, server-side). The server then issues its own `express-session` cookie backed by a Postgres session table, so revocation, the local `active` flag and role checks stay under this application's control. Users, sessions and the audit trail live in Postgres; the 14 business record types stay in `data/store.json` until the separate migration project.

**Tech Stack:** Node 24, TypeScript, Express 4, `pg`, `express-session`, `connect-pg-simple`, `openid-client`, `express-rate-limit`, React 19, Vite, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-18-auth-design.md`

## Global Constraints

- Node `^20.19.0 || >=22.12.0`; the machine runs Node 24.
- No ORM. Plain SQL in `migrations/`, queries through `pg`.
- No mail library, no password hashing, no registration or reset flows — authentication is Entra only.
- Identity is the token's `oid` claim, never the email address.
- The token's `tid` claim must equal `ENTRA_TENANT_ID`; reject otherwise.
- `AUTH_MODE=dev` bypasses Entra with a fixed local user. The server **refuses to start** when `AUTH_MODE=dev` and `NODE_ENV=production` are both set.
- Session cookies: `httpOnly`, `sameSite: "lax"`, `secure` in production.
- Every mutating request (POST/PATCH/DELETE) carries `X-CSRF-Token`; compare timing-safe.
- Do not change any existing business API contract, and do not touch `data/store.json` except through the audit migration in Task 9.
- Brand values for any UI: red `#E00700`, ink `#1E1E1E`, page `#EFF2F7`, panel border `#D9DEE5`, Kanit headings, **zero corner radius**.
- `npm test` must keep running offline (no database, no network). Database-backed tests live behind `npm run test:db`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `compose.dev.yml` | Local Postgres for development |
| `.env.example` | Documented configuration template |
| `migrations/001_auth.sql` | `users` and `session` tables |
| `migrations/002_audit_logs.sql` | `audit_logs` table and indexes |
| `scripts/migrate.ts` | Applies pending migrations in order |
| `scripts/admin.ts` | Promotes an existing user to `admin` |
| `scripts/import-audit-logs.ts` | Moves the 61 existing entries out of `store.json` |
| `server/config.ts` | Reads and validates environment configuration |
| `server/db.ts` | `pg` pool, `query` and `transaction` helpers |
| `server/users.ts` | User repository and admin guards |
| `server/auditLog.ts` | Audit repository: append and query |
| `server/session.ts` | Session middleware, `requireAuth`, `requireAdmin`, CSRF |
| `server/auth/entra.ts` | OIDC discovery, authorization URL, callback exchange |
| `server/auth/claims.ts` | Pure claim validation and mapping (unit-tested offline) |
| `server/routes/auth.ts` | `/api/auth/*` routes |
| `server/routes/admin.ts` | `/api/admin/*` routes |
| `server/testDb.ts` | Test-only schema setup and teardown |
| `src/SignIn.tsx` | Sign-in screen |
| `src/SessionContext.tsx` | Current user, sign-out, session gate |
| `src/pages/AdminUsers.tsx` | User management console |
| `src/pages/AuditLog.tsx` | Global audit view |

**Modified**

| File | Change |
| --- | --- |
| `package.json` | Dependencies and the `migrate`, `admin`, `test:db` scripts |
| `server/index.ts` | Mount session, auth and admin routes; protect `/api` and `/uploads`; audit through the database with the acting user |
| `server/store.ts` | Nothing in this project — kept as the business store |
| `src/api.ts` | CSRF header, `credentials: "same-origin"`, 401 handling, auth and admin calls |
| `src/main.tsx` | Wrap the app in `SessionProvider` |
| `src/App.tsx` | Render `SignIn` when there is no session; admin entries in the shell |
| `src/components/AppShell.tsx` | Current user and sign-out in the sidebar |
| `src/uiTypes.ts` | `"Admin"` section |
| `tsconfig.server.json` | Include `scripts/**/*.ts` |

---

## Task 1: Configuration and database connection

**Files:**
- Create: `compose.dev.yml`, `.env.example`, `server/config.ts`, `server/db.ts`
- Test: `server/config.test.ts`
- Modify: `package.json`, `tsconfig.server.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `getConfig(env?: NodeJS.ProcessEnv): Config` where `Config = { production: boolean; port: number; origin: string; databaseUrl: string; sessionSecret: string; secureCookies: boolean; authMode: "entra" | "dev"; entra: { tenantId: string; clientId: string; clientSecret: string } | undefined }`; `pool: Pool`, `query<T>(text: string, params?: unknown[]): Promise<T[]>`, `transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Create `server/config.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { getConfig } from "./config";

const base = {
  DATABASE_URL: "postgres://localhost/sourcing",
  SESSION_SECRET: "x".repeat(32),
  APP_ORIGIN: "http://127.0.0.1:5173",
  ENTRA_TENANT_ID: "tenant",
  ENTRA_CLIENT_ID: "client",
  ENTRA_CLIENT_SECRET: "secret",
};

test("reads a complete environment", () => {
  const config = getConfig(base);
  assert.equal(config.databaseUrl, "postgres://localhost/sourcing");
  assert.equal(config.authMode, "entra");
  assert.equal(config.entra?.tenantId, "tenant");
});

test("refuses a missing database url", () => {
  assert.throws(() => getConfig({ ...base, DATABASE_URL: undefined }), /DATABASE_URL/);
});

test("refuses a short session secret", () => {
  assert.throws(() => getConfig({ ...base, SESSION_SECRET: "short" }), /SESSION_SECRET/);
});

test("refuses the dev bypass in production", () => {
  assert.throws(
    () => getConfig({ ...base, AUTH_MODE: "dev", NODE_ENV: "production" }),
    /AUTH_MODE=dev/,
  );
});

test("allows the dev bypass without Entra credentials outside production", () => {
  const config = getConfig({
    DATABASE_URL: base.DATABASE_URL,
    SESSION_SECRET: base.SESSION_SECRET,
    APP_ORIGIN: base.APP_ORIGIN,
    AUTH_MODE: "dev",
  });
  assert.equal(config.authMode, "dev");
  assert.equal(config.entra, undefined);
});

test("requires Entra credentials when the mode is entra", () => {
  assert.throws(() => getConfig({ ...base, ENTRA_CLIENT_SECRET: undefined }), /ENTRA_CLIENT_SECRET/);
});

test("requires https in production", () => {
  assert.throws(
    () => getConfig({ ...base, NODE_ENV: "production", APP_ORIGIN: "http://sourcing.segsolar.com" }),
    /HTTPS/,
  );
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx tsx --test server/config.test.ts`
Expected: FAIL, `Cannot find module './config'`.

- [ ] **Step 3: Write `server/config.ts`**

```ts
export interface Config {
  production: boolean;
  port: number;
  origin: string;
  databaseUrl: string;
  sessionSecret: string;
  secureCookies: boolean;
  authMode: "entra" | "dev";
  entra: { tenantId: string; clientId: string; clientSecret: string } | undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  return value;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const authMode = env.AUTH_MODE === "dev" ? "dev" : "entra";

  if (authMode === "dev" && production) {
    throw new Error("AUTH_MODE=dev cannot run in production. Remove it or unset NODE_ENV=production.");
  }

  const databaseUrl = required(env, "DATABASE_URL");
  const sessionSecret = required(env, "SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");

  const origin = new URL(env.APP_ORIGIN || "http://127.0.0.1:5173").origin;
  if (production && !origin.startsWith("https://")) throw new Error("Production APP_ORIGIN must use HTTPS.");

  const entra =
    authMode === "entra"
      ? {
          tenantId: required(env, "ENTRA_TENANT_ID"),
          clientId: required(env, "ENTRA_CLIENT_ID"),
          clientSecret: required(env, "ENTRA_CLIENT_SECRET"),
        }
      : undefined;

  return {
    production,
    port: Number(env.API_PORT ?? 5174),
    origin,
    databaseUrl,
    sessionSecret,
    secureCookies: production || env.COOKIE_SECURE === "true",
    authMode,
    entra,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx tsx --test server/config.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `server/db.ts`**

```ts
import { Pool, type PoolClient } from "pg";

import { getConfig } from "./config";

export const pool = new Pool({ connectionString: getConfig().databaseUrl });

pool.on("error", (error) => console.error("Database connection error:", error.message));

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 6: Write `compose.dev.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: sourcing
      POSTGRES_PASSWORD: sourcing
      POSTGRES_DB: sourcing
    ports:
      - "5433:5432"
    volumes:
      - sourcing-pgdata:/var/lib/postgresql/data

volumes:
  sourcing-pgdata:
```

- [ ] **Step 7: Write `.env.example`**

```bash
# Database — docker compose -f compose.dev.yml up -d
DATABASE_URL=postgres://sourcing:sourcing@127.0.0.1:5433/sourcing
# A second database used only by npm run test:db
DATABASE_URL_TEST=postgres://sourcing:sourcing@127.0.0.1:5433/sourcing_test

# At least 32 random characters: openssl rand -hex 32
SESSION_SECRET=

# Where the browser reaches this app; must match the Entra redirect URI
APP_ORIGIN=http://127.0.0.1:5173
API_PORT=5174

# entra (default) or dev. dev signs in a fixed local account and is refused in production.
AUTH_MODE=dev

# Entra app registration — redirect URI is <APP_ORIGIN>/api/auth/callback
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
```

- [ ] **Step 8: Add dependencies and scripts**

Run:

```bash
npm install pg express-session connect-pg-simple openid-client express-rate-limit
npm install --save-dev @types/pg @types/express-session
```

Then edit `package.json` scripts to read:

```json
"dev:api": "tsx --env-file-if-exists=.env server/index.ts",
"migrate": "tsx --env-file-if-exists=.env scripts/migrate.ts",
"admin": "tsx --env-file-if-exists=.env scripts/admin.ts",
"test": "tsx --test src/*.test.ts src/lib/*.test.ts server/*.test.ts",
"test:db": "tsx --env-file-if-exists=.env --test server/db/*.test.ts"
```

Edit `tsconfig.server.json` so `include` reads:

```json
"include": ["server/**/*.ts", "scripts/**/*.ts", "src/data.ts", "src/types.ts", "src/leadTime.ts", "src/leadTime.test.ts"]
```

- [ ] **Step 9: Verify the whole suite still passes**

Run: `npm test && npm run typecheck:api`
Expected: all tests pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.server.json compose.dev.yml .env.example server/config.ts server/config.test.ts server/db.ts
git commit -m "Add Postgres connection and validated configuration"
```

---

## Task 2: Migration runner and the auth schema

**Files:**
- Create: `migrations/001_auth.sql`, `scripts/migrate.ts`
- Test: `server/db/migrate.test.ts`, `server/testDb.ts`

**Interfaces:**
- Consumes: `pool`, `query` from `server/db.ts`.
- Produces: `runMigrations(client: PoolClient, directory?: string): Promise<string[]>` returning the filenames applied; `withTestDatabase(fn: (client: PoolClient) => Promise<void>): Promise<void>` from `server/testDb.ts`, which creates a fresh schema, runs every migration, and drops the schema afterwards.

- [ ] **Step 1: Write `server/testDb.ts`**

```ts
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

import { runMigrations } from "../scripts/migrate";

const connectionString = process.env.DATABASE_URL_TEST;

export const databaseAvailable = Boolean(connectionString);

export async function withTestDatabase(fn: (client: PoolClient) => Promise<void>) {
  if (!connectionString) throw new Error("DATABASE_URL_TEST is not set. Run npm test for the offline suite.");
  const pool = new Pool({ connectionString });
  const schema = `test_${randomUUID().replace(/-/g, "")}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await runMigrations(client);
    await fn(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `server/db/migrate.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";

test("creates the users table", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND table_schema = current_schema()",
    );
    const columns = rows.map((row) => row.column_name).sort();
    assert.deepEqual(columns, [
      "active", "created_at", "email", "entra_oid", "id", "last_login_at", "name", "role", "session_epoch",
    ]);
  });
});

test("rejects a second user with the same entra oid", async () => {
  await withTestDatabase(async (client) => {
    await client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "a@segsolar.com", "A"]);
    await assert.rejects(
      client.query("INSERT INTO users(entra_oid, email, name) VALUES ($1, $2, $3)", ["oid-1", "b@segsolar.com", "B"]),
      /duplicate key/,
    );
  });
});

test("records which migrations ran", async () => {
  await withTestDatabase(async (client) => {
    const { rows } = await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
    assert.ok(rows.some((row) => row.filename === "001_auth.sql"));
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `docker compose -f compose.dev.yml up -d` then
`createdb -h 127.0.0.1 -p 5433 -U sourcing sourcing_test` (password `sourcing`), then
`npm run test:db`
Expected: FAIL, `Cannot find module '../../scripts/migrate'`.

- [ ] **Step 4: Write `migrations/001_auth.sql`**

```sql
CREATE TABLE users (
  id             serial PRIMARY KEY,
  entra_oid      text NOT NULL UNIQUE,
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active         boolean NOT NULL DEFAULT true,
  session_epoch  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE INDEX users_email_idx ON users (lower(email));

-- connect-pg-simple's table, created here so migrations own the whole schema.
CREATE TABLE session (
  sid    varchar NOT NULL COLLATE "default" PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX session_expire_idx ON session (expire);
```

- [ ] **Step 5: Write `scripts/migrate.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const defaultDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function runMigrations(client: PoolClient, directory = defaultDirectory): Promise<string[]> {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.filename as string));
  const pending = readdirSync(directory).filter((name) => name.endsWith(".sql") && !applied.has(name)).sort();

  for (const filename of pending) {
    await client.query(readFileSync(join(directory, filename), "utf8"));
    await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [filename]);
  }
  return pending;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pool } = await import("../server/db.js");
  const client = await pool.connect();
  try {
    const applied = await runMigrations(client);
    console.log(applied.length === 0 ? "No pending migrations." : `Applied: ${applied.join(", ")}`);
  } finally {
    client.release();
    await pool.end();
  }
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npm run test:db`
Expected: PASS, 3 tests.

- [ ] **Step 7: Apply the migration to the development database**

Run: `npm run migrate`
Expected: `Applied: 001_auth.sql`.

- [ ] **Step 8: Commit**

```bash
git add migrations/001_auth.sql scripts/migrate.ts server/testDb.ts server/db/migrate.test.ts package.json
git commit -m "Add migration runner and the users and session schema"
```

---

## Task 3: User repository and the admin promotion script

**Files:**
- Create: `server/users.ts`, `scripts/admin.ts`
- Test: `server/db/users.test.ts`

**Interfaces:**
- Consumes: `withTestDatabase` (tests), `query`/`transaction` from `server/db.ts`.
- Produces, all taking a `PoolClient`-like executor as the first argument so tests can bind them to a schema:
  - `type User = { id: number; entraOid: string; email: string; name: string; role: "admin" | "user"; active: boolean; sessionEpoch: number; lastLoginAt: string | null }`
  - `upsertUserFromClaims(db, claims: { oid: string; email: string; name: string }): Promise<User>`
  - `findUserById(db, id: number): Promise<User | undefined>`
  - `listUsers(db): Promise<User[]>`
  - `setUserRole(db, id: number, role: "admin" | "user", actingUserId: number): Promise<User>`
  - `setUserActive(db, id: number, active: boolean, actingUserId: number): Promise<User>`
  - `deleteUser(db, id: number, actingUserId: number): Promise<void>`
  - `class UserRuleError extends Error { status = 400 }`

- [ ] **Step 1: Write the failing test**

Create `server/db/users.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";
import { deleteUser, listUsers, setUserActive, setUserRole, upsertUserFromClaims } from "../users";

const alice = { oid: "oid-alice", email: "Alice@segsolar.com", name: "Alice" };
const bob = { oid: "oid-bob", email: "bob@segsolar.com", name: "Bob" };

test("creates a user on first sign-in with the default role", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, alice);
    assert.equal(user.role, "user");
    assert.equal(user.active, true);
    assert.equal(user.email, "alice@segsolar.com");
  });
});

test("returns the same row on the next sign-in and refreshes the name", async () => {
  await withTestDatabase(async (db) => {
    const first = await upsertUserFromClaims(db, alice);
    const second = await upsertUserFromClaims(db, { ...alice, name: "Alice Zhou" });
    assert.equal(second.id, first.id);
    assert.equal(second.name, "Alice Zhou");
  });
});

test("matches on the oid even when the email changed", async () => {
  await withTestDatabase(async (db) => {
    const first = await upsertUserFromClaims(db, alice);
    const renamed = await upsertUserFromClaims(db, { ...alice, email: "alice.zhou@segsolar.com" });
    assert.equal(renamed.id, first.id);
    assert.equal((await listUsers(db)).length, 1);
  });
});

test("a role change bumps the session epoch", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    const target = await upsertUserFromClaims(db, bob);
    const promoted = await setUserRole(db, target.id, "admin", admin.id);
    assert.equal(promoted.role, "admin");
    assert.equal(promoted.sessionEpoch, target.sessionEpoch + 1);
  });
});

test("an admin cannot deactivate their own account", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    await assert.rejects(() => setUserActive(db, admin.id, false, admin.id), /your own account/);
  });
});

test("the last active admin cannot be demoted", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    const other = await upsertUserFromClaims(db, bob);
    await assert.rejects(() => setUserRole(db, admin.id, "user", other.id), /one active admin/);
  });
});

test("an admin cannot delete their own account", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, alice);
    await setUserRole(db, admin.id, "admin", admin.id);
    await assert.rejects(() => deleteUser(db, admin.id, admin.id), /your own account/);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:db`
Expected: FAIL, `Cannot find module '../users'`.

- [ ] **Step 3: Write `server/users.ts`**

```ts
import type { PoolClient } from "pg";

export interface User {
  id: number;
  entraOid: string;
  email: string;
  name: string;
  role: "admin" | "user";
  active: boolean;
  sessionEpoch: number;
  lastLoginAt: string | null;
}

export class UserRuleError extends Error {
  status = 400;
}

type Executor = Pick<PoolClient, "query">;

const COLUMNS = `id, entra_oid, email, name, role, active, session_epoch, last_login_at`;

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    entraOid: row.entra_oid as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as "admin" | "user",
    active: row.active as boolean,
    sessionEpoch: row.session_epoch as number,
    lastLoginAt: (row.last_login_at as Date | null)?.toISOString() ?? null,
  };
}

export async function upsertUserFromClaims(db: Executor, claims: { oid: string; email: string; name: string }): Promise<User> {
  const { rows } = await db.query(
    `INSERT INTO users(entra_oid, email, name, last_login_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (entra_oid) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now()
     RETURNING ${COLUMNS}`,
    [claims.oid, claims.email.trim().toLowerCase(), claims.name.trim()],
  );
  return toUser(rows[0]);
}

export async function findUserById(db: Executor, id: number): Promise<User | undefined> {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : undefined;
}

export async function listUsers(db: Executor): Promise<User[]> {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM users ORDER BY lower(name)`);
  return rows.map(toUser);
}

async function activeAdminCount(db: Executor, excludingId: number): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND active AND id <> $1",
    [excludingId],
  );
  return rows[0].count as number;
}

export async function setUserRole(db: Executor, id: number, role: "admin" | "user", actingUserId: number): Promise<User> {
  if (role === "user" && (await activeAdminCount(db, id)) === 0) {
    throw new UserRuleError("At least one active admin must remain.");
  }
  const { rows } = await db.query(
    `UPDATE users SET role = $2, session_epoch = session_epoch + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, role],
  );
  if (!rows[0]) throw new UserRuleError(`User not found: ${id}`);
  return toUser(rows[0]);
}

export async function setUserActive(db: Executor, id: number, active: boolean, actingUserId: number): Promise<User> {
  if (!active && id === actingUserId) throw new UserRuleError("You cannot deactivate your own account.");
  if (!active && (await activeAdminCount(db, id)) === 0) {
    throw new UserRuleError("At least one active admin must remain.");
  }
  const { rows } = await db.query(
    `UPDATE users SET active = $2, session_epoch = session_epoch + 1 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, active],
  );
  if (!rows[0]) throw new UserRuleError(`User not found: ${id}`);
  return toUser(rows[0]);
}

export async function deleteUser(db: Executor, id: number, actingUserId: number): Promise<void> {
  if (id === actingUserId) throw new UserRuleError("You cannot delete your own account.");
  if ((await activeAdminCount(db, id)) === 0) throw new UserRuleError("At least one active admin must remain.");
  await db.query("DELETE FROM users WHERE id = $1", [id]);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm run test:db`
Expected: PASS, 7 new tests.

- [ ] **Step 5: Write `scripts/admin.ts`**

```ts
import { pool } from "../server/db.js";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run admin -- <email>");
  process.exit(1);
}

const client = await pool.connect();
try {
  const { rows } = await client.query(
    "UPDATE users SET role = 'admin', session_epoch = session_epoch + 1 WHERE lower(email) = lower($1) RETURNING email, name",
    [email],
  );
  if (rows.length === 0) {
    console.error(`No user with that address. They must sign in once before they can be promoted: ${email}`);
    process.exit(1);
  }
  console.log(`${rows[0].name} <${rows[0].email}> is now an admin.`);
} finally {
  client.release();
  await pool.end();
}
```

- [ ] **Step 6: Verify types and the offline suite**

Run: `npm run typecheck:api && npm test`
Expected: no type errors; the offline suite still passes.

- [ ] **Step 7: Commit**

```bash
git add server/users.ts server/db/users.test.ts scripts/admin.ts
git commit -m "Add user repository with admin guards and a promotion script"
```

---

## Task 4: Claim validation

**Files:**
- Create: `server/auth/claims.ts`
- Test: `server/claims.test.ts` (offline — no database, no network)

**Interfaces:**
- Consumes: nothing.
- Produces: `validateClaims(claims: Record<string, unknown>, expectedTenantId: string): { oid: string; email: string; name: string }`, throwing `ClaimError` with a `status` of 403.

- [ ] **Step 1: Write the failing test**

Create `server/claims.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateClaims } from "./auth/claims";

const valid = {
  tid: "seg-tenant",
  oid: "00000000-1111-2222-3333-444444444444",
  preferred_username: "Di.Zhou@segsolar.com",
  name: "Di Zhou",
};

test("maps a valid token to user fields", () => {
  assert.deepEqual(validateClaims(valid, "seg-tenant"), {
    oid: "00000000-1111-2222-3333-444444444444",
    email: "di.zhou@segsolar.com",
    name: "Di Zhou",
  });
});

test("rejects a token from another tenant", () => {
  assert.throws(() => validateClaims({ ...valid, tid: "someone-else" }, "seg-tenant"), /tenant/i);
});

test("rejects a token with no object id", () => {
  assert.throws(() => validateClaims({ ...valid, oid: undefined }, "seg-tenant"), /oid/);
});

test("falls back to the email claim when preferred_username is absent", () => {
  const claims = { ...valid, preferred_username: undefined, email: "di.zhou@segsolar.com" };
  assert.equal(validateClaims(claims, "seg-tenant").email, "di.zhou@segsolar.com");
});

test("falls back to the email local part when no name is present", () => {
  const claims = { ...valid, name: undefined };
  assert.equal(validateClaims(claims, "seg-tenant").name, "Di.Zhou");
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx tsx --test server/claims.test.ts`
Expected: FAIL, `Cannot find module './auth/claims'`.

- [ ] **Step 3: Write `server/auth/claims.ts`**

```ts
export class ClaimError extends Error {
  status = 403;
}

export function validateClaims(claims: Record<string, unknown>, expectedTenantId: string) {
  if (claims.tid !== expectedTenantId) {
    throw new ClaimError("This account belongs to a different organisation.");
  }
  const oid = typeof claims.oid === "string" ? claims.oid : "";
  if (!oid) throw new ClaimError("The sign-in response carried no oid claim.");

  const email = String(claims.preferred_username ?? claims.email ?? "").trim().toLowerCase();
  if (!email) throw new ClaimError("The sign-in response carried no email address.");

  const name = String(claims.name ?? "").trim() || email.split("@")[0];
  return { oid, email, name };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx tsx --test server/claims.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/auth/claims.ts server/claims.test.ts
git commit -m "Validate Entra token claims against the tenant"
```

---

## Task 5: Sessions, guards and CSRF

**Files:**
- Create: `server/session.ts`
- Test: `server/db/session.test.ts`

**Interfaces:**
- Consumes: `findUserById` (Task 3), `getConfig`, `pool`.
- Produces: `sessionMiddleware: RequestHandler`, `requireAuth: RequestHandler`, `requireAdmin: RequestHandler`, `verifyCsrf: RequestHandler`, `csrfToken(req): string`, `signIn(req, user): Promise<void>`, and the `Express.Request` augmentation `req.user?: User`.

- [ ] **Step 1: Write the failing test**

Create `server/db/session.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";
import { sessionUserIsCurrent } from "../session";
import { setUserActive, setUserRole, upsertUserFromClaims } from "../users";

test("a session matching the stored epoch is current", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    assert.equal(await sessionUserIsCurrent(db, user.id, user.sessionEpoch), true);
  });
});

test("a role change makes an existing session stale", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    const admin = await upsertUserFromClaims(db, { oid: "oid-2", email: "b@segsolar.com", name: "B" });
    await setUserRole(db, admin.id, "admin", admin.id);
    await setUserRole(db, user.id, "admin", admin.id);
    assert.equal(await sessionUserIsCurrent(db, user.id, user.sessionEpoch), false);
  });
});

test("a deactivated user is never current", async () => {
  await withTestDatabase(async (db) => {
    const admin = await upsertUserFromClaims(db, { oid: "oid-2", email: "b@segsolar.com", name: "B" });
    await setUserRole(db, admin.id, "admin", admin.id);
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "A" });
    const deactivated = await setUserActive(db, user.id, false, admin.id);
    assert.equal(await sessionUserIsCurrent(db, user.id, deactivated.sessionEpoch), false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:db`
Expected: FAIL, `Cannot find module '../session'`.

- [ ] **Step 3: Write `server/session.ts`**

```ts
import { randomBytes, timingSafeEqual } from "node:crypto";
import connectPgSimple from "connect-pg-simple";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import session from "express-session";
import type { PoolClient } from "pg";

import { getConfig } from "./config";
import { pool, query } from "./db";
import { findUserById, type User } from "./users";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userEpoch?: number;
    csrfToken?: string;
    oidc?: { state: string; nonce: string; verifier: string };
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const config = getConfig();

export const sessionMiddleware: RequestHandler = session({
  store: new (connectPgSimple(session))({ pool, tableName: "session", createTableIfMissing: false }),
  name: "sourcing.sid",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: config.secureCookies, maxAge: 12 * 60 * 60 * 1000 },
});

type Executor = Pick<PoolClient, "query">;

export async function sessionUserIsCurrent(db: Executor, userId: number, epoch: number): Promise<boolean> {
  const user = await findUserById(db, userId);
  return Boolean(user && user.active && user.sessionEpoch === epoch);
}

export async function signIn(request: Request, user: User): Promise<void> {
  await new Promise<void>((resolve, reject) => request.session.regenerate((error) => (error ? reject(error) : resolve())));
  request.session.userId = user.id;
  request.session.userEpoch = user.sessionEpoch;
  await new Promise<void>((resolve, reject) => request.session.save((error) => (error ? reject(error) : resolve())));
}

export const requireAuth: RequestHandler = async (request, response, next) => {
  const { userId, userEpoch } = request.session;
  if (!userId || userEpoch === undefined) {
    response.status(401).json({ message: "Sign in to continue." });
    return;
  }
  const user = await findUserById({ query: (text: string, params?: unknown[]) => pool.query(text, params) } as Executor, userId);
  if (!user || !user.active || user.sessionEpoch !== userEpoch) {
    request.session.destroy(() => undefined);
    response.status(401).json({ message: "Your session has ended. Sign in again." });
    return;
  }
  request.user = user;
  next();
};

export const requireAdmin: RequestHandler = (request, response, next) => {
  if (request.user?.role !== "admin") {
    response.status(403).json({ message: "Administrator access is required." });
    return;
  }
  next();
};

export function csrfToken(request: Request): string {
  request.session.csrfToken ||= randomBytes(32).toString("hex");
  return request.session.csrfToken;
}

export function verifyCsrf(request: Request, response: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const supplied = request.get("x-csrf-token") ?? "";
  const expected = request.session.csrfToken ?? "";
  if (!expected || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    response.status(403).json({ message: "This page expired. Reload and try again." });
    return;
  }
  next();
}

export { query };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm run test:db`
Expected: PASS, 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add server/session.ts server/db/session.test.ts
git commit -m "Add session middleware, auth guards and CSRF verification"
```

---

## Task 6: The OIDC routes

**Files:**
- Create: `server/auth/entra.ts`, `server/routes/auth.ts`
- Modify: `server/index.ts`
- Test: `server/db/authRoutes.test.ts`

**Interfaces:**
- Consumes: `validateClaims` (Task 4), `upsertUserFromClaims` (Task 3), `signIn`, `requireAuth`, `csrfToken` (Task 5).
- Produces: `authRouter: Router` mounted at `/api/auth`, serving `GET /login`, `GET /callback`, `POST /logout`, `GET /me`; `getAuthorizationUrl(request)` and `exchangeCallback(request)` from `server/auth/entra.ts`.

- [ ] **Step 1: Write the failing test**

Create `server/db/authRoutes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";
import { upsertUserFromClaims } from "../users";

// AUTH_MODE=dev is set by the test runner; the dev bypass signs in this fixed account.
const { createApp } = await import("../app");

async function call(app: ReturnType<typeof createApp>, path: string, init?: RequestInit & { cookie?: string }) {
  const server = app.listen(0);
  const { port } = server.address() as { port: number };
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init?.headers ?? {}), ...(init?.cookie ? { cookie: init.cookie } : {}) },
    });
  } finally {
    server.close();
  }
}

test("an unauthenticated API call is rejected", async () => {
  await withTestDatabase(async () => {
    const response = await call(createApp(), "/api/bootstrap");
    assert.equal(response.status, 401);
  });
});

test("an unauthenticated upload request is rejected", async () => {
  await withTestDatabase(async () => {
    const response = await call(createApp(), "/uploads/file-1001.pdf");
    assert.equal(response.status, 401);
  });
});

test("the dev bypass signs in and /api/auth/me returns the user", async () => {
  await withTestDatabase(async () => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    const me = await call(app, "/api/auth/me", { cookie });
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.email, "dev@segsolar.com");
  });
});

test("a deactivated user cannot use an existing session", async () => {
  await withTestDatabase(async (db) => {
    const app = createApp();
    const login = await call(app, "/api/auth/login");
    const cookie = login.headers.get("set-cookie") ?? "";
    await db.query("UPDATE users SET active = false, session_epoch = session_epoch + 1 WHERE email = $1", ["dev@segsolar.com"]);
    const me = await call(app, "/api/auth/me", { cookie });
    assert.equal(me.status, 401);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `AUTH_MODE=dev npm run test:db`
Expected: FAIL, `Cannot find module '../app'`.

- [ ] **Step 3: Split the Express app out of `server/index.ts`**

Move everything in `server/index.ts` except the final `app.listen(...)` into a new `server/app.ts` exporting `export function createApp(): Express`. `server/index.ts` becomes:

```ts
import { createApp } from "./app";
import { getConfig } from "./config";

const { port } = getConfig();
createApp().listen(port, () => console.log(`Global Sourcing API listening on http://127.0.0.1:${port}`));
```

- [ ] **Step 4: Write `server/auth/entra.ts`**

```ts
import { randomBytes } from "node:crypto";
import type { Request } from "express";
import * as client from "openid-client";

import { getConfig } from "../config";

const config = getConfig();

let configuration: client.Configuration | undefined;

async function getConfiguration(): Promise<client.Configuration> {
  if (!config.entra) throw new Error("Entra is not configured.");
  configuration ??= await client.discovery(
    new URL(`https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`),
    config.entra.clientId,
    config.entra.clientSecret,
  );
  return configuration;
}

const redirectUri = `${config.origin}/api/auth/callback`;

export async function getAuthorizationUrl(request: Request): Promise<string> {
  const configured = await getConfiguration();
  const verifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(verifier);
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  request.session.oidc = { state, nonce, verifier };

  return client.buildAuthorizationUrl(configured, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
  }).href;
}

export async function exchangeCallback(request: Request): Promise<Record<string, unknown>> {
  const pending = request.session.oidc;
  if (!pending) throw new Error("This sign-in attempt expired. Start again.");
  delete request.session.oidc;

  const configured = await getConfiguration();
  const tokens = await client.authorizationCodeGrant(
    configured,
    new URL(`${config.origin}${request.originalUrl}`),
    { pkceCodeVerifier: pending.verifier, expectedState: pending.state, expectedNonce: pending.nonce },
  );
  return tokens.claims() as Record<string, unknown>;
}
```

- [ ] **Step 5: Write `server/routes/auth.ts`**

```ts
import { Router } from "express";
import rateLimit from "express-rate-limit";

import { validateClaims } from "../auth/claims";
import { exchangeCallback, getAuthorizationUrl } from "../auth/entra";
import { getConfig } from "../config";
import { pool } from "../db";
import { csrfToken, requireAuth, signIn } from "../session";
import { upsertUserFromClaims } from "../users";

const config = getConfig();
export const authRouter = Router();

const callbackLimiter = rateLimit({ windowMs: 60_000, limit: 20 });

const DEV_CLAIMS = { tid: "dev", oid: "dev-oid", preferred_username: "dev@segsolar.com", name: "Dev User" };

authRouter.get("/login", async (request, response, next) => {
  try {
    if (config.authMode === "dev") {
      const user = await upsertUserFromClaims(pool, validateClaims(DEV_CLAIMS, "dev"));
      await signIn(request, user);
      response.redirect(302, "/");
      return;
    }
    response.redirect(302, await getAuthorizationUrl(request));
  } catch (error) {
    next(error);
  }
});

authRouter.get("/callback", callbackLimiter, async (request, response, next) => {
  try {
    const claims = await exchangeCallback(request);
    const mapped = validateClaims(claims, config.entra!.tenantId);
    const user = await upsertUserFromClaims(pool, mapped);
    if (!user.active) {
      response.redirect(302, "/?error=deactivated");
      return;
    }
    await signIn(request, user);
    response.redirect(302, "/");
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", (request, response) => {
  request.session.destroy(() => response.json({ ok: true }));
});

authRouter.get("/me", requireAuth, (request, response) => {
  const user = request.user!;
  response.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    csrfToken: csrfToken(request),
  });
});
```

- [ ] **Step 6: Mount everything in `server/app.ts`**

Add to `createApp()`, before the existing routes:

```ts
app.set("trust proxy", 1);
app.use(sessionMiddleware);
app.use("/api/auth", authRouter);
app.use("/api", requireAuth, verifyCsrf);
app.use("/uploads", requireAuth, express.static(join(process.cwd(), "uploads")));
```

Delete the previous unprotected `app.use("/uploads", express.static(...))` line.

- [ ] **Step 7: Run the test and watch it pass**

Run: `AUTH_MODE=dev npm run test:db`
Expected: PASS, 4 new tests.

- [ ] **Step 8: Verify by hand**

Run `npm run dev:api` and `npm run dev` with `AUTH_MODE=dev`, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5174/api/bootstrap   # 401
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5174/uploads/file-1001.pdf  # 401
```

- [ ] **Step 9: Commit**

```bash
git add server/app.ts server/index.ts server/auth/entra.ts server/routes/auth.ts server/db/authRoutes.test.ts
git commit -m "Add Entra sign-in routes and close the API and uploads"
```

---

## Task 7: Frontend session gate and sign-in screen

**Files:**
- Create: `src/SessionContext.tsx`, `src/SignIn.tsx`
- Modify: `src/api.ts`, `src/main.tsx`, `src/App.tsx`, `src/components/AppShell.tsx`
- Test: `src/session.test.ts`

**Interfaces:**
- Consumes: `GET /api/auth/me`, `POST /api/auth/logout` (Task 6).
- Produces: `useSession(): { user: SessionUser | null; loading: boolean; signOut: () => Promise<void> }` where `SessionUser = { id: number; name: string; email: string; role: "admin" | "user" }`; `setCsrfToken(token: string)` exported from `src/api.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/session.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { csrfHeaders } from "./api";

test("mutating requests carry the csrf token", () => {
  assert.deepEqual(csrfHeaders("POST", "token-123"), { "X-CSRF-Token": "token-123" });
});

test("read-only requests carry no csrf token", () => {
  assert.deepEqual(csrfHeaders("GET", "token-123"), {});
});

test("a missing token adds no header", () => {
  assert.deepEqual(csrfHeaders("POST", ""), {});
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx tsx --test src/session.test.ts`
Expected: FAIL, `csrfHeaders is not exported`.

- [ ] **Step 3: Update `src/api.ts`**

Add above `request()`:

```ts
let csrfToken = "";

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function csrfHeaders(method: string, token: string): Record<string, string> {
  if (!token || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return {};
  return { "X-CSRF-Token": token };
}

export class UnauthenticatedError extends Error {}
```

Replace the body of `request()` with:

```ts
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? "GET";
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(method, csrfToken),
      ...options?.headers,
    },
    ...options,
  });

  if (response.status === 401) throw new UnauthenticatedError("Sign in to continue.");

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: "Request failed" }));
    throw new Error(errorBody.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
}

export function fetchSession() {
  return request<SessionUser & { csrfToken: string }>("/api/auth/me");
}

export function signOut() {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx tsx --test src/session.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write `src/SessionContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { fetchSession, setCsrfToken, signOut as postSignOut, type SessionUser } from "./api";

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession()
      .then((session) => {
        setCsrfToken(session.csrfToken);
        setUser({ id: session.id, name: session.name, email: session.email, role: session.role });
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const signOut = useCallback(async () => {
    await postSignOut().catch(() => undefined);
    setUser(null);
    window.location.assign("/");
  }, []);

  return <SessionContext.Provider value={{ user, loading, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within SessionProvider");
  return context;
}
```

- [ ] **Step 6: Write `src/SignIn.tsx`**

Reproduce `design/LoginSignIn.dc.html`: a charcoal `#141414` block on the left carrying `seg-logo-white.svg`, the uppercase Kanit heading "Global Sourcing", a red `#E00700` rule and the description line; the right half white with the heading "Sign in", the explanatory line, and one button linking to `/api/auth/login`. Zero corner radius throughout. Copy the SVG logo into `src/assets/seg-logo-white.svg` and import it.

```tsx
export function SignIn({ deactivated }: { deactivated: boolean }) {
  return (
    <div className="signInLayout">
      <aside className="signInBrand">
        <img src={logo} alt="SEG Solar" className="signInLogo" />
        <div>
          <h1 className="signInTitle">Global<br />Sourcing</h1>
          <div className="signInRule" />
          <p className="signInLead">Packaging supplier development, quoting, sample QC and pricing for solar module production.</p>
        </div>
        <div className="signInFoot">Internal system · Authorized users only</div>
      </aside>
      <main className="signInPanel">
        <div className="signInForm">
          <h2 className="signInHeading">Sign in</h2>
          <p className="signInSub">Use the SEG account you sign in to Outlook with.</p>
          {deactivated && (
            <div className="notice errorNotice">
              <strong>Access turned off.</strong> This account has been deactivated. Contact the sourcing system administrator.
            </div>
          )}
          <a className="signInButton" href="/api/auth/login">Sign in with your SEG account</a>
          <p className="signInNote">
            No separate password for this system. Access follows your Microsoft account — if it is disabled, so is this.
          </p>
        </div>
      </main>
    </div>
  );
}
```

Add the matching classes to `src/styles.css` using the brand tokens.

- [ ] **Step 7: Gate the app**

In `src/main.tsx`, wrap the tree: `<SessionProvider><AppDataProvider><App /></AppDataProvider></SessionProvider>`.

At the top of `App()` in `src/App.tsx`:

```tsx
const { user, loading: sessionLoading } = useSession();
const deactivated = new URLSearchParams(window.location.search).get("error") === "deactivated";
if (sessionLoading) return <div className="signInLoading">Loading…</div>;
if (!user) return <SignIn deactivated={deactivated} />;
```

In `src/components/AppShell.tsx`, add the signed-in user's name and email plus a sign-out button to the bottom of the sidebar, replacing the "Data source" block.

- [ ] **Step 8: Verify by hand**

With `AUTH_MODE=dev`, open http://127.0.0.1:5173 in a private window: the sign-in screen appears, the button signs in, the workbench renders, the sidebar shows "Dev User", and sign-out returns to the sign-in screen.

- [ ] **Step 9: Commit**

```bash
git add src/SessionContext.tsx src/SignIn.tsx src/session.test.ts src/api.ts src/main.tsx src/App.tsx src/components/AppShell.tsx src/styles.css src/assets
git commit -m "Gate the frontend behind sign-in"
```

---

## Task 8: Audit log table and repository

**Files:**
- Create: `migrations/002_audit_logs.sql`, `server/auditLog.ts`, `scripts/import-audit-logs.ts`
- Test: `server/db/auditLog.test.ts`

**Interfaces:**
- Consumes: `withTestDatabase`, `upsertUserFromClaims`.
- Produces:
  - `type AuditEntry = { timestamp: string; actorUserId: number | null; actorLabel: string; action: string; entityType: string; entityId: string; entityLabel: string; before?: unknown; after?: unknown; reason?: string; source: "UI" | "Import" | "System"; linkedRecordId?: string }`
  - `appendAuditEntry(db, entry: AuditEntry): Promise<void>`
  - `listAuditEntries(db, filter: { entityType?: string; entityId?: string; actorUserId?: number; limit?: number }): Promise<(AuditEntry & { id: number })[]>`
  - `countAuditEntries(db): Promise<{ rows: number; bytes: number }>`

- [ ] **Step 1: Write the failing test**

Create `server/db/auditLog.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { appendAuditEntry, countAuditEntries, listAuditEntries } from "../auditLog";
import { withTestDatabase } from "../testDb";
import { upsertUserFromClaims } from "../users";

const entry = {
  timestamp: "2026-09-18T10:00:00.000Z",
  actorUserId: null,
  actorLabel: "System",
  action: "Create",
  entityType: "Quote",
  entityId: "q-1001",
  entityLabel: "LEGACY / 27.002.011.052",
  after: { unitPrice: 36.2 },
  source: "UI" as const,
};

test("appends and reads back an entry", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, entry);
    const [stored] = await listAuditEntries(db, { entityType: "Quote", entityId: "q-1001" });
    assert.equal(stored.entityLabel, "LEGACY / 27.002.011.052");
    assert.deepEqual(stored.after, { unitPrice: 36.2 });
  });
});

test("records the acting user", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "Alice" });
    await appendAuditEntry(db, { ...entry, actorUserId: user.id, actorLabel: "Alice" });
    const [stored] = await listAuditEntries(db, { actorUserId: user.id });
    assert.equal(stored.actorLabel, "Alice");
  });
});

test("keeps the label after the user is deleted", async () => {
  await withTestDatabase(async (db) => {
    const user = await upsertUserFromClaims(db, { oid: "oid-1", email: "a@segsolar.com", name: "Alice" });
    await appendAuditEntry(db, { ...entry, actorUserId: user.id, actorLabel: "Alice" });
    await db.query("DELETE FROM users WHERE id = $1", [user.id]);
    const [stored] = await listAuditEntries(db, { entityId: "q-1001" });
    assert.equal(stored.actorLabel, "Alice");
    assert.equal(stored.actorUserId, null);
  });
});

test("returns newest first and respects the limit", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, { ...entry, timestamp: "2026-09-18T10:00:00.000Z", entityId: "q-1" });
    await appendAuditEntry(db, { ...entry, timestamp: "2026-09-18T11:00:00.000Z", entityId: "q-2" });
    const entries = await listAuditEntries(db, { limit: 1 });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].entityId, "q-2");
  });
});

test("reports how much the trail occupies", async () => {
  await withTestDatabase(async (db) => {
    await appendAuditEntry(db, entry);
    const usage = await countAuditEntries(db);
    assert.equal(usage.rows, 1);
    assert.ok(usage.bytes > 0);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:db`
Expected: FAIL, `Cannot find module '../auditLog'`.

- [ ] **Step 3: Write `migrations/002_audit_logs.sql`**

```sql
CREATE TABLE audit_logs (
  id               bigserial PRIMARY KEY,
  timestamp        timestamptz NOT NULL,
  actor_user_id    integer REFERENCES users(id) ON DELETE SET NULL,
  actor_label      text NOT NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  entity_label     text NOT NULL,
  before           jsonb,
  after            jsonb,
  reason           text,
  source           text NOT NULL DEFAULT 'UI',
  linked_record_id text
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_timestamp_idx ON audit_logs (timestamp DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id);
```

`ON DELETE SET NULL` is what makes the "keeps the label" test pass: the row survives its author.

- [ ] **Step 4: Write `server/auditLog.ts`**

```ts
import type { PoolClient } from "pg";

export interface AuditEntry {
  timestamp: string;
  actorUserId: number | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  source: "UI" | "Import" | "System";
  linkedRecordId?: string;
}

type Executor = Pick<PoolClient, "query">;

const COLUMNS = `id, timestamp, actor_user_id, actor_label, action, entity_type, entity_id, entity_label, before, after, reason, source, linked_record_id`;

function toEntry(row: Record<string, unknown>): AuditEntry & { id: number } {
  return {
    id: Number(row.id),
    timestamp: (row.timestamp as Date).toISOString(),
    actorUserId: (row.actor_user_id as number | null) ?? null,
    actorLabel: row.actor_label as string,
    action: row.action as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    entityLabel: row.entity_label as string,
    before: row.before ?? undefined,
    after: row.after ?? undefined,
    reason: (row.reason as string | null) ?? undefined,
    source: row.source as AuditEntry["source"],
    linkedRecordId: (row.linked_record_id as string | null) ?? undefined,
  };
}

export async function appendAuditEntry(db: Executor, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs(timestamp, actor_user_id, actor_label, action, entity_type, entity_id, entity_label, before, after, reason, source, linked_record_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      entry.timestamp, entry.actorUserId, entry.actorLabel, entry.action, entry.entityType, entry.entityId,
      entry.entityLabel, entry.before ?? null, entry.after ?? null, entry.reason ?? null, entry.source,
      entry.linkedRecordId ?? null,
    ],
  );
}

export async function listAuditEntries(
  db: Executor,
  filter: { entityType?: string; entityId?: string; actorUserId?: number; limit?: number } = {},
): Promise<(AuditEntry & { id: number })[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of [["entity_type", filter.entityType], ["entity_id", filter.entityId], ["actor_user_id", filter.actorUserId]] as const) {
    if (value !== undefined) {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
  }
  params.push(Math.min(filter.limit ?? 200, 1000));
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM audit_logs ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY timestamp DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toEntry);
}

export async function countAuditEntries(db: Executor): Promise<{ rows: number; bytes: number }> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS rows, pg_total_relation_size('audit_logs')::bigint AS bytes FROM audit_logs",
  );
  return { rows: rows[0].rows as number, bytes: Number(rows[0].bytes) };
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm run test:db`
Expected: PASS, 5 new tests.

- [ ] **Step 6: Write `scripts/import-audit-logs.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { appendAuditEntry } from "../server/auditLog.js";
import { pool } from "../server/db.js";

const storePath = resolve(process.cwd(), "data", "store.json");
const store = JSON.parse(readFileSync(storePath, "utf8")) as { auditLogs?: Record<string, unknown>[] };
const entries = store.auditLogs ?? [];

const client = await pool.connect();
try {
  for (const entry of entries) {
    await appendAuditEntry(client, {
      timestamp: String(entry.timestamp),
      actorUserId: null,
      actorLabel: String(entry.actor ?? "System"),
      action: String(entry.action),
      entityType: String(entry.entityType),
      entityId: String(entry.entityId),
      entityLabel: String(entry.entityLabel ?? entry.entityId),
      before: entry.before,
      after: entry.after,
      reason: entry.reason as string | undefined,
      source: (entry.source as "UI" | "Import" | "System") ?? "UI",
      linkedRecordId: entry.linkedRecordId as string | undefined,
    });
  }
  writeFileSync(`${storePath}.pre-audit-import.bak`, JSON.stringify(store, null, 2));
  delete store.auditLogs;
  writeFileSync(storePath, `${JSON.stringify({ ...store, auditLogs: [] }, null, 2)}\n`);
  console.log(`Imported ${entries.length} audit entries. Previous store saved as store.json.pre-audit-import.bak`);
} finally {
  client.release();
  await pool.end();
}
```

- [ ] **Step 7: Run the migration and the import**

Run: `npm run migrate && npx tsx --env-file-if-exists=.env scripts/import-audit-logs.ts`
Expected: `Imported 61 audit entries.` Verify with `psql`: `SELECT count(*) FROM audit_logs;` returns 61.

- [ ] **Step 8: Commit**

```bash
git add migrations/002_audit_logs.sql server/auditLog.ts server/db/auditLog.test.ts scripts/import-audit-logs.ts
git commit -m "Move the audit trail into Postgres"
```

---

## Task 9: Record the acting user on every change

**Files:**
- Modify: `server/app.ts` (the `audit()` helper and `GET /api/audit-logs`), `server/store.ts` (drop `auditLogs` from the store type)
- Test: `server/db/auditActor.test.ts`

**Interfaces:**
- Consumes: `appendAuditEntry`, `listAuditEntries` (Task 8), `req.user` (Task 5).
- Produces: no new exports; `audit()` gains a `request` parameter.

- [ ] **Step 1: Write the failing test**

Create `server/db/auditActor.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { listAuditEntries } from "../auditLog";
import { withTestDatabase } from "../testDb";

const { createApp } = await import("../app");

test("a create records the signed-in user", async () => {
  await withTestDatabase(async (db) => {
    const app = createApp();
    const server = app.listen(0);
    const { port } = server.address() as { port: number };
    try {
      const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { redirect: "manual" });
      const cookie = login.headers.get("set-cookie") ?? "";
      const me = await (await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } })).json();
      await fetch(`http://127.0.0.1:${port}/api/suppliers`, {
        method: "POST",
        headers: { cookie, "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ name: "Audit Actor Test" }),
      });
      const [entry] = await listAuditEntries(db, { entityType: "Supplier" });
      assert.equal(entry.actorLabel, "Dev User");
      assert.equal(entry.actorUserId, me.id);
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `AUTH_MODE=dev npm run test:db`
Expected: FAIL — the entry's `actorLabel` is `System`.

- [ ] **Step 3: Rewrite the `audit()` helper in `server/app.ts`**

```ts
function audit(
  request: Request,
  action: AuditAction,
  entityType: string,
  entityId: string,
  entityLabel: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
  linkedRecordId?: string,
  source: "UI" | "Import" | "System" = "UI",
) {
  const diff = compactDiff(before, after);
  const actor = source === "System" ? undefined : request.user;
  void appendAuditEntry(pool, {
    timestamp: new Date().toISOString(),
    actorUserId: actor?.id ?? null,
    actorLabel: actor?.name ?? "System",
    action,
    entityType,
    entityId,
    entityLabel,
    before: diff.before,
    after: diff.after,
    reason: String(reason ?? "").trim() || undefined,
    source,
    linkedRecordId,
  }).catch((error) => console.error("Failed to write audit entry:", error));
}
```

Pass `request` at all 30-odd call sites. System-generated calls — the two in `syncActivePackagingSetItems`, `syncActiveCasesForModels` and `syncQuoteStatusFromInspection` — pass `"System"` as `source`, which is what keeps them anonymous.

- [ ] **Step 4: Serve the audit log from the database**

Replace the route:

```ts
app.get("/api/audit-logs", requireAdmin, async (request, response, next) => {
  try {
    response.json(await listAuditEntries(pool, {
      entityType: request.query.entityType as string | undefined,
      entityId: request.query.entityId as string | undefined,
      actorUserId: request.query.actorUserId ? Number(request.query.actorUserId) : undefined,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    }));
  } catch (error) {
    next(error);
  }
});
```

Remove `auditLogs` from the `Store` interface and the seed store in `server/store.ts`, and from `AppData` in `src/api.ts`. The frontend's History dialog fetches `/api/audit-logs?entityType=…&entityId=…` instead of reading the bootstrap payload.

- [ ] **Step 5: Run the test and watch it pass**

Run: `AUTH_MODE=dev npm run test:db`
Expected: PASS.

- [ ] **Step 6: Verify the offline suite and types**

Run: `npm test && npm run typecheck:api && npx tsc -p tsconfig.json --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/app.ts server/store.ts src/api.ts src/modals/record/HistoryModal.tsx server/db/auditActor.test.ts
git commit -m "Record the signed-in user on every audited change"
```

---

## Task 10: Admin API

**Files:**
- Create: `server/routes/admin.ts`
- Modify: `server/app.ts`
- Test: `server/db/adminRoutes.test.ts`

**Interfaces:**
- Consumes: `listUsers`, `setUserRole`, `setUserActive`, `deleteUser`, `UserRuleError` (Task 3); `requireAdmin` (Task 5); `countAuditEntries` (Task 8).
- Produces: `adminRouter: Router` mounted at `/api/admin`, serving `GET /users`, `PATCH /users/:id/role`, `PATCH /users/:id/active`, `DELETE /users/:id`, `GET /audit-usage`.

- [ ] **Step 1: Write the failing test**

Create `server/db/adminRoutes.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { withTestDatabase } from "../testDb";

const { createApp } = await import("../app");

async function signedInFetch(port: number) {
  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { redirect: "manual" });
  const cookie = login.headers.get("set-cookie") ?? "";
  const me = await (await fetch(`http://127.0.0.1:${port}/api/auth/me`, { headers: { cookie } })).json();
  return { cookie, me };
}

test("a non-admin is refused", async () => {
  await withTestDatabase(async () => {
    const server = createApp().listen(0);
    const { port } = server.address() as { port: number };
    try {
      const { cookie } = await signedInFetch(port);
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/users`, { headers: { cookie } });
      assert.equal(response.status, 403);
    } finally {
      server.close();
    }
  });
});

test("an admin lists users", async () => {
  await withTestDatabase(async (db) => {
    const server = createApp().listen(0);
    const { port } = server.address() as { port: number };
    try {
      const { cookie, me } = await signedInFetch(port);
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/users`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const users = await response.json();
      assert.equal(users[0].email, "dev@segsolar.com");
    } finally {
      server.close();
    }
  });
});

test("deactivating yourself is refused with the rule message", async () => {
  await withTestDatabase(async (db) => {
    const server = createApp().listen(0);
    const { port } = server.address() as { port: number };
    try {
      const { cookie, me } = await signedInFetch(port);
      await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [me.id]);
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/users/${me.id}/active`, {
        method: "PATCH",
        headers: { cookie, "Content-Type": "application/json", "X-CSRF-Token": me.csrfToken },
        body: JSON.stringify({ active: false }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /your own account/);
    } finally {
      server.close();
    }
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `AUTH_MODE=dev npm run test:db`
Expected: FAIL, 404 on `/api/admin/users`.

- [ ] **Step 3: Write `server/routes/admin.ts`**

```ts
import { Router } from "express";

import { countAuditEntries } from "../auditLog";
import { pool } from "../db";
import { requireAdmin } from "../session";
import { deleteUser, listUsers, setUserActive, setUserRole, UserRuleError } from "../users";

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/users", async (_request, response, next) => {
  try {
    response.json(await listUsers(pool));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/role", async (request, response, next) => {
  try {
    const role = request.body?.role;
    if (role !== "admin" && role !== "user") throw new UserRuleError("Role must be admin or user.");
    response.json(await setUserRole(pool, Number(request.params.id), role, request.user!.id));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/active", async (request, response, next) => {
  try {
    response.json(await setUserActive(pool, Number(request.params.id), Boolean(request.body?.active), request.user!.id));
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/users/:id", async (request, response, next) => {
  try {
    await deleteUser(pool, Number(request.params.id), request.user!.id);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-usage", async (_request, response, next) => {
  try {
    response.json(await countAuditEntries(pool));
  } catch (error) {
    next(error);
  }
});
```

- [ ] **Step 4: Mount it and map the error**

In `server/app.ts`, add `app.use("/api/admin", adminRouter);` after the `/api` guards, and extend the error handler so a `UserRuleError` returns its `status` and `message` the way `ValidationError` already does.

- [ ] **Step 5: Run the test and watch it pass**

Run: `AUTH_MODE=dev npm run test:db`
Expected: PASS, 3 new tests.

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin.ts server/app.ts server/db/adminRoutes.test.ts
git commit -m "Add the admin user management API"
```

---

## Task 11: Admin console and audit view

**Completed 2026-09-21.** Admin users and audit views are implemented, including role-gated navigation, record and voided-record history, and sign-out after changing the current admin's own role.

Validation: 82 unit tests, 36 Postgres integration tests, frontend/server type checks, and the production build passed. Browser checks covered ordinary/admin visibility, role changes, self-deactivation and last-admin errors, activation, removal, audit filters/limits/diffs/empty results, per-record history, and 390px layouts. All write tests used isolated databases and a temporary JSON store; the audit preview used 61 synthetic historical entries plus a newly created supplier entry. Existing application users and business data were not changed.

**Files:**
- Create: `src/pages/AdminUsers.tsx`, `src/pages/AuditLog.tsx`
- Modify: `src/api.ts`, `src/App.tsx`, `src/components/AppShell.tsx`, `src/uiTypes.ts`, `src/modals/record/HistoryModal.tsx`

**Interfaces:**
- Consumes: the Task 10 endpoints; `useSession()` (Task 7).
- Produces: `fetchUsers()`, `updateUserRole(id, role)`, `updateUserActive(id, active)`, `removeUser(id)`, `fetchAuditUsage()`, `fetchAuditEntries(filter)` in `src/api.ts`.

- [x] **Step 1: Add the API calls to `src/api.ts`**

```ts
export interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  active: boolean;
  lastLoginAt: string | null;
}

export function fetchUsers() {
  return request<AdminUser[]>("/api/admin/users");
}

export function updateUserRole(id: number, role: "admin" | "user") {
  return request<AdminUser>(`/api/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
}

export function updateUserActive(id: number, active: boolean) {
  return request<AdminUser>(`/api/admin/users/${id}/active`, { method: "PATCH", body: JSON.stringify({ active }) });
}

export function removeUser(id: number) {
  return request<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" });
}

export function fetchAuditUsage() {
  return request<{ rows: number; bytes: number }>("/api/admin/audit-usage");
}

export function fetchAuditEntries(filter: { entityType?: string; entityId?: string; actorUserId?: number; limit?: number } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined) params.set(key, String(value));
  return request<AuditLogRecord[]>(`/api/audit-logs?${params.toString()}`);
}
```

- [x] **Step 2: Add the "Admin" section**

Add `"Admin"` to the `Section` union in `src/uiTypes.ts`, and render the entry in `src/components/AppShell.tsx` only when `useSession().user?.role === "admin"`.

- [x] **Step 3: Write `src/pages/AdminUsers.tsx`**

A `Panel` titled "Users" over a table with columns Name, Email, Role, Status, Last sign-in, Actions. Role is a `<select>` calling `updateUserRole`; Status is a button calling `updateUserActive`; Remove calls `removeUser` behind a `window.confirm` naming the person. Failures set an error message rendered through the existing `ErrorNotice`, showing the server's own text ("You cannot deactivate your own account.", "At least one active admin must remain."). Below the table, one line from `fetchAuditUsage()`: "Audit trail: 61 entries, 0.1 MB".

- [x] **Step 4: Write `src/pages/AuditLog.tsx`**

A `TableToolbar` with three filters — user, record type, limit — over a table of Time, User, Action, Record, Change. The Change cell reuses the existing `AuditDiff` component from `src/modals/record/RecordDetailModal.tsx`.

- [x] **Step 5: Gate the per-record History dialog**

In `src/modals/record/HistoryModal.tsx`, fetch from `fetchAuditEntries({ entityType, entityId })`. Render the dialog only for `role === "admin"`; hide the History entry in `RecordMenu` for everyone else.

- [x] **Step 6: Verify by hand**

With `AUTH_MODE=dev`: the Admin section is hidden, then `npm run admin -- dev@segsolar.com`, sign out and in again, and it appears. Check the user table loads, the role toggle works, deactivating yourself shows the server's message, and the audit view lists the imported 61 entries plus anything created since.

- [x] **Step 7: Verify everything**

Run: `npm test && AUTH_MODE=dev npm run test:db && npm run typecheck:api && npx tsc -p tsconfig.json --noEmit && npm run build`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add src/pages/AdminUsers.tsx src/pages/AuditLog.tsx src/api.ts src/App.tsx src/components/AppShell.tsx src/uiTypes.ts src/modals/record/HistoryModal.tsx
git commit -m "Add the admin console and the global audit view"
```

---

## Task 12: Documentation and the Entra registration

**Files:**
- Modify: `README.md`, `server/README.md`
- Create: `docs/deployment.md`

- [ ] **Step 1: Document the Entra app registration**

In `docs/deployment.md`, record: one app registration, redirect URI `<APP_ORIGIN>/api/auth/callback`, delegated scopes `openid profile email`, no directory permissions, no admin consent beyond sign-in; the client secret goes in `ENTRA_CLIENT_SECRET` and expires — note the expiry date when it is created.

- [ ] **Step 2: Document the same-origin requirement**

State plainly that the frontend and the API must be served from one origin in production, because the session cookie is `SameSite=Lax` and will not be sent cross-site. The Vite proxy provides this in development.

- [ ] **Step 3: Update the READMEs**

Setup becomes: `docker compose -f compose.dev.yml up -d`, copy `.env.example` to `.env`, `npm run migrate`, `npm run dev:api`, `npm run dev`. Explain `AUTH_MODE=dev`, that it is refused in production, and that the first admin is created with `npm run admin -- <email>` after that person has signed in once.

- [ ] **Step 4: Commit**

```bash
git add README.md server/README.md docs/deployment.md
git commit -m "Document Entra registration, deployment and local setup"
```

---

## Self-review notes

- Spec coverage: sign-in flow (Tasks 4–7), tenant check (Task 4), dev bypass (Tasks 1, 6), `requireAuth` on `/api` and `/uploads` (Task 6), CSRF (Tasks 5, 7), session epoch revocation (Tasks 3, 5), audit table and migration (Task 8), real actor (Task 9), admin console and guards (Tasks 3, 10, 11), audit visibility restricted to admins (Tasks 9, 11), audit usage reporting for the deferred retention decision (Tasks 8, 10, 11), configuration and deployment notes (Tasks 1, 12).
- Deliberately not in this plan, per the spec: registration, email verification, password reset, mail sending, per-role restrictions on business screens, audit retention, and the business-data migration.
