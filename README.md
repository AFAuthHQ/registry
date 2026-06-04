# AFAuth service directory

> The reference service directory for the [AFAuth Protocol](https://github.com/AFAuthHQ/spec) — **Agent-First Auth**, the open protocol that makes AI agents first-class citizens of every service.

AFAuth agents sign themselves up to services using their own cryptographic keypair. This directory is how they find services to sign up with in the first place: an opt-in, cold-start index where a service announces that it speaks AFAuth and an agent discovers it. It is an *informational convention* ([AFAP-0003](https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md)) — conforming agents and services have **no obligation** to use it.

This repository is the canonical instance at **[`registry.afauth.org`](https://registry.afauth.org)**, implementing the non-normative directory convention in [`spec/directory.md`](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md). The directory is a convention, not a dependency — anyone can [run their own](#run-your-own-instance).

**Part of AFAuth:** [Protocol spec](https://github.com/AFAuthHQ/spec) · [Docs](https://docs.afauth.org) · [CLI](https://github.com/AFAuthHQ/cli) · [SDK](https://github.com/AFAuthHQ/typescript-sdk) · [Trust attestor](https://github.com/AFAuthHQ/trust)

> **Sibling service:** the **trust attestor** at [`trust.afauth.org`](https://github.com/AFAuthHQ/trust) (AFAP-0006) lets an agent link to a human and mint the attestation JWTs that spam-resistant `attested_only` services require.

## Status

**v0.1.** Tracking the `spec/directory.md` v0.1 surface.

## Architecture

A single [Hono](https://hono.dev/) service:

- **`src/routes/`** — the HTTP surface: the listing protocol (challenge / submit / patch / delete), the public read API, the browse UI, the governance pages, and the admin cron trigger.
- **`src/lib/store/`** — the storage layer behind one interface: Postgres in production, an in-memory store for `pnpm preview` and tests.
- **`src/jobs/`** — the daily revalidation sweep that re-fetches each listed host's `/.well-known/afauth` and ages out the unreachable.

Listing payloads are validated with Zod schemas mirroring `schemas/listing.json` and `schemas/well-known.json` from the spec.

## Stack

- **Runtime**: Node 22 + [Hono](https://hono.dev/) HTTP framework
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

The suite covers tokens, schemas, the storage layer, the §4 listing
protocol (challenge / submit / patch / delete + re-challenge), the §5
read API (pagination, filters, CORS, cache), the §7 revalidation state
machine (three-fail-then-stale, grace-period sweep, Redis advisory
lock), the admin cron trigger, the §9/§10 governance pages, and SSRF
hardening on outbound host validation (DNS pinning, NAT64/6to4
rejection).

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

## Configuration

All variables have working dev defaults in [`.env.example`](.env.example). On Railway, `DATABASE_URL` and `REDIS_URL` are injected by the Postgres and Redis plugins.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL`          | ✅ (injected on Railway) | Postgres connection string. |
| `REDIS_URL`             | ✅ (injected on Railway) | Redis connection string. |
| `PUBLIC_BASE_URL`       | ✅ | Public origin; used in generated proof URLs and the operator/policy pages. |
| `REGISTRY_CRON_SECRET`  | ✅ | Bearer secret for `POST /admin/cron/revalidate`. |
| `REGISTRY_ADMIN_SECRET` | ✅ | Bearer secret reserved for admin take-down operations. |
| `REGISTRY_CRON_SCHEDULE`| optional | Revalidation cron (UTC). Default `0 6 * * *` (daily 06:00). |
| `NODE_ENV`              | optional | `production` in production. |
| `LOG_LEVEL`             | optional | `info` default; `debug` during shakedown. |
| `PORT`                  | optional | Defaults to 3000. |

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

## Run your own instance

The directory is an opt-in convention ([AFAP-0003](https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md)), so you can run your own — for a private agent fleet, a community, or as an alternative public directory. The canonical instance runs on Railway, but any container host works (a [`Dockerfile`](Dockerfile) is included).

From the Railway dashboard:

1. **New project** → "Deploy from GitHub repo" → `AFAuthHQ/registry`.
2. Add a **Postgres** plugin (Railway → +New → Database → Postgres).
   `DATABASE_URL` is injected automatically into the service.
3. Add a **Redis** plugin. `REDIS_URL` is injected automatically.
4. Set the environment variables from the [Configuration](#configuration)
   table — at minimum `PUBLIC_BASE_URL`, `REGISTRY_CRON_SECRET`,
   `REGISTRY_ADMIN_SECRET`, and `NODE_ENV=production`.
5. **Custom domain** → add `registry.afauth.org` (or your own); Railway
   will provide a CNAME target to set in DNS.
6. First deploy runs migrations on boot via `PgStore.init()`.

Build is via the included `Dockerfile`; Railway picks it up automatically.

## Contributing

The wire surface is defined by the protocol, not this repo — to change
*behavior*, propose an [AFAP](https://github.com/AFAuthHQ/spec/tree/main/proposals)
against [`AFAuthHQ/spec`](https://github.com/AFAuthHQ/spec). Bug reports and
fixes against this implementation are welcome as issues and PRs here. For
security issues, follow the [AFAuth security policy](https://github.com/AFAuthHQ/.github/blob/main/SECURITY.md)
— please don't open a public issue.

## License

[Apache-2.0](LICENSE). The specification text and JSON Schemas this
implements are CC-BY-4.0, hosted in the
[`AFAuthHQ/spec`](https://github.com/AFAuthHQ/spec) repository.
