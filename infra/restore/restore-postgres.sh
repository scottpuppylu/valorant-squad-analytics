#!/usr/bin/env bash
# TASK-INFRA-DATABASE-PORTABILITY-01 — deterministic restore of a backup-postgres.sh dump into an EMPTY database,
# followed by validation. Never restores over a non-empty target (fails closed).
#
#   restore-postgres.sh <dump-file> [target-database]
#
# Steps: verify SHA-256 → create the empty target database → pg_restore (single transaction, exit on error) →
# validate: schema_migrations present + parity summary (counts/digests) printed for comparison with the source.
set -euo pipefail

DUMP="${1:?usage: restore-postgres.sh <dump-file> [target-database]}"
TARGET_DB="${2:-valorant_restore}"
COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../compose.yaml}"
[[ "$TARGET_DB" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "unsafe target database name" >&2; exit 2; }
[[ -f "$DUMP" ]] || { echo "dump not found" >&2; exit 2; }

if [[ -f "${DUMP}.sha256" ]]; then
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" )
else
  echo "missing checksum file ${DUMP}.sha256 — refusing to restore" >&2; exit 1
fi

psql_admin() { docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d postgres -Atc \"$1\""; }

EXISTS="$(psql_admin "SELECT 1 FROM pg_database WHERE datname='${TARGET_DB}'" | tr -d '\r')"
if [[ "$EXISTS" == "1" ]]; then
  TABLES="$(docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d ${TARGET_DB} -Atc \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\"" | tr -d '\r')"
  [[ "$TABLES" == "0" ]] || { echo "target database ${TARGET_DB} is not empty — refusing" >&2; exit 1; }
else
  psql_admin "CREATE DATABASE ${TARGET_DB}"
fi

docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d ${TARGET_DB} --no-owner --no-privileges --single-transaction --exit-on-error" < "$DUMP"

LATEST="$(docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d ${TARGET_DB} -Atc \"SELECT max(version) FROM schema_migrations\"" | tr -d '\r')"
[[ -n "$LATEST" ]] || { echo "restored database has no schema_migrations" >&2; exit 1; }

# Parity summary of the restored copy (counts + digests only). Compare with the source summary:
#   node dist-server/scripts/database-parity.js compare source.json restored.json
docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL_OVERRIDE_DB="${TARGET_DB}" migrate \
  sh -c 'DATABASE_URL="${DATABASE_URL%/*}/${DATABASE_URL_OVERRIDE_DB}" node dist-server/scripts/database-parity.js summary'

echo "{\"event\":\"postgres_restore\",\"target\":\"${TARGET_DB}\",\"latestMigration\":\"${LATEST}\"}"
