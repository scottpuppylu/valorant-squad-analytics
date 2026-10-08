# VPS Production architecture — TASK-INFRA-DATABASE-PORTABILITY-01

> **PUBLIC READ PATH SUPERSEDED (2026-10-07, TASK-INFRA-STATIC-DATA-PUBLISH-01).** Public read views are served as a
> derived, immutable, privacy-gated **static snapshot** on a static host. The recommended host is a separate public
> data repository on GitHub Pages; see [STATIC_DATA_PUBLISH.md](STATIC_DATA_PUBLISH.md).
>
> What stays valid:
> - The Compose stack below remains the **local runtime** on the self-hosted machine: sync worker, scheduler,
>   PostgreSQL (the source of truth), migrations, backup/restore and the exporter.
>
> What is no longer required:
> - The public parts: Caddy public TLS, a public Node API, inbound 80/443, DNS to this host. CGNAT therefore no longer
>   blocks the public site.
> - The routing-switch steps of the migration runbook (16–17) need a new static-cutover plan before use.
> - This document is kept as historical evidence and for the local runtime.

> **SDD correction (2026-10-07): SELF_HOSTED_FIRST.** The primary Production host is **user-owned hardware**,
> not a cloud VPS. Cloud is at most a future optional backup or fallback. The stack itself is unchanged: Docker
> Compose, Caddy, Node API and PostgreSQL on a private network. "VPS" below means "the Production host".
>
> **Readiness (TASK-INFRA-SELFHOST-READINESS-01):** outcome **B — HOST_READY_NETWORK_BLOCKED**.
> - **Host:** the Windows 11 desktop (i5-14400F 10C/16T, 32 GB RAM, 1 TB NVMe, wired 1 Gbps, WSL2 Ubuntu 24.04
>   with systemd) is suitable.
> - **Network:** direct inbound hosting is not established.
>   - There is no IPv6.
>   - The router's upstream hop is RFC1918 (10.x) while the public IPv4 is globally routable, which strongly
>     suggests CGNAT. That is not yet confirmed.
>   - UPnP and NAT-PMP are not exposed.
> - **Operational gaps:**
>   - The host is power-cycled about 2–3 times a day today.
>   - The database and backups would share one SSD (shared failure domain).
>   - C: is 84 % used. [SUPERSEDED: the WSL vhdx moved to D:; C: has 87 GB free.]
> - See docs/TASKS.md.
>
> **Local runtime (TASK-INFRA-LOCAL-RUNTIME-BOOTSTRAP-01): LOCAL_RUNTIME_READY = YES.**
> - Docker Engine runs inside WSL; PostgreSQL data is on ext4 in the D:-hosted vhdx.
> - The full stack, the real-PostgreSQL rehearsal and backup/restore all PASS locally.
> - An idle WSL VM shuts down. 24/7 Production on this host must keep WSL running.

**Decided (final):** a single VPS running Docker Compose, with Caddy → Node API → PostgreSQL on a private Docker
network.

| Role | System |
|---|---|
| Production | The VPS (after cutover) |
| Demo, static fallback and rollback reference | GitHub Pages (no Production DB, no secrets) |
| Pending retirement | Vercel serverless and Neon |

```
Internet ──HTTPS──▶ web (Caddy :80/:443) ──app-internal──▶ app (Node API :3000) ──app-internal──▶ postgres (:5432)
                                                         └─edge (outbound only)──▶ provider API (HTTPS)
VPS: migrate (one-shot) · scheduler (daily jobs) · backup (host cron → infra/backup) · health (/healthz)
```

## Principles

- **Production locality:** the Node API and PostgreSQL communicate only over the private `app-internal` network,
  which is `internal: true` and has no route to the Internet. Application ↔ database traffic never crosses the
  public Internet, so no DBaaS transfer quota exists.
- **No public database port:** PostgreSQL publishes **no** port (not even on 127.0.0.1). Only Caddy publishes 80
  and 443. The API publishes nothing; it also joins `edge` for outbound provider HTTPS. Both are guarded by
  `tests/databaseArchitecture.test.ts`.
- **Hosting independence:** the 12 API handlers and their business logic are unchanged.
  - `server/node/httpServer.ts` adapts `node:http` to the same `ApiRequest` / `ApiResponse` contract the
    serverless host used: JSON body parsing, repeated query keys as arrays, the cron `[job]` segment, 64 KB body
    cap, and the same `/api/*` security headers.
  - `tests/nodeRuntime.test.ts` proves all 12 route files are served.
- **Bounded background work:** see [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md#bounded-background-work).
- **Restore-first backup:** a backup is not accepted until a restore procedure exists and has been rehearsed.

## Assets

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage. `build`: `npm ci`, frontend with `APP_BASE_PATH=/`, server compile (`tsconfig.server.json` → `dist-server`). `app`: production deps only, compiled JS, `USER node`, healthcheck. `web`: Caddy + built frontend. No secret is ever copied |
| `infra/compose.yaml` | `postgres` (persistent `postgres-data` volume, healthcheck, no ports), `migrate` (one-shot migrations + fact hydration), `app`, `scheduler`, `web` |
| `infra/Caddyfile` | Automatic TLS for `SITE_ADDRESS`, `/api/*` and `/healthz` → `app:3000`, SPA static files at `/` |
| `infra/env.example`, `infra/postgres.env.example` | Placeholders only. The real files are `infra/env/production.env` (app and jobs) and `infra/env/postgres.env` (database container only: least privilege, never app secrets). Both are gitignored, chmod 600 and created on the VPS. Run Compose with `--env-file infra/env/production.env` so `SITE_ADDRESS` and `POSTGRES_DB`/`POSTGRES_USER` interpolate |
| `server/node/main.ts` | API entrypoint: graceful SIGTERM, request and header timeouts, cheap health |
| `server/node/scheduler.ts` | Replaces Vercel Cron with the **same** two daily jobs (UTC 18:05 recent, 18:35 history) through the same authenticated `/api/valorant/cron/*` endpoints |
| `infra/backup`, `infra/restore`, `infra/rehearsal` | See [DATABASE_OPERATIONS.md](DATABASE_OPERATIONS.md) |

**Health.** `GET /healthz` checks that the app is alive and the database reachable, using one `SELECT` of the
latest migration. It also returns DB latency and pool sizes. It never runs analytics; it returns 503 when the
database is unavailable.

**Frontend.** The VPS build serves the site root (`APP_BASE_PATH=/`). GitHub Pages keeps the repository subpath,
and its `*.github.io` hostname forces Demo mode (unchanged). Any other hostname uses same-origin `/api`, which
means REAL.

## VPS baseline (to provision; not invented here)

- Linux with Docker Engine and the Compose plugin.
- Firewall allowing only 22/80/443 inbound.
- SSH key authentication only; automatic security updates.
- Disk monitoring, and a backup destination off the VPS.

The domain and IP are supplied when the VPS exists.
