import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { loadPublicProduct } from '../api/publicProducts';
import ProductGallery from '../components/warehouse/ProductGallery';
import { Button } from '../ui/Button';
import { formatMoney } from '../../../shared/utils/formatters';

export default function PublicProductPage() {
  const { token = '' } = useParams<{ token: string }>();
  const query = useQuery({
    queryKey: ['public-product', token],
    queryFn: ({ signal }) => loadPublicProduct(token, signal),
    retry: false,
  });
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-2">
          <img src="/logo-icon.png" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-lg font-semibold">Autexa</span>
        </div>
        {query.isPending ? (
          <p role="status" className="py-16 text-center text-ink-2">
            Загрузка товара…
          </p>
        ) : query.isError ? (
          <div role="alert" className="space-y-4 rounded-xl bg-surface p-6">
            <h1 className="text-xl font-semibold">Товар недоступен</h1>
            <p className="text-sm text-ink-2">{query.error.message}</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          <article className="space-y-5 rounded-2xl bg-surface p-4 sm:p-6">
            <ProductGallery photos={query.data.photos} name={query.data.name} />
            <h1 className="break-words text-2xl font-semibold">{query.data.name}</h1>
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(query.data.sellPrice, 2)}</p>
          </article>
        )}
      </div>
    </main>
  );
}
