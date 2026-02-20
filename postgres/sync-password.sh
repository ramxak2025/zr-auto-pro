#!/usr/bin/env bash
set -e

# Start postgres via the original entrypoint
docker-entrypoint.sh "$@" &
PG_PID=$!

# Forward signals for graceful shutdown
trap "kill -TERM $PG_PID" TERM INT

# Wait for postgres to accept connections, then sync password
(
    until pg_isready -q -U "${POSTGRES_USER:-postgres}" 2>/dev/null; do
        sleep 0.5
    done
    psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" \
        -c "ALTER USER \"${POSTGRES_USER:-postgres}\" WITH PASSWORD '${POSTGRES_PASSWORD}';" \
        2>/dev/null || true
) &

# Keep container alive with the postgres process
wait $PG_PID
