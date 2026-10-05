# Authoritative lifetime history feasibility

## Superseding product decision — DATA-05A, 2026-10-05

The human explicitly selected Tracker-style persistent Henrik accumulation instead
of waiting for authoritative lifetime proof. The research below is preserved,
but its acquisition/release blocker is superseded. Ticket #139243830 remains OPEN —
WAITING FOR RIOT RESPONSE, informational/non-blocking (no fresh ticket query).
DATA-04B deferred/not required for current product path. lifetimeComplete=false.
See PERSISTENT_SYNC.md; DATA-03B not started, RELEASE-01 paused for DATA-05A / DATA-03B,
V1 not released. No Riot/RSO/application or destructive authorization.

TASK-DATA-04A — SDD STRICT. Research date: 2026-10-04.
Status: **WAITING ON RIOT — ticket #139243830**. Docs-only research is complete; official clarification remains pending.
Starting repository HEAD: `8ffe12e15544fd03eb53879341a867a6c6d9febe` (clean `main`, equal to `origin/main`).

## Current governance — Riot clarification pending (2026-10-04)

[Riot Developer Support ticket #139243830](https://support-developer.riotgames.com/hc/en-us/requests/139243830): **OPEN — WAITING FOR RIOT RESPONSE**, as confirmed by the maintainer for this governance update. No live ticket query was performed in this update.

Questions submitted:

1. Whether VAL-MATCH-V1 guarantees full lifetime match history.
2. Pagination, retention/window limits and missing-match semantics.
3. Eligibility of a private friends/community analytics product.
4. Required order and prerequisites for Production API access and RSO.

The inquiry was submitted, not a Production/RSO application. Do not submit another Production/RSO application until Riot clarifies the required sequence. Do not resume Henrik deep crawl, implement DATA-03A.2, start DATA-03B, implement DATA-04B/Riot provider/RSO, call Riot or Henrik APIs, or change production data. TASK-DATA-04B is **BLOCKED ON DATA-04A**; TASK-RELEASE-01 **PAUSED**; V1 **NOT YET RELEASED**. Research findings and the application draft below are preserved, not official answers or permission to proceed.

Governance-update verification (2026-10-04): `npm run lint` exit 0; `npm test` exit 0, 23 files / 339 tests passed in 56.89s, source secret boundary passed; `npm run build` exit 0, 712 modules, Vite build 9.86s, dist secret boundary passed; `git diff --check` passed. Changes are limited to AGENTS.md and the four governance documents. Audit/DB/browser checks were not repeated for this status-only update. No live provider calls, production reads/writes, push or deployment were performed.

## Hard requirement and acquisition freeze

**FULL LIFETIME MATCH HISTORY** means the player's earliest actual VALORANT match through the latest match, with no known missing matches. A returned window, latest 300, exhausted provider, or all currently discoverable records does not satisfy this requirement. Queue/platform exclusions cannot silently narrow it.

This decision supersedes earlier continuation permissions: do not execute DATA-03A.2, P1/P2 continuation, Henrik live/stored/detail calls, Riot game API calls, production writes, DATA-03B, release levels A/B/C, or v1.0.0. No code, credentials, migrations, provider calls or production writes are part of DATA-04A. Reading public documentation is not a player-data API call.

Preserve DATA-03A.1's recorded post-stop state: two consenting players, 30 unique durable source matches; P1 paused, P2 failed after `provider_repeated_page`, neither source exhausted, `lifetimeComplete=false`. These are historical verified aggregates from [DEEP_HISTORY.md](DEEP_HISTORY.md), not a new production database query.

## Decision

Primary **OUTCOME D — FULL_LIFETIME_HISTORY_NOT_PROVABLE_WITH_CURRENT_AVAILABLE_SOURCES**.

- Riot lifetime guarantee: **NOT DOCUMENTED** in the official material reviewed below. Absence of documentation is not proof that Riot has no older records.
- Can `lifetimeComplete=true` currently be proven? **NO**, especially because proof condition G is unavailable.
- Conditional B: approved Riot access could provide official history, but neither more matches than Henrik nor lifetime completeness is verified.
- Access gate: no operational official integration exists in this repository. Actual Riot Portal production/RSO approval is **NOT VERIFIED**; do not infer that the maintainer has no approval.
- Full lifetime verified remains an unmet hard requirement, not a renamed smaller feature.

## Primary sources and research method

Reviewed 20 search results across endpoint/limit, retention, and access/routing questions; accepted only Riot-owned documentation for Riot capability/policy conclusions. Read the rendered endpoint reference because its general API landing page did not expose the endpoint schema to text extraction. Community reports and League of Legends match-history limits are not VALORANT authority.

1. [VAL-MATCH-V1 endpoint reference](https://developer.riotgames.com/api-details/val-match-v1), also [interactive matchlist reference](https://developer.riotgames.com/apis#val-match-v1/GET_getMatchlist).
2. [VALORANT developer policy and RSO](https://developer.riotgames.com/docs/valorant).
3. [Developer Support VALORANT policy](https://support-developer.riotgames.com/hc/en-us/articles/22698769097107-VALORANT).
4. [Riot developer FAQ](https://developer.riotgames.com/docs/faqs).
5. [Developer Portal / rate limiting](https://developer.riotgames.com/docs/portal).
6. [OAuth client documentation](https://support-developer.riotgames.com/hc/en-us/articles/22897607341075-OAuth-Client-Documentation).
7. [Requesting Your Account Data](https://support-valorant.riotgames.com/hc/en-us/articles/31857321662995-Requesting-Your-Account-Data).

All sources accessed 2026-10-04. NOT DOCUMENTED means no supporting contract was found in these sources; NOT VERIFIED means no current project-specific operational evidence was obtained. Neither is an invented negative guarantee.

## VAL-MATCH-V1 capability matrix

The [official reference](https://developer.riotgames.com/api-details/val-match-v1) documents:

| Question | Official finding / limit of evidence |
| --- | --- |
| Matchlist | `GET /val/match/v1/matchlists/by-puuid/{puuid}`; description: "Get matchlist for games played by puuid". This is not an explicit lifetime contract. |
| Request parameters | Required path `puuid` string only. No documented query parameters. |
| Response | `MatchlistDto`: `puuid`, `history`; entries contain `matchId`, `gameStartTimeMillis`, `queueId`. |
| Routing | Reference options AP, BR, ESPORTS, EU, KR, LATAM, NA. Select the validated VAL shard, not an ACCOUNT-V1 regional cluster. ESPORTS is not a normal-account fallback. |
| Authentication | API-key authorization is documented; future implementation must use a server-side header rather than a query key. An RSO access token identifies the consenting account; it is not documented here as a replacement for the VAL API key. |
| Production access / RSO | VAL player-data applications require approved Production access and RSO opt-in; see policy below. |
| Pagination | **NOT DOCUMENTED**: no `start`, `count`, page, cursor, date or range parameter. Do not invent LoL-style pagination. |
| Page size / maximum | **NOT DOCUMENTED**. No supported fixed match-count limit can be claimed from this reference. |
| Queue filter | No matchlist queue filter documented. Entry `queueId` is metadata, not a request filter. The separate recent-matches-by-queue endpoint does not enumerate a player's lifetime. |
| Oldest obtainable match | **NOT DOCUMENTED**: no earliest-account boundary or first-match retrieval contract. |
| Retention / history window | **NOT DOCUMENTED** for this player matchlist. Do not transfer another game's retention rules or the recent-matches endpoint's short window. |
| Ordering / stability | **NOT DOCUMENTED**. A displayed array does not establish immutable ordering or snapshot consistency. |
| Total count | No total field documented; returned array length is not lifetime total. |
| Beginning / end cursor | No cursor or authoritative beginning/end marker documented. |
| Lifetime guarantee | **NOT DOCUMENTED**; no explicit every-match-from-inception guarantee found. |
| Match details | `GET /val/match/v1/matches/{matchId}`, required path `matchId`; response includes match information, players, coaches, teams and round results. Actual project retrieval **NOT VERIFIED**. |
| Missing / deleted details | Detail reference documents 404 Data Not Found. Whether a matchlist can include a subsequently deleted/unavailable detail is **NOT DOCUMENTED**; do not assume every listed ID is always obtainable. |
| Cross-platform / all-mode coverage | Coverage of every actual match across console/PC, custom and other modes is **NOT DOCUMENTED** for this proof. Must resolve before claiming the user's full scope. |

### Rate limits and failure behavior

[Portal documentation](https://developer.riotgames.com/docs/portal) describes generic starting Production application limits of 500 requests/10 seconds and 30,000/10 minutes, enforced per region. These are not this project's granted limits or a confirmed VAL method quota. Application, method and service limits must all be respected. Future acquisition must inspect rate-limit headers, honor `Retry-After` on 429, bound retries, and stop on unauthorized access. Generic 404 does not distinguish temporary from permanent absence and is not an authoritative earliest-history marker. No game request was made to verify any project-specific limit.

## Riot access and product policy

[VALORANT policy](https://developer.riotgames.com/docs/valorant), [current support policy](https://support-developer.riotgames.com/hc/en-us/articles/22698769097107-VALORANT), [FAQ](https://developer.riotgames.com/docs/faqs) and [OAuth documentation](https://support-developer.riotgames.com/hc/en-us/articles/22897607341075-OAuth-Client-Documentation) establish:

- VALORANT Personal Key applications are not supported. Generic development-key guidance is not evidence of VAL player-data access.
- A Production application must be approved before RSO onboarding; a separate approved OAuth app/client is also required. Production key and RSO approval are distinct gates.
- Player-data apps require RSO identity/opt-in. Show only players who opt in and explain that linking makes relevant data public. Do not expose non-opted players or deliberately hidden identities.
- Products serving players must be registered even when not using official APIs. Current product registration status is **NOT VERIFIED**.
- Self-history/training/statistics and opted-in community use cases can be eligible, but this exact scoring/community-leaderboard use case needs Riot review. No opponent scouting, live gameplay advantage, gambling or substitute MMR/Elo.
- **Material eligibility conflict:** current project governance/brief describes a private friend-group dashboard. Riot excludes apps designed for personal-only, non-public use. A public URL is not itself evidence of an eligible public use case. The maintainer must clarify eligibility with Riot or honestly authorize a different public product scope; this task does not change that scope.
- FAQ expects a functioning demonstrable product and Terms of Service/Privacy Policy; source code alone is insufficient. Mockups/screenshots/video can demonstrate a future integration. Domain ownership verification may be requested after application; none was performed here.

## Current repository integration audit

Inspection used tracked code/configuration templates only. No actual `.env`, secrets, Portal key screen, token value or account authorization status was inspected.

| Capability | Current evidence |
| --- | --- |
| Riot provider | `src/dataSources/riot/RiotDataSource.ts` is a future placeholder that throws instead of returning an official dataset; not an operational provider. |
| Official DTO types | `src/dataSources/riot/dto.ts` has preparatory interfaces, not validated official normalization or a full production contract. |
| Actual server provider | Existing server integration is Henrik (`server/henrikDataProvider.ts`). |
| Riot production configuration | No tracked operational Riot API-key configuration support found. `.env.example` supports the current Henrik/database runtime, not Riot. Actual Portal approval **NOT VERIFIED**. |
| RSO implementation / client ID | No operational RSO flow or tracked client-ID configuration found. |
| Callback route | No Riot OAuth start/callback route in current API inventory. |
| Official PUUID flow | No authenticated ACCOUNT-V1 ownership resolution implemented. Riot ID entry plus `self_asserted` consent does not prove ownership. |
| Token storage | No official OAuth token model/rotation implemented. Existing nullable encrypted provider identity slots are unused, not functioning secure token storage. |
| Consent schema | Future `riot_rso_verified` enum support does not activate a flow. Current service policy requires `self_asserted` on `2026-10-02-public-v1`. A future policy/gate change requires separate review. |

**RIOT PRODUCTION ACCESS STATUS = NOT VERIFIED.** Repository absence cannot determine external account approval.

## Riot account-data export

Result: **NOT DOCUMENTED** for VALORANT match history. The [official request page](https://support-valorant.riotgames.com/hc/en-us/articles/31857321662995-Requesting-Your-Account-Data) lists VALORANT voice-related records and purchase/store transactions, not match history. Match-history entries for other games must not be transferred to VALORANT. This is no documented export solution for the hard requirement, but is not an explicit guarantee that such data can never be supplied. No request was submitted or personal archive inspected.

## Henrik and existing Neon value

Henrik is **SECONDARY SOURCE ONLY** for lifetime reconciliation, not the authority proving condition G. [DEEP_HISTORY.md](DEEP_HISTORY.md) preserves mutable pagination, the observed `provider_repeated_page` hard stop, and stored-source limitations. Stored history may have holes; stored total is not Riot lifetime total; source exhaustion does not prove all actual matches. Do not discard existing data or continue crawling.

The 30 durable matches remain useful for current evidence-aware analytics, overlap checks and future reconciliation. Existing public player/match UUIDs, normalized evidence, provenance, consent and coverage must survive a future provider transition. Durable accumulation cannot reconstruct unknown earlier matches merely by collecting future ones.

## Lifetime completeness proof — proposed `lifetime-proof-v1`

All conditions must hold together for `lifetimeComplete=true`:

| Proof | Required evidence |
| --- | --- |
| A | Authoritative RSO-resolved player identity and validated shard/platform/queue scope. |
| B | Enumeration reaches an explicitly documented authoritative earliest boundary for the full scope. |
| C | Every enumerated ID has a durable ledger outcome, with no lost work. |
| D | Every obtainable detail is persisted and validated; unavailable details are recorded, not silently omitted. |
| E | Duplicates and cross-source identities are reconciled without unsupported merges. |
| F | No unresolved gaps, identity conflicts, omitted modes or unknown detail outcomes. A known missing actual match blocks the strict requirement even if its absence is explained. |
| G | An authoritative contract permits the claim that no earlier actual matches exist. |

G is currently **NOT DOCUMENTED**, so the flag MUST remain false. Empty/short results, stable counts, oldest observed timestamps, high match counts and provider exhaustion cannot substitute for G. A user remembering a first match is not authoritative enumeration evidence.

A future proof manifest should version source contracts and observation dates; record identity HMAC, scope, authoritative boundaries, enumeration fingerprints, distinct counts, detail/duplicate/gap ledgers and reconciliation decisions. Provider IDs remain server-only; public reports expose aggregates and limitations, not IDs/tokens. The proof must specify its latest cutoff and become stale when later matches are not accounted for. Revocation/deletion must also cover subject-linked manifests.

### Proposed completeness state machine — `history-completeness-v1`

| State | Meaning / entry condition |
| --- | --- |
| NOT_STARTED | No enumeration attempt within the versioned scope. |
| COLLECTING | Authorized bounded collection is in progress. |
| SOURCE_EXHAUSTED_NOT_VERIFIED | A source stop condition was reached, but no authoritative lifetime proof. |
| GAPS_DETECTED | Known missing detail, unresolved identity or enumeration gap. |
| AUTHORITATIVE_WINDOW_COMPLETE | All records in an explicitly documented authoritative window are reconciled; does not mean lifetime. Not currently proven. |
| LIFETIME_COMPLETE_VERIFIED | A–G all satisfied for the complete scope and latest cutoff. Currently unreachable with reviewed contracts. |
| UNVERIFIABLE_WITH_CURRENT_SOURCES | Available evidence cannot establish the required lifetime boundary/contract. Current feasibility conclusion. |

This is a proposed model, not a migration or alteration of current sync statuses. Operational failures such as `provider_repeated_page`, sample confidence and scoring evidence availability remain independent. A future source contract could unblock proof; accumulating more records alone cannot.

## Proposed source reconciliation (not implemented)

Use two independent axes rather than mixing provenance with detail status:

- Provenance: `RIOT_AND_HENRIK`, `RIOT_ONLY`, `HENRIK_ONLY`, `DURABLE_ONLY`. Record Henrik live/stored observations separately, with observation time and enumeration scope. Absence from a limited Riot result does not disprove an existing Henrik record.
- Detail: `DETAIL_AVAILABLE`, `DETAIL_UNAVAILABLE`, `UNRESOLVED`. A unavailable-detail response needs reason/time/retry eligibility and does not erase durable detail obtained earlier. Source expiry is not deletion of an actual played match.

Maintain a canonical durable match and server-only source-alias ledger; retain its existing public UUID. Existing `server/identityProtection.ts` fingerprints are provider-qualified (`source-match:v1:{provider}`), so Riot and Henrik fingerprints do not automatically deduplicate. Existing HMACs cannot be reversed into fetchable raw IDs. Equivalence of Riot/Henrik raw match-ID namespaces is **NOT VERIFIED**. Only after validating that equivalence may an incoming official ID be compared under the existing Henrik HMAC domain. Otherwise record an unresolved alias and require reviewed reconciliation; map/time/queue similarity alone is not sufficient proof.

Retain source observations and schema/normalizer versions. Resolve field conflicts explicitly, preferring verified authoritative fields only under a reviewed field-level rule; do not blindly overwrite round/event children or fabricate missing evidence. No automatic player merge, history reset or tombstone resurrection. Future schema/retention changes require separately approved append-only migrations and privacy review covering aliases, encrypted IDs, tokens, cursors and deletion/anonymization.

## Proposed DATA-04B architecture — conditional and blocked

`RiotOfficialProvider` is server-only and may be implemented only after eligibility/access gates are resolved. Browser flow:

`Connect Riot account → Riot RSO → callback → authoritative PUUID → separate explicit public consent → authorized history acquisition → durable Neon evidence → sanitized public projection`.

1. Start RSO with a bound, expiring server session and CSRF state, approved redirect URI and scopes. Exchange the one-use authorization code server-side using Riot's approved client configuration. Exact authentication/scopes/PKCE support must be confirmed during onboarding rather than invented here.
2. Proposed callback `/api/auth/riot/callback` accepts only the official short-lived code/state return, redacts query logging/analytics, validates state and immediately redirects to a clean URL. No long-lived credential, management credential or token goes into URLs, browser storage, logs or reports.
3. Use RSO Bearer authentication for `/riot/account/v1/accounts/me`; official OAuth documentation lists americas/europe/asia identity clusters with identical data. Resolve and validate the separate VAL shard through an approved official mechanism; never equate `asia` with every VAL routing region or infer scope from entered Riot ID.
4. Keep PUUID/recoverable IDs and any authorized refresh/access tokens encrypted server-side with reviewed key rotation/lifecycle. Use domain-separated HMACs for joins. No new secrets/storage are created in this task.
5. RSO proves authenticated identity, **not** consent to publish. Present a separate policy disclosure/explicit opt-in and preserve revocation/deletion management. No provider work/public visibility until active exact-policy consent and membership gates pass.
6. Use a Production key in server headers for VAL matchlist/detail, separate from RSO identity tokens. No Henrik DTO, Riot DTO, key or provider identifier reaches frontend bundles/public APIs. Preserve GitHub Pages Demo-only compatibility and current sanitized bounded projection; this does not start DATA-03B.
7. **Capability-gated enumeration:** current documented matchlist has no pagination. Do not implement invented `start/count` requests. A future adapter may paginate only if Riot documents/approves a pagination contract. Current conceptual cursor tracks a returned-ID snapshot fingerprint and pending detail-work index, not a fictitious older-history cursor. Repeated snapshots support bounded refresh, not proof of older discovery.
8. Enforce granted per-region application/method/service quotas, `Retry-After`, bounded jitter/backoff, leases, cancellation, and consent rechecks before every request/write/cursor commit. Stop on 401/403; ledger 404 as unavailable/unresolved, not earliest boundary; cap 5xx retries. No unbounded recovery loop.
9. Normalize validated official evidence through dedicated modules. Preserve missing/null semantics, derivation versions and evidence-aware scoring. Reconciliation/proof are separate from performance scores; no scoring/weight change is authorized here.

### P1/P2 identity-preserving future migration

Keep both existing players/history unchanged. A later account-linking operation must authenticate Riot ownership, explicitly authorize linking to the existing public player using its management flow, and verify the server-side identity correspondence; display-name similarity is not proof. Retain the public player UUID and canonical durable matches. A verified official identity alias can attach to the existing record only after conflicts are resolved; ambiguous matches require review, not duplication or silent merging.

Introduce a separately reviewed consent policy supporting `riot_rso_verified`; obtain fresh explicit public consent rather than auto-upgrading `self_asserted`. Switch current active consent transactionally only when all gates pass. Existing history/provenance remains intact. Refusal/failed verification leaves the old player preserved under current policy; it does not authorize deletion or resurrection. No migration is implemented now.

## Application readiness checklist

| Item | Current readiness |
| --- | --- |
| Public production URL | [哥布林大調查](https://valorant-squad-analytics.vercel.app/); current Privacy page loaded read-only in browser. |
| Working product | Existing deployed analytics product; this task checked Privacy only, not every route or a new release acceptance. |
| Privacy policy | Existing [Privacy page](https://valorant-squad-analytics.vercel.app/#/privacy) visibly explains public visibility, self-asserted consent and revocation. |
| Opt-in flow | Current self-asserted consent exists; official RSO opt-in **NOT IMPLEMENTED**. No connection submitted in this task. |
| Data usage explanation | Draft below; official integration/lifetime claims must remain conditional. |
| Account-linking mockup | Text flow above only; dedicated RSO screens/screenshots **NOT PREPARED**. |
| Callback design | Proposed above; not implemented/registered. |
| Public-stat disclosure | Current public disclosure exists; RSO linking disclosure requires policy/UX review. |
| Deletion/revocation | Existing documented production-validated flow from DATA-01C; not re-executed here. Future RSO/token/alias lifecycle needs extension. |
| Security architecture | Existing server-only credentials, HMAC and sanitized projection; encrypted RSO token/identity lifecycle remains future work. |
| Terms of Service | No public Terms route found in current routing inspection; must prepare/review before application. |
| Screenshots / demo | Existing live product can demonstrate current functionality; fresh application evidence and RSO mockup walkthrough **NOT PREPARED**. |
| Intended use case | Private friend-group scope conflicts with personal-only/non-public exclusion; Riot clarification/maintainer decision required. |
| Product registration / Production / OAuth approval | **NOT VERIFIED**, three separate external readiness questions. |

Not ready to assert completed official onboarding. No application submitted and no domain ownership challenge performed.

## Draft Production access application — NOT SUBMITTED

> Product name: 哥布林大調查 (Goblin Survey).
>
> Current purpose: consenting players inspect their own historical VALORANT statistics, community rankings, teammate analytics and transparent evidence-aware performance analysis. The current deployed project originated as a private friend-group dashboard. We request clarification whether this scope is eligible; a public URL alone does not change its intended audience. We will not describe it as an approved general-public service without an explicit product decision and your review.
>
> Current production URL: https://valorant-squad-analytics.vercel.app/. The current third-party integration uses server-side operator credentials and explicit self-asserted public consent. Riot ownership authentication is not implemented. Proposed official integration uses approved Riot Production access and RSO, followed by separate explicit public-data consent before acquisition or public visibility.
>
> We provide no opponent scouting, live gameplay advantage, gambling, or replacement MMR/Elo. Scores are transparent community metrics with missing-evidence and sample-size disclosures. Non-opted player identities are not published. Players are never asked to share passwords, provider keys or authentication secrets with us.
>
> Official credentials, provider identifiers and tokens will remain server-side; browsers receive bounded sanitized evidence only. Our current privacy/revocation/deletion flow supports withdrawal of public visibility and durable deletion/anonymization. The proposed RSO implementation must extend those controls to tokens and source aliases before launch.
>
> Our target is verified full lifetime history. We do not claim VAL-MATCH-V1 currently guarantees it. Please confirm the authoritative earliest-history boundary, completeness/retention contract, mode/platform scope, pagination or enumeration method, and treatment of unavailable details. Until that contract can satisfy our proof standard, lifetimeComplete remains false.
>
> Privacy page: https://valorant-squad-analytics.vercel.app/#/privacy. Terms, account-linking mockups, approved callback/scopes and application evidence remain to be prepared/reviewed. This is a draft, not a claim of approval or an application submission.

## Maximum conditional achievable result / next gate

With approved access and future implementation, the defensible ceiling may be all Riot-authoritative history actually returned, plus reconciled Henrik-discoverable/durable history, plus future matches accumulated in Neon, with no known internal gaps. This still **does not satisfy the hard lifetime requirement** without A–G; `lifetimeComplete=false`. No promise that this ceiling is currently achieved or that any source returns more than current records.

Exact next human action: wait for Riot's response on [ticket #139243830](https://support-developer.riotgames.com/hc/en-us/requests/139243830), then review its non-secret contract/policy answers with the maintainer. Do not submit another Production/RSO application until Riot clarifies the required sequence. Confirm any existing approval status privately in the Developer Portal if needed; do not paste keys, tokens, codes or private identities. A response does not automatically authorize acquisition, implementation or production changes: those still require the separate explicit human gate after reviewing feasibility and eligibility.

DATA-04B — Riot Official Provider / RSO Integration: **BLOCKED ON DATA-04A / NOT STARTED** pending Riot clarification on ticket #139243830, explicit authorization, eligible scope, approved Production/OAuth access, reviewed identity/consent/security design, and a documented decision on the still-unmet lifetime requirement. If Riot cannot supply the proof contract, the maintainer must decide whether to keep the hard requirement blocked; this task does not weaken it automatically. The support inquiry has already been sent; do not send a duplicate inquiry or submit a Production/RSO application automatically.

## Research verification (historical, preceding governance update)

Executed in the current worktree on 2026-10-04:

| Command | Exact result |
| --- | --- |
| `npm run lint` | PASS, exit 0. |
| `npm test` | PASS, exit 0: 23 test files, 339 tests passed; duration 48.58s. Source secret-boundary check passed. |
| `npm run build` | PASS, exit 0: TypeScript and Vite 7.3.6, 712 modules, Vite build 6.43s; dist secret-boundary check passed. |
| `npm audit --omit=dev` | PASS, exit 0: 0 vulnerabilities. |
| `npm run db:validate` | PASS, exit 0: 1 test file, 16 tests passed; duration 31.89s. Local PGlite foundation tests, not a production migration/query. |
| `npm audit` | Exit 1: 5 high findings in the existing braces/dev-tooling chain; NOT FIXED, governed by unchanged SEC-2026-001. |
| `git diff --check` | PASS, no whitespace errors. |

Build output: HTML 0.71 kB (gzip 0.49); CSS 40.17 kB (gzip 9.15); entry JS 363.14 kB (gzip 116.46); largest chart chunk 339.21 kB (gzip 99.53). Full audit was not suppressed or relabeled as passing. No dependency files were changed.

The test suite exercises synthetic providers/local databases; its provider-request counters are fixture activity, not live Riot/Henrik calls. Browser verification was limited to the existing public Privacy page and public official reference, with no connection/consent/sync action. Production DB health, every production route, official API operation and Portal approval were NOT VERIFIED in this task.

Only the four requested Markdown files changed. No push or deployment is performed, avoiding any deployment-triggered production activity during the freeze. Application code changes NONE; migration NONE; live provider calls 0; production writes NONE.
