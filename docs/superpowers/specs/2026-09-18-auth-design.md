# Authentication and audit accountability — design

Date: 2026-09-18
Status: approved for implementation planning
Supersedes: the password-login draft of the same date (replaced by Entra ID SSO
after confirming the system is internal-only)

## Problem

The workbench has no concept of a user. Anyone who can reach the API can read,
change or delete every supplier, quote, inspection and price record, and every
uploaded file is served to anyone who knows its name. The audit log records what
changed but not who changed it — all 61 existing entries read `actor: "System"`,
because the server has nobody to name.

This design adds sign-in through the company's Microsoft Entra ID tenant,
server-side sessions, and an accountable audit trail. It is project A of two;
migrating the 14 business record types out of `data/store.json` into Postgres is
project B and is out of scope here.

## Goals

1. Nobody reaches business data or uploaded files without signing in.
2. Employees sign in with the SEG account they already have — no new password.
3. Every change records the user who made it.
4. An administrator can see all users, change a role, and deactivate or remove an account.

## Non-goals

- Per-role restrictions on business screens. Any signed-in employee keeps full
  access to the workbench; only the admin console is gated by role.
- Restricting access to a department or Entra group. The tenant is the boundary:
  any SEG employee may sign in and the account is created on first arrival.
- Migrating business records to Postgres (project B).
- Deleting or archiving old audit entries. See "Deferred decisions".
- Accounts for anyone outside the tenant. External users (a supplier portal, for
  instance) would need a second sign-in path and are not planned.

## Approach

OpenID Connect against Microsoft Entra ID, authorization code flow with PKCE,
run server-side as a confidential client using `openid-client`. The identity
provider holds the credentials; this application never sees a password and
stores none.

After a successful callback the server creates its own session — `express-session`
with `connect-pg-simple`, the pattern already proven in the employee-portal
project — so authorisation decisions, the local `active` flag and `session_epoch`
revocation stay under this application's control rather than depending on token
lifetimes.

Rejected: local passwords with self-registration and emailed verification. It
was the original plan, and it is strictly more work (registration, verification
tokens, password reset, a mail module, password hashing) for a weaker result:
offboarding would depend on someone remembering to deactivate the account here,
instead of following from the Entra account being disabled.

## Stack

New dependencies: `pg`, `express-session`, `connect-pg-simple`,
`express-rate-limit`, `openid-client`. No mail library, no password hashing.

Postgres runs locally through a `compose.dev.yml` copied from employee-portal.
Migrations are plain SQL files under `migrations/` applied by a small
`npm run migrate` script. No ORM: project B will decide the data-access layer for
business records, and that choice should not be pre-empted here.

## Data model

### `users`

| Column | Notes |
| --- | --- |
| `id` | serial primary key |
| `entra_oid` | unique; the `oid` claim, stable across email and name changes |
| `email` | from the token, stored lowercase |
| `name` | display name from the token, refreshed on each sign-in |
| `role` | `admin` or `user`, default `user` |
| `active` | false blocks sign-in without deleting history |
| `session_epoch` | integer, incremented to invalidate existing sessions |
| `created_at`, `last_login_at` | timestamps |

`entra_oid` is the identity, not the email address: people change surnames and
email aliases, and matching on email would silently create a second account.

### `session`

The standard `connect-pg-simple` table. Sessions live server-side; the browser
holds only an httpOnly, SameSite=Lax cookie.

### `audit_logs`

The audit trail moves out of `store.json` and into Postgres in this project,
because it shares the `users` table and because appending one row is cheap
regardless of table size — today every save rewrites the whole JSON file, and the
61 audit entries are already 66% of it.

| Column | Notes |
| --- | --- |
| `id` | serial primary key |
| `timestamp` | when the change happened |
| `actor_user_id` | references `users`; null for system-generated changes |
| `actor_label` | denormalised display name, so a deleted user does not blank the history |
| `action` | Create / Edit / Status Change / Upload / Void / Delete / Approve / Import |
| `entity_type`, `entity_id`, `entity_label` | what was changed |
| `before`, `after` | jsonb, the changed fields only |
| `reason`, `source`, `linked_record_id` | as today |

Indexes on `(entity_type, entity_id)`, `timestamp desc`, and `actor_user_id`.
The 61 existing entries migrate in with `actor_user_id` null and `actor_label`
`System` — their real author is unknowable and inventing one would be worse than
admitting the gap.

## Flows

### Sign-in

1. The frontend finds no session (`GET /api/auth/me` returns 401) and shows the
   sign-in screen: one button.
2. `GET /api/auth/login` generates PKCE verifier, state and nonce, stores them in
   the session, and redirects to the Entra authorize endpoint.
3. Entra authenticates the employee and redirects to
   `GET /api/auth/callback`.
4. The server exchanges the code, validates the ID token — signature, issuer,
   audience, nonce, expiry — and **checks the `tid` claim equals the configured
   tenant**. A token from any other tenant is rejected outright.
5. The user row is found by `entra_oid` or created with role `user`; `email`,
   `name` and `last_login_at` are refreshed from the token.
6. A locally deactivated account (`active = false`) is refused here, with a
   message naming who to contact.
7. The session id is regenerated, the session records `userId` and the current
   `session_epoch`, and the browser is redirected to the workbench.

`POST /api/auth/logout` destroys the local session. Signing out of Microsoft
itself is not triggered — on a shared machine that would be surprising — so the
screen says the SEG account is still signed in on this device.

`GET /api/auth/me` returns the current user or 401; the frontend uses it to
decide what to render.

### Development without a tenant

`AUTH_MODE=dev` signs in a fixed local account so the app runs offline, with no
Entra registration and no client secret. The server **refuses to start** when
`AUTH_MODE=dev` and `NODE_ENV=production` are both set — a refusal, not a
warning, because a development bypass reaching production would undo the whole
project.

### Rate limits

`express-rate-limit` on the callback endpoint (20/minute per IP). The login
endpoint itself is a redirect and Entra carries the brute-force burden.

## Protecting what exists

A `requireAuth` middleware mounted on `/api` covers all 62 existing routes at
once; the auth routes above are the only exemptions. It re-reads the user on each
request and rejects a session whose `session_epoch` no longer matches, so a
deactivation takes effect immediately. Unauthenticated API calls return 401 JSON
rather than a redirect, because the frontend is a single-page app that handles
navigation itself.

`/uploads` gets the same middleware before `express.static`. This is the single
largest security gain in the project: drawings, QC photos and — once uploaded —
W-9 and payment information are currently served to anyone who knows a filename.

CSRF: every mutating request (POST, PATCH, DELETE) must carry an `X-CSRF-Token`
header, compared timing-safe against the session's token.

`server/index.ts` currently hardcodes `actor: "System"`. It takes the signed-in
user from the session instead; changes the server makes on its own — a passing
inspection promoting a quote, the bootstrap sync — stay `System`.

## Admin console

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/users` | name, email, role, active, created, last sign-in |
| `PATCH /api/admin/users/:id/role` | switch between `user` and `admin` |
| `PATCH /api/admin/users/:id/active` | deactivate or restore |
| `DELETE /api/admin/users/:id` | permanent removal, behind a confirmation |

Three guards: an admin cannot deactivate or delete their own account, at least
one active admin must remain, and any role or status change increments the
target's `session_epoch` so it takes effect immediately rather than whenever
their session happens to expire.

Deactivation is the recommended action and the default in the UI. Deleting a user
who signs in again simply creates a fresh account with the default role, so
deletion is only meaningful for someone who has left; deactivation is what stops
a current employee.

The first admin cannot be granted through the UI — there is no admin to grant it.
An `npm run admin -- <email>` script promotes an existing user row, run once
after that person has signed in for the first time.

## Frontend

One new screen: sign-in. It follows direction B1 from the design canvas
(`design/LoginBlockCharcoal.dc.html`): a charcoal block carrying the logo, the
product name and one line of description, with a single "Sign in with your SEG
account" button beside it. Square corners, Kanit headings, SEG red as the accent,
the white logo variant used unaltered.

Two secondary states on the same screen: a deactivated account ("your access has
been turned off — contact …") and a failed sign-in.

No router is added. `App.tsx` calls `GET /api/auth/me` on load: no session renders
the sign-in screen, a session renders the workbench as it does today. The sidebar
gains the current user and a sign-out control; admins additionally see a user
management entry.

Audit visibility is restricted to admins in this project — the before/after
values expose other people's activity, and the implementation guide leans the
same way. The per-record History dialog stays, gated by role, and a global audit
view (filter by user, date and record type) is added to the admin console.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection |
| `SESSION_SECRET` | at least 32 characters; startup fails without it |
| `APP_ORIGIN` | must match the redirect URI registered in Entra; HTTPS in production |
| `ENTRA_TENANT_ID` | the SEG tenant; also checked against the token's `tid` |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | the app registration |
| `AUTH_MODE` | `entra` (default) or `dev`; `dev` is refused in production |

The Entra app registration needs one redirect URI, `<APP_ORIGIN>/api/auth/callback`,
and the delegated `openid`, `profile`, `email` scopes — no directory permissions,
no admin consent for anything beyond sign-in.

## Testing

Unit tests, following the existing `node:test` suite: tenant claim validation,
mapping a token's claims onto a user row, first-sign-in creation versus returning
user, the `session_epoch` comparison, and the admin guards (cannot remove
yourself, one admin must remain).

Integration tests against a test database, covering the failure paths, which are
the part that matters and the part nobody exercises by hand:

- unauthenticated API call → 401; `/uploads` request without a session → 401
- a token from another tenant → rejected
- a deactivated user's existing session → rejected on the next request
- non-admin calling an admin endpoint → 403
- an audit row is written with the acting user for a create, an edit and a delete

The OIDC exchange itself is covered with a stubbed issuer rather than a live
tenant, so the suite runs offline.

## Delivery

Three steps, each shippable and independently verifiable:

1. **Postgres foundation** — connection, migrations, `users` and `session`
   tables, the admin promotion script. Changes no existing behaviour.
2. **Sign-in** — the OIDC flow, `requireAuth` on `/api` and `/uploads`, the
   sign-in screen, sign-out, the dev bypass. **The system is closed after this
   step.**
3. **Audit and admin** — audit table and migration of the existing entries, the
   real actor on every write, the admin console and the global audit view.

## Risks and accepted limitations

- **Any employee who signs in has full access**, including deleting supplier and
  quote records: per-role restrictions are deferred and access was deliberately
  set at the tenant boundary. The mitigations are that every change is now
  attributable to a named person, and an admin can deactivate an account
  immediately. Revisit if the audit trail starts showing edits from people with
  no business in the data.
- **Historical audit entries stay anonymous.** The existing 61 rows never had an
  author; only new activity is attributable.
- **Session cookies require same origin.** The Vite proxy gives this in
  development; in production the frontend and API must be served from one domain,
  or the cookie will not be sent. This belongs in the deployment notes.
- **An Entra outage blocks all access.** Acceptable for an internal tool — the
  same outage blocks Outlook and Teams — but there is no local fallback account
  by design.
- **Business data stays in `store.json`** until project B. Two stores coexist in
  the meantime.

## Deferred decisions

- **Audit retention.** Deliberately not implemented. Once the audit trail is in
  Postgres, size is not a practical constraint — 150,000 rows is a small table —
  so a retention period is a policy question, not an engineering one. The admin
  console will show the row count and size so the decision can be made against
  real numbers, and the mechanism, when it is wanted, should be monthly
  partitioning rather than row deletion or export to files. Ask finance or legal
  for the required period; purchasing records are commonly kept 3–7 years.
- **Department or group restrictions.** Entra groups are the natural place to add
  them later, and the `tid`-validated token already carries the claims needed.
