import { useQuery } from '@tanstack/react-query';
import { Check, Clock } from 'lucide-react';
import { knowledgeApi } from '../../api/services';
import { formatDateTime } from '../../../../shared/utils/formatters';
import Modal from '../Modal';
import QueryState from '../QueryState';
import { KEY } from './keys';
import { ProgressBar } from './ui';

const pctFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** «Кто ознакомился» — acknowledgment panel (manager). */
export default function AcksModal({ articleId, onClose }: { articleId: string; onClose: () => void }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: KEY.acks(articleId),
    queryFn: async () => (await knowledgeApi.listAcks(articleId)).data,
  });

  const percent = data && data.totalAudience > 0 ? (data.acknowledgedCount / data.totalAudience) * 100 : 0;

  return (
    <Modal isOpen onClose={onClose} title="Кто ознакомился" size="md">
      <QueryState
        isLoading={isLoading}
        isError={isError}
        onRetry={refetch}
        isFetching={isFetching}
        errorTitle="Не удалось загрузить список"
        minHeight="py-10"
      >
        {data && (
          <div className="space-y-5">
            {/* Progress */}
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">
                  <span className="tabular-nums">{data.acknowledgedCount}</span> из{' '}
                  <span className="tabular-nums">{data.totalAudience}</span> ознакомлены
                </span>
                <span className="text-sm font-semibold tabular-nums text-ok-text">{pctFmt.format(percent)}%</span>
              </div>
              <ProgressBar percent={percent} label="Доля ознакомившихся" />
            </div>

            {/* Acknowledged list */}
            <section aria-labelledby="acks-done">
              <h4 id="acks-done" className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                <Check className="h-3.5 w-3.5 text-ok" aria-hidden="true" /> Ознакомлены
                <span className="tabular-nums">({data.acknowledged.length})</span>
              </h4>
              {data.acknowledged.length === 0 ? (
                <p className="text-sm text-ink-3">Пока никто не ознакомился.</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.acknowledged.map((a) => (
                    <li key={a.userId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate text-sm font-medium text-ink">{a.userName}</span>
                      <span className="flex-shrink-0 text-xs tabular-nums text-ink-3">
                        {formatDateTime(a.acknowledgedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Pending list */}
            {data.pending.length > 0 && (
              <section aria-labelledby="acks-pending">
                <h4 id="acks-pending" className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                  <Clock className="h-3.5 w-3.5 text-warn" aria-hidden="true" /> Ожидают
                  <span className="tabular-nums">({data.pending.length})</span>
                </h4>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {data.pending.map((p) => (
                    <li key={p.userId} className="px-3 py-2 text-sm text-ink-2">
                      {p.userName}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </QueryState>
    </Modal>
  );
}
