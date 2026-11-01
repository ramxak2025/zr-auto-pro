import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { productKitsApi, productsApi, warehousesApi } from '../../api/services';
import { readStoredToken } from '../../utils/sessionToken';
import { newUuid } from '../../utils/uuid';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import { kitDraftPayload, type KitDraftLine } from '../../../../shared/utils/productKitDraft';
import type { AssembleKitRequest } from '../../../../shared/api/productKits';
import ProductPickerDrawer from '../checks/ProductPickerDrawer';
import Modal from '../Modal';
import { Button, Field, Input } from '../../ui';

export default function ProductKitComposer({
  warehouseId,
  productId,
  onClose,
  onCompleted,
}: {
  warehouseId: string;
  productId?: string;
  onClose: () => void;
  onCompleted: (productId: string) => void;
}) {
  const { user, hasPermission } = useAuth(),
    queryClient = useQueryClient();
  const renderToken = readStoredToken();
  const key = `autexa.kit-draft.v1:${JSON.stringify([user?.tenantId, user?.id, user?.currentPointId, productId ?? warehouseId])}`;
  const [name, setName] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [sellPrice, setSellPrice] = useState('');
  const [lines, setLines] = useState<KitDraftLine[]>([]),
    [pickerOpen, setPickerOpen] = useState(false),
    [sourceWarehouse, setSourceWarehouse] = useState(warehouseId);
  const [requestId, setRequestId] = useState(() => newUuid()),
    [pending, setPending] = useState<(AssembleKitRequest & { expectedRevision?: number }) | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmOpen, setConfirmOpen] = useState(false),
    [restoredKey, setRestoredKey] = useState<string | null>(null);
  const draftRef = useRef({ name, quantity, sellPrice, lines });
  draftRef.current = { name, quantity, sellPrice, lines };
  const writeLines = useCallback((change: KitDraftLine[] | ((previous: KitDraftLine[]) => KitDraftLine[])) => {
    const next = typeof change === 'function' ? change(draftRef.current.lines) : change;
    draftRef.current.lines = next;
    setLines(next);
  }, []);
  const seeded = useRef(false),
    submitted = useRef(false),
    busyRef = useRef(false),
    mounted = useRef(true);
  const {
    data: kit,
    isPending: kitLoading,
    isError: kitError,
    refetch: refetchKit,
  } = useQuery({
    queryKey: ['product-kit', productId],
    queryFn: async () => {
      if (!productId) throw new Error('Комплект не выбран');
      return (await productKitsApi.get(productId)).data;
    },
    enabled: !!productId,
  });
  const {
    data: products = [],
    isPending: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useQuery({
    queryKey: ['products', 'kit-composer', sourceWarehouse],
    queryFn: () => loadProductCatalog(productsApi.getAll, { warehouseId: sourceWarehouse }),
    staleTime: 0,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
  });
  useEffect(() => {
    mounted.current = true;
    seeded.current = false;
    submitted.current = false;
    setName('');
    setQuantity('1');
    setSellPrice('');
    writeLines([]);
    setPending(null);
    setRequestId(newUuid());
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}') as {
        name?: string;
        quantity?: string;
        sellPrice?: string;
        lines?: KitDraftLine[];
        requestId?: string;
        pending?: typeof pending;
        submitted?: boolean;
      };
      if (saved.name !== undefined) {
        setName(saved.name);
        setQuantity(saved.quantity ?? '1');
        setSellPrice(saved.sellPrice ?? '');
        writeLines(saved.lines ?? []);
        if (saved.requestId) setRequestId(saved.requestId);
        if (saved.pending) setPending(saved.pending);
        submitted.current = !!saved.submitted;
        seeded.current = true;
      }
    } catch {
      setError('Не удалось восстановить черновик комплекта.');
    }
    setRestoredKey(key);
    return () => {
      mounted.current = false;
    };
  }, [key, writeLines]);
  useEffect(() => {
    if (kit && restoredKey === key && !seeded.current) {
      setName(kit.name);
      setQuantity(String(kit.quantity));
      setSellPrice(String(kit.sellPrice));
      writeLines(
        kit.components.map((item) => ({ productId: item.productId, name: item.name, quantity: String(item.quantity) })),
      );
      seeded.current = true;
    }
  }, [kit, restoredKey, key, writeLines]);
  useEffect(() => {
    if (restoredKey !== key || (!name && !lines.length)) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ name, quantity, sellPrice, lines, requestId, pending, submitted: submitted.current }),
      );
    } catch {
      setError('Черновик не сохранён. Не закрывайте форму до подтверждения результата.');
    }
  }, [key, restoredKey, name, quantity, sellPrice, lines, requestId, pending]);
  const prepare = () => {
    try {
      if (productId && !kit) throw new Error('Дождитесь загрузки актуального состава.');
      const body = pending ?? {
        ...kitDraftPayload({ ...draftRef.current, warehouseId }, requestId),
        ...(kit ? { expectedRevision: kit.revision } : {}),
      };
      setPending(body);
      setConfirmOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте комплект.');
    }
  };
  const confirm = async () => {
    if (
      busyRef.current ||
      !pending ||
      renderToken !== readStoredToken() ||
      (productId && pending.expectedRevision === undefined)
    )
      return;
    const token = readStoredToken();
    busyRef.current = true;
    submitted.current = true;
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ name, quantity, sellPrice, lines, requestId, pending, submitted: true }),
      );
      const result =
        productId && pending.expectedRevision !== undefined
          ? await productKitsApi.recompose(productId, { ...pending, expectedRevision: pending.expectedRevision })
          : await productKitsApi.assemble(pending);
      if (!mounted.current || readStoredToken() !== token) return;
      localStorage.removeItem(key);
      for (const prefix of ['products', 'products-all', 'stock-movements', 'product-kit', 'warehouse-stats'])
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      onCompleted(result.data.productId);
    } catch (cause) {
      if (mounted.current && readStoredToken() === token) {
        const response = (cause as { response?: { status?: number; data?: { message?: string; code?: string } } })
          .response;
        setError(response?.data?.message || 'Результат не подтверждён. Повторите тот же запрос.');
        if (response?.status === 400 || (response?.status === 409 && response.data?.code !== 'KIT_REQUEST_CONFLICT')) {
          submitted.current = false;
          setPending(null);
          setConfirmOpen(false);
          setRequestId(newUuid());
          if (productId) void refetchKit();
        }
      }
    } finally {
      if (mounted.current && readStoredToken() === token) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const frozen = busy || !!pending;
  return (
    <>
      <Modal
        isOpen={restoredKey === key && !pickerOpen && !confirmOpen}
        onClose={onClose}
        title={productId ? 'Изменить состав комплекта' : 'Собрать комплект'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Закрыть
            </Button>
            <Button
              disabled={!hasPermission('warehouse_manage') || busy || (!!productId && !kit)}
              loading={busy}
              onClick={prepare}
            >
              {pending ? 'Повторить сборку' : productId ? 'Проверить новый состав' : 'Проверить сборку'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            {productId
              ? 'Выбранное количество старой партии будет разобрано и собрано новой партией с указанным составом.'
              : 'Компоненты спишутся только после подтверждения сборки.'}
          </p>
          {error && (
            <p role="alert" className="text-sm text-bad-text">
              {error}
            </p>
          )}
          {productId && kitLoading && <p role="status">Загрузка состава…</p>}
          {kitError && (
            <Button variant="secondary" onClick={() => void refetchKit()}>
              Не удалось загрузить состав · Повторить
            </Button>
          )}
          <Field label="Название комплекта">
            <Input
              aria-label="Название комплекта"
              value={name}
              disabled={frozen}
              onChange={(event) => {
                draftRef.current.name = event.target.value;
                setName(event.target.value);
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Количество комплектов">
              <Input
                inputMode="numeric"
                aria-label="Количество комплектов"
                value={quantity}
                disabled={frozen}
                onChange={(event) => {
                  draftRef.current.quantity = event.target.value;
                  setQuantity(event.target.value);
                }}
              />
            </Field>
            <Field label="Продажная цена за комплект, ₽">
              <Input
                inputMode="decimal"
                aria-label="Цена комплекта"
                value={sellPrice}
                disabled={frozen}
                onChange={(event) => {
                  draftRef.current.sellPrice = event.target.value;
                  setSellPrice(event.target.value);
                }}
              />
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">Состав на один комплект</p>
            <Button variant="secondary" size="sm" icon={Plus} disabled={frozen} onClick={() => setPickerOpen(true)}>
              Добавить компонент
            </Button>
          </div>
          {!lines.length && <p className="text-sm text-ink-3">Выберите существующие товары через каталог кассы.</p>}
          {lines.map((line) => (
            <div key={line.productId} className="flex items-center gap-2 border-b border-line py-2">
              <span className="min-w-0 flex-1 text-sm text-ink">{line.name}</span>
              <Input
                aria-label={`Количество компонента — ${line.name}`}
                inputMode="decimal"
                value={line.quantity}
                disabled={frozen}
                onChange={(event) =>
                  writeLines((previous) =>
                    previous.map((item) =>
                      item.productId === line.productId ? { ...item, quantity: event.target.value } : item,
                    ),
                  )
                }
                className="w-24"
              />
              <Button
                variant="ghost"
                size="sm"
                icon={Trash2}
                disabled={frozen}
                onClick={() => writeLines((previous) => previous.filter((item) => item.productId !== line.productId))}
              >
                Убрать
              </Button>
            </div>
          ))}
        </div>
      </Modal>
      <ProductPickerDrawer
        open={pickerOpen && restoredKey === key}
        onClose={() => setPickerOpen(false)}
        products={products.filter((product) => !product.assemblyId)}
        isLoading={productsLoading}
        isError={productsError}
        onRetry={() => void refetchProducts()}
        selectedIds={lines.map((line) => line.productId)}
        warehouses={warehouses}
        selectedWarehouseId={sourceWarehouse}
        onSelectWarehouse={setSourceWarehouse}
        priceKind={hasPermission('warehouse_manage') ? 'cost' : 'sell'}
        onSelectProduct={(product) => {
          writeLines((previous) =>
            previous.some((line) => line.productId === product.id)
              ? previous
              : [...previous, { productId: product.id, name: product.name, quantity: '1' }],
          );
          setPickerOpen(false);
        }}
      />
      <Modal
        isOpen={confirmOpen && restoredKey === key}
        onClose={() => {
          setConfirmOpen(false);
          if (!submitted.current) setPending(null);
        }}
        title={productId ? 'Собрать новую партию?' : 'Собрать комплект?'}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={busy || submitted.current}
              onClick={() => {
                setConfirmOpen(false);
                setPending(null);
              }}
            >
              Назад к составу
            </Button>
            <Button loading={busy} onClick={() => void confirm()}>
              Подтвердить сборку
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">
          {pending?.quantity} комплектов «{pending?.name}». Компоненты спишутся со складов, собранный товар появится
          отдельной позицией. Себестоимость рассчитается по компонентам.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-bad-text">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
