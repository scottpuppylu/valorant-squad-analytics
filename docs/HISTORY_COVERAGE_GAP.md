# History coverage gap — TASK-DATA-HISTORY-COVERAGE-GAP-01 (research only)

**STATUS: COMPLETE (SDD-corrected, 2026-10-07).**
- **PRIMARY OUTCOME: OUTCOME_D.** No documented authorized source currently demonstrates recoverable lifetime history.
- **SUPPORTING CANDIDATE: OUTCOME_B.** Riot Production + RSO remains the only documented official path worth
  pursuing, but its ability to recover deeper history is UNKNOWN.
- **Conducted with:** 0 Henrik requests, 0 Riot game-API requests, no Neon access, no code / schema / runtime change.
- **Canonical collection evidence:** [REBUILD_STAGING.md](REBUILD_STAGING.md).
- **Earlier Riot research (2026-10-04):** [LIFETIME_HISTORY.md](LIFETIME_HISTORY.md).

Evidence classes:
- **DOCUMENTED:** a primary source states it.
- **INFERRED:** reasoned from evidence, not stated.
- **USER_OBSERVED:** reported by the user; valid diagnostic evidence, not yet reconciled at match level.
- **UNKNOWN:** not established.

## 1. Executive conclusion

1. **Henrik: current recovery is exhausted.**
   - DOCUMENTED: Henrik describes stored history as "an accumulating materialized subset of Riot's match history" that
     "may have holes" ([stored-matches guide](https://docs.henrikdev.xyz/valorant/guides/stored-matches.md)).
   - Our completed live-history + stored-index exhaustion produced 838 unique matches, so
     CURRENT_HENRIK_RECOVERY_EXHAUSTED = YES.
   - This does not claim Henrik can never expose deeper history in future.
2. **Riot: the matchlist exists, but its depth is undocumented.**
   - DOCUMENTED: `VAL-MATCH-V1` provides `/val/match/v1/matchlists/by-puuid/{puuid}`.
   - Riot does **not** document lifetime completeness, retention depth, pagination sufficient for lifetime history,
     or whether Production access or RSO exposes deeper history. Whether the observed gap is recoverable is UNKNOWN.
3. **Riot policy blocks the current scope.** DOCUMENTED: VALORANT Personal Keys are unsupported, and private
   personal-use apps are not approvable. The current private scope is not presently eligible. This task does not
   redesign scope.
4. **No other authorized source was found.** Tracker / Blitz status is UNKNOWN.
5. **Neon:** LEGACY_NEON_EXTRA_HISTORY = UNKNOWN. Equal counts (838 = 838) do not prove equal match-id sets.
6. **`lifetimeComplete = false`.**

## 2. Gap evidence (summary; see REBUILD_STAGING.md)

| Item | Value | Class |
|---|---|---|
| Henrik-visible Competitive, 滑鏟, 2026 / 2025 / older | 102 / 0 / 0 | DOCUMENTED (our collection) |
| Provider-visible history start, 滑鏟 | 2026-02-15 (240 matches across all modes) | DOCUMENTED (our collection) |
| Reference: Competitive in 2026 | ≈ 433 | USER_OBSERVED |
| APPROX_REFERENCE_DIFFERENCE | ≈ 331 | Derived from the two counts |
| REFERENCE_COUNT_GAP_CONFIRMED | YES | — |
| MATCH_LEVEL_GAP_VERIFIED | NO. The reference's source, mode / filter semantics and individual match ids are not reconciled against the Henrik set | UNKNOWN |
| MATCH_LEVEL_DIFFERENCE | UNKNOWN. Not "exactly 331 missing matches" | UNKNOWN |

The user observation is not invalidated. It is count-level evidence that awaits match-level reconciliation.

## 3. Henrik findings

Sources (accessed 2026-10-07):
- [stored-matches guide](https://docs.henrikdev.xyz/valorant/guides/stored-matches.md)
- [rate limiting](https://docs.henrikdev.xyz/general/rate-limiting.md)
- [premium](https://docs.henrikdev.xyz/general/premium.md)
- [v4 matches](https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4.md)
- [docs index](https://docs.henrikdev.xyz/llms.txt)

| Field | Finding |
|---|---|
| LIFETIME_GUARANTEE | NOT_DOCUMENTED |
| How stored history is built | DOCUMENTED: it fetches recent match IDs from Riot, attempts each detail and stores the successful ones. Holes include matches "never requested by any developer" |
| RETENTION_POLICY / older-match expiry | NOT_DOCUMENTED |
| MAX_HISTORY_DEPTH / max matches per account | NOT_DOCUMENTED |
| STORED_INDEX_RETENTION | NOT_DOCUMENTED. DOCUMENTED: `total` is the number currently stored, not the player's total |
| Live (v4) history depth / size / start ranges / source | NOT_DOCUMENTED |
| Same backend for stored and live | NOT_DOCUMENTED. INFERRED: identical per-account totals in our run |
| PRODUCTION_TIER_HISTORY_DIFFERENCE (PREMIUM_EXTENDS_HISTORY) | NOT_DOCUMENTED. Premium documents only rate-limit (up to 130 / 200 / 300 req/min), cache and webhook improvements |
| Rate model | DOCUMENTED: each API call +1 plus each background Riot request +1 (explains the collector's weighted cost) |
| CURRENT_HENRIK_RECOVERY_EXHAUSTED | YES. All 18 sources were exhausted with 838 unique matches; re-crawling cannot add matches Henrik never stored (INFERRED from the documented build method) |

## 4. Riot official findings

Sources:
- [VAL-MATCH-V1 reference](https://developer.riotgames.com/api-details/val-match-v1) (rendered page read 2026-10-07);
- [VALORANT policy](https://developer.riotgames.com/docs/valorant) (2026-10-07);
- the 2026-10-04 sources in LIFETIME_HISTORY.md.

| Field | Finding |
|---|---|
| RIOT_VAL_MATCHLIST_EXISTS | YES (DOCUMENTED). It returns `history[]` of `matchId`, `gameStartTimeMillis`, `queueId`; detail via `/val/match/v1/matches/{matchId}` |
| HISTORICAL_DEPTH / retention | NOT_DOCUMENTED |
| Pagination | NOT_DOCUMENTED. Only the `puuid` path parameter; nothing sufficient for lifetime enumeration is documented |
| Deeper history with Production access | NOT_DOCUMENTED |
| `recent-matches/by-queue` | DOCUMENTED: only the last 10 minutes (live regions); not a history source |
| CAN_RECOVER_GAP | UNKNOWN |
| PERSONAL_VALORANT_KEY_SUPPORTED | NO (DOCUMENTED) |
| PLAYER_DATA_OPT_IN_REQUIRED | YES (DOCUMENTED) |
| RSO_AVAILABLE_WITH_PRODUCTION_KEY | YES. DOCUMENTED: RSO onboarding follows an approved Production key |
| PRIVATE_PERSONAL_USE_APP_APPROVABLE | NO. DOCUMENTED: "not public and designed for personal use only" is unapproved. The current project scope is therefore not presently eligible |

## 5. RSO findings

**RSO is Riot's required player opt-in / account-linking mechanism for VALORANT player-data applications.** That does
not show that RSO changes `VAL-MATCH-V1` retention or depth. Production + RSO eligibility and historical depth are
separate questions.

| Field | Value | Class |
|---|---|---|
| RSO_REQUIRED_FOR_APPROVED_VALORANT_PLAYER_DATA_APP | YES | DOCUMENTED (policy) |
| RSO_REQUIRED_AS_MATCHLIST_ENDPOINT_AUTH | NOT_ESTABLISHED. The reference documents API-key authorization; RSO is not documented as the endpoint's credential | DOCUMENTED absence |
| RSO_CAN_EXTEND_HISTORY_DEPTH | UNKNOWN | — |
| Authoritative identity (`/riot/account/v1/accounts/me` with an RSO token) | Available via RSO; the current `self_asserted` Riot-ID entry does not prove ownership | DOCUMENTED |

Riot support ticket #139243830: RIOT_SUPPORT_RESPONSE = NOT_AVAILABLE_LOCALLY (the project record says OPEN). No
support system was accessed.

## 6. Alternative sources

A public website that displays history is **not** evidence that an API exists, that programmatic access is permitted,
or that lifetime completeness exists. No scraping and no reverse engineering.

| Source | Authorized | Recovers old history | API | Auth | Cost | Terms risk | Quality | Feasibility |
|---|---|---|---|---|---|---|---|---|
| Riot VAL-MATCH-V1 (Production + RSO) | HIGH (official) | UNKNOWN | YES (DOCUMENTED) | Production key; RSO opt-in for the app | Free, after approval | LOW once approved; current scope ineligible | HIGH | MEDIUM: gated |
| Henrik (any tier) | MEDIUM (third party, in use) | LOW now; current recovery exhausted | YES | Key | Free / paid | LOW | MEDIUM–HIGH | LOW for the gap |
| Tracker Network | AUTHORIZED_VALORANT_API_FOUND = NO; STATUS = UNKNOWN (developer docs returned 403) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | HIGH if scraped (prohibited) | UNKNOWN | LOW |
| Blitz.gg | AUTHORIZED_VALORANT_API_FOUND = NO; STATUS = UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | HIGH if scraped | UNKNOWN | LOW |
| Riot account-data export | HIGH | LOW: VALORANT match history not listed (DOCUMENTED 2026-10-04) | N/A | Player request | Free | LOW | UNKNOWN | LOW |
| Local / private Riot client endpoints | Not authorized | UNKNOWN | Not official | Player session | — | HIGH | UNKNOWN | NOT PERMITTED |
| User-owned records | HIGH (the user's own) | Count-level only | NO | — | Manual | LOW | LOW (no match ids) | Diagnostic only |
| Legacy Neon (this project) | HIGH (own data) | LEGACY_NEON_EXTRA_HISTORY = UNKNOWN | Internal | Maintainer | — | LOW | HIGH | Testable after the quota reset |

## 7. 滑鏟 case study

- **DOCUMENTED (our collection):**
  - the provider-visible history starts 2026-02-15 (240 matches across all modes);
  - 102 Competitive in 2026;
  - both Henrik sources are exhausted.
- **USER_OBSERVED:** ≈ 433 Competitive in 2026, a count-level difference of ≈ 331.
- **INFERRED:** matches never requested from Henrik while retrievable are absent from its accumulating store. This
  plausibly explains part or all of the difference, but it is not verified at match level.
- **UNKNOWN:**
  - the reference's source (tracker site, in-game page, estimate);
  - its mode / region filters;
  - which individual matches differ.

## 8. Decision view

| Route | Recovers the gap? | Blocker |
|---|---|---|
| More Henrik crawling / premium | No (current recovery exhausted; premium does not document deeper history) | — |
| Riot Production + RSO | UNKNOWN (the only documented official path worth pursuing) | Scope eligibility, application, DATA-04B implementation |
| Neon reconciliation | UNKNOWN | Neon access; exact match-id set comparison |
| Third-party trackers | No authorized API found | Permission / API unknown |

## 9. Recommended next decision

1. **Wait** for Riot's answer on ticket #139243830. Do not submit an application from this task.
2. **Preserve** the private staging dataset ([REBUILD_STAGING.md](REBUILD_STAGING.md)).
3. **Cheap diagnostic for a later task:** the maintainer records the ≈ 433 reference's source and mode scope, so
   count-level and match-level gaps can be told apart.
4. **After Neon access returns,** TASK-DATA-NEON-RECONCILIATION-01 compares exact provider match-id sets.
5. **Product terminology (design only, not implemented):**
   - RECOMMENDED_HISTORY_LABEL = **Provider-visible history**;
   - metadata `coverageStartDate`, `coverageEndDate`, `providerVisibleMatches`;
   - `historyCompleteness = "unknown"`, `lifetimeComplete = false`.

## 10. Unresolved questions

- The ≈ 433 reference: its source, filters and match ids (UNKNOWN).
- `VAL-MATCH-V1` depth, retention and pagination; any Production or RSO effect on depth (NOT_DOCUMENTED / UNKNOWN).
- Riot eligibility for any future product scope (not decided here).
- Henrik expiry policy and future depth changes (NOT_DOCUMENTED).
- Whether Neon holds match ids absent from staging (UNKNOWN).

## 11. Lifetime completeness

**`lifetimeComplete = false`.** No reviewed source documents an authoritative earliest-match boundary or lifetime
guarantee (proof condition G in LIFETIME_HISTORY.md is unmet). Provider exhaustion, stable counts or 838 = 838 cannot
substitute for it.
