# Deep historical acquisition

## Current acquisition decision — DATA-05A (2026-10-05)

Explicit human decision supersedes the following Riot-response freeze. DATA-03A
resumes as Tracker-style persistent acquisition infrastructure: daily recent sync,
bounded historical continuation and 7/30-day reconciliation. Repeated pages pause
with durable backoff, third live repeat falls back to stored discovery; partial
sweeps are terminal but never lifetime-complete. See PERSISTENT_SYNC.md. Registration
and production canaries await safe CRON_SECRET configuration; NOT VERIFIED.
Historical P1/P2 and 30-source evidence below remains unchanged, not a fresh query.

## Superseding acquisition freeze — TASK-DATA-04A, 2026-10-04

TASK-DATA-04A is **WAITING ON RIOT — ticket #139243830**, **OPEN — WAITING FOR RIOT RESPONSE**. TASK-DATA-04B is **BLOCKED ON DATA-04A**; no Riot provider/RSO implementation or another Production/RSO application before clarification. Support inquiry submission does not authorize API calls, production changes or resumed acquisition.

**FULL LIFETIME MATCH HISTORY** is now the hard requirement: earliest actual match through latest, no known missing matches. [LIFETIME_HISTORY.md](LIFETIME_HISTORY.md) records completed docs-only feasibility research: primary Outcome D, Riot lifetime guarantee NOT DOCUMENTED, Production access NOT VERIFIED, `lifetimeComplete=false` required.

Do not continue P1/P2, DATA-03A.2, Henrik live/stored/detail retrieval, Riot game calls or production writes. Preserve the 30 durable matches and two consenting players. Henrik is secondary reconciliation only, not lifetime authority. DATA-03A production acceptance remains BLOCKED; DATA-03B NOT STARTED; RELEASE-01 PAUSED. Future DATA-04B is BLOCKED / NOT STARTED. No operational states or historical evidence below were changed; prior permissions do not override this freeze.

TASK-DATA-03A — SDD STRICT, IMPLEMENTATION COMPLETE; production acceptance BLOCKED after the approved TASK-DATA-03A.1 hard stop. Rule: `deep-history-v1`.
Starting HEAD: f3c870f5ee7b93dbbd6fcadf470a5f3053866c17. The preceding release
diagnosis was preserved and pushed first. Checkpoint: checkpoint-before-data-03a-deep-history.
Release acceptance is PAUSED FOR DATA-03; V1 NOT YET RELEASED.

## TASK-DATA-03A.1 production execution — 2026-10-04

Starting runtime/repository HEAD: 2c6864e564d401285d6a8e81e2f8632afc55a9c9.
Explicit human approval covered bounded P1/P2 canaries followed by full application
sync continuation. Both canaries PASS: one live request each, paused, three committed
observations each; overlaps P1=3/P2=1. Post-canary sources=19, links=10/12, shared=3;
contract, consent, relational, lease and bounded runtime-log checks passed.

Full continuation used the existing runs, serial global >=7-second spacing and
GET status before every continue. STOPPED on P2 `provider_repeated_page` after
12 continuation calls. No retry, reset, repair, cancellation or additional provider
request followed. P1 remains paused; P2 failed. Both remain in live_v4, with live,
stored and source exhaustion false and lifetimeComplete=false. The cause of provider
repetition is NOT VERIFIED; this is not evidence of source exhaustion.

| Final run aggregate | P1 | P2 |
| --- | ---: | ---: |
| Pages | 7 | 7 |
| Matches seen / persisted observations | 21 / 21 | 18 / 18 |
| Overlaps updated | 16 | 10 |
| Provider requests | 7 | 7 |
| Stored references / detail requests / unavailable details | 0 / 0 / 0 | 0 / 0 / 0 |
| Retries | 0 | 0 |
| Next live offset | 21 | 18 |
| Provider fetch / normalization ms | 13061 / 270 | 10409 / 203 |
| Database / total ms | 54291 / 72227 | 46501 / 61510 |
| SQL query count | 337 | 303 |

Durable sources grew 17 -> 30 (+13); P1 links 10 -> 15 (+5), P2 10 -> 18 (+8).
Shared=3, P1-only=12, P2-only=15, union=30; shared same-team=3, unchanged.
Observation upserts=39, NOT 39 unique new matches. All 14 recorded provider requests
were live-v4 history calls through application endpoints; stored discovery/detail
were not reached. Growth occurred during live execution; exact actor attribution
is NOT VERIFIED. No direct Henrik request, credential extraction or manual SQL write.

Durable UTC coverage: P1 2026-09-28T07:50:06.878Z -> 2026-10-03T09:35:27.566Z;
P2 2026-09-06T09:21:43.443Z -> 2026-10-03T16:12:44.559Z. Neither is lifetime history.
Full-continuation wall time 235.211s (2026-10-03T19:17:57.410Z -> 19:21:52.621Z).
First canary to stop elapsed 2h26m28.527s, including the human verification pause.

Post-stop SELECT-only health: ledger 0001–0007, two deep runs/cursors, no leases;
zero duplicate sources/active consents, membership/consent/deletion contradictions,
participant/evidence orphans, old normalization or invalid deep cursors. One failed
deep run is the known P2 stall. No migration occurred during this execution.
Public GET: HTTP 200, contract accepted, schema 4 REAL ready, 2 players/30 matches,
33 basic performances, newest <=300 bound unchanged. This window is not a durable
full-history API. Each player has 0 available/2 partial/6 unavailable dimensions;
Overall unavailable. Scoring and Synergy versions/formulas unchanged.

Nine requested public routes rendered without NaN/Infinity; console errors=0.
Bounded logs: 2 start and 12 continue POSTs returned HTTP 200, including the final
domain-level failed response; status/dataset reads remained healthy. No observed
500, DB/schema error, unhandled exception or secret leakage. A Node url.parse
deprecation warning was observed. Stored-phase production behavior NOT VERIFIED.

Local verification: lint PASS; 23 files/339 tests PASS (44.28s); build PASS, 712
modules, Vite 6.21s; source/dist secret-boundary checks PASS. Main 363.14 kB/116.46
gzip, charts 339.21/99.53, CSS 40.17/9.15, Connect 22.05/7.33, HTML 0.71/0.49.
DB validation 16 tests PASS (18.25s); production audit zero. Full audit remains
five high under SEC-2026-001, NOT FIXED; no dependency change.

Production acceptance is BLOCKED, not COMPLETE. DATA-03B NOT STARTED; RELEASE-01
remains PAUSED FOR DATA-03; V1 NOT YET RELEASED. A separately scoped diagnosis is
needed before any further continuation or software repair. Earlier NOT STARTED /
NOT EXECUTED descriptions below describe the implementation checkpoint only.

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

- lint PASS, exit 0; 23 files / 339 tests PASS, 68.66s; source boundary PASS.
- Build PASS, exit 0, 712 modules, Vite 8.69s, dist boundary PASS. Main
  363.14 kB / 116.46 gzip; charts 339.21 / 99.53; CSS 40.17 / 9.15;
  lazy Connect 22.05 / 7.33. No dependency, runtime-read cap or scoring change.
- db:validate: 16 tests PASS, 35.85s. Includes populated 0006 -> 0007 upgrade,
  unchanged legacy cursor/run/evidence and ledger rerun. Disposable PGlite only.
- Production audit: zero vulnerabilities. Full audit: exit 1, exactly five high
  in the existing dev/build chain, NOT FIXED; SEC-2026-001 remains separate.
- Updated in-memory boundary proof: 469 emitted browser modules and all 11 API
  entry closures have zero affected dependency inputs; external node:crypto only.
  New provider input is URL-encoded and SQL parameterized, not build/glob input.
  Remote function-artifact bytes remain NOT VERIFIED.
- Initial implementation deployment 228c4f8: CI
  [37135937278](https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37135937278)
  SUCCESS (83s); Pages
  [37135937355](https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37135937355)
  SUCCESS (109s). Vercel
  [Df5hV1zJw](https://vercel.com/scottpuppys-projects/valorant-squad-analytics/Df5hV1zJw3FyEnTwhu12XWC1RLTv)
  Ready, 3m31s; build log at 00:11:40 Asia/Taipei confirms
  Applied production migrations: 0007. Subsequent build passes report already up to date.
- The Ready deployment also logged three nonfatal compiler diagnostics: two legacy
  type-import extensions and new Array.at under the function builder's older lib.
  Minimal .js type imports/indexing corrections are included without changing logic.
  Final follow-up commit/deployment checks are reported in the handoff, not inferred
  from the initial deployment. Completed-source UI now clears automatic-running state.
- Public API readonly: HTTP 200/no-store, schema 4, dataset-read-v4, REAL ready,
  two players/17 matches, limit 300, lifetimeComplete=false. Public Connect and
  Pages Connect render with zero console errors; Pages remains Demo-only.
- >300 fixture persists 303 source matches across 102 live requests, then stored
  exhaustion. Shared P1/P2 fixture advances past three shared sources and adds
  one older source, with seven consenting participant links and four unique sources.
- Stored detail: one per invocation; 404 counted and skipped; 429/timeout/5xx
  persist backoff without moving page/item; repeated pages stall, not exhaust.
- Crash after evidence commit/before cursor commit retries idempotently and skips
  already durable detail. Consent revocation between index/detail blocks detail.
- Browser orchestration fixtures verify explicit resume, >=7-second spacing,
  persisted backoff, pause/unmount/error/completion stop and safe localStorage fallback.
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
