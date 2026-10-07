# Intranet deployment

The workbench runs as two containers on one host, defined in `compose.intranet.yml`:

| Container | Purpose | Data volume |
| --- | --- | --- |
| `postgres` | All data: business records, uploaded files, users, sessions and the audit trail | `pgdata` |
| `app` | The API, which also serves the built frontend | none |

The app listens on `HOST_PORT` (default 8080). On every start it applies pending migrations, so a new release needs no separate migration step. Postgres is not published to the host.

## Requirements

- Docker with Compose v2 (`docker compose version`).

If the server cannot reach Docker Hub and the npm registry, build on a machine that can and copy the images across:

```bash
# On the connected machine, from the repository
docker compose -f compose.intranet.yml --env-file deploy.env build
docker pull postgres:17
docker save sourcing-workbench-app postgres:17 | gzip > sourcing-images.tar.gz

# On the server
docker load < sourcing-images.tar.gz
docker compose -f compose.intranet.yml --env-file deploy.env up -d   # no --build
```

## First deployment

```bash
cp deploy.env.example deploy.env
```

Fill in `deploy.env`:

- `APP_ORIGIN`: the address people will type, such as `http://sourcing-srv:8080`.
- `POSTGRES_PASSWORD`: `openssl rand -hex 24`.
- `SESSION_SECRET`: `openssl rand -hex 32`.

`deploy.env` holds secrets and is ignored by git. Then start the containers:

```bash
docker compose -f compose.intranet.yml --env-file deploy.env up -d --build
```

Open `APP_ORIGIN` and sign in. The system starts empty.

## Sign-in modes

### `AUTH_MODE=dev` (trial use)

No Microsoft sign-in: everyone who opens the page is signed in as one shared account, **Dev User** (`dev@segsolar.com`). Every change in the audit trail is recorded as Dev User, and anyone who can reach the host can read and change all data. Use it only on the intranet, for a short trial with a small group.

The shared account starts with the `user` role, which cannot open Admin or change KPI weights. To allow that, promote it after the first sign-in. Everyone then has admin rights:

```bash
docker compose -f compose.intranet.yml --env-file deploy.env exec app npm run admin -- dev@segsolar.com
```

`dev` mode is refused when `NODE_ENV=production`.

### `AUTH_MODE=entra` (named accounts)

Each person signs in with their SEG account, and the audit trail records who made each change. This mode needs:

1. **An Entra app registration.** IT registers one app with the redirect URI `<APP_ORIGIN>/api/auth/callback` and the delegated `openid`, `profile` and `email` scopes; no other permissions are needed. The client secret expires, so note its expiry date.
2. **HTTPS.** Entra accepts `http` redirect URIs only for `localhost`, so `APP_ORIGIN` must be an `https://` address. Put a reverse proxy with a certificate (an internal CA is fine) in front of `HOST_PORT`. The frontend and the API must stay on that one origin, because the session cookie is not sent cross-site.
3. **Settings in `deploy.env`.** Set `AUTH_MODE=entra`, `NODE_ENV=production` and the three `ENTRA_` values, then run `up -d` again.

Accounts are created with the `user` role on first sign-in. Promote the first admin with the `npm run admin` command above, using their email address. Further admins can then be promoted from **Admin → Users**.

## Updating

```bash
git pull
docker compose -f compose.intranet.yml --env-file deploy.env up -d --build
```

Data is kept in the `pgdata` volume, and pending migrations run when the app starts.

### Before deploying the quote selection rules (migration 006)

Migration 006 makes every effective `Requote` and `Change Work Order` quote Selected, so prices do not change. Before updating, list the ones it will change and check them with purchasing:

```bash
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres psql -U sourcing sourcing -c "
SELECT id, supplier_id, item_id, status, quote_reason, unit_price, effective_from
FROM quotes
WHERE coalesce(record_state, 'Active') <> 'Void'
  AND quote_reason IN ('Requote', 'Change Work Order')
  AND status <> 'Selected';"
```

A quote listed as `Not Selected` or `Expired` takes effect today only because of its reason, and will become Selected. Change its status first if that is not wanted.

`PREVIOUS_ORDER_SELECTION` in `deploy.env` (default `on`) lets buyers select a quote without a sample by confirming earlier orders. Set it to `off` once ERP purchase history is in the system, then run `up -d` again.

### Upgrading from a release that stored business data in files

Earlier releases kept business records and uploads in two more volumes. This release does not read them. After upgrading, check they are empty, then remove them:

```bash
docker run --rm -v sourcing-workbench_app-data:/data -v sourcing-workbench_app-uploads:/uploads alpine ls -A /data /uploads
docker volume rm sourcing-workbench_app-data sourcing-workbench_app-uploads
```

If the listing shows files, stop and keep the volumes: their records would need importing, which this release does not do.

## Backups

The database holds everything, uploaded files included. Schedule this with cron on the host:

```bash
cd /path/to/Supplier-Management-System
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres pg_dump -U sourcing sourcing | gzip > backup-db-$(date +%F).sql.gz
```

Uploaded PDFs and images are already compressed, so the dump grows by roughly the size of the files uploaded.

To restore, stop the app, replace the database with the dump, and start again. On a new host, run `up -d postgres` first so the database container exists.

```bash
docker compose -f compose.intranet.yml --env-file deploy.env stop app
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres dropdb -U sourcing sourcing
docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres createdb -U sourcing sourcing
gunzip -c backup-db-<date>.sql.gz | docker compose -f compose.intranet.yml --env-file deploy.env exec -T postgres psql -q -U sourcing sourcing
docker compose -f compose.intranet.yml --env-file deploy.env up -d
```

## Operations

```bash
docker compose -f compose.intranet.yml --env-file deploy.env ps          # status and health
docker compose -f compose.intranet.yml --env-file deploy.env logs -f app # logs
curl http://<host>:<HOST_PORT>/api/health                                  # liveness, no sign-in needed
```
