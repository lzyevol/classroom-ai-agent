#!/usr/bin/env sh
set -eu

runtime_db="${SQLITE_DB_PATH:-/app/runtime/classroom.db}"

mkdir -p "$(dirname "$runtime_db")"

exec "$@"
