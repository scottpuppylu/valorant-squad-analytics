# Deep historical acquisition

TASK-DATA-03A — SDD STRICT, IMPLEMENTED; deployment verification pending. Rule: `deep-history-v1`.
Starting HEAD: f3c870f5ee7b93dbbd6fcadf470a5f3053866c17. The preceding release
diagnosis was preserved and pushed first. Checkpoint: checkpoint-before-data-03a-deep-history.
Release acceptance is PAUSED FOR DATA-03; V1 NOT YET RELEASED.

## Implementation contract

Append-only migration 0007 creates a separate `deep_backfill` cursor/run kind.
Do not modify legacy backfill/incremental history or migrations 0001–0006.
Phase 1 crawls v4 size/start monotonically, advancing through fully overlapping pages,
without a 300-response horizon. Empty/short transitions atomically to stored_index.
Phase 2 uses 1-based Stored Matches size/page, reads pagination counters, and treats
meta.id only as an in-memory discovery identifier. Existing HMAC-keyed sources are
overlaps; otherwise full v4 detail goes through the same durable evidence pipeline.
Compact stored rows never become fabricated full match evidence.

One invocation: one live request OR one stored-index request plus at most one detail
request; no provider retry loop. Preserve the 25-second useful-work budget, 45-second
lease, consent checks before every request, durable success commit and persisted backoff.
Store phase/page/item, keyed fingerprints and aggregate counters, never plaintext match IDs.
Permanent detail 404 advances with an unavailable count; retryable errors preserve position.
Provider repetition is a stall, never source exhaustion. Mutable index pages may be
revisited; changed page fingerprints restart that page idempotently rather than skip items.

Only exhausted live AND stored phases may yield sourceExhausted=true. A stored account
404 is not proof of an empty index: fail safely rather than claim exhaustion.
lifetimeComplete=false always. Completion language: 已達目前資料來源最舊可取得紀錄.
Browser continuation starts only after explicit user action, spaces requests, observes
nextAttemptAt, stops on errors/revocation/unmount, and saves only public run recovery state.
No cron/queue; a closed browser stops orchestration, not durable progress. Future
incremental requests accumulate newly observed matches; this is not an unattended scheduler.

## Provider contract evidence

On 2026-10-03 the current [provider guide](https://docs.henrikdev.xyz/valorant/guides/stored-matches)
explicitly documents `page` as 1-based, with `size` required, newest-first mutable pages
and results.total/returned/before/after. OpenAPI 4.6.0 still omits page; guide confirmation
supersedes the older field-audit warning for this rule, not the historic observation.
Stored records are a cached accumulating subset with possible holes, not lifetime history.
Use name/tag route, no new recoverable PUUID. Detail route:
GET /valorant/v4/match/{affinity}/{match_id}. Mocked adapter contract tests are required.
No live player API validation is implied by documentation inspection.

Future official provider is a boundary only, NOT activated. Riot VAL-MATCH-V1 exposes
matchlists/by-puuid and matches/{matchId}; public VALORANT applications require opt-in,
RSO and Production access ([Riot policy](https://developer.riotgames.com/docs/valorant)).
No lifetime guarantee, Riot secret or Riot call is introduced.

## Verification and production gate

Baseline: lint PASS; 21 files/317 tests PASS (31.81s); build PASS, 711 modules, 6.34s;
production audit 0 vulnerabilities; local db:validate 15 tests PASS (30.68s).
Full audit remains independently governed by SEC-2026-001.
Mandatory fixtures: overlap/shared pages, >300 history, empty/short phase transition,
stored discovery/detail unavailable, crash resume, retry/backoff, consent revocation,
lease recovery, migration ledger rerun and safe public status. No production test data.

Implementation/deployment and normal Vercel migration path are authorized. Production
deep start/continue would call Henrik and write run/cursor/evidence; therefore propose
the exact bounded validation and STOP for approval before executing it. Full P1/P2
crawl is a separate human gate. Production crawl NOT STARTED.

DATA-03A improves acquisition/storage only. Public schema 4 and newest-300 dataset
read remain unchanged. TASK-DATA-03B (full-history runtime pagination/consumption)
NOT STARTED. No scoring, metric-reconstruction or Synergy change.

## Current-worktree verification (2026-10-04 Asia/Taipei)

- lint PASS, exit 0; 23 files / 338 tests PASS, 58.02s; source boundary PASS.
- Build PASS, exit 0, 712 modules, Vite 3.90s, dist boundary PASS. Main
  363.14 kB / 116.46 gzip; charts 339.21 / 99.53; CSS 40.17 / 9.15;
  lazy Connect 22.01 / 7.31. No dependency, runtime-read cap or scoring change.
- db:validate: 16 tests PASS, 35.85s. Includes populated 0006 -> 0007 upgrade,
  unchanged legacy cursor/run/evidence and ledger rerun. Disposable PGlite only.
- Production audit: zero vulnerabilities. Full audit: exit 1, exactly five high
  in the existing dev/build chain, NOT FIXED; SEC-2026-001 remains separate.
- Updated in-memory boundary proof: 469 emitted browser modules and all 11 API
  entry closures have zero affected dependency inputs; external node:crypto only.
  New provider input is URL-encoded and SQL parameterized, not build/glob input.
  Remote function-artifact bytes remain NOT VERIFIED.
- >300 fixture persists 303 source matches across 102 live requests, then stored
  exhaustion. Shared P1/P2 fixture advances past three shared sources and adds
  one older source, with seven consenting participant links and four unique sources.
- Stored detail: one per invocation; 404 counted and skipped; 429/timeout/5xx
  persist backoff without moving page/item; repeated pages stall, not exhaust.
- Crash after evidence commit/before cursor commit retries idempotently and skips
  already durable detail. Consent revocation between index/detail blocks detail.
- Browser orchestration fixtures verify explicit resume, >=7-second spacing,
  persisted backoff, pause/unmount/error stop and safe localStorage fallback.
- Real Chrome local Demo Connect and home navigation PASS, zero console errors,
  no blank page/overlay, 390px Connect no horizontal overflow. Active production
  deep progress UI/real provider pagination NOT VERIFIED: intentionally gated.

Recovery storage: goblin-survey:deep-sync:v1 = version/playerId/runId only.
Reset/deletion acceptance clears recovery state; malformed storage is discarded.
No management credential, Riot ID, provider ID or raw data enters this new key.
Counters are committed observations/upserts, not unique lifetime totals. Attempt
counts include recorded retry failures but cannot cover an abrupt uncommitted death.
The mutable stored index is not a snapshot: changed in-progress pages restart
idempotently; offset/page movement during concurrent provider updates can leave
holes. Source exhaustion never proves lifetime completeness or fixed-snapshot coverage.

## Proposed production validation — NOT EXECUTED

After explicit approval, start one deep_backfill chunk for each still-eligible
P1/P2: at most two live provider requests and six full-match observations/upserts,
plus new independent run/cursor metadata. Confirm sanitized status, phase, no lost
legacy cursor, zero relational/consent errors and truthful coverage. No reset,
reconnect, deletion or credentials/IDs in output. Before extending to the full
two-phase crawl, obtain/confirm approval of full P1/P2 continuation. Each live
chunk <=3 matches; each stored chunk <=one index request plus one detail; honor
persisted backoff and halt on revoked consent, stall, malformed data or DB error.
No total history cap, therefore total requests/cost cannot be promised in advance.
Full crawl is NOT STARTED; production pagination/coverage is NOT VERIFIED.
