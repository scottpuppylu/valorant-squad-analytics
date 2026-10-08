/**
 * TASK-DATA-LOCAL-REBUILD-COLLECT-01 — PRIVATE rebuild staging schema (`rebuild-staging-v1`).
 *
 * This is NOT the application schema and is NOT a migration: it is created only by `npm run rebuild:collect`
 * inside the dedicated private staging database (valorant_rebuild_staging), never in a canonical application
 * database (the collector refuses any database that has the application's `consents` / `schema_migrations`).
 *
 * Raw provider identifiers retained here (private, local, never exported) and why:
 *   - accounts.game_name / tag      the 9 known public Riot IDs: the provider addresses history by Name#Tag;
 *   - accounts.provider_puuid       the member's provider account id: needed to identify the member inside a
 *                                   payload and to re-derive canonical identity HMACs during reconciliation;
 *   - matches.provider_match_id     the provider match id: the only cross-source match identity that survives
 *                                   a different HMAC key (TASK-DATA-NEON-RECONCILIATION-01);
 *   - match_payloads.payload        the raw v4 match document: canonical durable evidence can only be produced
 *                                   by the existing normalizer from the raw document under the canonical key.
 */
export const REBUILD_STAGING_SCHEMA_VERSION = 'rebuild-staging-v1' as const;
export const REBUILD_STAGING_SCHEMA = 'rebuild_staging' as const;

export const STAGING_DDL: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS rebuild_staging`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.accounts (
     account_public_id uuid PRIMARY KEY,
     member_public_id uuid NOT NULL,
     community_name text NOT NULL CHECK (char_length(community_name) BETWEEN 1 AND 64),
     game_name text NOT NULL,
     tag text NOT NULL,
     is_primary boolean NOT NULL,
     affinity text CHECK (affinity IN ('ap','eu','na','kr','latam','br')),
     provider_puuid text,
     resolved_at timestamptz,
     UNIQUE (game_name, tag)
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.cursors (
     account_public_id uuid NOT NULL REFERENCES rebuild_staging.accounts(account_public_id),
     source text NOT NULL CHECK (source IN ('live_v4','stored_index')),
     next_position integer NOT NULL DEFAULT 0 CHECK (next_position >= 0),
     exhausted boolean NOT NULL DEFAULT false,
     termination text,
     last_fingerprint text,
     repeat_count integer NOT NULL DEFAULT 0,
     provider_total integer,
     pages_read integer NOT NULL DEFAULT 0,
     entries_seen integer NOT NULL DEFAULT 0,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (account_public_id, source)
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.matches (
     provider_match_id text PRIMARY KEY CHECK (char_length(provider_match_id) BETWEEN 1 AND 128),
     match_ref text NOT NULL UNIQUE,
     first_discovered_at timestamptz NOT NULL,
     started_at timestamptz,
     mode text,
     map_name text,
     season_short text,
     detail_affinity text NOT NULL CHECK (detail_affinity IN ('ap','eu','na','kr','latam','br')),
     hydration_status text NOT NULL DEFAULT 'pending' CHECK (hydration_status IN ('pending','hydrated','unavailable','failed')),
     hydration_attempts integer NOT NULL DEFAULT 0,
     last_error text,
     hydrated_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.account_matches (
     account_public_id uuid NOT NULL REFERENCES rebuild_staging.accounts(account_public_id),
     provider_match_id text NOT NULL REFERENCES rebuild_staging.matches(provider_match_id),
     source text NOT NULL CHECK (source IN ('live_v4','stored_index')),
     discovered_at timestamptz NOT NULL,
     stored_row jsonb,
     PRIMARY KEY (account_public_id, provider_match_id)
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.match_payloads (
     provider_match_id text PRIMARY KEY REFERENCES rebuild_staging.matches(provider_match_id),
     source text NOT NULL CHECK (source IN ('v4_detail','v4_history')),
     payload jsonb NOT NULL,
     payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
     fetched_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.provider_requests (
     id bigserial PRIMARY KEY,
     at timestamptz NOT NULL,
     category text NOT NULL CHECK (category IN ('account','discovery_live','discovery_stored','detail','mmr','other')),
     http_status integer,
     outcome text NOT NULL CHECK (outcome IN ('ok','http_429','http_4xx','http_5xx','timeout')),
     duration_ms integer NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS rebuild_staging.runs (
     id bigserial PRIMARY KEY,
     started_at timestamptz NOT NULL,
     finished_at timestamptz,
     command text NOT NULL,
     status text NOT NULL CHECK (status IN ('running','complete','stopped','failed')),
     stop_reason text,
     summary jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS matches_hydration ON rebuild_staging.matches (hydration_status, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS provider_requests_at ON rebuild_staging.provider_requests (at)`,
  `ALTER TABLE rebuild_staging.provider_requests ADD COLUMN IF NOT EXISTS rl_limit integer`,
  `ALTER TABLE rebuild_staging.provider_requests ADD COLUMN IF NOT EXISTS rl_remaining integer`,
  `ALTER TABLE rebuild_staging.provider_requests ADD COLUMN IF NOT EXISTS rl_reset integer`,
  `INSERT INTO rebuild_staging.meta (key, value) VALUES ('schema_version', '${REBUILD_STAGING_SCHEMA_VERSION}')
     ON CONFLICT (key) DO NOTHING`,
];
