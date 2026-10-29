import { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../../api/services';
import { useAuth } from '../../../contexts/AuthContext';
import { captureDataSession } from '../../../contexts/dataSession';
import { updateWidgetData, type OwnerWidgetData } from '../../../utils/widgetBridge';
import { loadOwnerHome, ownerHomeEnabled, type OwnerHomeScope } from './ownerHomeState';

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Mounted only during an active/focused pilot visit, independently of its selected historical date. */
export default function OwnerHomeWidgetSync({ scope, enabled }: { scope: OwnerHomeScope; enabled: boolean }) {
  const { user } = useAuth();
  const lease = useMemo(() => captureDataSession(), []);
  const lastWritten = useRef<OwnerWidgetData | null>(null);
  const canQuery =
    enabled &&
    Platform.OS === 'ios' &&
    AppState.currentState === 'active' &&
    ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role) &&
    !!lease.owner &&
    lease.isCurrent() &&
    scope.isCurrent();
  const query = useQuery({
    queryKey: ['owner-home', ...scope.key, 'native-widget-today'],
    queryFn: () => loadOwnerHome(scope, () => reportsApi.dashboardV2({ period: 'today' })),
    enabled: canQuery,
    staleTime: 60_000,
    // Re-entering the screen must verify today, not re-stamp a cached pre-activation payload.
    refetchOnMount: 'always',
    placeholderData: undefined,
  });
  const ready =
    canQuery &&
    query.isSuccess &&
    query.isFetchedAfterMount &&
    !query.isPending &&
    !query.isError &&
    !query.isPlaceholderData;
  const revenue = query.data?.revenueToday;
  const profitToday = query.data?.netProfitToday;
  const checksCount = query.data?.checksToday;
  const openOrders = query.data?.deferredSum?.count;

  useEffect(() => {
    if (!ready || AppState.currentState !== 'active' || !lease.isCurrent() || !scope.isCurrent()) return;
    if (!finiteNumber(revenue) || !finiteNumber(profitToday) || !finiteNumber(checksCount) || !finiteNumber(openOrders))
      return;
    const previous = lastWritten.current;
    if (
      previous &&
      previous.revenue === revenue &&
      previous.profitToday === profitToday &&
      previous.checksCount === checksCount &&
      previous.openOrders === openOrders
    )
      return;
    // Retain the existing widget's operating-profit contract. The new accrual/day/MTD view is separate.
    const payload: OwnerWidgetData = { role: 'owner', revenue, profitToday, checksCount, openOrders };
    updateWidgetData(payload, lease);
    lastWritten.current = payload;
    // Scope changes remount the parent; numeric deps prevent writes for fresh objects with identical KPIs.
  }, [ready, revenue, profitToday, checksCount, openOrders, lease]);

  return null;
}
