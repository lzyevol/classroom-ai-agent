#!/usr/bin/env sh
set -eu

runtime_db="${SQLITE_DB_PATH:-/app/runtime/classroom.db}"
seed_db="${SQLITE_SEED_DB_PATH:-/app/seed/classroom.db}"

mkdir -p "$(dirname "$runtime_db")"
if [ ! -f "$runtime_db" ]; then
  if [ ! -f "$seed_db" ]; then
    echo "SQLite seed database is missing: $seed_db" >&2
    exit 1
  fi
  cp "$seed_db" "$runtime_db"
  echo "Initialized SQLite runtime database at $runtime_db"
fi

exec "$@"
