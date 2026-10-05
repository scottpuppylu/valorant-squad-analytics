# Fast recent match refresh (TASK-DATA-FASTSYNC-01)

Policy version: **`recent-refresh-v1`**. SDD STRICT, authorized 2026-10-06. Starting HEAD
`6ed4da3411201227a05d35a28cafc2333f21e734`; checkpoint `checkpoint-before-data-fastsync-01`.

Goal: a player normally does not have to wait for the daily cron to see a newly finished match.
Opening a real public Profile can trigger **one** bounded incremental refresh when, and only when,
the server decides the player's recent sync is stale.

This is recent-match freshness only. It is not deeper history, Riot/RSO, rank ingestion, a score
change or a lifetime-completeness claim. `community-score-v2`, `community-benchmarks-v1`,
`overall-profile-v1`, `duo-synergy-v1` and `improvement-index-v1` are unchanged.

## Cron is unchanged

`vercel.json` still runs `recent` at `5 18 * * *` and `history` at `35 18 * * *` (daily, Hobby
plan). The scheduled recent job still uses its 20-hour eligibility. FASTSYNC complements the cron
as an opportunistic path; the cron remains the unattended safety net. There is no plan upgrade, no
external scheduler and no GitHub Actions schedule.

## API (no new function; still 12)

`POST /api/valorant/sync/start` with `{ "playerId": "<public uuid>", "kind": "incremental", "intent": "refresh_if_stale" }`

- `intent` is optional and backward compatible. Without it, `start` behaves exactly as before
  (Connect and historical controls are unchanged).
- `refresh_if_stale` is accepted only with `kind: "incremental"`. Any other intent → 400.
- The client never sends a threshold or cooldown, and unknown fields are ignored.
- The existing per-IP limit on `sync/start` (6/min) still applies first. It is not weakened, and
  it is not the authority: the durable per-player gate below is.

Response:

```json
{ "ok": true,
  "refresh": { "policyVersion": "recent-refresh-v1",
    "status": "refreshed | fresh | busy | backoff | unavailable",
    "providerRequested": false,
    "lastSuccessAt": "…", "nextEligibleAt": "…",
    "newMatches": 0, "morePending": false, "errorCategory": "RATE_LIMITED" },
  "sync": { "…existing public sync status, only when a chunk ran…" } }
```

- No PUUID, Riot ID, provider match ID, HMAC, database ID, lease token or secret is included.
- An ineligible or unknown player returns `unavailable`, not a distinct error.

## Freshness definition

Freshness = **`sync_cursors.last_success_at` of the player's incremental cursor** (provider
HenrikDev, the identity's affinity, queue `*`).

- It is written only by a committed successful incremental chunk, whether cron, manual or
  opportunistic.
- It is never the page render time or the time of an analysis request.
- The latest incremental `sync_runs` row decides whether a run is still in progress (see below).

## Decision model (`server/sync/recentRefresh.ts`, pure and deterministic)

| Durable state | Decision | Provider call |
|---|---|---|
| Not eligible: no active current-policy consent, inactive membership, anonymized, open deletion job, or no Henrik identity | `INELIGIBLE` → `unavailable` | no |
| Unexpired lease (cron or another visitor is working) | `BUSY` → `busy` | no |
| `next_attempt_at` in the future (existing provider backoff) | `BACKOFF` → `backoff` | no |
| Latest incremental run `paused` / `pending` / `running` (lease expired) | `CONTINUE_PENDING` | one chunk of the **same** run |
| Latest run `failed`, last error < 30 min ago | `BACKOFF` (cooldown) | no |
| Latest run `failed`, ≥ 30 min | `STALE` / resume the same run | one chunk |
| `last_success_at` < 30 min ago | `FRESH` → `fresh` | no |
| No cursor, or `last_success_at` ≥ 30 min ago | `STALE` / new incremental run | one chunk |

- **Stale threshold:** `AUTO_REFRESH_STALE_AFTER_MS = 30 min`. Age ≥ 30:00.000 is stale and
  29:59.999 is fresh; both are boundary-tested.
- `nextEligibleAt` is `last_success_at + 30 min` for fresh, or `next_attempt_at` for backoff.

## Race safety

1. The decision records the cursor's `updated_at` (microseconds) as an optimistic version, or
   "no cursor".
2. `acquireCursorLease` locks the cursor row (`SELECT … FOR UPDATE`) inside the existing lease
   transaction. It refuses the lease if the version changed, or if a "no cursor" decision did
   not create the row itself.
3. Every lease, success or failure changes `updated_at`. So a second visitor who decided "stale"
   before the winner committed fails the guard and re-reads `fresh` or `busy`. They cannot fetch
   again.
4. A visitor arriving while the winner holds the lease gets `busy`.

This holds across browsers, IPs, tabs and reloads, because it is enforced in Postgres.

## Paused incremental runs

An incremental page holds 3 matches. With more than 3 new matches the run stays `paused`, and the
recent `last_success_at` must not be read as "nothing to do". A paused run is
`CONTINUE_PENDING`. It may continue immediately on the next action, without the 30-minute
cooldown, provided it is the same run, there is no backoff, the lease is free and consent is
still valid. It stops at the known boundary (`known_boundary`), a short page or an empty page.

## Bounds

| Action | Provider chunks |
|---|---|
| Automatic Profile refresh | at most **1** per event; no recursion; `morePending` is disclosed (最新一批已更新，仍有近期資料待補) |
| Manual 更新戰績 | **1** per click (decision below) |
| Page size | unchanged at **3**; the existing sync semantics were tested at this size |

**Manual stays at one chunk.** A chunk is one Henrik request plus normalization and a durable
transaction under a 25-second budget. A second chunk in the same request would double the
worst-case latency for one click and add burst pressure on the shared operator key. The user can
click again to continue a paused run, which the per-player server gate allows. No client loop
exists.

## Provider protection

- Existing `RATE_LIMITED` / `PROVIDER_TIMEOUT` / `PROVIDER_5XX` handling is reused unchanged:
  the run is paused, `next_attempt_at` is set to 60 s × 2^retry (max 15 min), and the cursor does
  not advance.
- FASTSYNC surfaces this as `backoff` with `nextEligibleAt` and makes no further provider call
  until it passes.
- Non-retryable failures are cooled down for 30 minutes.
- `retries: 0` on the provider client is unchanged.
- No assumption is made about the Henrik per-minute quota. Provider retry headers are not used;
  that would be a future enhancement.

## Consent and privacy

The existing service path re-checks consent at every stage:
- At the decision.
- In the lease transaction (`FOR SHARE`).
- Again before the provider request.
- In the durable write transaction.

Revocation before provider work means no request. Revocation before the write means no durable
write; the run is cancelled. Deletion semantics are unchanged.

Opportunistic runs keep `trigger_kind='manual'`, so there is no new DB value and no migration.
Telemetry interpretation: `manual` now includes Connect-page manual syncs **and** Profile
refreshes. Server telemetry emits one aggregate line per request:
`{event:'recent_refresh', policy, decision, refreshStatus, providerRequested, newMatches, morePending, durationMs}`.
It contains no player, Riot, match or secret identifiers.

## Browser behaviour

- **Profile** renders stored data first. `RecentRefreshPanel` then asks `refresh_if_stale` **once
  per player per tab**, using an in-memory map in `DatasetProvider` (UX only; never localStorage).
  Re-renders, filter changes and remounts do not refire it.
- **Copy:** 最近同步：X 分鐘前, plus one of 正在檢查最新戰績 / 資料已是最新狀態 / 已更新最新戰績
  / 仍有近期資料待補 / 更新暫時受到限制 / 稍後可再更新. It never claims 全部戰績 or 完整生涯.
- **Manual 更新戰績** asks the same endpoint. It is disabled while a request is in flight; a fresh
  answer shows 約 N 分鐘後可再次更新.
- **Reloads:** only `refreshed` with `newMatches > 0` (durably committed) reloads the snapshot.
  That reload clears the per-tab `view=analysis` cache, and the new snapshot version re-keys
  every analysis hook: Profile, Matches, currentStrength, recentForm and the Progress Index.
  Fresh, zero-new and error answers do not reload anything. There is no optimistic data.
- **Dashboard, Leaderboard, Matches and the site root never trigger a refresh.** The optional
  Matches-page button was not built.
- **Demo / GitHub Pages:** the control is not rendered, and 0 `/api` calls are made.

## Migration

None. Existing `sync_cursors` (`last_success_at`, `next_attempt_at`, `lease_token`,
`lease_expires_at`, `last_error_at`, `updated_at`) and `sync_runs` hold all the required evidence.

## Measurements

Local PGlite with a stub provider: fresh skip ≈ 2 ms (2 SQL queries, asserted in tests),
stale one-chunk refresh ≈ 19 ms plus provider latency, snapshot reload ≈ 13 ms (21 matches).
Production figures are recorded under "Production canary".

## Future (not implemented)

**TASK-DATA-FASTSYNC-02 — NOT STARTED / OPTIONAL FUTURE.** An hourly scheduled recent sync if the
deployment plan later supports sub-daily cron.

## Production canary (2026-10-06, exactly one call)

- **Deployment:** commits `ed53bb4` and `2160bab`. GitHub CI, GitHub Pages and Vercel all passed.
- **Before the canary:** opening the site root made 0 `sync/start` calls. Public state was 183
  matches with 0 duplicate public match IDs.
- **The call:** one real public Profile was opened (player not identified) and triggered the
  automatic refresh-if-stale. The player was not fresh: the latest incremental run was **paused**,
  so the decision was `CONTINUE_PENDING`. No cooldown was bypassed.

**Response:** HTTP 200 in 14.1 s (client-observed).

| Field | Value |
|---|---|
| `status` | `refreshed` |
| `providerRequested` | `true` |
| `newMatches` | 0 |
| `morePending` | false |
| Run status | `complete` (`known_boundary`) |

- This chunk made one provider request. The run's cumulative counters show 2 provider requests,
  2.9 s total provider fetch and 15.6 s database time.
- The database time is dominated by the existing idempotent re-upsert of the overlapping known
  matches on the boundary page. Its behaviour is unchanged by this task.
- No player, PUUID, provider match ID, HMAC, lease, database ID or secret was in the response.
  The public `runId` is the existing public sync contract.

**After the canary**
- 183 matches, 0 duplicates; the dataset and `view=analysis` (improvementIndex, currentStrength)
  return 200 with no identifier patterns.
- The Profile stayed rendered with no NaN.
- The tab made exactly one refresh call and did not reload the snapshot, which is correct for
  0 new matches.
- The snapshot content hash changed (sync metadata/overlap refresh). It is picked up on the next
  normal load.

**Demo (GitHub Pages):** the Profile renders, the update control is absent and 0 `/api` requests
are made.

**Not exercised in production:** the fresh-skip path (`providerRequested=false`). It is covered by
tests and would have needed a second call. A new match did not exist; 0 new matches is a valid
success.

**Latency note:** a stale chunk can take over 10 s in production. The Profile never waits for it:
stored data stays on screen and the panel updates afterwards.
