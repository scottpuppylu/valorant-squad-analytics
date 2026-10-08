#!/usr/bin/env bash
# TASK-INFRA-DATABASE-PORTABILITY-01 — LOCAL migration rehearsal on disposable PostgreSQL (never Production):
#   Postgres A ← all migrations ← representative data (the repository's deterministic realistic fixture)
#   → real-Postgres contract suite → parity summary A → pg_dump → empty Postgres B → pg_restore → parity B
#   → compare (must be IDENTICAL) → tear down (-v is safe ONLY because this project is ephemeral).
# Requires Docker + Node/npm on the rehearsal machine. Uses its own compose project and 127.0.0.1-only ports.
# POSTGRES_IMAGE selects the server (default: PostgreSQL 18, the Production migration major; pg_dump and
# pg_restore run inside the containers, so the dump/restore tools always match the server major).
set -euo pipefail
cd "$(dirname "$0")/../.."
PROJECT="valorant-rehearsal-$$"
PASS="rehearsal-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
WORK="$(mktemp -d)"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18-bookworm}"
# -v removes the containers' anonymous data volumes (ephemeral by design); without it each run leaks two volumes.
cleanup() { docker rm -f -v "${PROJECT}-a" "${PROJECT}-b" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

for side in a b; do
  port=$([[ $side == a ]] && echo 55432 || echo 55433)
  docker run -d --name "${PROJECT}-${side}" -e POSTGRES_PASSWORD="$PASS" -e POSTGRES_DB=valorant -p "127.0.0.1:${port}:5432" "$POSTGRES_IMAGE" >/dev/null
done
for side in a b; do until docker exec "${PROJECT}-${side}" pg_isready -U postgres -d valorant >/dev/null 2>&1; do sleep 1; done; done
for side in a b; do echo "{\"event\":\"rehearsal_server\",\"side\":\"$side\",\"server_version\":\"$(docker exec "${PROJECT}-${side}" psql -U postgres -tAc 'show server_version')\",\"pg_dump\":\"$(docker exec "${PROJECT}-${side}" pg_dump --version)\"}"; done
URL_A="postgresql://postgres:${PASS}@127.0.0.1:55432/valorant"
URL_B="postgresql://postgres:${PASS}@127.0.0.1:55433/valorant"

# 1. Real-PostgreSQL contract suite + migrations + representative data on A.
TEST_DATABASE_URL="$URL_A" npx vitest run tests/databasePortability.test.ts
DATABASE_URL="$URL_A" npx tsx scripts/migrate.ts
DATABASE_URL="$URL_A" REHEARSAL_MATCHES="${REHEARSAL_MATCHES:-600}" npx tsx scripts/rehearsal-seed.ts
DATABASE_URL="$URL_A" npx tsx scripts/hydrate-analysis-facts.ts
DATABASE_URL="$URL_A" npx tsx scripts/database-parity.ts summary "$WORK/a.json"

# 2. Dump A, restore into empty B (same commands as infra/backup + infra/restore, run inside the containers).
docker exec "${PROJECT}-a" pg_dump -U postgres -d valorant -Fc -Z 6 --no-owner --no-privileges > "$WORK/a.dump"
docker exec -i "${PROJECT}-b" pg_restore -U postgres -d valorant --no-owner --no-privileges --single-transaction --exit-on-error < "$WORK/a.dump"
DATABASE_URL="$URL_B" npx tsx scripts/database-parity.ts summary "$WORK/b.json"

# 3. Parity gate (exit 1 on ANY difference) and an idempotency check on the restored copy.
npx tsx scripts/database-parity.ts compare "$WORK/a.json" "$WORK/b.json"
DATABASE_URL="$URL_B" npx tsx scripts/migrate.ts | grep -q "already up to date"
echo '{"event":"migration_rehearsal","result":"PASS"}'
