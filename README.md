# AFAuth service directory

The canonical AFAuth service directory at **`registry.afauth.org`**.

This implements the informational (non-normative) service-directory
convention defined in
[AFAuthHQ/spec → `spec/directory.md`](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md)
and [AFAP-0003](https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md).

Conforming agents and services have **no obligation** to interact with
this directory; it exists for opt-in announcement and cold-start
discovery.

## Status

**v0.1 — Working Draft.** Tracking the `spec/directory.md` v0.1 surface.

## Stack

- **Runtime**: Node 20 + [Hono](https://hono.dev/) HTTP framework
- **Storage**: Postgres 16 (listings), Redis 7 (challenges, sessions, rate limits, cron lock)
- **Scheduler**: in-process `node-cron` (default `0 6 * * *` UTC daily)
- **Hosting**: Railway (production), Docker Compose (local dev)
- **Validation**: Zod mirroring `schemas/listing.json` and `schemas/well-known.json` from the spec
- **Tests**: Vitest with MSW (outbound fetch) and ioredis-mock (Redis)

## Local development

```bash
pnpm install

# Postgres + Redis on default ports
docker compose up -d

cp .env.example .env

# Apply migrations
pnpm migrate

# Hot-reload dev server on :3000
pnpm dev

# Or: standalone preview with seeded in-memory data, no DB needed
pnpm preview
```

Smoke-test:

```bash
curl -s localhost:3000/healthz
# {"status":"ok"}

curl -s localhost:3000/v1/listings
# {"listings":[],"next_cursor":null}
```

## Tests

```bash
pnpm test           # one-shot
pnpm test:watch     # watch mode
pnpm typecheck      # tsc --noEmit
pnpm build          # production bundle
```

77 tests covering tokens, schemas, the storage layer, the §4 listing
protocol (challenge / submit / patch / delete + re-challenge), the §5
read API (pagination, filters, CORS, cache), the §7 revalidation state
machine (three-fail-then-stale, grace-period sweep, Redis advisory
lock), the admin cron trigger, and the §9/§10 governance pages.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET    | `/healthz`                     | Liveness probe |
| GET    | `/`                            | Browse UI (HTML) |
| GET    | `/operator`                    | Operator commitment (§9) |
| GET    | `/policy`                      | Take-down policy (§10) |
| POST   | `/v1/listings/challenge`       | Request a registration challenge (§4.1) |
| POST   | `/v1/listings`                 | Submit a listing or re-challenge an existing one (§4.1, §4.3) |
| PATCH  | `/v1/listings/{service_did}`   | Update a listing (§4.2) — bearer session token |
| DELETE | `/v1/listings/{service_did}`   | Soft-delete a listing (§4.2) — bearer session token |
| GET    | `/v1/listings`                 | Paginated list with `cursor`, `limit`≤100, `search`, `tag`, `updated_since`, `status`, `include_deleted` (§5) |
| GET    | `/v1/listings/{service_did}`   | Single listing (§5) |
| POST   | `/admin/cron/revalidate`       | Force a revalidation tick — bearer `REGISTRY_CRON_SECRET` |

## Rate limits

Defaults are per-IP fixed-window counters in Redis.

| Endpoint group | Limit |
|---|---|
| `POST /v1/listings/challenge`     | 30 / minute |
| `POST /v1/listings`               | 10 / minute |
| `PATCH/DELETE /v1/listings/...`   | 30 / minute |
| `GET /v1/listings*`               | 600 / minute |

In addition, **per-host** challenge issuance is capped at 10 active
challenges per hour to make submission spam against a single discovery
host harder.

## Deploying to Railway

The service deploys cleanly as a single Railway container. From the
Railway dashboard:

1. **New project** → "Deploy from GitHub repo" → `AFAuthHQ/registry`.
2. Add a **Postgres** plugin (Railway → +New → Database → Postgres).
   `DATABASE_URL` is injected automatically into the service.
3. Add a **Redis** plugin. `REDIS_URL` is injected automatically.
4. Set environment variables on the service:
   - `REGISTRY_CRON_SECRET` — long random string for the admin route
   - `REGISTRY_ADMIN_SECRET` — long random string (reserved for future admin routes)
   - `NODE_ENV=production`
   - `LOG_LEVEL=info` (or `debug` during shakedown)
   - `PUBLIC_BASE_URL=https://registry.afauth.org`
   - `REGISTRY_CRON_SCHEDULE=0 6 * * *` (optional; defaults to daily 06:00 UTC)
5. **Custom domain** → add `registry.afauth.org`; Railway will provide
   a CNAME target to set in DNS.
6. First deploy will run migrations on boot via `PgStore.init()`.

Build is via the included `Dockerfile`; Railway picks it up automatically.

## License

[Apache-2.0](LICENSE). The specification text and JSON Schemas this
implements are CC-BY-4.0, hosted in the
[`AFAuthHQ/spec`](https://github.com/AFAuthHQ/spec) repository.
