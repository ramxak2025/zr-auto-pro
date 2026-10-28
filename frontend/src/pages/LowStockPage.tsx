import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import PageHeader from '../components/PageHeader';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { SkeletonCard } from '../ui/Skeleton';
import { ErrorRow } from '../components/dashboard/shared';

export default function LowStockPage() {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('warehouse_access');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['products', 'low-stock-list', user?.id, user?.currentPointId, page],
    queryFn: async () => (await productsApi.getAll({ lowStock: true, warehouseId: 'all', page, limit: 50 })).data,
    enabled: allowed,
    placeholderData: undefined,
  });
  if (!allowed) return <p className="text-ink-3">Нет доступа к складу</p>;
  return (
    <div className="space-y-5">
      <PageHeader
        composition="navigation"
        title="Товары на исходе"
        subtitle="Остаток не выше минимального · все склады текущего филиала"
        actions={<Link to="/products">Открыть склад</Link>}
      />
      {query.isLoading ? (
        <SkeletonCard lines={5} />
      ) : query.isError ? (
        <ErrorRow message="Не удалось загрузить товары" onRetry={() => query.refetch()} loading={query.isFetching} />
      ) : (
        <Card padding="md">
          <p className="mb-3 text-sm text-ink-3">Всего: {query.data?.total ?? 0}</p>
          <ul className="divide-y divide-line">
            {query.data?.data.map((p) => (
              <li key={p.id} className="flex items-center gap-4 py-3 text-sm text-ink">
                <Link
                  className="min-w-0 flex-1 break-words underline"
                  to={p.warehouseId ? `/products?wh=${encodeURIComponent(p.warehouseId)}` : '/products'}
                  state={{ openProductId: p.id }}
                >
                  {p.name}
                </Link>
                <span className="shrink-0 tabular-nums">
                  {p.stock} / мин. {p.minStock}
                </span>
              </li>
            ))}
          </ul>
          {!query.data?.total && <p className="py-3 text-sm text-ink-3">Все товары выше минимального остатка</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>
              Назад
            </Button>
            <span className="text-sm text-ink-3">{page}</span>
            <Button
              variant="secondary"
              disabled={page * 50 >= (query.data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              Далее
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
