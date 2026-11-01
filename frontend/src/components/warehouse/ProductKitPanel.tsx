import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productKitsApi, productsApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { newUuid } from '../../utils/uuid';
import { readStoredToken } from '../../utils/sessionToken';
import { formatQty } from '../../utils/units';
import { Button, Input, Badge, Money } from '../../ui';
import Modal from '../Modal';
import ProductKitComposer from './ProductKitComposer';
import type { Product } from '../../types';

export default function ProductKitPanel({
  product,
  canManage,
  onChanged,
  onOverlayChange,
}: {
  product: Product;
  canManage: boolean;
  onChanged?: (product: Product) => void;
  onOverlayChange?: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const key = `autexa.kit-disassembly.v1:${JSON.stringify([user?.tenantId, user?.id, user?.currentPointId, product.id])}`;
  const query = useQuery({
    queryKey: ['product-kit', product.id],
    queryFn: async () => (await productKitsApi.get(product.id)).data,
  });
  const [composer, setComposer] = useState(false),
    [disassembly, setDisassembly] = useState(false),
    [quantity, setQuantity] = useState('1'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ requestId: string; expectedRevision: number; quantity: number } | null>(null);
  useEffect(() => {
    onOverlayChange?.(composer || disassembly);
    return () => onOverlayChange?.(false);
  }, [composer, disassembly, onOverlayChange]);
  useEffect(() => {
    request.current = null;
    setQuantity('1');
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        request.current = JSON.parse(raw);
        setQuantity(String(request.current?.quantity ?? 1));
      }
    } catch {
      setError('Не удалось восстановить запрос разборки.');
    }
  }, [key]);
  const refreshProduct = async (id: string) => {
    try {
      onChanged?.((await productsApi.getById(id)).data);
    } catch {
      setError('Операция выполнена. Обновите карточку товара.');
    }
  };
  const disassemble = async () => {
    if (busy || !query.data) return;
    if (!request.current) {
      const number = Number(quantity);
      if (!/^\d+$/.test(quantity) || number < 1 || number > query.data.quantity) {
        setError('Укажите целое количество в пределах остатка.');
        return;
      }
      request.current = { requestId: newUuid(), expectedRevision: query.data.revision, quantity: number };
    }
    const token = readStoredToken();
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(key, JSON.stringify(request.current));
      await productKitsApi.disassemble(product.id, request.current);
      if (token !== readStoredToken()) return;
      for (const prefix of ['products', 'product-kit', 'stock-movements', 'product'])
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      setDisassembly(false);
      request.current = null;
      localStorage.removeItem(key);
      await refreshProduct(product.id);
    } catch (cause) {
      setError(
        (cause as { response?: { data?: { message?: string } } }).response?.data?.message ||
          'Результат не подтверждён. Повторите тот же запрос.',
      );
      const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
      if (response?.status === 400 || (response?.status === 409 && response.data?.code !== 'KIT_REQUEST_CONFLICT')) {
        request.current = null;
        localStorage.removeItem(key);
        void query.refetch();
      }
    } finally {
      if (token === readStoredToken()) setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-line p-3">
      <Badge tone="accent">Собранный комплект</Badge>
      {error && !disassembly && (
        <p role="alert" className="text-sm text-bad-text">
          {error}
        </p>
      )}
      {query.isPending ? (
        <p role="status" className="text-sm text-ink-3">
          Загрузка состава…
        </p>
      ) : query.isError ? (
        <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
          Не удалось загрузить состав · Повторить
        </Button>
      ) : (
        <>
          <ul className="space-y-1 text-sm text-ink">
            {query.data.components.map((component) => (
              <li key={component.productId} className="flex justify-between gap-3">
                <span>
                  {component.name} × {formatQty(component.quantity)}
                </span>
                {canManage && component.costPrice !== undefined ? <Money value={component.costPrice} /> : null}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setComposer(true)}>
                Изменить состав
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={query.data.quantity < 1 && !request.current}
                onClick={() => setDisassembly(true)}
              >
                {request.current ? 'Повторить разборку' : 'Разобрать комплект'}
              </Button>
            </div>
          )}
        </>
      )}
      {composer && (
        <ProductKitComposer
          warehouseId={product.warehouseId ?? ''}
          productId={product.id}
          onClose={() => setComposer(false)}
          onCompleted={(id) => {
            setComposer(false);
            void query.refetch();
            void refreshProduct(id);
            void queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
      <Modal
        isOpen={disassembly}
        onClose={() => {
          if (!busy) setDisassembly(false);
        }}
        title="Разобрать комплект?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setDisassembly(false)}>
              Закрыть
            </Button>
            <Button loading={busy} onClick={() => void disassemble()}>
              Подтвердить разборку
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Компоненты выбранного количества вернутся в исходные места хранения. Общая стоимость сохранится.
          </p>
          <Input
            aria-label="Количество комплектов к разборке"
            inputMode="numeric"
            value={quantity}
            disabled={!!request.current}
            onChange={(event) => setQuantity(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-bad-text">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
