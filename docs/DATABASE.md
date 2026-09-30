# Durable database foundation

TASK-DATA-01A adds the first server-side evidence store without changing the public analytics runtime. The React application still reads `BrowserRealDatasetRepository` (or Demo); Neon becomes the frontend source of truth only in TASK-DATA-02.

## Configuration and migrations

Production uses `@neondatabase/serverless` and the server-only variables `DATABASE_URL` and `IDENTIFIER_HMAC_KEY`. Neither name may use a `VITE_` prefix or appear in `src/` or the browser build. CI uses in-memory PGlite and does not require production credentials.

Versioned SQL lives in `migrations/`. `npm run db:migrate` creates `schema_migrations`, applies each unapplied version in a transaction, and records its filename. Migration `0001_durable_evidence_foundation.sql` is the initial schema. Production migrations are run from a trusted server/operator environment, never from React or a public endpoint.

## Identity classes

- **Lookup identifier:** a 64-character HMAC-SHA256 value made with `IDENTIFIER_HMAC_KEY` and a versioned domain. It supports deduplication without storing a raw provider identifier.
- **Recoverable encrypted identifier:** nullable `encrypted_identifier`, `encryption_nonce`, and `encryption_key_version` columns. They must be populated together under a future reviewed encryption design. TASK-DATA-01A does not enable or populate them.
- **Public application ID:** an independent random UUID. It does not derive from Riot ID, PUUID, match ID, or another provider value.

Non-consenting participants receive a match-scoped HMAC. The same provider participant therefore has a different pseudonym in a different match, and appearance in evidence never creates a `players`, membership, provider identity, or consent row.

## Consent and retention

The current connection is unofficial HenrikDev data access, not Riot RSO ownership verification. Consent is stored as `self_asserted`; the schema separately allows a future `riot_rso_verified` method. An active record includes policy version and `consented_at`; revoked records require `revoked_at`.

Normalized evidence may be persisted while consent is active, subject to product retention/deletion policy. `deletion_jobs` can represent pending, running, complete, and failed work. TASK-DATA-01C will implement the actual revocation cascade; its execution is not part of this foundation.

## Evidence and transaction boundary

One normalized source match is written in one database transaction. Player reuse, membership, active consent, source match, teams, match participants, rounds, round participants, kills, assistants, and location snapshots either commit together or roll back together. Raw Henrik JSON is validated and normalized in memory, then discarded; it is not stored.

Observed numeric zero remains zero. Missing properties remain null with an explicit `missing` evidence status, and structurally unusable values use `unavailable`. Plant/defuse additionally distinguish a provider-observed `absent` value from a missing property.

Source matches are unique by provider and keyed match HMAC. Participants, active consents, memberships, events, assistants, and locations have database uniqueness constraints. Re-import replaces a match's round/event children transactionally while preserving the source match and participant identities, so a repeated write does not increase row counts.

## Schema ownership

- Identity and permission: `squads`, `players`, `squad_memberships`, `provider_identities`, `consents`
- Source evidence: `source_matches`, `match_teams`, `match_participants`, `rounds`, `round_participants`, `kill_events`, `kill_assistants`, `event_player_locations`
- Future observation/synchronization: `rank_observations`, `sync_runs`, `sync_cursors`
- Future revocation execution: `deletion_jobs`

No scoring table is introduced. Rank/MMR evidence remains separate and is never fed into the community score by this task.
