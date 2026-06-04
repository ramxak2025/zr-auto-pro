import { useQuery } from '@tanstack/react-query';
import { ScrollText, User as UserIcon, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { adminApi } from '../../api/services';
import type { AuditLogEntry } from '../../types';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

// Human-readable labels for known audit actions; unknown actions show the raw key.
const ACTION_LABELS: Record<string, string> = {
  'tenant.create': 'Создан автосервис',
  'tenant.update': 'Изменён автосервис',
  'tenant.delete': 'Удалён автосервис',
  'tenant.extend': 'Продлена подписка',
  'tenant.assign_plan': 'Назначен тариф',
  'tenant.impersonate': 'Вход как владелец',
  'plan.create': 'Создан тариф',
  'plan.update': 'Изменён тариф',
  'plan.delete': 'Удалён тариф',
  'broadcast.create': 'Отправлена рассылка',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function actionBadgeClass(action: string): string {
  if (action.endsWith('.delete')) return 'badge-red';
  if (action.endsWith('.create') || action.endsWith('.extend')) return 'badge-green';
  if (action.includes('impersonate')) return 'badge-yellow';
  return 'badge-blue';
}

export default function AdminAuditLogPage() {
  const { data: entries, isLoading } = useQuery({
    queryKey: ['admin-audit-log'],
    queryFn: () => adminApi.listAuditLog(),
    select: (res) => res.data as AuditLogEntry[],
  });

  if (isLoading) return <LoadingSpinner />;

  const rows = entries ?? [];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Журнал действий</h1>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Журнал пуст"
          description="Действия администраторов платформы появятся здесь"
        />
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Действие</th>
                <th>Кто</th>
                <th>Объект</th>
                <th>Когда</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const when = (() => {
                  try {
                    return format(parseISO(entry.createdAt), 'd MMM yyyy, HH:mm', { locale: ru });
                  } catch {
                    return entry.createdAt;
                  }
                })();
                return (
                  <tr key={entry.id}>
                    <td>
                      <span className={actionBadgeClass(entry.action)}>{actionLabel(entry.action)}</span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-gray-700">
                        <UserIcon className="w-3.5 h-3.5 text-gray-400" />
                        {entry.actorName || 'Система'}
                      </span>
                    </td>
                    <td>
                      {entry.targetName || entry.targetType ? (
                        <span className="text-gray-700">
                          {entry.targetName || entry.targetId}
                          {entry.targetType && (
                            <span className="text-gray-400 ml-1.5 text-xs">({entry.targetType})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 text-gray-500 whitespace-nowrap">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {when}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
