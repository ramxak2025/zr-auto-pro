import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Home, Info } from 'lucide-react';
import toast from 'react-hot-toast';

import { pointsApi } from '../api/services';
import { POINTS_QUERY_KEY, pointKindLabel, usePointsQuery } from '../hooks/usePoints';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import ConfirmDialog from './ConfirmDialog';
import InlineLoader from './InlineLoader';
import Modal from './Modal';
import { ErrorRow } from './dashboard/shared';
import { apiErrorMessage } from '../../../shared/utils/apiError';

/**
 * UserPointsModal — «НА КАКИХ ФИЛИАЛАХ МОЖЕТ РАБОТАТЬ СОТРУДНИК» (163).
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «чтобы в пользователях была настройка, на
 * каких филиалах они могут работать». Это ответ про ЧЕЛОВЕКА, поэтому живёт в
 * его карточке («Пользователи» → сотрудник), а раздел «Филиалы» показывает
 * состав только для просмотра.
 *
 * ЧТО ЭТО ЗНАЧИТ ДЛЯ ЧЕЛОВЕКА. Отмеченные филиалы — те, что он увидит в списке
 * при ВХОДЕ (филиал выбирается один раз, при входе, и живёт в сессии). Пустой
 * набор — НЕ «доступов нет», а «не ограничен»: доступны все живые филиалы.
 * Подпись обязана говорить об этом прямо, иначе владелец снимет все галочки,
 * решив, что заблокировал человека, и получит ровно обратное.
 *
 * ПОЧЕМУ СОХРАНЕНИЕ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ. Снятие филиала НЕМЕДЛЕННО
 * обесточивает сессии сотрудника в нём: его следующий запрос получит 401
 * «Филиал больше не доступен — войдите заново». Владелец обязан знать об этом
 * ДО нажатия, а не узнавать по звонку мастера.
 *
 * ПРАВО — user_management, тот же ключ, что гейтит PUT /users/:id/points на
 * сервере. Вызывающая страница сама решает, показывать ли вход; без права
 * запрос всё равно вернёт 403.
 */
export interface UserPointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Кому настраиваем доступ. */
  userId: string;
  /** Имя — в подзаголовке: владелец должен видеть, чью карточку правит. */
  userName: string;
}

/** Ключ набора филиалов ОДНОГО сотрудника. Отдельный от ['points'] — разные данные. */
export const userPointsQueryKey = (userId: string) => ['user-points', userId] as const;

export default function UserPointsModal({ isOpen, onClose, userId, userName }: UserPointsModalProps) {
  const queryClient = useQueryClient();

  // Живые филиалы тенанта — тот же ключ ['points'], что у индикатора и раздела:
  // лишней сети нет, слот почти всегда уже прогрет.
  const { data: pointsData, isLoading: pointsLoading } = usePointsQuery();
  const points = pointsData?.points ?? [];

  const {
    data: assigned,
    isError: assignedError,
    refetch: refetchAssigned,
    isFetching: assignedFetching,
  } = useQuery({
    queryKey: userPointsQueryKey(userId),
    queryFn: async () => (await pointsApi.userPoints(userId)).data.pointIds,
    // Открыто окно — есть запрос. Закрыто — не тратим сеть на каждую строку
    // списка сотрудников.
    enabled: isOpen,
    staleTime: 30_000,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Пере-засеваем локальный выбор ответом сервера, пока владелец ничего не
  // трогал. Иначе фоновый refetch затирал бы уже проставленные галочки.
  useEffect(() => {
    if (!isOpen) {
      setDirty(false);
      setConfirmOpen(false);
      return;
    }
    if (!dirty && assigned) setSelected(assigned);
  }, [isOpen, assigned, dirty]);

  const toggle = (pointId: string) => {
    setDirty(true);
    setSelected((prev) => (prev.includes(pointId) ? prev.filter((id) => id !== pointId) : [...prev, pointId]));
  };

  const saveMutation = useMutation({
    mutationFn: async (pointIds: string[]) => (await pointsApi.setUserPoints(userId, pointIds)).data.pointIds,
    onSuccess: (applied) => {
      setDirty(false);
      // Сервер отбрасывает архивные филиалы — источник правды его ответ.
      queryClient.setQueryData(userPointsQueryKey(userId), applied);
      // memberIds в разделе «Филиалы» изменились этой же правкой.
      queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
      toast.success('Филиалы сотрудника сохранены');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err) ?? 'Не удалось сохранить филиалы сотрудника'),
  });

  /**
   * Готовы ли ПОКАЗЫВАТЬ галочки. Пока набор сотрудника не приехал, `selected`
   * пуст — а пустой набор в этой настройке означает «не ограничен». Отрисовать
   * его как факт значило бы показать владельцу неправду и дать нажать
   * «Сохранить», стерев реальные назначения. Поэтому до ответа — только
   * индикатор загрузки, и кнопка сохранения выключена.
   */
  const ready = !pointsLoading && assigned !== undefined;

  // Кого выгоняем из смены прямо сейчас: филиалы, которые были и снялись.
  const removedNames = points
    .filter((p) => (assigned ?? []).includes(p.id) && !selected.includes(p.id))
    .map((p) => p.name)
    .join(', ');
  const consequence =
    selected.length === 0
      ? `${userName} сможет работать в любом филиале — ограничение снимается.`
      : removedNames
        ? `Доступ к «${removedNames}» будет снят. Если ${userName} сейчас работает там, страница попросит его войти заново.`
        : `${userName} сможет входить только в отмеченные филиалы.`;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Филиалы сотрудника"
        description={userName}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={saveMutation.isPending || !ready || points.length === 0}
              loading={saveMutation.isPending}
            >
              Сохранить
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-2">
            Отметьте филиалы, в которые сотрудник сможет войти. Филиал выбирается при входе, а чтобы перейти в другой —
            нужно выйти и войти заново.
          </p>

          {assignedError ? (
            <ErrorRow
              message="Не удалось загрузить филиалы сотрудника"
              onRetry={() => refetchAssigned()}
              loading={assignedFetching}
            />
          ) : !ready ? (
            <InlineLoader minHeight="py-8" />
          ) : points.length === 0 ? (
            <p className="text-sm text-ink-3">У автосервиса нет филиалов — настраивать нечего.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {points.map((point) => {
                const Icon = point.isMain ? Home : Building2;
                return (
                  <li key={point.id} className="px-3.5 py-2.5">
                    <Checkbox
                      checked={selected.includes(point.id)}
                      onChange={() => toggle(point.id)}
                      label={
                        <span className="inline-flex items-center gap-2 font-medium">
                          <Icon className="h-4 w-4 text-ink-3" aria-hidden="true" />
                          {point.name}
                        </span>
                      }
                      description={
                        point.address ? `${pointKindLabel(point)} · ${point.address}` : pointKindLabel(point)
                      }
                      className="w-full"
                    />
                  </li>
                );
              })}
            </ul>
          )}

          {/* Пустой набор — самая опасная для понимания часть настройки:
              галочек нет, а доступ ЕСТЬ ко всему. Пишем это явно и там, где
              владелец увидит подпись ровно в момент, когда снял последнюю. */}
          {ready && points.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-surface-2 px-4 py-3 text-xs leading-relaxed text-ink-2">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-3" aria-hidden="true" />
              <span>
                {selected.length === 0
                  ? 'Ни один филиал не отмечен — сотрудник не ограничен и может войти в любой филиал.'
                  : 'Сотрудник увидит при входе только отмеченные филиалы.'}
              </span>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => saveMutation.mutate(selected)}
        title="Сохранить филиалы сотрудника?"
        message={consequence}
        confirmText="Сохранить"
        variant="primary"
      />
    </>
  );
}
