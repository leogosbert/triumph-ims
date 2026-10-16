#!/usr/bin/env bash
# Proves a nightly backup can be put back: loads public.sql into a throwaway database
# (with the same Supabase stand-in the database tests use) and checks that every table
# has exactly as many rows as the backup file holds.
#
# Usage: PGHOST=... PGUSER=... scripts/backup-restore-test.sh path/to/public.sql
# Writes restore-report.txt next to where it runs. Exit 0 = every row came back.
set -euo pipefail
dump=$1
here=$(cd "$(dirname "$0")/.." && pwd)
db=restore_test_$$
createdb "$db"
trap 'dropdb --if-exists "$db" >/dev/null 2>&1 || true' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/supabase/tests/supabase_stub.sql" >/dev/null
psql -q -d "$db" -c 'drop schema public cascade' >/dev/null 2>&1

# Load everything; errors are listed in the report (links to sign-in accounts are expected
# to fail here, because the stand-in has no people). Rows are what must all come back.
psql -q -d "$db" -f "$dump" >restore.log 2>&1 || true

# Rows per table in the file: lines between "COPY public.<table> ..." and "\.".
awk '/^COPY public\./ { t = $2; sub(/^public\./, "", t); gsub(/"/, "", t); n = 0; inb = 1; next }
     inb && /^\\\.$/ { print t, n; inb = 0; next }
     inb { n++ }' "$dump" | sort >expected.txt

fail=0
: >restore-report.txt
while read -r t n; do
  got=$(psql -At -d "$db" -c "select count(*) from public.\"$t\"" 2>/dev/null || echo "missing")
  if [ "$got" != "$n" ]; then
    echo "MISMATCH $t: file $n, restored $got" >>restore-report.txt
    fail=1
  fi
done <expected.txt
tables=$(wc -l <expected.txt)
rows=$(awk '{ s += $2 } END { print s + 0 }' expected.txt)
# Links to people (sign-in accounts) cannot be made here: expected. Anything else is listed.
other=$(grep "ERROR" restore.log | grep -v "violates foreign key constraint" || true)
{
  echo "Tables: $tables, rows: $rows, all rows came back: $([ $fail = 0 ] && echo yes || echo NO)"
  if [ -n "$other" ]; then
    echo "Other statements that failed:"
    echo "$other" | sed 's/^psql:[^:]*:[0-9]*: //' | sort | uniq -c | sort -rn | head -20
  fi
} >>restore-report.txt
cat restore-report.txt
exit $fail
