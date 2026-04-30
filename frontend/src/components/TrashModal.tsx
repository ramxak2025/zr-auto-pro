/**
 * TrashModal — paginated list of soft-deleted products with two
 * irreversible actions: "Restore" (back to live) and "Delete forever"
 * (hard delete that bypasses the trash). A footer button empties the
 * whole bin in one call.
 *
 * Lives behind a Modal — uses the existing animated Modal so it inherits
 * spring entrance + Esc-to-close + body scroll lock.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Trash2, RotateCcw, AlertCircle, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from './Modal';
import EmptyState from './EmptyState';
import LoadingSpinner from './LoadingSpinner';
import { productsApi } from '../api/services';
import type { Product } from '../types';

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const formatMoney = (v: number): string =>
  Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';

const formatDate = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' '
    + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const { data: items, isLoading } = useQuery<Product[]>({
    queryKey: ['products-trash'],
    queryFn: async () => { const res = await productsApi.getTrash(); return res.data; },
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
  };

  const restoreMut = useMutation({
    mutationFn: (id: string) => productsApi.restore(id),
    onSuccess: () => { invalidateAll(); toast.success('Восстановлено'); },
    onError: () => toast.error('Не удалось восстановить'),
  });

  const hardDeleteMut = useMutation({
    mutationFn: (id: string) => productsApi.hardDelete(id),
    onSuccess: () => { invalidateAll(); toast.success('Удалено навсегда'); },
    onError: () => toast.error('Не удалось удалить'),
  });

  const emptyMut = useMutation({
    mutationFn: () => productsApi.emptyTrash(),
    onSuccess: (res: { data: { count: number } }) => {
      invalidateAll();
      setConfirmEmpty(false);
      toast.success(`Корзина очищена (${res.data.count} шт)`);
    },
    onError: () => toast.error('Не удалось очистить'),
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Корзина склада" size="lg">
      <div className="flex flex-col gap-3" style={{ minHeight: 'min(60dvh, 480px)' }}>
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию"
            className="input pl-9"
          />
        </div>

        {/* List */}
        {isLoading ? (
          <LoadingSpinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title={items && items.length > 0 ? 'Ничего не найдено' : 'Корзина пуста'}
            description={items && items.length > 0
              ? 'Попробуйте изменить поиск.'
              : 'Удалённые товары сохраняются здесь и могут быть восстановлены.'}
          />
        ) : (
          <ul className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
            {filtered.map((p, idx) => (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: Math.min(idx * 0.02, 0.18) }}
                className="card flex items-center gap-3 px-3 py-2.5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-500 flex-shrink-0">
                  <Trash2 className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {p.category || 'Без папки'}
                    <span className="mx-1.5 text-gray-300">·</span>
                    Цена {formatMoney(p.sellPrice)}
                    {(p as Product & { deletedAt?: string; deleted_at?: string }).deletedAt && (
                      <>
                        <span className="mx-1.5 text-gray-300">·</span>
                        <span className="text-gray-400">
                          {formatDate((p as Product & { deletedAt?: string }).deletedAt)}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => restoreMut.mutate(p.id)}
                    disabled={restoreMut.isPending}
                    title="Восстановить"
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Удалить "${p.name}" навсегда? Восстановление будет невозможно.`)) {
                        hardDeleteMut.mutate(p.id);
                      }
                    }}
                    disabled={hardDeleteMut.isPending}
                    title="Удалить навсегда"
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.li>
            ))}
          </ul>
        )}

        {/* Empty trash footer */}
        {items && items.length > 0 && (
          <div className="border-t border-gray-100 pt-3 -mx-6 px-6">
            {confirmEmpty ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-100">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-700 flex-1">
                  Удалить все {items.length} товаров навсегда?
                </p>
                <button
                  type="button"
                  onClick={() => setConfirmEmpty(false)}
                  className="btn-ghost btn-sm"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => emptyMut.mutate()}
                  disabled={emptyMut.isPending}
                  className="btn-danger btn-sm"
                >
                  {emptyMut.isPending ? 'Удаляю…' : 'Да, удалить'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmEmpty(true)}
                className="btn-ghost w-full text-red-500"
              >
                <Trash2 className="h-4 w-4" />
                Очистить корзину ({items.length})
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
