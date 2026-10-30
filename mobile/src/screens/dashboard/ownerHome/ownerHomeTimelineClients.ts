import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OwnerHomeTimeline, OwnerHomeVisits, OwnerHomeVisitsQuery } from '../../../../../shared/types/ownerHome';
import { formatDayKey } from '../../../../../shared/utils/formatters';
import { reportsApi } from '../../../api/services';
import { loadOwnerHome, type OwnerHomeScope } from './ownerHomeState';
import type { OwnerTimelinePoint } from './ownerHomeTimelineModel';

export interface OwnerTimelineClientsTarget {
  range: OwnerHomeVisitsQuery;
  timezone: string;
  pointId: string | null;
  label: string;
  identity: string;
}

/** Visits are civil-day facts. An inspected hour must never acquire an hourly count. */
export function ownerTimelineClientsTarget(
  data: OwnerHomeTimeline,
  point: OwnerTimelinePoint | null,
): OwnerTimelineClientsTarget | null {
  try {
    let range = data.visitsRange;
    if (point) {
      const start = Date.parse(point.at),
        end = Date.parse(point.untilExclusive);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      range = {
        from: formatDayKey(new Date(start), data.timezone),
        // At midnight an allocation-only point still belongs to the new civil day.
        to: formatDayKey(new Date(Math.max(start, end - 1)), data.timezone),
      };
    }
    return {
      range,
      timezone: data.timezone,
      pointId: data.pointId,
      label: point && data.range.period === 'day' ? 'Клиенты за день' : 'Клиенты',
      identity: JSON.stringify([range.from, range.to, data.timezone, data.pointId]),
    };
  } catch {
    return null;
  }
}

/** A cache hit is useful only for this exact civil range, timezone and service point. */
export function ownerTimelineClientsCount(
  data: OwnerHomeVisits | undefined,
  target: OwnerTimelineClientsTarget | null,
): number | null {
  if (
    !data ||
    !target ||
    data.period?.from !== target.range.from ||
    data.period?.to !== target.range.to ||
    data.timezone !== target.timezone ||
    data.pointId !== target.pointId ||
    data.basis !== 'first_recorded_service_visit' ||
    ![data.servedClients, data.newClients, data.returningClients].every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    data.newClients + data.returningClients !== data.servedClients
  )
    return null;
  return data.servedClients;
}

export function useOwnerTimelineClients(
  data: OwnerHomeTimeline,
  point: OwnerTimelinePoint | null,
  scope: OwnerHomeScope,
  active: boolean,
) {
  const target = ownerTimelineClientsTarget(data, point);
  const identity = `${JSON.stringify(scope.key)}:${target?.identity ?? ''}`;
  const usesPeriodRange =
    !!target && target.range.from === data.visitsRange.from && target.range.to === data.visitsRange.to;
  const hasTarget = !!target;
  const [settled, setSettled] = useState<string | null>(null);
  const live = useRef({ identity, active, scope });
  live.current = { identity, active, scope };
  useEffect(() => {
    if (!active || !live.current.scope.isCurrent() || !hasTarget || usesPeriodRange || settled === identity) return;
    const timer = setTimeout(() => {
      if (live.current.active && live.current.scope.isCurrent() && live.current.identity === identity)
        setSettled(identity);
    }, 180);
    return () => clearTimeout(timer);
  }, [active, identity, hasTarget, usesPeriodRange, settled]);

  // The parent owns the full-period fetch; the disabled observer reuses its cache.
  // During scrubbing there is no observer or request for each intermediate day.
  const ready = usesPeriodRange || settled === identity;
  const requested = ready ? target : null;
  const query = useQuery({
    queryKey: ['owner-home', ...scope.key, 'visits', requested?.range.from ?? null, requested?.range.to ?? null],
    queryFn: async () => {
      if (!requested || !live.current.active || (!usesPeriodRange && live.current.identity !== identity))
        throw new Error('Интервал изменился');
      const response = await loadOwnerHome(scope, () => reportsApi.ownerHomeVisits(requested.range));
      if (ownerTimelineClientsCount(response, requested) === null) throw new Error('Период клиентов не совпал');
      return response;
    },
    enabled: active && scope.isCurrent() && !!requested && !usesPeriodRange,
    staleTime: 30_000,
    placeholderData: undefined,
    retry: false,
  });
  const available = active && scope.isCurrent() && !!target;
  const count = available && !query.isError ? ownerTimelineClientsCount(query.data, requested) : null;
  const status = !available
    ? 'unavailable'
    : count !== null
      ? 'ready'
      : ready && (query.isError || !!query.data)
        ? 'error'
        : 'loading';
  const retry = () => {
    if (ready && live.current.active && live.current.scope.isCurrent() && live.current.identity === identity)
      void query.refetch();
  };
  return { count, status, label: target?.label ?? 'Клиенты', retry };
}
