import { ownsProcurementOutcome, runOwnedProcurement } from '../../../shared/utils/procurementSession';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createSessionBoundClient } from '../api/axios';
import { inspectStoredSession, readStoredToken } from '../utils/sessionToken';
import { durableProcurement } from '../utils/procurementStorage';
import type { PendingProcurement, ProcurementOwner, ProcurementTarget } from '../../../shared/utils/durableProcurement';

/** Recovery is independent of the form, its refetch, and the current date. */
export function useProcurementRecovery(filter: Partial<ProcurementTarget> = {}) {
  const { user, token } = useAuth();
  const owner = useMemo<ProcurementOwner | null>(
    () =>
      user?.tenantId && token
        ? { tenantId: user.tenantId, userId: user.id, pointId: user.currentPointId ?? null }
        : null,
    [user?.tenantId, user?.id, user?.currentPointId, token],
  );
  const lease = useMemo(() => ({ owner }), [owner]);
  const client = useMemo(() => createSessionBoundClient(token), [token]);
  const active = useRef(token);
  const activeLease = useRef(lease);
  activeLease.current = lease;
  const mounted = useRef(true);
  active.current = token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () =>
      mounted.current &&
      active.current === token &&
      activeLease.current === lease &&
      token !== null &&
      inspectStoredSession() === 'own' &&
      readStoredToken() === token,
    [token, lease],
  );
  const [records, setRecords] = useState<PendingProcurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!owner || !isCurrent()) return;
    setLoading(true);
    try {
      const rows = await durableProcurement.list(owner, isCurrent);
      if (isCurrent()) {
        setRecords(rows);
        setError(null);
      }
    } catch (err) {
      if (isCurrent()) setError(err instanceof Error ? err.message : 'Не удалось прочитать сохранённые операции');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [owner, isCurrent]);
  useEffect(() => {
    if (!owner) {
      setRecords([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [owner, refresh]);
  const execute = useCallback(
    async <T>(target: ProcurementTarget, payload?: object) => {
      if (!owner || !isCurrent()) throw new Error('Сессия изменилась. Откройте операцию в нужном аккаунте.');
      setBusy(true);
      return runOwnedProcurement({
        lease,
        isCurrent,
        dispatch: () =>
          durableProcurement.execute<T>({
            owner,
            target,
            payload,
            isCurrent,
            send: (path, body) => client.post<T>(path, body, { headers: { 'Content-Type': 'application/json' } }),
          }),
        refresh: async () => {
          if (isCurrent()) {
            setBusy(false);
            await refresh();
          }
        },
      });
    },
    [owner, isCurrent, client, refresh, lease],
  );
  const pending = isCurrent()
    ? records.filter(
        (record) =>
          owner &&
          record.owner.tenantId === owner.tenantId &&
          record.owner.userId === owner.userId &&
          record.owner.pointId === owner.pointId &&
          (!filter.operation || record.target.operation === filter.operation) &&
          (!filter.sourceId || record.target.sourceId === filter.sourceId) &&
          (!filter.contextId || record.target.contextId === filter.contextId),
      )
    : [];
  const resume = <T>(record: PendingProcurement) => execute<T>(record.target);
  const owns = (value: unknown) => ownsProcurementOutcome(value, lease, isCurrent);
  return { pending, loading, error, busy, refresh, isCurrent, owns, execute, resume };
}
export type ProcurementRecovery = ReturnType<typeof useProcurementRecovery>;
