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

**v0.1 — Working Draft.** Not yet deployed; tracking the
`spec/directory.md` v0.1 surface.

## Stack

- **Runtime**: Node 20+, [Hono](https://hono.dev/) HTTP framework
- **Storage**: Postgres 16 (listings), Redis 7 (challenges, sessions, rate limits)
- **Scheduler**: in-process `node-cron`
- **Hosting**: Railway (production), Docker Compose (local dev)
- **Validation**: Zod against `schemas/listing.json` and `schemas/well-known.json` from the spec

## Local development

```bash
# 1. Install deps
pnpm install

# 2. Start Postgres + Redis
docker compose up -d

# 3. Configure env
cp .env.example .env

# 4. Run migrations
pnpm migrate

# 5. Start dev server (auto-reloads on change)
pnpm dev
```

Server listens on `http://localhost:3000`. Smoke-test:

```bash
curl -s localhost:3000/healthz
# {"status":"ok"}
```

## Tests

```bash
pnpm test          # one-shot
pnpm test:watch    # watch mode
pnpm typecheck     # tsc --noEmit
```

## Endpoints (planned)

Tracking [`spec/directory.md`](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md):

| Method | Path | Phase | Status |
|---|---|---|---|
| GET    | `/healthz`                          | 1 | ✅ implemented |
| POST   | `/v1/listings/challenge`            | 2 | pending |
| POST   | `/v1/listings`                      | 2 | pending |
| PATCH  | `/v1/listings/{service_did}`        | 2 | pending |
| DELETE | `/v1/listings/{service_did}`        | 2 | pending |
| GET    | `/v1/listings`                      | 3 | pending |
| GET    | `/v1/listings/{service_did}`        | 3 | pending |
| GET    | `/` (browse UI)                     | 5 | pending |
| GET    | `/operator`                         | 5 | pending |
| GET    | `/policy`                           | 5 | pending |

## License

[Apache-2.0](LICENSE). The specification text and JSON Schemas this
implements are CC-BY-4.0, hosted in the
[`AFAuthHQ/spec`](https://github.com/AFAuthHQ/spec) repository.
