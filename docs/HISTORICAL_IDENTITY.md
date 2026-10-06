# Stable historical account identity — `historical-identity-v1` (TASK-DATA-HISTORICAL-IDENTITY-01)

**Status:** IMPLEMENTED (2026-10-06). Production acceptance is recorded at the end of this file.

## Problem

`normalizeHenrikEvidence` used to treat a match participant as the consenting account only when `players[].name` and
`players[].tag` equalled the account's **current** Riot ID.
- Riot match data carries the name that was in use at match time.
- So a historical match played under a different Riot ID had no consenting participant.
- `persistSyncPage` then threw `ConsentingParticipantAbsentError`, which the deep sync reported as `DATABASE_ERROR`.

This is TASK-DATA-BULK-01D's verified root cause (C1a). The proven fact is narrower than "the account renamed": the
historical match lacked a participant matching the **current** Riot name+tag.

## Rule

The consenting participant of a provider match is the participant for which:

```
providerIdentityHmac('HenrikDev', affinity, players[].puuid, IDENTIFIER_HMAC_KEY)
  === provider_identities.lookup_hmac   -- of the exact syncing account and affinity
```

- **Exactly one per match.**
  - 0 → `ConsentingParticipantAbsentError`.
  - More than 1 → `ConsentingParticipantAmbiguousError`, an invariant failure.
- The Riot name/tag is **never** an identity signal. There is no fallback, no fuzzy match and no inference from stats,
  agent or team.
- `players.display_name` / `display_tag` remain for display and for provider queries only. Henrik endpoints are
  addressed by GameName/Tag.

### Identity-domain compatibility (static gate): `PROVIDER_IDENTITY_DOMAIN_COMPATIBLE = YES`

| Step | Code |
|---|---|
| Connection | `HenrikDataProvider.resolveAccount` reads Henrik `/valorant/v2/account/{name}/{tag}` → `data.puuid` |
| Persist | `DurableEvidenceService.persistConnection(input, data.puuid)` → `providerIdentityHmac('HenrikDev', input.affinity, puuid, key)` |
| Store | `PostgresPlayerRepository.upsertConnectedPlayer` is the **only** writer of `provider_identities.lookup_hmac` |
| Match | `normalizeHenrikEvidence` hashes `players[].puuid` with the **same** function, provider literal, affinity and key |

Both identifiers are the Henrik-supplied Riot PUUID, which is stable across Riot ID changes. Both use the
`provider-identity:v1:HenrikDev:{affinity}` HMAC domain.

The match-scoped `participantHmac` (`match-participant:v1:{matchId}`) is **not** used for cross-match account identity.

## Resolution of the expected identity

`PostgresPlayerRepository.resolveProviderIdentityHmac(executor, { id } | { publicId }, affinity)`:
- Returns only `lookup_hmac`.
- Matches the exact account id, provider `HenrikDev`, the exact affinity and `players.anonymized_at IS NULL`.
- 0 rows or more than 1 row → `ProviderIdentityUnresolvedError`, which fails closed.

Callers:
- `persistSyncPage` (incremental, backfill and deep_backfill live_v4/stored_index detail pages).
- `persistMatches` (the normal connect import).

Both resolve the identity and pass it into the **pure** normalizer, which has no DB access. No raw expected PUUID is
passed around.

## Failure classification

All identity failures extend `HistoricalIdentityError` (`server/persistence/errors.ts`):
- `ConsentingParticipantAbsentError`
- `ConsentingParticipantAmbiguousError`
- `ProviderIdentityUnresolvedError`
- `ParticipantAccountConflictError`

Every one of them:
- is reported publicly as `502 MALFORMED_PROVIDER_RESPONSE`, with sync category `MALFORMED_RESPONSE` and run status
  `failed`;
- is **never** `DATABASE_ERROR`;
- emits **no** `sync_database_failure` log.

The normal import path maps them the same way. There is no new public error category and no migration.

Consent semantics are unchanged:
- The per-match consent `FOR UPDATE` check still throws `CONSENT_REVOKED`.
- Revocation and deletion gates are untouched.

## Account scope and participant linking

- Linking is **account-scoped**. Only the account whose identity HMAC matches is linked; a sibling account of the same
  member is never linked by another account's sync. Non-consenting participants keep `player_id = NULL`.
- Upsert `player_id = COALESCE(EXCLUDED.player_id, match_participants.player_id)`.
  - A new NULL never erases a link.
  - `upsertMatch` first checks the consenting participant: if the row is already linked to a **different** account, or
    this account already owns a **different** participant row in the match, it throws
    `ParticipantAccountConflictError`. The match transaction rolls back and the existing link is preserved.
  - That conflict can only arise from the same PUUID connected under two affinities, or from a legacy name-based mislink.
- **Healing:** a row inserted as NULL because another account's sync wrote the match gets linked when its own account
  replays that match through the normal sync. There is no production backfill.
- Per-match atomicity and replay idempotency are unchanged.

## Versioning

- `HISTORICAL_IDENTITY_VERSION = 'historical-identity-v1'` (`server/evidence/types.ts`). It is a code and documentation
  label; it is not persisted.
- `DURABLE_NORMALIZATION_VERSION` stays **`durable-evidence-v2`**, deliberately:
  - The normalized evidence shape, statuses and values are unchanged. Only the consenting-participant selection changed.
  - `eventMetricEngine` requires the current normalization version for complete event metrics. A bump would mark every
    stored v2 match as incomplete and change production metrics without new evidence.
- Schema 6, `member-identity-v2` and all scoring, Progress, Synergy, weapon and mode-policy versions are unchanged.

## Privacy

- Raw PUUIDs are never persisted, logged, documented, sent to the browser or written into test snapshots. Only the
  existing domain-separated HMAC persists.
- `encrypted_identifier` is neither required nor decrypted.
- There is no alias or rename-history table, and old GameName or Tag values are not stored.

## Remaining name/tag usage (classified)

| Location | Use | Class |
|---|---|---|
| `henrikDataProvider.ts` provider URLs | Henrik queries are addressed by GameName/Tag | QUERY |
| `durableEvidenceService.assertConnectionAllowed` | Pre-provider deletion-in-progress block for a requested Riot ID | GATE (before the PUUID is known) |
| `durableEvidenceService.assertImportAllowed` | Requested Riot ID must equal the account's current display | REQUEST AUTHORIZATION |
| `normalizeHenrik.ts` `isPlayer` | Non-durable connect-response preview (never persisted) | DISPLAY / RESPONSE ONLY |
| dataset projection, member admin | Display and maintainer name mapping | DISPLAY |
| `normalizeHenrikEvidence` | — | **Removed as identity** (now `providerIdentityHmac`) |

## Tests

- `tests/historicalIdentity.test.ts` covers:
  - Changes to the name, the tag, or both.
  - The same name with the wrong PUUID, and a different name with the correct PUUID.
  - A missing PUUID, a duplicated target PUUID, and the wrong affinity.
  - Resolution with 1, 0 or ambiguous rows, the wrong account, an anonymized account, and a revoked consent.
  - A multi-account member, healing, the different-account overwrite guard, and replay idempotency.
  - The end-to-end incident (overlaps plus a renamed match → success, no `sync_database_failure`).
  - True absence → `MALFORMED_RESPONSE` with the cursor kept.
  - The incremental path, and privacy of logs and status.
- `tests/syncDatabaseFailure.test.ts`: C1a is now characterized as fixed.
