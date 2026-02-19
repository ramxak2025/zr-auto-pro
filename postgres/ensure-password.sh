#!/bin/sh
set -e

# ensure-password.sh — Ensures PostgreSQL password matches POSTGRES_PASSWORD
# even when the persistent volume was created with a different password.

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

if [ -s "$PGDATA/PG_VERSION" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    echo "[ensure-password] Existing database detected. Syncing password..."

    # PostgreSQL refuses to run as root, use su-exec to run as postgres user
    su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start -l /tmp/pg_ensure.log

    # Update password to match current POSTGRES_PASSWORD env var
    su-exec postgres psql -U postgres -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';" 2>/dev/null && \
        echo "[ensure-password] Password synced successfully." || \
        echo "[ensure-password] Password sync skipped."

    # Stop temporary instance cleanly
    su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop
    echo "[ensure-password] Starting normally..."
else
    echo "[ensure-password] Fresh database. Normal init will handle it."
fi

# Hand off to the standard PostgreSQL entrypoint (becomes PID 1)
exec docker-entrypoint.sh postgres
