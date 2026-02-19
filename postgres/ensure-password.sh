#!/bin/bash
set -e

# ensure-password.sh — Ensures PostgreSQL password matches POSTGRES_PASSWORD
# even when the persistent volume was created with a different password.
#
# Problem: POSTGRES_PASSWORD only works on first initialization.
# If the volume already has data, the old password persists.
# This script fixes that by updating the password before normal startup.

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

if [ -s "$PGDATA/PG_VERSION" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    echo "[ensure-password] Existing database detected. Syncing password..."

    # Start PostgreSQL temporarily (local socket only, no network)
    pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start -l /tmp/pg_ensure.log

    # Update password to match current POSTGRES_PASSWORD env var
    # Local socket uses 'trust' auth by default in the postgres Docker image
    psql -U postgres -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';" 2>/dev/null && \
        echo "[ensure-password] Password synced successfully." || \
        echo "[ensure-password] Password sync skipped (already correct or trust auth)."

    # Stop temporary instance cleanly
    pg_ctl -D "$PGDATA" -m fast -w stop
    echo "[ensure-password] Temporary instance stopped. Starting normally..."
else
    echo "[ensure-password] Fresh database or no password set. Normal init will handle it."
fi

# Hand off to the standard PostgreSQL entrypoint (becomes PID 1)
exec docker-entrypoint.sh postgres
