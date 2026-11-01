#!/usr/bin/env bash
# Levanta un Postgres temporal, aplica las migraciones y corre las pruebas de RLS/RPC.
# Uso: npm run test:db   (requiere binarios de PostgreSQL 15+ instalados)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
AS_PG=0
if [ "$(id -u)" = "0" ]; then
  id -u postgres >/dev/null 2>&1 || useradd -r postgres
  chown -R postgres "$TMP"
  AS_PG=1
fi
run() { if [ "$AS_PG" = "1" ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $TMP/data -U postgres -A trust" >/dev/null
run "$PGBIN/pg_ctl -D $TMP/data -o '-p $PORT -k $TMP -c listen_addresses=' -l $TMP/log -w start" >/dev/null
PSQL="psql -X -q -t -A -v ON_ERROR_STOP=1 -h $TMP -p $PORT -U postgres -d postgres"
$PSQL -f "$DIR/bootstrap.sql"
for f in "$ROOT"/migrations/*.sql; do
  echo "→ migración $(basename "$f")"
  $PSQL -f "$f"
done
echo "→ pruebas de seguridad y reglas de negocio"
$PSQL -f "$DIR/rls_test.sql"
echo "✔ Todas las pruebas de base de datos pasaron"
