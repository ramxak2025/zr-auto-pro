import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { createSessionBoundClient } from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { createOneCApi, type OneCEntityType } from '../../../../shared/api/oneC';
import { apiErrorMessage } from '../../../../shared/utils/apiError';
import { Button } from '../../ui/Button';
import { Card, CardHeader, CardBody } from '../../ui/Card';
import ConfirmDialog from '../ConfirmDialog';

const labels: Record<OneCEntityType, string> = {
  products: 'Номенклатура',
  stock: 'Остатки',
  clients: 'Клиенты',
  purchases: 'Закупки',
  workOrders: 'Заказ-наряды',
  payments: 'Оплаты',
};
const statuses: Record<string, string> = {
  applied: 'Применено',
  needs_review: 'Нужна сверка',
  rejected: 'Отклонено',
  exported: 'Передано',
  processing: 'Обрабатывается',
};

export default function OneCSettingsCard() {
  const { user, token } = useAuth();
  const identity = `${user?.tenantId}:${user?.id}`;
  return user && ['director', 'superadmin'].includes(user.role) ? (
    <ConnectionCard key={`${identity}:${token}`} identity={identity} token={token} />
  ) : null;
}

function ConnectionCard({ identity, token }: { identity: string; token: string | null }) {
  const exchange = useMemo(() => createOneCApi(createSessionBoundClient(token)), [token]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The key is deliberately never placed in the persisted query cache.
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pointId, setPointId] = useState('');
  const [rotate, setRotate] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [offset, setOffset] = useState(0);
  const settings = useQuery({
    queryKey: ['one-c', identity],
    queryFn: async () => (await exchange.getConnection()).data,
  });
  const journal = useQuery({
    queryKey: ['one-c-journal', identity, offset],
    queryFn: async () => (await exchange.journal({ limit: 20, offset })).data,
    enabled: showJournal && !!settings.data?.connection,
  });
  const connection = settings.data?.connection;
  const points = settings.data?.availablePoints ?? [];
  const selectedPoint = pointId || points[0]?.id || '';
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (alive.current) {
        await settings.refetch();
        if (showJournal) await journal.refetch();
      }
    } catch (e) {
      if (alive.current) setError(apiErrorMessage(e) ?? 'Не удалось обновить обмен с 1С');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Обмен с 1С" subtitle="1С:Управление нашей фирмой 3 · пилотное подключение" icon={RefreshCw} />
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-2">
          Для подключения специалист 1С настраивает обмен и сверяет данные на копии базы. До завершения проверки обмен
          приостановлен.
        </p>
        {settings.isLoading && <p role="status">Загрузка подключения…</p>}
        {settings.isError && (
          <div role="alert" className="space-y-2 text-bad-text">
            <p>Не удалось получить настройки 1С.</p>
            <Button variant="secondary" onClick={() => void settings.refetch()}>
              Повторить
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-bad-text">
            {error}
          </p>
        )}
        {settings.data && !connection && (
          <div className="space-y-3">
            <label className="block text-sm">
              Филиал для обмена
              <select
                value={selectedPoint}
                onChange={(e) => setPointId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-line bg-surface p-2 text-ink"
              >
                {points.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!selectedPoint}
              loading={busy}
              onClick={() =>
                void perform(async () => {
                  const response = await exchange.create({ pointId: selectedPoint });
                  setSecret(response.data.apiKey);
                })
              }
            >
              Подготовить подключение
            </Button>
          </div>
        )}
        {connection && (
          <>
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <p className="font-semibold">
                {connection.status === 'active' ? 'Обмен включён' : 'Обмен приостановлен'}
              </p>
              <p>{points.find((p) => p.id === connection.pointId)?.name ?? 'Выбранный филиал'}</p>
              <p className="text-ink-3">
                {connection.lastSeenAt
                  ? `Последнее соединение: ${new Date(connection.lastSeenAt).toLocaleString('ru-RU')}`
                  : '1С ещё не подключалась'}
              </p>
            </div>
            <p className="break-all text-xs text-ink-3">Код подключения: {connection.id}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="mb-2 text-left font-medium">Что синхронизировать</caption>
                <thead>
                  <tr>
                    <th className="text-left">Данные</th>
                    <th>В 1С</th>
                    <th>Из 1С</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(labels) as OneCEntityType[]).map((kind) => (
                    <tr key={kind} className="border-t border-line">
                      <td className="py-3">{labels[kind]}</td>
                      {(['export', 'import'] as const).map((direction) => (
                        <td className="text-center" key={direction}>
                          <input
                            type="checkbox"
                            aria-label={`${labels[kind]}: ${direction === 'export' ? 'в 1С' : 'из 1С'}`}
                            checked={connection.capabilities[kind][direction]}
                            disabled={busy || (direction === 'import' && !connection.mappingConfirmed)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              void perform(() =>
                                exchange.configure({
                                  capabilities: {
                                    ...connection.capabilities,
                                    [kind]: { ...connection.capabilities[kind], [direction]: checked },
                                  },
                                }),
                              );
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={connection.mappingConfirmed}
                disabled={busy || connection.status === 'active'}
                onChange={(e) => {
                  const checked = e.target.checked;
                  void perform(() => exchange.configure({ mappingConfirmed: checked }));
                }}
              />
              <span>Специалист проверил соответствие справочников и документов на копии базы 1С</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                loading={busy}
                disabled={connection.status !== 'active' && !connection.mappingConfirmed}
                onClick={() =>
                  void perform(() =>
                    exchange.configure({ status: connection.status === 'active' ? 'paused' : 'active' }),
                  )
                }
              >
                {connection.status === 'active' ? 'Приостановить обмен' : 'Включить обмен'}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setRotate(true)}>
                Заменить ключ
              </Button>
              <Button variant="ghost" onClick={() => setShowJournal(!showJournal)}>
                {showJournal ? 'Скрыть журнал' : 'Журнал обмена'}
              </Button>
            </div>
            {showJournal && (
              <div className="space-y-3">
                <Button size="sm" variant="ghost" loading={journal.isFetching} onClick={() => void journal.refetch()}>
                  Обновить журнал
                </Button>
                {journal.isError && <p role="alert">Не удалось загрузить журнал. Повторите обновление.</p>}
                {journal.isLoading && <p role="status">Загрузка журнала…</p>}
                {journal.data?.items.length === 0 && <p className="text-sm text-ink-3">Событий обмена пока нет.</p>}
                {journal.data?.items.map((item) => (
                  <article key={item.id} className="rounded-lg border border-line p-3 text-sm">
                    <p className="font-medium">
                      {labels[item.entityType]} · {statuses[item.status] ?? item.status}
                    </p>
                    <p className="break-words">{item.message}</p>
                    <p className="text-xs text-ink-3">
                      {new Date(item.createdAt).toLocaleString('ru-RU')} ·{' '}
                      {item.direction === 'import' ? 'Из 1С' : 'В 1С'}
                    </p>
                  </article>
                ))}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - 20))}
                  >
                    Назад
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!journal.data || offset + 20 >= journal.data.total}
                    onClick={() => setOffset(offset + 20)}
                  >
                    Далее
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {secret && (
          <div className="space-y-2 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">
              Ключ подключения показывается один раз. Сохраните его в настройках коннектора 1С.
            </p>
            <input
              aria-label="Ключ подключения 1С"
              readOnly
              type="password"
              value={secret}
              autoComplete="off"
              className="w-full rounded border border-line bg-surface p-2"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(secret)
                    .catch(() => setError('Не удалось скопировать ключ. Разрешите доступ к буферу обмена.'))
                }
              >
                Скопировать ключ
              </Button>
              <Button variant="ghost" onClick={() => setSecret('')}>
                Ключ сохранён
              </Button>
            </div>
          </div>
        )}
      </CardBody>
      <ConfirmDialog
        isOpen={rotate}
        onClose={() => setRotate(false)}
        onConfirm={() => {
          setRotate(false);
          void perform(async () => {
            const result = await exchange.rotateKey();
            setSecret(result.data.apiKey);
          });
        }}
        title="Заменить ключ 1С?"
        message="Старый ключ перестанет работать. Новый нужно сохранить в коннекторе 1С."
        confirmText="Заменить ключ"
      />
    </Card>
  );
}
