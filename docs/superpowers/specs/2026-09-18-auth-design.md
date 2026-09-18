# Authentication and audit accountability — design

Date: 2026-09-18
Status: approved for implementation planning

## Problem

The workbench has no concept of a user. Anyone who can reach the API can read,
change or delete every supplier, quote, inspection and price record, and every
uploaded file is served to anyone who knows its name. The audit log records what
changed but not who changed it — all 61 existing entries read `actor: "System"`,
because the server has nobody to name.

This design adds accounts, sessions and an accountable audit trail. It is
project A of two; migrating the 14 business record types out of
`data/store.json` into Postgres is project B and is out of scope here.

## Goals

1. Nobody reaches business data or uploaded files without signing in.
2. Employees self-register with a `@segsolar.com` address and verify it by email.
3. A forgotten password can be reset without an administrator.
4. Every change records the user who made it.
5. An administrator can see all users, change a role, and deactivate or remove an account.

## Non-goals

- Per-role restrictions on business screens. Any signed-in user keeps full access
  to the workbench for now; only the admin console is gated by role.
- Migrating business records to Postgres (project B).
- Deleting or archiving old audit entries. See "Deferred decisions".
- SSO. Worth asking IT whether Entra ID is available — it would remove
  registration, verification and password reset entirely — but the decision was
  to build password login now.

## Approach

Cookie sessions with a server-side session store, following the pattern already
proven in the employee-portal project: `express-session` with
`connect-pg-simple`, scrypt password hashing from `node:crypto`, CSRF tokens,
and a `session_epoch` column that invalidates a user's existing sessions the
moment their password changes or an admin acts on the account.

Rejected: JWT in browser storage. A token readable by JavaScript is stealable by
any XSS, and revoking one needs a server-side denylist — which is the session
table again, with extra steps.

## Stack

New dependencies, versions aligned with employee-portal where they overlap:
`pg`, `express-session`, `connect-pg-simple`, `express-rate-limit`, `nodemailer`.
Password hashing uses `node:crypto` scrypt — no bcrypt dependency.

Postgres runs locally through a `compose.dev.yml` copied from employee-portal.
Migrations are plain SQL files under `migrations/` applied by a small
`npm run migrate` script. No ORM: project B will decide the data-access layer for
business records, and that choice should not be pre-empted here.

## Data model

### `users`

| Column | Notes |
| --- | --- |
| `id` | serial primary key |
| `name` | 1–100 characters |
| `email` | unique, stored lowercase, must end in the configured domain |
| `password_hash` | `scrypt:<salt>:<key>` |
| `role` | `admin` or `user`, default `user` |
| `email_verified_at` | null until the address is confirmed |
| `active` | false disables sign-in without deleting history |
| `session_epoch` | integer, incremented to invalidate existing sessions |
| `created_at`, `last_login_at` | timestamps |

### `session`

The standard `connect-pg-simple` table. Sessions live server-side; the browser
holds only an httpOnly, SameSite=Lax cookie.

### `email_verification_tokens` and `password_reset_tokens`

| Column | Notes |
| --- | --- |
| `user_id` | references `users` |
| `token_hash` | SHA-256 of the token; the raw value exists only in the email |
| `expires_at` | 60 minutes for verification, 30 minutes for reset |
| `used_at` | null until redeemed; a token works once |

Storing only the hash means a database read cannot be replayed to take over an
account. (The IT HelpDesk project stores raw verification tokens; this design
deliberately differs.)

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

### Registration

`POST /api/auth/register` validates the email domain and a password of 6–128
characters, creates an unverified `user`, and emails a verification link.

The response is the same whether or not the address already has an account —
otherwise the endpoint becomes a way to enumerate who works here. An address that
already exists receives a "someone tried to register with your address" email
instead of a verification link.

### Verification

The emailed link opens `/verify?token=…` in the app, which calls
`POST /api/auth/verify`. The server hashes the token, checks it is unexpired and
unused, sets `email_verified_at`, marks the token used, and sends the user to
sign in. Verification does not create a session: a token that lives in a URL —
and therefore in browser history and proxy logs — should not be exchangeable for
one.

### Sign-in

`POST /api/auth/login` requires a correct password, a verified address and an
active account. An unknown address is still compared against a dummy hash so
that response time does not reveal whether an account exists. On success the
session id is regenerated (defeating session fixation) and the session records
`userId` and the current `session_epoch`.

`POST /api/auth/logout` destroys the session. `GET /api/auth/me` returns the
current user or 401 — the frontend uses it to decide what to render.

### Password reset

`POST /api/auth/forgot-password` always reports success and only sends mail when
the account exists and is active. `POST /api/auth/reset-password` verifies the
token, stores the new hash, increments `session_epoch` (signing the user out
everywhere), marks the token used, and sends a "your password was changed"
notice — the last line of defence if the reset was not the account holder.

### Rate limits

Per IP, via `express-rate-limit`: login and forgot-password 5/minute,
verification 6/minute, registration 3/hour.

## Protecting what exists

A `requireAuth` middleware mounted on `/api` covers all 62 existing routes at
once; the auth routes above are the only exemptions. Unauthenticated API calls
return 401 JSON rather than a redirect, because the frontend is a single-page app
that handles navigation itself.

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
| `GET /api/admin/users` | name, email, role, verified, active, created, last sign-in |
| `PATCH /api/admin/users/:id/role` | switch between `user` and `admin` |
| `PATCH /api/admin/users/:id/active` | deactivate or restore |
| `DELETE /api/admin/users/:id` | permanent removal, behind a confirmation |

Three guards: an admin cannot deactivate or delete their own account, at least
one active admin must remain, and any role or status change increments the
target's `session_epoch` so it takes effect immediately rather than whenever
their session happens to expire.

Deactivation is the recommended action and the default in the UI; deletion stays
available but leaves the user's audit entries pointing at a gone account, which
is why `actor_label` is denormalised.

The first admin cannot be created through the UI — there is no admin to grant it.
A `npm run admin` script creates or promotes one, reading the password from a
prompt or an environment variable. No password is ever written to a file in the
repository.

## Frontend

Five new screens: sign-in, register, verification result, forgot password, reset
password. They follow direction B1 from the design canvas (`design/`): a charcoal
block carrying the logo, the product name and one line of description, with the
form on white beside it; square corners, Kanit headings, SEG red as the accent.
The white logo variant is used unaltered — it is built for dark backgrounds.

No router is added. The five screens are selected by the `?token=` parameter and
local state, matching how the workbench already switches sections.

`App.tsx` calls `GET /api/auth/me` on load: no session renders the sign-in
screen, a session renders the workbench as it does today. The sidebar gains the
current user and a sign-out control; admins additionally see a user management
entry.

Audit visibility is restricted to admins in this project — the before/after
values expose other people's activity, and the implementation guide leans the
same way. The per-record History dialog stays, gated by role, and a global audit
view (filter by user, date and record type) is added to the admin console.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection |
| `SESSION_SECRET` | at least 32 characters; startup fails without it |
| `APP_ORIGIN` | used in emailed links; must be HTTPS in production |
| `ALLOWED_EMAIL_DOMAIN` | `segsolar.com` |
| `MAIL_TRANSPORT` | `log` (writes to the console and `data/mail/`) or `smtp` |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` | Office 365: `smtp.office365.com:587` |

Development needs no SMTP account: `MAIL_TRANSPORT=log` exercises the whole flow
with the link printed to the server console.

## Testing

Unit tests, following the existing `node:test` suite: password hashing and
verification, token generation and hash comparison, email domain validation,
expiry, and the admin guards (cannot remove yourself, one admin must remain).

Integration tests against a test database, covering the failure paths, which are
the part that matters and the part nobody exercises by hand:

- unauthenticated API call → 401; `/uploads` request without a session → 401
- non-admin calling an admin endpoint → 403
- exceeding a rate limit → 429
- expired token, already-used token, token for the wrong purpose → rejected
- password change → the previous session no longer works
- an audit row is written with the acting user for a create, an edit and a delete

## Delivery

Five steps, each shippable and independently verifiable:

1. **Postgres foundation** — connection, migrations, `users` table, admin CLI.
   Changes no existing behaviour.
2. **Sign-in** — login, logout, session, `requireAuth` on `/api` and `/uploads`,
   the sign-in screen. **The system is closed after this step**; everything
   after it is convenience.
3. **Registration and verification** — including the mail module in log mode.
4. **Password reset** — including the password-changed notice.
5. **Audit and admin** — audit table migration, real actor, admin console,
   global audit view.

## Risks and accepted limitations

- **Historical audit entries stay anonymous.** The existing 61 rows never had an
  author; only new activity is attributable.
- **Session cookies require same origin.** The Vite proxy gives this in
  development; in production the frontend and API must be served from one
  domain, or the cookie will not be sent. This belongs in the deployment notes.
- **Password minimum is 6 characters**, set by the product owner. Login rate
  limiting is therefore the main defence against guessing.
- **SMTP credentials depend on IT.** Steps 1–4 can be built and tested without
  them.
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
- **SSO.** If IT can provide Entra ID, registration, verification and password
  reset all disappear. Worth one email before step 3.
