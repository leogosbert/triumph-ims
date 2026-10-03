#!/usr/bin/env bash
# Runs the database rule tests on a throwaway local Postgres database.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=ims_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase_stub.sql
for f in migrations/*.sql; do
  psql -q -t -v ON_ERROR_STOP=1 -d "$DB" -f "$f" | sed '/^[[:space:]]*$/d'
done
for f in tests/*_test.sql; do
  psql -q -t -v ON_ERROR_STOP=1 -d "$DB" -f "$f" | sed '/^[[:space:]]*$/d'
done
