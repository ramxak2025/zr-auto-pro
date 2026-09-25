import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import { shiftsApi } from '../../api/services';
import type { Shift } from '../../types';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { StatusPill } from '../../ui/Badge';

/** Открыть/закрыть свою смену (сотрудники; владельцу не показывается). */
export default function ShiftControl() {
  const queryClient = useQueryClient();
  const { data: myShifts } = useQuery<Shift[]>({
    queryKey: ['shifts', 'my'],
    queryFn: async () => {
      const res = await shiftsApi.getMy();
      return res.data;
    },
    staleTime: 10_000,
  });

  const openShift = useMutation({
    mutationFn: () => shiftsApi.open(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      toast.success('Смена открыта');
    },
    onError: (err: unknown) => toast.error(errorMessage(err)),
  });

  const closeShift = useMutation({
    mutationFn: (id: string) => shiftsApi.close(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
      toast.success('Смена закрыта');
    },
    onError: (err: unknown) => toast.error(errorMessage(err)),
  });

  const currentShift = myShifts?.find((s) => !s.closedAt);
  const isLoading = openShift.isPending || closeShift.isPending;

  return (
    <Card padding="sm" className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <StatusPill tone={currentShift ? 'ok' : 'neutral'} live={!!currentShift}>
          {currentShift ? 'Смена открыта' : 'Смена закрыта'}
        </StatusPill>
        {currentShift && (
          <span className="truncate text-sm tabular-nums text-ink-3">
            с {new Date(currentShift.openedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      {currentShift ? (
        <Button
          variant="secondary"
          icon={Square}
          onClick={() => closeShift.mutate(currentShift.id)}
          loading={isLoading}
        >
          Закрыть
        </Button>
      ) : (
        <Button variant="primary" icon={Play} onClick={() => openShift.mutate()} loading={isLoading}>
          Открыть смену
        </Button>
      )}
    </Card>
  );
}

function errorMessage(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } } } | undefined;
  return e?.response?.data?.message || 'Ошибка';
}
