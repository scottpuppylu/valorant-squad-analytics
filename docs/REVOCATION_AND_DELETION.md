# Consent revocation and durable deletion

Status: **COMPLETE — SDD STRICT**

TASK-DATA-01C implements the revocation and deletion control plane. Migration `0003_consent_revocation_deletion.sql`, API routes, UI and disposable Postgres tests exist. Migration `0003` is applied to production. After explicit human approval, the first irreversible production test-player revocation and deletion completed on 2026-10-01 using the existing service boundary.

This is an engineering retention policy, not a legal-compliance claim.

## Authorization boundary

New consent receives a random 32-byte base64url management credential once. Plaintext is returned only in the successful account-resolution response and saved under browser key `goblin-survey:consent-management:v1`, separate from analytics key `goblin-survey:real-dataset:v1`. The server stores only a domain-separated SHA-256 HMAC using domain `consent-management:v1` and the server-only `IDENTIFIER_HMAC_KEY`.

- A player UUID or deletion-job UUID is lookup-only and never authorizes deletion.
- Revoke, continue and status all require the management credential in a JSON POST body.
- Credentials are never accepted in URLs and must never enter logs, Git, screenshots or reports.
- Verification validates the fixed credential shape and uses constant-time byte comparison.
- Malformed browser credential state is deleted instead of trusted.
- On accepted revocation, the browser immediately removes its REAL dataset. The same local record becomes a deletion-only session containing the public player ID, public deletion-job ID, management credential and `revocationAccepted=true`; it contains no Riot ID, tag, PUUID, provider match ID or HMAC value.
- A deletion-only credential may call only deletion status and continuation. The account/import/sync UI is unavailable while that session exists, and server consent remains the provider-access authority.
- Pending, running, paused and retryable failed jobs retain the deletion-only credential across reload. Only a server response with `status=complete` removes the job state and credential and returns the browser to Demo/reconnect eligibility.

Browser lifecycle: **active consent credential → revocation accepted → deletion-only credential/job session → deletion complete → credential destroyed**.

An existing production consent created before migration `0003` has no credential. It is deliberately not auto-issued on reconnect. The operator-only `npm run consent:provision` workflow requires `DATABASE_URL`, `IDENTIFIER_HMAC_KEY`, an explicit `CONSENT_PROVISION_PLAYER_ID` and an absolute `CONSENT_PROVISION_OUTPUT_PATH` outside the repository. It updates exactly one active legacy consent and creates a new external file; the plaintext is never printed. The public app has no provisioning endpoint.

Losing the browser credential prevents self-service revocation from another device. Until a future Riot RSO ownership flow exists, recovery is operator-assisted and must verify the request out of band before using the explicit provisioning workflow.

## Public endpoints

| Endpoint | Method | Authenticated input | Safe result |
|---|---|---|---|
| `/api/valorant/consent/revoke` | POST | player UUID + management credential | public job ID, state/stage, aggregate counts |
| `/api/valorant/deletion/continue` | POST | job UUID + management credential | bounded updated progress |
| `/api/valorant/deletion/status` | POST | job UUID + management credential | aggregate progress only |

All three responses use `Cache-Control: no-store`. The status endpoint is POST rather than GET so the credential never appears in a query string. Raw provider/database identifiers, credential HMACs and deleted identity values are not returned.

## Immediate revocation transaction

The transaction locks the active consent, verifies the credential, marks the consent revoked with its UTC timestamp, deactivates squad membership, cancels pending/running/paused/failed sync runs, releases cursor leases, clears retry scheduling and creates or reuses one open deletion job. A repeated authenticated revoke returns the existing job instead of duplicating work.

Vercel's public REAL projection requires both current-version active consent and active membership. The accepted revocation transaction therefore removes the player from public read eligibility immediately, before the heavier evidence deletion or shared-match anonymization stages finish. `GET /api/valorant/dataset` uses `Cache-Control: no-store`, so the next request is not served from a browser/CDN dataset cache. An already-open page may retain its in-memory snapshot until refresh or reload.

Manual import checks the active public player before Henrik access and again in the evidence transaction. Sync checks consent before start/continue, in lease acquisition, before provider access, inside each match write and before cursor/run success commit. Account resolution is blocked before provider access while a deletion job is open. A revocation that commits while a provider response is in flight therefore prevents the later database write and cursor advance; cancellation cannot be overwritten by failure/success bookkeeping.

## Durable deletion state machine

The Vercel function budget remains 60 seconds. One deletion invocation targets at most 22 seconds of useful work, uses a 45-second expiring database lease and processes at most ten matches per batch. Work is transactional by stage/batch, idempotent and recoverable after process death or stale lease.

States: `pending`, `running`, `paused`, `complete`, `failed`.

Stages:

1. `cancel_sync` — acknowledges the already-atomic cancellation boundary.
2. `remove_rank_observations` — deletes zero or more player rank rows.
3. `process_matches` — repeatedly deletes exclusive batches or anonymizes shared batches.
4. `remove_provider_identity` — removes lookup/encrypted provider identity material.
5. `remove_membership` — removes deactivated squad membership.
6. `clear_sync_metadata` — deletes cursors and unlinks/scrubs personal coverage from aggregate sync runs.
7. `purge_player_profile_identity` — deletes consent and replaces display identity with a tombstone.
8. `finalize_job` — records completion and releases the lease.

The job records only its public ID, status/stage/timestamps, safe error category, attempt count and aggregate removal/anonymization counts. The random credential HMAC remains solely as a verifier for idempotent status/retry until the job audit reaches its 90-day retention target.

## Exclusive and shared match policy

An exclusive match has no other match participant linked to both active consent and active squad membership. Its `source_matches` row is deleted; database cascades remove teams, participants, rounds, events, assistants and locations in one transaction.

A shared match is retained for at least one other active consenting member. Every participant row linked to the revoked player is transformed as follows:

- `player_id` becomes null;
- provider-derived participant HMAC is replaced with a random 32-byte match-scoped tombstone;
- agent, personal combat aggregate, ability, economy, weapon, armor and location evidence is cleared;
- round presence, team key and killer/victim/assistant/plant/defuse references remain as anonymous event topology;
- kill weapon/location evidence involving that participant is cleared.

`event_lookup_hmac` originally hashes the match ID plus the killer and victim participant HMACs. A system holding both provider evidence and `IDENTIFIER_HMAC_KEY` can therefore reproduce an event key involving the revoked participant. During shared-match anonymization, each affected killer/victim event receives a fresh random 32-byte hex tombstone inside the same transaction. The database uniqueness constraint preserves uniqueness; the event row UUID, round/event sequence, timing and all foreign-key topology remain unchanged. A committed retry cannot rotate again because the participant is already unlinked from the player, while a failed batch rolls the rotation back with the rest of the transaction.

Other retained identity-derived fields were reviewed as follows:

- the source-match HMAC depends only on the provider match ID, not the revoked participant, and remains necessary to deduplicate shared evidence for the remaining consenting player;
- sync boundary HMACs, coverage dates and cursors are removed in `clear_sync_metadata`;
- locations for the revoked participant are deleted, and victim/killer location plus weapon fields are cleared on affected events;
- assistant, plant, defuse, killer and victim relationships retain only random internal participant UUID references after `player_id` is removed and the participant lookup HMAC is randomized;
- round presence and anonymous relationships remain because future Trade, KAST, Clutch and Impact reconstruction depends on event topology rather than provider identity.

### position-evidence-v1 (migration 0012) in a retained shared match

TASK-RELEASE-BLOCKER-FIX-01 (2026-10-08). Each item below is proven by the `position-evidence-v1 spatial telemetry`
tests in `tests/revocationDeletion.test.ts`.

| Evidence | After revocation of participant P |
|---|---|
| P's player snapshots (`event_player_locations`: x, y, `view_radians`) | Deleted (whole row) |
| Kill position (`kill_events.location_x/y`) where P is killer or victim | Cleared (existing rule) |
| Plant coordinates (`rounds.plant_location_x/y`) where P planted | Cleared |
| Defuse coordinates (`rounds.defuse_location_x/y`) where P defused | Cleared |
| Planter / defuser reference (`plant_participant_id` / `defuse_participant_id`) | Kept as anonymous topology; it now points only to the anonymized participant row (`player_id` NULL, random lookup HMAC) |
| Site label (`plant_site`, a provider A/B/C label), plant / defuse status and time | Kept (shared round facts) |
| Side (`winning_team_role`, `attacking_team_key`, `side_source`) | Kept (team-level shared round facts) |
| `source_matches.position_evidence_version` | Kept (version marker, no personal data) |
| Other participants' snapshots, kill positions, plant / defuse coordinates | Kept unchanged |

**No resurrection.** After deletion, the application database holds no precise coordinate attributable to P.
- A later analysis-fact rebuild (`hydrateAnalysisFacts`) cannot recreate one: P has no facts and no spatial residue.
- A repeated `continue` or revoke resurrects or changes nothing.

**Scope.**
- Exclusive matches are still deleted whole by cascade.
- Private rebuild staging is a separate store outside this lifecycle.

The retained structure supports trade/KAST/clutch/impact reconstruction for the remaining consenting member without a cross-match or provider identity link to the revoked person. No unavailable derived-metric table exists today; that stage is therefore a documented zero-row operation until such a table is introduced.

## Sync and rank metadata

All rank observations for the player are deleted, including valid observed zero values. Rank synchronization remains otherwise unimplemented.

Sync cursors are deleted. Sync runs retain only privacy-safe operational aggregates such as request/page/count/timing/error/termination values; player link, coverage dates, cursor start and provider match boundary HMAC are cleared. Structured telemetry must continue to use public run/job IDs and aggregate values only.

## Retention, recovery and SLO

- Raw provider payload retention remains off.
- Browser REAL data is removed immediately on accepted revocation. The management credential is retained only in the deletion session while status is pending/running/paused/retryable-failed, then destroyed automatically on `complete`.
- Personal server evidence remains only while a deletion job is safely working or awaiting retry.
- Operational objective: normally finish immediately for the current small dataset; otherwise resume as bounded chunks and investigate any job not complete within 24 hours.
- Manual recovery threshold: a job still incomplete after seven days requires operator review of only safe stage/error/count state.
- Completed deletion-job aggregate audit has a 90-day retention target. `npm run deletion:retention` removes expired audit rows and unreferenced player tombstones in bounded batches. Automatic scheduling is not yet configured, so operations must run and evidence this command until a scheduler is added.
- Failed stages release or expire their lease, retain the prior committed stage, and never report completion.

## Re-consent

Re-consent is allowed only after the prior deletion job completes. Because provider identity was removed, the next explicit consent creates a new player public ID, consent record and management credential. Old match tombstones and deletion audit cannot be relinked to that new identity.

A material future publication-policy change must use a new privacy version. Only an explicit connection submission accepting that current version may transactionally revoke an older active consent and create a new active consent; background sync, retries and public reads never upgrade consent.

## Disposable validation matrix

The PGlite and browser-storage suites cover credential one-time issuance, legacy v1 browser-record migration, legacy server consent no-auto-upgrade, invalid credential, atomic revocation, active and paused sync cancellation, lease release, single and multiple exclusive matches, shared-match participant/event-HMAC anonymization, idempotent retry, zero/nonzero rank removal, post-revoke provider blocking, provider-fetch race, bounded pause, stale lease recovery, worker failure rollback, repeated revoke/continue/completion, re-consent separation, child topology integrity, malformed browser deletion sessions, immediate REAL removal, reload/status recovery, paused continuation retention and credential destruction only after completion.

These tests use fictional identifiers and never call Henrik or production Neon.

## Production validation evidence

The approved production run first required exactly one active legacy consent and stopped if that gate was not met. Safe pre-deletion aggregates were 154 source matches, all exclusive; zero shared matches and rank rows; one provider identity, membership and consent; two sync cursors and two sync runs.

After revocation committed, controlled manual-import, reconnect, backfill and incremental attempts all stopped before provider access; the measured provider-fetch count was zero. The deletion worker completed in three leased attempts. Final counters were: zero rank rows, 154 exclusive matches, zero shared matches, zero shared participants, one provider identity, one membership, two sync cursors and two anonymized sync runs. The consent was removed and the player became the documented tombstone.

Post-deletion verification found zero linked source matches, participants, rank rows, provider identities, memberships, consents, cursors or player-linked sync runs; personal sync residue was zero. Global orphan checks for match participants, rounds, round participants, kill events, assistants and event locations were all zero. The production subject had no shared matches, so shared anonymization remains verified by the disposable Postgres suite rather than this production sample.

The run used a short-lived operator endpoint solely to bridge the legacy consent. It required POST, a constant-time bearer check, expiry, rate limiting, the exact-one candidate gate and the server-only management credential. It called `RevocationDeletionService` directly and was never committed. After verification, the three temporary Vercel secrets, local credential/response artifacts and endpoint source were removed; a clean production deployment returned 404 for the former route. The original Chrome profile was identifiable from its one-player/one-match REAL envelope. After an explicit action-time confirmation, the product's local-removal control returned the browser to Demo; a refresh confirmed the REAL envelope stayed removed and the browser console remained error-free.

Any future destructive production revocation is a new irreversible action and requires a fresh explicit human confirmation immediately before execution. Completion of this one test-player run is not standing approval for another player.
