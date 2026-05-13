import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { checksApi } from '../api/services';
import { formatMoney } from '../../../shared/utils/formatters';

/**
 * Small badge that surfaces the most recent visit for a client/car combo.
 * Used inside the cash screen, right under the selected-client card, so the
 * master immediately sees when this customer was here last and on which car.
 */
interface LastVisitBadgeProps {
  clientId?: string;
  carId?: string;
  /** Inline (compact, one-line) vs block (multi-line) layout. */
  variant?: 'inline' | 'block';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} в ${time}`;
}

export default function LastVisitBadge({ clientId, carId, variant = 'block' }: LastVisitBadgeProps) {
  const enabled = !!clientId || !!carId;
  const { data, isLoading } = useQuery({
    queryKey: ['last-visit', { clientId, carId }],
    queryFn: async () => {
      const res = await checksApi.getLastVisit({ clientId, carId });
      return res.data;
    },
    enabled,
    // Cache for a minute — visits don't change often.
    staleTime: 60_000,
  });

  if (!enabled) return null;
  if (isLoading) {
    return (
      <div className="mt-2 text-xs text-gray-400 flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        Ищем последний визит…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mt-2 text-xs text-gray-500 flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        Это первый визит клиента
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="text-xs text-gray-600 flex items-center gap-1.5">
        <Clock className="w-3 h-3" />
        Последний визит: {formatDate(data.date)} · {formatMoney(data.totalRevenue)} ₽
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-green-200/70 text-xs">
      <div className="flex items-center gap-1.5 text-gray-700 font-medium">
        <Clock className="w-3.5 h-3.5 text-gray-500" />
        Последний визит
      </div>
      <div className="mt-0.5 text-gray-600">
        {formatDate(data.date)}
        {data.masterName && <> · мастер {data.masterName}</>}
        {' · '}
        <span className="font-semibold text-gray-900">{formatMoney(data.totalRevenue)} ₽</span>
        {data.carPlate && (
          <>
            {' · '}
            <span className="font-mono">{data.carPlate}</span>
            {data.carMakeModel && <> ({data.carMakeModel})</>}
          </>
        )}
      </div>
    </div>
  );
}
