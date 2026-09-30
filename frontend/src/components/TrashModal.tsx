/**
 * TrashModal — корзина склада: soft-deleted товары с двумя действиями —
 * «Восстановить» и «Удалить навсегда» (hard delete мимо корзины), плюс
 * «Очистить корзину» одним вызовом. Живёт в Modal (Escape, блокировка
 * прокрутки, возврат фокуса).
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import SearchInput from './SearchInput';
import QueryState from './QueryState';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Money } from '../ui/Money';
import { Skeleton } from '../ui/Skeleton';
import { productsApi } from '../api/services';
import type { Product } from '../types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { formatDateTime } from '../../../shared/utils/formatters';
import { countLabel } from './warehouse/format';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TrashedProduct = Product & { deletedAt?: string | null };

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<TrashedProduct | null>(null);

  const {
    data: items,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<TrashedProduct[]>({
    queryKey: ['products-trash'],
    queryFn: async () => {
      const res = await productsApi.getTrash();
      return res.data;
    },
    enabled: isOpen,
  });

  const filtered = useMemo(() => {
    const list = items ?? [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((p) => p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q));
  }, [items, search]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['products-trash'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['storage-cells'] });
  };

  const restoreMut = useMutation({
    mutationFn: (id: string) => productsApi.restore(id),
    onSuccess: () => {
      invalidateAll();
      toast.success('Восстановлено');
    },
    onError: () => toast.error('Не удалось восстановить'),
  });

  const hardDeleteMut = useMutation({
    mutationFn: (id: string) => productsApi.hardDelete(id),
    onSuccess: () => {
      invalidateAll();
      toast.success('Удалено навсегда');
    },
    // 409 приходит с объяснением: товар держат складские документы, заказ
    // поставщику или возврат — стереть его физически нельзя, иначе учёт за
    // закрытые периоды поедет. Показываем ИМЕННО текст сервера, иначе человек
    // видит «не удалось» и не понимает, что делать.
    onError: (err: unknown) => toast.error(apiErrorMessage(err) || 'Не удалось удалить'),
  });

  const emptyMut = useMutation({
    mutationFn: () => productsApi.emptyTrash(),
    onSuccess: (res: { data: { count: number; kept?: number } }) => {
      invalidateAll();
      setConfirmEmpty(false);
      const kept = res.data.kept ?? 0;
      // Часть товаров намеренно остаётся: по ним есть учётные документы.
      // Без этой строчки человек видит непустую корзину после «Очистить» и
      // решает, что кнопка сломалась.
      if (kept > 0) {
        toast.success(
          `Удалено ${res.data.count} шт. Оставлено ${kept} — по ним есть складские документы, они нужны отчётам.`,
          { duration: 6000 },
        );
      } else {
        toast.success(`Корзина очищена (${res.data.count} шт)`);
      }
    },
    onError: () => toast.error('Не удалось очистить'),
  });

  const hasItems = !!items && items.length > 0;

  const footer = hasItems ? (
    confirmEmpty ? (
      <div role="alert" className="flex flex-1 flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 flex-shrink-0 text-bad" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-bad-text">
          Удалить все {countLabel(items.length, ['товар', 'товара', 'товаров'])} навсегда?
        </p>
        <Button variant="secondary" size="sm" onClick={() => setConfirmEmpty(false)} disabled={emptyMut.isPending}>
          Отмена
        </Button>
        <Button variant="danger" size="sm" loading={emptyMut.isPending} onClick={() => emptyMut.mutate()}>
          Да, удалить
        </Button>
      </div>
    ) : (
      <Button
        variant="ghost"
        icon={Trash2}
        className="mr-auto text-bad-text hover:bg-bad-soft hover:text-bad-text"
        onClick={() => setConfirmEmpty(true)}
      >
        Очистить корзину ({items.length})
      </Button>
    )
  ) : undefined;

  const loader = (
    <ul className="space-y-1.5" aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
          <Skeleton className="h-9 w-9" />
          <div className="flex-1 space-y-1.5">
            <Skeleton variant="text" className={i % 2 ? 'w-2/3' : 'w-1/2'} />
            <Skeleton variant="text" className="w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Корзина склада"
      description="Удалённые товары можно восстановить или стереть навсегда"
      size="lg"
      footer={footer}
    >
      <div className="flex flex-col gap-3" style={{ minHeight: 'min(60dvh, 480px)' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Название или папка…"
          aria-label="Поиск в корзине"
        />

        <QueryState
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          isFetching={isFetching}
          loader={loader}
          isEmpty={filtered.length === 0}
          empty={{
            icon: Trash2,
            title: hasItems ? 'Ничего не найдено' : 'Корзина пуста',
            description: hasItems
              ? 'Попробуйте изменить поиск'
              : 'Удалённые товары сохраняются здесь и могут быть восстановлены',
          }}
          minHeight="py-10"
        >
          <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {filtered.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-bad-soft text-bad">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {p.category || 'Без папки'} · Цена <Money value={p.sellPrice} />
                    {p.deletedAt && <> · удалён {formatDateTime(p.deletedAt)}</>}
                  </p>
                </div>
                <IconButton
                  label={`Восстановить: ${p.name}`}
                  icon={RotateCcw}
                  size="sm"
                  onClick={() => restoreMut.mutate(p.id)}
                  disabled={restoreMut.isPending}
                />
                <IconButton
                  label={`Удалить навсегда: ${p.name}`}
                  icon={Trash2}
                  size="sm"
                  variant="danger"
                  onClick={() => setHardDeleteTarget(p)}
                  disabled={hardDeleteMut.isPending}
                />
              </li>
            ))}
          </ul>
        </QueryState>
      </div>

      <ConfirmDialog
        isOpen={!!hardDeleteTarget}
        onClose={() => setHardDeleteTarget(null)}
        onConfirm={() => hardDeleteTarget && hardDeleteMut.mutate(hardDeleteTarget.id)}
        title="Удалить навсегда?"
        message={`«${hardDeleteTarget?.name ?? ''}» будет стёрт без возможности восстановления.`}
        confirmText="Удалить навсегда"
        variant="danger"
      />
    </Modal>
  );
}
