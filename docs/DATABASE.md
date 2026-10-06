# Durable database foundation

> **TASK-DATA-03B.2D migration 0011 (`analysis_participant_facts`, additive):** derived analysis facts per LINKED match participant (FK cascades to `match_participants` and `source_matches`): `engine_key`, `source_observed_at`, round coverage, the event-metrics-v1 reconstruction (`metrics` json) and direct trade edges. No scores, provider identifiers, HMACs or names. Written in the same per-match transaction as the evidence (`upsertMatch` → `refreshAnalysisFacts`), deleted with an anonymized participant, hydrated deterministically by the Vercel Production build after migrations. Older application code ignores the table. See [FULL_TRACKED_LATENCY.md](FULL_TRACKED_LATENCY.md).

> **TASK-DATA-PERFORMANCE-SCORE-01:** no migration. `match_participants.score` = legacy combat-score total and must never be reused for Performance Score. A future `performance_score` column needs migration 0011 under a separate task. See [PERFORMANCE_SCORE.md](PERFORMANCE_SCORE.md).

> **TASK-IDENTITY-01B data migration 0010:** a one-time, fail-closed assignment of the 9 approved community names (members.display_name/source only; scoped no-op on databases without any approved name).

> **TASK-IDENTITY-01B (member-identity-v2, schema 6):** migration 0009 adds `members.nickname` (NULL = unset; CHECK forbids '' and padded values). No data moved. See [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md#member-naming-model-task-identity-01b).

> **TASK-IDENTITY-01 (member-identity-v1, 2026-10-06):** migration 0008 adds `members` and `players.member_id/is_primary_account/account_label`, with a deterministic 1:1 backfill (member id/public id = account id/public id) and a BEFORE INSERT trigger that creates a new 1:1 member for every new account. Consent, identities, sync, deletion and participants stay account-scoped. See [MEMBER_IDENTITY.md](MEMBER_IDENTITY.md).

TASK-DATA-01A added the first server-side evidence store. TASK-DATA-02 later made Neon the PUBLIC REAL source of truth, and TASK-METRICS-01 added evidence-status columns needed by versioned reconstruction. The retired `BrowserRealDatasetRepository` is cleanup/test/rollback code only.

## Configuration and migrations

Production uses `@neondatabase/serverless` and the server-only variables `DATABASE_URL` and `IDENTIFIER_HMAC_KEY`. Neither name may use a `VITE_` prefix or appear in `src/` or the browser build. CI uses in-memory PGlite and does not require production credentials.

Versioned SQL lives in `migrations/`. `npm run db:migrate` creates `schema_migrations`, applies each unapplied version in a transaction, and records its filename. Migration `0001_durable_evidence_foundation.sql` is the immutable initial schema; migration `0002_bounded_historical_sync.sql` adds executable run/cursor metrics, coverage and expiring lease state; migration `0003_consent_revocation_deletion.sql` adds consent-management HMAC, tombstone and deletion state; migration `0004_dataset_read_runtime.sql` adds an independent stable `source_matches.public_id`; migration `0005_public_dataset_consent.sql` replaces version-scoped active-consent uniqueness with one active consent per player across all policy versions; migration `0006_metric_evidence_status.sql` adds observed/missing/unavailable status for round, kill, round-participant, ability and economy evidence. Production migrations are run from a trusted server/operator environment, never from React or a permanent public migration endpoint.

## Identity classes

- **Lookup identifier:** a 64-character HMAC-SHA256 value made with `IDENTIFIER_HMAC_KEY` and a versioned domain. It supports deduplication without storing a raw provider identifier.
- **Recoverable encrypted identifier:** nullable `encrypted_identifier`, `encryption_nonce`, and `encryption_key_version` columns. They must be populated together under a future reviewed encryption design. TASK-DATA-01A does not enable or populate them.
- **Public application ID:** an independent random UUID. It does not derive from Riot ID, PUUID, match ID, or another provider value.

Non-consenting participants receive a match-scoped HMAC. The same provider participant therefore has a different pseudonym in a different match, and appearance in evidence never creates a `players`, membership, provider identity, or consent row.

**Consenting participant identity (`historical-identity-v1`):** `match_participants.player_id` is set only for the participant whose `providerIdentityHmac('HenrikDev', affinity, puuid)` equals the syncing account's `provider_identities.lookup_hmac` (exactly one per match). The Riot name/tag is never used. A row already linked to a different account is never re-linked (fail closed). There is no migration and no new column. See [HISTORICAL_IDENTITY.md](HISTORICAL_IDENTITY.md).

## Consent and retention

The current connection is unofficial HenrikDev data access, not Riot RSO ownership verification. Consent is stored as `self_asserted`; the schema separately allows a future `riot_rso_verified` method. The current public-display policy is `2026-10-02-public-v1`, defined once in `shared/privacyPolicy.ts`. An active record includes policy version and `consented_at`; revoked records require `revoked_at`. A player may have at most one active consent across all versions. An explicit current-policy connection reuses an already-current consent or transactionally revokes the older active consent and creates one new current consent with a new one-time management credential. Background sync, dataset reads and retries never upgrade policy.

Normalized evidence may be persisted only while the exact current public policy consent is active. `deletion_jobs` represents pending, running, paused, complete and failed work with a 45-second lease, explicit stage, safe aggregate counters and 90-day audit-retention target. TASK-DATA-01C implements the cascade and is production validated; every future destructive subject still requires a fresh explicit approval.

## Evidence and transaction boundary

One normalized source match is written in one database transaction. Player reuse, membership, active consent, source match, teams, match participants, rounds, round participants, kills, assistants, and location snapshots either commit together or roll back together. Raw Henrik JSON is validated and normalized in memory, then discarded; it is not stored.

Observed numeric zero remains zero. Missing properties remain null with an explicit `missing` evidence status, and structurally unusable values use `unavailable`. Plant/defuse additionally distinguish a provider-observed `absent` value from a missing property. `durable-evidence-v2` writes the migration-0006 statuses; pre-existing v1 rows retain `missing` until a future authorized overlap/import observes them again.

Source matches are unique by provider and keyed match HMAC. Participants, active consents, memberships, events, assistants, and locations have database uniqueness constraints. Re-import replaces a match's round/event children transactionally while preserving the source match and participant identities, so a repeated write does not increase row counts.

## Schema ownership

- Identity and permission: `squads`, `players`, `squad_memberships`, `provider_identities`, `consents`
- Source evidence: `source_matches`, `match_teams`, `match_participants`, `rounds`, `round_participants`, `kill_events`, `kill_assistants`, `event_player_locations`
- Active bounded match synchronization: `sync_runs`, `sync_cursors`; future rank observation synchronization: `rank_observations`
- Future revocation execution: `deletion_jobs`

TASK-DATA-SEASON-01 writes the existing `source_matches.season_id/season_short` columns (no migration).

No scoring table is introduced. `event-metrics-v1` derives versioned evidence at read time and stores no score. Rank/MMR evidence remains separate and is never fed into the community score.
