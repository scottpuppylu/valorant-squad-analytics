#!/usr/bin/env bash
# TASK-INFRA-DATABASE-PORTABILITY-01 — PostgreSQL logical backup (restore-first: see ../restore/restore-postgres.sh).
#
# Runs pg_dump INSIDE the postgres container (no published port), writes a compressed custom-format dump plus a
# SHA-256 checksum and a non-secret metadata file, then prunes local dumps older than BACKUP_RETENTION_DAYS.
# Destination is replaceable: BACKUP_DIR (local volume / NAS mount) and optional BACKUP_COPY_COMMAND, invoked as
# `$BACKUP_COPY_COMMAND <file>` for each artifact (e.g. an rclone/S3/rsync wrapper you provide on the host).
# No password, URL or credential is ever written by this script; credentials stay inside the container env.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-$(dirname "$0")/../compose.yaml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/valorant}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="valorant-${STAMP}"

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || { echo "BACKUP_RETENTION_DAYS must be an integer" >&2; exit 2; }
mkdir -p "$BACKUP_DIR"
umask 077

TMP="${BACKUP_DIR}/.${NAME}.dump.partial"
trap 'rm -f "$TMP"' EXIT

# -Fc: compressed custom format (pg_restore-able, selective restore); --no-owner keeps it host-portable.
docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6 --no-owner --no-privileges' > "$TMP"

[[ -s "$TMP" ]] || { echo "backup produced an empty file" >&2; exit 1; }
mv "$TMP" "${BACKUP_DIR}/${NAME}.dump"
trap - EXIT

( cd "$BACKUP_DIR" && sha256sum "${NAME}.dump" > "${NAME}.dump.sha256" )

LATEST_MIGRATION="$(docker compose -f "$COMPOSE_FILE" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT max(version) FROM schema_migrations"' | tr -d '\r')"
cat > "${BACKUP_DIR}/${NAME}.meta.json" <<EOF
{"backup":"${NAME}","createdAtUtc":"${STAMP}","format":"pg_dump-custom","latestMigration":"${LATEST_MIGRATION}","bytes":$(stat -c %s "${BACKUP_DIR}/${NAME}.dump")}
EOF

if [[ -n "${BACKUP_COPY_COMMAND:-}" ]]; then
  for artifact in "${NAME}.dump" "${NAME}.dump.sha256" "${NAME}.meta.json"; do
    "$BACKUP_COPY_COMMAND" "${BACKUP_DIR}/${artifact}"
  done
fi

# Local retention only; offsite retention is the destination's policy.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'valorant-*' -mtime +"$RETENTION_DAYS" -print -delete

echo "{\"event\":\"postgres_backup\",\"backup\":\"${NAME}\",\"latestMigration\":\"${LATEST_MIGRATION}\"}"
