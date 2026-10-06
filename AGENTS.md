# Repository instructions

## Product boundary

- Build VALORANT Squad Analytics as a transparent community performance dashboard for a private friend group.
- Never describe the score as MMR, Elo, official rank, or a replacement for Riot's ranked system.
- Preserve the GitHub Pages demo during TASK-API-02 migration. Production may use a thin Vercel backend, but no API key or Henrik DTO may enter the deployed frontend.
- TASK-API-02.1 is the completed evidence checkpoint. Normal players provide only Riot Game Name, Tag, affinity and explicit consent. The site operator holds one `HENRIK_API_KEY` server-side; never ask players for provider credentials or Riot authentication secrets.
- Do not copy Riot, VALORANT, VLR, or third-party visual assets or page designs.

## Technology

- Use React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.
- Keep data types, raw statistics, derived statistics, normalization, scoring weights, and UI in separate modules.
- Never place scoring logic directly inside React components.
- Prefer strict TypeScript and small, testable functions.

## Data and scoring

- Keep every derived metric transparent and document its formula in `docs/SCORING.md`.
- Treat sample-size confidence separately from performance scores.
- Handle missing advanced statistics without breaking scoring.
- Use role-aware comparisons so the system does not automatically favor Duelists.
- When scoring logic changes, update documentation and add or update tests in the same change.

## Required verification

- Before declaring work complete, run `npm run lint`, `npm test`, and `npm run build` when those scripts exist.
- Report the exact verification results and any skipped or unavailable checks.
- Do not claim a check passed unless it was run successfully in the current worktree.

## Git and security

- Use small, focused commits and preserve unrelated user changes.
- Never commit secrets, credentials, API keys, `.env` files, generated logs, or private player identifiers.
- Keep the rollback deployment compatible with the repository subpath on GitHub Pages while making the selected Vercel deployment work at `/`.
- Do not rewrite history or force-push unless the user explicitly asks.

## Current stage

### AUTHORITATIVE STATUS (updated 2026-10-05 — this table wins over every older line below)

| Task | Status |
|---|---|
| DATA-05A persistent scheduled sync | PRODUCTION ACTIVATED / ACCEPTED (cron enabled) |
| DATA-03B.1 history pagination | COMPLETE / ACCEPTED |
| DATA-03B.2A scope engine | COMPLETE / ACCEPTED |
| DATA-03B.2B server analytics (`view=analysis`) | COMPLETE / ACCEPTED |
| TASK-DATA-03B.2C no website match-count ceiling / scalable full-tracked analytics | COMPLETE / ACCEPTED (2026-10-06; server-analysis-v2, selection-summary-v1; 300 = transport-only; generic 2000 cap REMOVED; no migration) — see docs/FULL_TRACKED_ANALYTICS.md |
| TASK-DATA-SEASON-01 season evidence | COMPLETE / ACCEPTED (Act data available; coverage partial and dynamic) |
| TASK-PROGRESS-01 Adaptive Improvement Index | COMPLETE / ACCEPTED (2026-10-06; improvement-index-v1) — see docs/PROGRESS_INDEX.md |
| TASK-DATA-FASTSYNC-01 opportunistic recent refresh | COMPLETE / ACCEPTED (2026-10-06; recent-refresh-v1) — see docs/FAST_RECENT_SYNC.md |
| TASK-DATA-FASTSYNC-02 sub-daily scheduled recent sync | NOT STARTED / OPTIONAL FUTURE |
| TASK-DATA-FASTSYNC-01.1 known-boundary fast path | DEFERRED |
| TASK-IDENTITY-01 member / multi-account identity | COMPLETE / ACCEPTED (2026-10-06; member-identity-v1, schema 5, migration 0008) — production 9 members × 1 account, 0 merges; see docs/MEMBER_IDENTITY.md |
| TASK-IDENTITY-01B community names + nickname | COMPLETE / ACCEPTED (2026-10-06; member-identity-v2, schema 6; migrations 0009 + one-time data migration 0010) — production 9 members × 1 account, 9 approved community names, nicknames unset, 0 merges |
| TASK-ADMIN-01 authenticated browser administration | NOT STARTED (no public edit endpoint until then) |
| TASK-WEAPON-01 member-level weapon analytics | COMPLETE / ACCEPTED (2026-10-06; weapon-analytics-v1; no migration) — see docs/WEAPON_ANALYTICS.md |
| TASK-WEAPON-01.1 Warden catalog correction | COMPLETE / ACCEPTED (2026-10-06; weapon-catalog-v2: Warden → Rifle per Riot Patch 13.06; classification only) |
| TASK-DATA-FASTSYNC-01.2 FASTSYNC UI navigation regression test repair | NOT STARTED |
| TASK-SECURITY-02 dependency audit drift reassessment | COMPLETE / SECURITY DISPOSITION ACCEPTED (2026-10-06): full audit 7 (5 high GHSA-vfj7 → SEC-2026-001 original subset only; 2 moderate GHSA-rj75 → SEC-2026-002, review 2026-11-03); source-map-js GHSA-68fv FIXED; production audit 0 — see docs/SECURITY_EXCEPTIONS.md |
| TASK-SECURITY-03 Tailwind 4 / build toolchain security migration | NOT STARTED — needs explicit authorization |
| TASK-DATA-BULK-01 multi-account bulk historical backfill accelerator | IMPLEMENTED / CANARY PASSED (2026-10-06; bulk-history-v1; 12 charged / 10 actual provider requests; 2 lanes default) — see docs/BULK_HISTORY.md |
| TASK-DATA-BULK-01A production bulk crawl Phase 1 | EVIDENCE ACCEPTED / STOPPED ON PROVIDER 429 (2026-10-06): 84 charged / 77 actual provider requests; tracked 213 → 332 — see docs/BULK_HISTORY.md |
| TASK-DATA-BULK-01B bulk crawl Phase 2 (2 lanes / 6 RPM) | STOPPED / BLOCKED (2026-10-06): first DATABASE_ERROR after 53.6 min, zero 429; 311 charged provider requests; tracked 332 → 671; oldest 2025-01-25; root cause NOT VERIFIED — see docs/BULK_HISTORY.md |
| Full-tracked analysis latency (≈ 10 s at 671 matches, linear) | RISK — must be addressed before ~4,000 tracked matches (60 s limit); never by sampling or a cap |
| TASK-SCORING-RANK-01 | NOT STARTED |
| TASK-DATA-PERFORMANCE-SCORE-01 official Performance Score evidence | AUDIT COMPLETE / PHASE B BLOCKED (2026-10-06): provider field NOT VERIFIED (outcome D); `stats.score` = legacy combat-score total → ACS_SAFE; nothing ingested — see docs/PERFORMANCE_SCORE.md |
| TASK-SCORING-SHARED-MATCH-01 shared-match relative rating | NOT STARTED |
| TASK-DATA-RANK-01 rank ingestion | NOT STARTED (rank stays optional) |
| DATA-04B Riot provider / RSO | DEFERRED |
| Riot ticket #139243830 | OPEN — informational / non-blocking |
| TASK-RELEASE-01 / V1 | PAUSED / NOT YET RELEASED (production SQL health check NOT VERIFIED is a release gate) |

The dated bullets below are a chronological log. Status words inside them describe the moment
they were written; lines marked **[SUPERSEDED]** must not be read as current state.

### Dated stage log

- TASK-DATA-PERFORMANCE-SCORE-01 (2026-10-06, SDD STRICT): rules.
  - Never treat Henrik `stats.score` as Performance Score, and never reuse `match_participants.score` for it.
  - Never approximate or reconstruct the official score, and never set missing values to 0.
  - Never feed Performance Score into community-score-v2, Progress or Synergy without a separate scoring task.
  - The provider audit stays production-disabled; the `performance-score` mode is shape-only (≤ 2 logical requests).
  - Re-run the shape audit before trusting any provider release that changes match-player stats.
  - Read docs/PERFORMANCE_SCORE.md first.

- TASK-DATA-03B.2C (2026-10-06, SDD STRICT) — COMPLETE / ACCEPTED. Rules:
  - The REAL website has NO match-count product ceiling.
  - `datasetWindowSize=300` is a transport bootstrap only. Never use it, or `boundedMatchLimit`, as an
    analytics or history population.
  - `view=analysis` is `server-analysis-v2`. It aggregates the FULL feature population server-side in
    chunks, with the same src/ functions (`selection-summary-v1`, duo-synergy-v1), and ships only
    aggregates plus bounded-window matches.
  - Never reintroduce a population cap, sample 全部已追蹤, load all history into the browser, or mark
    `populationComplete` true without full evidence.
  - Filter options and Dashboard counts come from all-tracked `view=analytics` facets (identifier-free).
  - Read docs/FULL_TRACKED_ANALYTICS.md before changing analytics populations or payloads.

- TASK-DATA-BULK-01 (2026-10-06, SDD STRICT): `bulk-history-v1` = `npm run history:bulk` (scripts/bulk-history.ts,
  scripts/bulk/). Rules:
  - Local maintainer controller only. It calls only the existing public dataset and sync start/continue/status routes.
  - Never add secrets, DB access, provider calls, admin or bulk endpoints, new functions, or raised rate limits.
  - Never import it from src/api/server/shared.
  - Plan mode (0 POSTs) is the default. Execute needs a selector and a finite --max-provider-requests.
  - ≤ 2 lanes, never two requests per account, ≤ 8 provider requests per minute.
  - Never run the full crawl or leave a worker running without explicit authorization. Read docs/BULK_HISTORY.md first.

- TASK-SECURITY-02 (2026-10-06): never reuse a SEC record beyond its exact findings. Every advisory maps to FIXED,
  TEMPORARILY ACCEPTED (exact SEC id) or BLOCKING. Production audit must stay 0. Never force-fix, override, patch
  node_modules or suppress audit output. A Tailwind 4 migration needs TASK-SECURITY-03 authorization.

- TASK-WEAPON-01.1 COMPLETE / ACCEPTED (2026-10-06): `weapon-catalog-v2` adds Warden as a Rifle firearm (Riot
  VALORANT Patch Notes 13.06). Classification only: never change weapon-analytics-v1 formulas or durable evidence
  for catalog fixes, never guess provider weapon ids, and keep unknown names and abilities as Other. Bump the
  catalog version for any classification change.

- TASK-WEAPON-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `view=analysis&feature=weaponAnalytics`
  (same function). Two separate evidence domains: round weapon observation (`round_participants.weapon_*`)
  and kill weapon (`kill_events.weapon_*`); never publish cross-domain efficiency or per-weapon
  HS%/ADR/damage/accuracy/attack-defense (no durable evidence). Member-level union across eligible accounts
  via the shared `activePlayers`; collisions withheld. ALL TRACKED/ACT = aggregate SQL over all eligible
  history (no snapshot, no 2000 cap); CURRENT = currentStrength selection. Descriptive only — never feed
  scores/Progress/Synergy without a separate authorized task. Read docs/WEAPON_ANALYTICS.md first.

- TASK-IDENTITY-01B COMPLETE / ACCEPTED (2026-10-06): the 9 approved community names were applied by the
  one-time fail-closed data migration 0010 through the normal Vercel migration path; DATABASE_URL was
  never retrieved. Never re-apply names in build logic; later edits use `member:admin`.
- TASK-IDENTITY-01B (2026-10-06, SDD STRICT): `members.display_name` = primary community name;
  `members.nickname` = optional second name of the PERSON (NULL = unset, never ''). The Riot
  `GameName#Tag` stays on the account. Names are presentation only: never ids, routes, analytics
  keys or sort keys.
  - Schema 6 / `member-identity-v2`, migration 0009.
  - All edits are maintainer-only via `npm run member:admin`; never add a public edit endpoint.
  - The approved name mapping lives in `ops/community-names-2026-10-06.json`; apply it only with
    `plan-names` then `apply-names --confirm`, using exact matching.
  - Never invent nicknames. Read docs/MEMBER_IDENTITY.md (naming model) first.

- TASK-IDENTITY-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): public `Player` = MEMBER (person);
  `players` rows are Riot ACCOUNTS. Human fact: the 9 current accounts are 9 different people.
  Never merge them and never infer alts; there is no heuristic linking.
  - Migration 0008 is append-only: deterministic 1:1 backfill reusing account ids/public ids, plus
    a BEFORE INSERT trigger that gives each new account its own member.
  - Consent, provider identities, sync (including FASTSYNC), deletion and match participants stay
    account-scoped; analytics merge member evidence before scoping/scoring.
  - Schema 5 / `member-identity-v1`. Same-match member collisions are withheld, never summed.
  - Account linking is maintainer-only (`npm run member:admin`, `--confirm`) and fails closed on
    coappearance. Never add a public admin API or a member picker on Connect.
  - Member names are `legacy_account` until the maintainer assigns community names
    (TASK-IDENTITY-01B); a Riot rename never changes a member name.
  Read docs/MEMBER_IDENTITY.md before changing identity, visibility or aggregation.

- TASK-DATA-FASTSYNC-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `recent-refresh-v1`.
  `POST /api/valorant/sync/start` with `intent: refresh_if_stale` (incremental only; no new
  function). Freshness is the incremental cursor's `last_success_at`; the server-only 30-minute
  threshold is never client-supplied. Leases, backoff and consent stay authoritative, and the
  cursor version is re-checked under the lease row lock (race-safe). At most one chunk per action,
  page size 3; paused runs continue without the cooldown. The Profile auto-refreshes once per
  player per tab plus a manual 更新戰績 button; only Profile triggers it, never Dashboard,
  Leaderboard or Matches. Demo has no control and no API calls. Cron schedules are unchanged
  (daily). No migration; `trigger_kind` stays `manual`. Read docs/FAST_RECENT_SYNC.md before
  changing it.

- TASK-PROGRESS-01 COMPLETE / ACCEPTED (2026-10-06, SDD STRICT): `improvement-index-v1` /
  `improvement-benchmarks-v1` / `feature-scope-policy-v2`. Profile-only signed −100..+100
  progress metric via `view=analysis&feature=improvementIndex`; separate confidence; overall
  confidence < 0.25 shows no value or direction. Rank is optional and never fabricated. It never
  reorders the ranking, and Score/Synergy formulas are unchanged. No migration; nothing persisted.
  Cross-Act fallback is fixture-verified only. Read docs/PROGRESS_INDEX.md before changing it.

- TASK-DATA-03B.2B COMPLETE / ACCEPTED (2026-10-05, SDD STRICT): analytics pages consume
  `GET /api/valorant/dataset?view=analysis` (`server-analysis-v1`). Clients declare only a
  feature plus context. The server runs the SAME src/ scope engine over ALL eligible durable
  history (phase 1 lightweight observations, phase 2 full projection for selected matches only)
  and the browser runs the unchanged scoring/Synergy code. The newest-300 snapshot stays the
  bootstrap but is not an analytics boundary. Never let a failed analysis request substitute
  another scope. LIFETIME/ACT/PAIR phase 2 is capped at 2000 with a disclosed reason. Read
  docs/SERVER_ANALYTICS.md before changing analysis populations. TASK-PROGRESS-01 is DESIGN ONLY [SUPERSEDED: COMPLETE / ACCEPTED, see status table];
  TASK-DATA-RANK-01 is NOT STARTED.

- TASK-DATA-SEASON-01 COMPLETE / ACCEPTED (2026-10-05, SDD STRICT): match season evidence from Henrik v4
  `metadata.season` / Stored `meta.season` is normalized and persisted to existing
  `source_matches.season_id/season_short` (no migration). Missing/invalid never erases; a valid
  later value corrects. `season_id` is server-only; the browser gets only a recognized public
  `seasonKey`. Stored rows may fill season ONLY for already durable, participant, consented
  matches. Never claim the current official Act. Read docs/SEASON_EVIDENCE.md before changing
  season handling. [SUPERSEDED: at that time TASK-DATA-RANK-01, TASK-PROGRESS-01 and DATA-03B.2B were NOT STARTED; see status table.]

- TASK-DATA-03B.2 (2026-10-05, SDD STRICT) is redefined as the **Context-Aware
  Analytics Scope Engine**; the earlier "all-history analytics" definition is
  superseded. DATA-03B.2A is COMPLETE: `analysis-scope-v1`, `feature-scope-policy-v1`
  (single registry in `src/analytics/scope/policies.ts`), deterministic
  `adaptive-window-v1`, and `view=analytics` aggregate facts. Pages never select windows
  themselves: everything goes through `selectPerformances` -> `resolveScopeSelection`.
  Score pages default to 目前實力 (adaptive, Competitive); maps/agents/matches default to
  全部已追蹤. No fallback across horizons. [SUPERSEDED: Act evidence was UNAVAILABLE at that time; TASK-DATA-SEASON-01 now persists it.] Rank is UNAVAILABLE (never ingested). Do not guess Acts, hardcode season
  dates, claim the current official Act, or invent rank. [SUPERSEDED: DATA-03B.2B, TASK-DATA-SEASON-01 and TASK-PROGRESS-01 have since been authorized; see status table.]
  TASK-DATA-RANK-01 is NOT STARTED and needs explicit authorization. Score/Synergy formulas are unchanged. Read docs/ANALYTICS_SCOPES.md
  before changing any analytical population. DATA-03B.1 COMPLETE / ACCEPTED.

- TASK-DATA-03B.1 (2026-10-05, SDD STRICT): bounded keyset history runtime is
  implemented as `GET /api/valorant/dataset?view=history` (`dataset-history-v1`,
  same function — 12-function Hobby limit). Default schema 4 newest-300 snapshot is
  unchanged. Signed position-only cursor; every page re-evaluates current consent;
  `trackedMatchCount` = eligible durable matches, never Riot lifetime;
  lifetimeComplete=false. History is BROWSE-ONLY on the Matches page. [SUPERSEDED: analytics now use server
  history via DATA-03B.2B, not the newest-300 snapshot.] No migration. Read docs/TASK_DATA_03B_PLAN.md before changing
  history pagination. DATA-05A remains PRODUCTION ACTIVATED / ACCEPTED.

- DATA-05A activation continuation: existing Vercel CLI/project authentication
  verified; production-only sensitive CRON_SECRET configured. Nine public players
  are maintainer-confirmed expected activity. Daily cron registration/canaries
  are verified: both one-shot canaries passed; DATA-05A is PRODUCTION ACTIVATED /
  ACCEPTED. Recurring eligible consenting-player acquisition is authorized.
  Sources 50→56, provider requests +2; lifetimeComplete=false. No Riot/RSO or V1 release.
  [SUPERSEDED: "No DATA-03B" — DATA-03B.1/2A/2B have since completed.] See docs/PERSISTENT_SYNC.md for evidence/limitations.

- Superseding human decision (2026-10-05): TASK-DATA-05A is ACTIVE — Tracker-style persistent scheduled sync. Maximize and retain observable Henrik history subject to consent/deletion; lifetimeComplete remains false. The Riot-response acquisition freeze below is historical and superseded. Ticket #139243830 remains OPEN / informational / non-blocking; DATA-04B is DEFERRED / NOT REQUIRED FOR CURRENT PRODUCT PATH. DATA-03A resumes as acquisition infrastructure; DATA-03B NOT STARTED [SUPERSEDED: completed later]. RELEASE-01 PAUSED FOR DATA-05A / DATA-03B; V1 NOT YET RELEASED. See docs/PERSISTENT_SYNC.md and docs/TASK_DATA_05A_PLAN.md. Secure production CRON_SECRET plus one recent and one historical passing canary gate recurring operation; if safe secret setting is unavailable, stop before cron activation. No Riot/RSO/application, player recreation, deletion, scoring/Synergy change or release authorization.

### Superseded governance checkpoint

- Current governance decision (2026-10-04): TASK-DATA-04A is **WAITING ON RIOT — ticket #139243830**, status **OPEN — WAITING FOR RIOT RESPONSE**. TASK-DATA-04B is **BLOCKED ON DATA-04A**. TASK-RELEASE-01 is **PAUSED**; V1 is **NOT YET RELEASED**. Preserve the full lifetime-history requirement and existing evidence; research completion is not official clarification or access approval. See `docs/LIFETIME_HISTORY.md` and `docs/TASKS.md`.
- Until the Riot clarification and a new explicit human gate: do not resume Henrik deep crawl, implement DATA-03A.2, start DATA-03B, implement DATA-04B/Riot provider/RSO, submit another Production/RSO application, call Riot or Henrik APIs, or change production data. The support inquiry is not a Production/RSO application. This current freeze supersedes continuation permissions in historical checkpoints below.

### Historical checkpoints (not new execution authorization)

- DATA-03A implementation is complete, initial CI/Pages/Vercel deployment and normal-path migration 0007 verified. Final local gates: 339 tests, lint/build, 16 DB checks, production audit zero; full audit retains the five-high SEC-2026-001 disposition. This is NOT production deep-crawl acceptance: bounded/full provider execution remains gated and NOT STARTED. Deployment success never grants crawl approval.

- TASK-DATA-03A is authorized under SDD STRICT: implement/deploy `deep-history-v1`, separate `deep_backfill`, and append-only migration 0007 through the normal Vercel build path. Read `docs/DEEP_HISTORY.md` before changing this boundary. Preserve legacy cursors and migrations 0001–0006. Production deep start/continue, bounded provider validation and full P1/P2 crawl require a separate explicit human gate: DO NOT execute them on deployment. Production crawl NOT STARTED. Public schema 4/newest-300 read unchanged; TASK-DATA-03B NOT STARTED. RELEASE-01/01A PAUSED FOR DATA-03; V1 NOT YET RELEASED. Prior diagnosis and SEC-2026-001 are historical evidence, not release/repair/delete/crawl authorization. No scoring/Synergy change.

- TASK-RELEASE-01A.3 security disposition is complete under SEC-2026-001, but final production acceptance is ON HOLD: after its documentation push, read-only dataset GET showed two players / seventeen matches instead of the authorized one / ten. Cause NOT VERIFIED. This supersedes the historical one-player/ten-match state below. RELEASE-01A remains IN PROGRESS / ON HOLD until human confirmation and revised read-only acceptance scope. Do not repair, reimport, sync, delete or rerun production health SQL; no provider calls or data writes are authorized. No release level or v1.0.0. See `docs/RELEASE_V1.md`.

- TASK-SYNERGY-01 and TASK-UI-01 acceptance are COMPLETE. TASK-RELEASE-01A.2 Option A is COMPLETE: schema 4 / dataset-read-v4 / evidence-decoupled-projection-v1, historically Public REAL ready with one visible player and ten basic matches. KAST/Opening remained partial without values; event engine and scoring/Synergy formulas are unchanged. Read-only production relational, migration, consent, sync and deletion checks passed on 2026-10-03 for that historical fixture. TASK-RELEASE-01A.3 dispositions five unpatched dev/build-only high audit findings under SEC-2026-001; production audit is zero. Review expires 2026-11-03 or on an earlier upstream fix. See `docs/SECURITY_EXCEPTIONS.md` and TASK-SECURITY-01; re-evaluate changed advisory scope, imports, runtime promotion or input boundaries. Remote function-artifact bytes remain NOT VERIFIED; all application API closures show no affected dependency/input path. RELEASE-01 remains IN PROGRESS; V1 NOT YET RELEASED. Do not perform provider calls, writes, release levels or tags without new explicit authorization. Non-empty two-player Synergy remains NOT VERIFIED. Older checkpoint descriptions below are historical; see the acceptance hold above for the current fixture. See `docs/RELEASE_V1.md`.

- TASK-DATA-01A, TASK-DATA-01B, TASK-DATA-01C and TASK-DATA-02 are complete. TASK-METRICS-01 is complete; migration 0006, CI and deployments are verified. The non-empty production advanced-metric path remains NOT VERIFIED. Vercel is the PUBLIC REAL canonical runtime: exact server-only `REAL_DATASET_READ_MODE=public` exposes only the bounded sanitized dataset without viewer authentication; every other value fails closed. GitHub Pages remains Demo-only. Current public consent policy is `2026-10-02-public-v1` from `shared/privacyPolicy.ts`; only an active `self_asserted` consent on that exact version authorizes provider writes or public visibility. The explicitly approved DATA-01C validation revoked and deleted the former production test player on 2026-10-01; do not repeat that operation or infer approval for another player. Any future destructive revocation still requires the explicit human approval gate in `docs/REVOCATION_AND_DELETION.md`. TASK-METRICS-01 introduced `event-metrics-v1`, `durable-evidence-v2`, public schema 2 and migration `0006`, but no new score or weight. TASK-002B is explicitly authorized and implementation is complete: community-score-v2, community-benchmarks-v1, overall-profile-v1. Preserve evidence-aware missing/partial semantics and aggregate-only traces. TASK-SYNERGY-01 is explicitly authorized and implemented; release acceptance is recorded in docs/TASK_SYNERGY_01_PLAN.md. Public schema is now 3 / dataset-read-v3 / synergy-ready-projection-v1. duo-synergy-v1 and duo-synergy-benchmarks-v1 remain separate pair-level association, not a ninth dimension. Non-empty production Synergy is NOT YET EXERCISED; no new migration, provider call or player reconnect. Read docs/SYNERGY.md before changing pair boundaries. Do not begin TASK-UI-01 implicitly. Read `docs/DATABASE.md`, `docs/HISTORICAL_SYNC.md`, `docs/REVOCATION_AND_DELETION.md`, `docs/REAL_DATA_FIELD_AUDIT.md`, `docs/DATASET_RUNTIME.md`, `docs/METRICS_RECONSTRUCTION.md`, `docs/CODE_MAP.md`, `docs/PRODUCTION_ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/TASKS.md` before changing data, synchronization, provider, reconstruction or scoring boundaries.
- Keep `DATABASE_URL`, `IDENTIFIER_HMAC_KEY`, provider identifiers and raw match IDs server-only. Never run migrations from browser code or return database/provider identifiers through public APIs.
- A public player/job UUID never authorizes revocation or deletion. Keep consent-management plaintext only in the consenting browser, store only the domain-separated HMAC server-side, and never put the credential in URLs, logs, Git or completion reports.
- Never treat stored-match results as complete lifetime history. Persist coverage windows, evidence availability and derivation versions explicitly.
- Keep display rounding in `src/utils/format.ts` and `src/analytics/presentation.ts`; do not reduce calculation precision to format UI values.
- Stay within the requested task. Record later ideas under the roadmap instead of silently expanding scope.
