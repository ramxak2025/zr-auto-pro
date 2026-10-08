import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createShiftsApi } from '../../../shared/api/createServices';
import type { NfcSession } from '../../../shared/utils/pendingNfc';
import { createSessionBoundClient } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { captureNfcSessionGeneration } from '../utils/nfcSessionGeneration';
import { createNfcSessionRefresh } from '../utils/nfcSessionRefresh';

export const NFC_STATUS_QUERY_KEY = ['shifts', 'nfc-status'] as const;
export const MY_SHIFTS_QUERY_KEY = ['shifts', 'my'] as const;
const leaseIds = new WeakMap<object, number>();
let nextLeaseId = 1;
export function nfcSessionCacheId(session: NfcSession | null): number | 'none' {
  if (!session) return 'none';
  let id = leaseIds.get(session.lease);
  if (!id) {
    id = nextLeaseId++;
    leaseIds.set(session.lease, id);
  }
  return id;
}
export function nfcStatusQueryKey(session: NfcSession | null) {
  return nfcStatusQueryKeyForLease(session?.lease);
}
export function nfcStatusQueryKeyForLease(lease: object | undefined) {
  if (!lease) return [...NFC_STATUS_QUERY_KEY, 'none'] as const;
  let id = leaseIds.get(lease);
  if (!id) {
    id = nextLeaseId++;
    leaseIds.set(lease, id);
  }
  return [...NFC_STATUS_QUERY_KEY, id] as const;
}
export function nfcTagsQueryKey(session: NfcSession | null) {
  return ['shifts', 'nfc-tags', nfcSessionCacheId(session)] as const;
}

export function useAttendanceNfcSession() {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const tenantId = user?.tenantId ?? user?.tenant?.id ?? '';
  const userId = user?.id ?? '';
  const pointId = user?.currentPointId ?? null;
  const identity = JSON.stringify([tenantId, userId, pointId, token]);
  const sessionScope = captureNfcSessionGeneration(identity);
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const api = useMemo(() => (token ? createShiftsApi(createSessionBoundClient(token)) : null), [token]);
  const session = useMemo<NfcSession | null>(() => {
    if (!token || !tenantId || !userId || !api) return null;
    const lease = {};
    const isCurrent = () => mountedRef.current && sessionScope.isCurrent();
    return {
      owner: { tenantId, userId, pointId },
      lease,
      isCurrent,
      refreshCurrent: createNfcSessionRefresh(api, queryClient, isCurrent, nfcStatusQueryKeyForLease(lease)),
    };
  }, [api, identity, pointId, queryClient, sessionScope.id, tenantId, token, userId]);

  return { api, session, user, token, sessionScope: sessionScope.id };
}
