# Durable historical synchronization

TASK-DATA-01B implements bounded, resumable synchronization for one actively consenting player. “History” means only the records that HenrikDev v4 returned through the verified `size/start` contract at observation time. It never means guaranteed Riot lifetime history.

## Public boundary

- `POST /api/valorant/sync/start` accepts a public application player UUID and `backfill` or `incremental` kind.
- `POST /api/valorant/sync/continue` accepts only the public run UUID.
- `GET /api/valorant/sync/status` returns aggregate progress, coverage, safe error state and performance totals.
- PUUIDs, Riot ID/tag, raw provider match IDs, HMAC values, database IDs and credentials never appear in these responses.
- The React analytics runtime remains browser-local until DATA-02. Sync controls do not silently switch leaderboard data to Neon.

## State machine and cursor

Runs transition through `pending`, `running`, `paused`, `complete`, `failed` or `cancelled`. A cursor is unique by player, provider, affinity, queue scope and sync kind. It records the next `start` offset, last committed provider boundary, last page fingerprint, last successful page, retry state, coverage, provider-window completeness and lease state.

Only one chunk runs at a time for a player/kind. Neon atomically grants a random lease token with a 45-second expiry. A second invocation returns `LOCK_BUSY`; a crashed invocation can be recovered after expiry. The lease is cleared on success or recorded failure.

Cursor advancement is monotonic and occurs only in the same durable success update after every match in the current page has committed. Each match has its own transaction, so a later bad match cannot roll back earlier pages. If a chunk fails before its cursor update, retry starts from the same page.

## Bounded provider work

- Page size: 3 matches.
- Provider requests per invocation: 1.
- Useful-work budget: 25 seconds, leaving margin below Vercel `maxDuration=60`.
- Historical horizon: 300 provider responses.
- Raw response policy: validate and normalize in memory, persist relational evidence, discard the raw payload.
- Rate handling: 429, timeout and provider 5xx are retryable with persisted exponential backoff from 60 seconds up to 15 minutes. There is no retry loop inside one invocation.

Failures use only these safe categories: `RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_5XX`, `MALFORMED_RESPONSE`, `DATABASE_ERROR`, `CONSENT_REVOKED`, `LOCK_BUSY`, and `UNKNOWN`.

## Deterministic termination

Backfill stops on:

1. `empty_page`: complete for the observed provider window;
2. `short_page`: complete for the observed provider window;
3. `repeated_page`: incomplete, provider repeated the same page fingerprint;
4. `no_older_unique_matches`: incomplete, every match on the next page was already durable;
5. `configured_horizon`: incomplete, the 300-response safety horizon was reached.

Incremental sync starts at the newest page, intentionally overlaps existing matches and additionally stops at `known_boundary`. This refreshes corrected records without downloading the full window.

`coverage_from`, `coverage_to` and `last_synced_at` describe observed evidence only. `coverage_complete_for_provider_window=true` means a verified empty/short/known-boundary stop, not complete lifetime history.

## Production evidence

The controlled 2026-09-30 validation used the existing consenting production player and reports aggregates only:

| Run | Requests/chunks | Responses observed | Overlaps updated | Retries | Termination | Coverage |
|---|---:|---:|---:|---:|---|---|
| Backfill | 54 | 159 | 6 | 0 | `empty_page` | 2025-01-25 to 2026-09-28 |
| Incremental | 1 | 3 | 3 | 0 | `known_boundary` | newest overlap only |

The backfill inserted or refreshed 159 observations. Six were already durable at write time, so 153 were new to that run. Database uniqueness constraints remain authoritative for source matches, participants, rounds, kills and assistants.

## Measured capacity

Backfill cumulative service metrics:

| Metric | Total | Average per invocation |
|---|---:|---:|
| Provider fetch | 116,509 ms | 2,157.6 ms |
| Normalization | 1,224 ms | 22.7 ms |
| Database transaction work | 371,672 ms | 6,882.8 ms |
| Measured service-core work | 512,581 ms | 9,492.2 ms |
| SQL statements | 2,394 | 44.3 per chunk / 15.1 per observed match |

The service-core timer ends before response/status serialization, so it is not labeled full network round-trip time. Consecutive production UI requests measured an average 13,429 ms active cadence. At three matches per full page this is approximately 13.4 matches per minute. Linear planning estimates at that conservative observed cadence are:

- 30 matches: about 2.2 minutes;
- 100 matches: about 7.5 minutes;
- 300 matches: about 22.4 minutes.

Actual elapsed time may be longer when rate backoff, pauses, network variance, short pages or operator spacing occur. These estimates are capacity guidance, not a promise.

## Consent and privacy

Every start and continuation checks active consent before calling the provider. Lease acquisition, match persistence and cursor success commit also re-check/lock active consent, so a committed revocation wins a provider-fetch race: no later evidence or cursor advance can overwrite cancellation. Manual import and reconnect while deletion is open are blocked before provider access. Consent is still `self_asserted`, not Riot ownership verification. DATA-01C production destructive validation remains pending.

Non-consenting participants remain match-scoped HMAC pseudonyms and do not receive reusable player identities. Structured telemetry contains only public run UUID, kind, status, aggregate timing/counts, safe termination and safe error categories.

## Deferred rank history

Rank/MMR history sync is **NOT IMPLEMENTED** and **NOT VERIFIED** as a bounded durable crawl. The provider evidence observed rank families, but no separately verified pagination/termination contract was accepted for this state machine. This does not block match-history backfill.
