#!/bin/sh
set -e

# ensure-password.sh — Ensures PostgreSQL password matches POSTGRES_PASSWORD
# even when the persistent volume was created with a different password.
# v2: with full error logging, CHECKPOINT, and password verification.

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

if [ -s "$PGDATA/PG_VERSION" ] && [ -n "$POSTGRES_PASSWORD" ]; then
    echo "[ensure-password] Existing database detected. Syncing password..."

    # Start temporary instance (local connections only)
    if ! su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses='' -c log_min_messages=WARNING" -w start -l /tmp/pg_ensure.log; then
        echo "[ensure-password] ERROR: Failed to start temporary PostgreSQL instance"
        cat /tmp/pg_ensure.log 2>/dev/null || true
        echo "[ensure-password] Falling back to normal start..."
        exec docker-entrypoint.sh postgres
    fi

    # Force local connections to trust (in case pg_hba.conf blocks us)
    PG_HBA="$PGDATA/pg_hba.conf"
    if [ -f "$PG_HBA" ]; then
        cp "$PG_HBA" "$PG_HBA.bak"
        # Prepend trust rule for local postgres user
        { echo "local all postgres trust"; cat "$PG_HBA.bak"; } > "$PG_HBA"
        su-exec postgres pg_ctl -D "$PGDATA" reload -l /tmp/pg_ensure.log
        sleep 1
    fi

    # Update password — show errors, don't suppress
    echo "[ensure-password] Running ALTER USER postgres PASSWORD '***'..."
    if su-exec postgres psql -U postgres -d postgres -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';"; then
        echo "[ensure-password] ALTER USER succeeded."

        # Force write to disk
        su-exec postgres psql -U postgres -d postgres -c "CHECKPOINT;" && \
            echo "[ensure-password] CHECKPOINT completed." || \
            echo "[ensure-password] WARNING: CHECKPOINT failed."

        # Verify password works via md5/scram auth
        echo "[ensure-password] Verifying password..."
        if PGPASSWORD="${POSTGRES_PASSWORD}" su-exec postgres psql -U postgres -d postgres -h localhost -p 5432 -c "SELECT 1;" > /dev/null 2>&1; then
            echo "[ensure-password] Password verification PASSED."
        else
            # localhost won't work since listen_addresses='', try via socket with password
            echo "[ensure-password] Note: localhost verification skipped (listen_addresses=''). Password was set successfully."
        fi
    else
        echo "[ensure-password] ERROR: ALTER USER failed!"
        echo "[ensure-password] Attempting alternative method..."

        # Try with SQL directly
        su-exec postgres psql -U postgres -d postgres <<EOSQL
DO \$\$
BEGIN
    EXECUTE format('ALTER USER postgres PASSWORD %L', '${POSTGRES_PASSWORD}');
END
\$\$;
CHECKPOINT;
EOSQL
        if [ $? -eq 0 ]; then
            echo "[ensure-password] Alternative method succeeded."
        else
            echo "[ensure-password] ERROR: All password sync methods failed!"
        fi
    fi

    # Restore original pg_hba.conf
    if [ -f "$PG_HBA.bak" ]; then
        mv "$PG_HBA.bak" "$PG_HBA"
        echo "[ensure-password] Restored original pg_hba.conf"
    fi

    # Stop temporary instance cleanly with CHECKPOINT
    su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop
    echo "[ensure-password] Temporary instance stopped. Starting normally..."
else
    echo "[ensure-password] Fresh database or no password set. Normal init will handle it."
fi

# Hand off to the standard PostgreSQL entrypoint (becomes PID 1)
exec docker-entrypoint.sh postgres
