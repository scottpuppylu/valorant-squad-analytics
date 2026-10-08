# Local provider rebuild — TASK-DATA-LOCAL-REBUILD-01

**STATUS: PREPARED / BLOCKED_ON_MAINTAINER_INPUT (2026-10-07).**
- **Not run:** 0 provider requests, 0 members, 0 matches.
- **Neon:** not accessed.
- **Goal:** rebuild a `LOCAL_PRODUCTION_CANDIDATE` from the authorized Henrik provider into local PostgreSQL 18.
- **Not canonical:** it becomes canonical only after SDD acceptance and TASK-DATA-NEON-RECONCILIATION-01.
- **History coverage:** `lifetimeComplete` stays **false**. The result is the best available provider history, never
  proven lifetime history.

```
Henrik API → local API (dist-server, loopback) + bulk-history-v1 controller → local PostgreSQL 18
           → analysis facts (same transaction) → data:export (public-safe, NOT published)
```

## Target (ready, verified EMPTY)

| Item | Value |
|---|---|
| Container | `vsa-rebuild-pg18` (`postgres:18-bookworm`, 18.6, restart `unless-stopped`) |
| Volume | `vsa-rebuild-pg18data` → `/var/lib/postgresql`. Separate from the migration target, rehearsal and synthetic databases |
| Storage | WSL ext4 `/dev/sdd` in `D:\WSL\Ubuntu\ext4.vhdx` |
| Listener | `127.0.0.1:55902` only |
| Database | `valorant_local_rebuild`; migrations 0001–0011 applied (0010 is a no-op on an empty database) |
| Initial state | 0 members, 0 accounts, 0 consents, 0 provider identities, 0 source matches, 0 analysis facts, 0 sync cursors / runs |
| Credentials | `~/.vsa-rebuild/db.env` (WSL, directory 700, file 600), never in Git |

## Blockers (maintainer / SDD input required before any provider call)

1. **Provider key is not available locally.**
   - `HENRIK_API_KEY` exists only as a Vercel environment variable.
   - The Vercel CLI on this machine is not logged in. Fetching the key would need a new OAuth flow plus credential
     retrieval, which was not done.
   - **Ask:** the maintainer writes `HENRIK_API_KEY=…` into `~/.vsa-rebuild/provider.env` in WSL (`chmod 600`)
     themselves. Never paste it into chat.
2. **The member set is not available locally.**
   - The tracked accounts' Riot `GameName#Tag` and affinity live only in Neon.
   - `ops/community-names-2026-10-06.json` has game names and community names, but no tags or regions.
   - **Ask:** the maintainer writes the 9 accounts as `gameName`, `tag`, `affinity`, `communityName` into
     `~/.vsa-rebuild/members.json` (600, outside the repository). The current set is 9 accounts = 9 people; no
     additions.
3. **Consent records (SDD decision).**
   - Sync and public visibility require an active consent on policy `2026-10-02-public-v1`. The allowed methods are
     `self_asserted` and `riot_rso_verified`.
   - The players consented in Production (Neon), but those rows are not readable now.
   - Writing new `self_asserted` rows on the players' behalf would record an assertion they did not make here.
   - **Options:**
     - (a) each player re-consents through the local Connect form;
     - (b) an SDD-approved, explicitly labelled carry-over (new consent method or audit note), as a separate code
       task;
     - (c) the maintainer confirms in chat that all 9 players' existing Production consent covers this local
       rebuild, and SDD accepts that recording it as `self_asserted` on the same policy version is acceptable.
4. **`IDENTIFIER_HMAC_KEY` (SDD decision).**
   - Provider identity and participant HMACs depend on this key.
   - **Same key as Production** (supplied like item 1, into `~/.vsa-rebuild/provider.env`): later Neon reconciliation
     can match accounts and matches by HMAC directly.
   - **New local key:** reconciliation must re-key. Recommendation: the same key.

## Run procedure (after the blockers clear; all local, no LLM polling)

1. Re-verify the target is EMPTY (counts above). Record `INITIAL_MATCH_COUNT=0` and `INITIAL_MEMBER_COUNT=0`.
2. Start `node dist-server/server/node/main.js` on `127.0.0.1` with the rebuild `DATABASE_URL` and
   `provider.env`.
   - `REAL_DATASET_READ_MODE=public`.
   - No scheduler, no `CRON_SECRET`.
3. Connect the 9 accounts through the local API's normal Connect path, using the consent mechanism SDD selects.
4. Run `npm run history:bulk -- --base-url http://127.0.0.1:<port> --all --execute --lanes 2 --provider-rpm 6
   --stop-on-rate-limit --max-provider-requests <finite budget> --state <file outside the repository>`.
   - **Discovery:** stored-index-efficiency-v1 / deep-history-v2 (`STORED_INDEX_PAGE_SIZE` 20).
   - **Detail fetches:** skipped for matches that are already durable (`existingMatchHmacs`), so a match shared by
     several members is fetched once.
   - **Writes:** go through the existing unique keys; facts refresh in the same transaction.
   - **Resumable:** DB cursors plus the controller `--state`. A restart continues; it never restarts from zero or
     re-downloads details.
5. **Monitor** with a local-log monitor every 3–5 minutes: alive, elapsed, requests, RPM, discovered / persisted,
   errors / 429 / retries, log growth.
   - No progress for 10 minutes: investigate. For 15 minutes: classify (rate limit / process / DB / network / missed
     completion).
   - Never raise the RPM.
6. **Completion:**
   - integrity checks: duplicates, orphans, FKs, public ids, timestamps, fact coverage;
   - coverage report: per member public label, count, earliest and latest; the reference is the old tracked count of
     838, never a target;
   - the per-year Competitive count check for the member with the ~433-matches-in-2026 concern;
   - local reads, a real local `data:export`, a loopback-only static frontend test.
   - **No publication.**

## TASK-DATA-NEON-RECONCILIATION-01 (future; do not execute now)

Run only after the Neon quota resets or access is restored. Steps:
1. Restore the Neon dump into PostgreSQL 18 (docs/PRODUCTION_DATA_MIGRATION.md).
2. Take the union with the local rebuild.
3. Deduplicate by identity (provider match HMAC; account HMAC under the same key).
4. List matches missing on either side.
5. Produce the final canonical local dataset.

Neon is not retired before this completes (`NEON_RETIRED=NO`).
