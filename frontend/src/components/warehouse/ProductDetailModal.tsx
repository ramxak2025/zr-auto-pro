import ProductLabelPrint from '../products/ProductLabelPrint';
import toast from 'react-hot-toast';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  AlertTriangle,
  Barcode,
  Printer,
  ArrowLeftRight,
  ClipboardCheck,
  MapPin,
  Package,
  PackageMinus,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Product, StockMovement } from '../../types';
import { productsApi, stockMovementsApi } from '../../api/services';
import Modal from '../Modal';
import QueryState from '../QueryState';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Money } from '../../ui/Money';
import { Skeleton } from '../../ui/Skeleton';
import { Tabs, TabPanel } from '../../ui/Tabs';
import { cn } from '../../ui/cn';
import type { Tone } from '../../ui/tokens';
import { formatQty, unitLabel } from '../../utils/units';
import { formatDayTime } from './format';
import StorageCellBadge from './StorageCellBadge';
import ProductGallery from './ProductGallery';
import ProductShareButton from './ProductShareButton';
import ProductKitPanel from './ProductKitPanel';
import { formatKitUnitCost } from '../../../../shared/utils/productKitDraft';
import { productPhotoUrls } from '../../../../shared/utils/productPhotos';
import { formatDateShort, formatDayKey } from '../../../../shared/utils/formatters';
import { useTenantTimezone } from '../../hooks/useTenantTimezone';

type DetailTab = 'info' | 'movements' | 'prices';
type HistoryPage = Awaited<ReturnType<typeof stockMovementsApi.history>>['data'];

const MOVEMENT_LABELS: Record<string, { label: string; tone: Tone }> = {
  income: { label: 'Приход', tone: 'ok' },
  expense: { label: 'Расход', tone: 'accent' },
  writeoff: { label: 'Списание', tone: 'warn' },
  inventory: { label: 'Инвентаризация', tone: 'info' },
  defect_transfer: { label: 'В брак', tone: 'warn' },
  used_transfer: { label: 'В Б/У', tone: 'accent' },
  point_transfer: { label: 'В другой филиал', tone: 'info' },
  defect_return_to_supplier: { label: 'Поставщику', tone: 'bad' },
  customer_return: { label: 'Возврат клиента', tone: 'info' },
  sale: { label: 'Продажа', tone: 'accent' },
  sale_correction: { label: 'Изменение продажи', tone: 'info' },
  sale_annulment: { label: 'Отмена продажи', tone: 'warn' },
  sale_restore: { label: 'Восстановление продажи', tone: 'accent' },
  legacy_baseline: { label: 'Из истории чека', tone: 'neutral' },
  kit_assembly: { label: 'Сборка комплекта', tone: 'accent' },
  kit_disassembly: { label: 'Разборка комплекта', tone: 'info' },
};

interface ProductDetailModalProps {
  product: Product;
  onClose: () => void;
  onEdit: () => void;
  onWriteoff: () => void;
  onInventory: () => void;
  onDelete: () => void;
  onTransfer?: () => void;
  canTransfer?: boolean;
  /** Сменить адрес товара; страница передаёт, только когда на складе есть ячейки. */
  onChangeCell?: () => void;
  /** Owner-class or warehouse_manage. Gates cost-price + all manage actions. */
  canManage?: boolean;
  onProductChanged?: (product: Product) => void;
}

function ListSkeleton() {
  return (
    <ul className="space-y-1.5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
          <Skeleton className="h-5 w-20" />
          <Skeleton variant="text" className={i % 2 ? 'w-1/2' : 'w-1/3'} />
        </li>
      ))}
    </ul>
  );
}

/** Карточка товара: информация и действия, история движений, история цен. */
export default function ProductDetailModal({
  product,
  onClose,
  onEdit,
  onWriteoff,
  onInventory,
  onDelete,
  onTransfer,
  canTransfer,
  onChangeCell,
  canManage,
  onProductChanged,
}: ProductDetailModalProps) {
  // Non-managers can only ever see the Info tab (cost + price history leak
  // costPrice, so those tabs are hidden entirely for them).
  const [tab, setTab] = useState<DetailTab>('info');
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const labelProducts = useMemo(() => [product], [product]);
  const [kitOverlay, setKitOverlay] = useState(false);
  const isLow = product.stock <= product.minStock;
  const uLabel = unitLabel(product.unit);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const cursorReset = useRef<unknown>(null);
  const timezone = useTenantTimezone();
  const documentDateNote = (movement: StockMovement) =>
    movement.documentDate &&
    formatDayKey(movement.documentDate, timezone) !== formatDayKey(movement.createdAt, timezone)
      ? `Чек от ${formatDateShort(movement.documentDate, timezone)}`
      : null;

  const movementsQuery = useInfiniteQuery({
    queryKey: ['stock-movements', 'history', product.id],
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: HistoryPage) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) =>
      (await stockMovementsApi.history({ productId: product.id, includeSales: true, cursor: pageParam, limit: 50 }))
        .data,
    staleTime: 30_000,
    retry: (count, error) =>
      (error as { response?: { data?: { code?: string } } })?.response?.data?.code !== 'HISTORY_CURSOR_STALE' &&
      count < 2,
  });

  const pricesQuery = useQuery({
    queryKey: ['product-prices', product.id],
    queryFn: async () => (await productsApi.getProductPriceHistory(product.id)).data,
    enabled: tab === 'prices',
    staleTime: 30_000,
  });

  const movements = [
    ...new Map((movementsQuery.data?.pages.flatMap((page) => page.data) ?? []).map((item) => [item.id, item])).values(),
  ];
  const priceHistory = pricesQuery.data ?? [];
  useEffect(() => {
    const error = movementsQuery.error as { response?: { data?: { code?: string } } } | null;
    if (error?.response?.data?.code === 'HISTORY_CURSOR_STALE' && cursorReset.current !== product.id) {
      cursorReset.current = product.id;
      void queryClient.resetQueries({ queryKey: ['stock-movements', 'history', product.id], exact: true });
    }
  }, [movementsQuery.error, product.id, queryClient]);

  const generateLabelCodes = async (ids: string[]) => {
    setGeneratingBarcode(true);
    try {
      const { data } = await productsApi.internalBarcodes(ids);
      const code = data.products.find((item) => item.id === product.id);
      if (code) onProductChanged?.({ ...product, internalBarcode: code.internalBarcode });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      return data.products;
    } finally {
      setGeneratingBarcode(false);
    }
  };

  const infoTile = (label: string, value: React.ReactNode, tone?: 'bad' | 'accent') => (
    <div className={cn('rounded-lg p-3', tone === 'bad' ? 'bg-bad-soft' : 'bg-surface-2')}>
      <p className="text-xs text-ink-3">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-sm font-semibold tabular-nums',
          tone === 'bad' ? 'text-bad-text' : tone === 'accent' ? 'text-accent-text' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={() => {
        if (!kitOverlay && !labelsOpen) onClose();
      }}
      title={product.name}
      description={product.category || 'Без папки'}
      size="lg"
    >
      <div className="space-y-4">
        <Tabs<DetailTab>
          variant="pills"
          fullWidth
          aria-label="Разделы карточки товара"
          idPrefix="product-detail"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'info', label: 'Информация' },
            { key: 'movements', label: 'Движение' },
            ...(canManage ? [{ key: 'prices' as const, label: 'Цены' }] : []),
          ]}
        />

        <TabPanel idPrefix="product-detail" tabKey="info" active={tab === 'info'} className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={Printer} onClick={() => setLabelsOpen(true)}>
              Этикетки
            </Button>
            {canManage && !product.internalBarcode && (
              <Button
                variant="secondary"
                loading={generatingBarcode}
                onClick={() =>
                  void generateLabelCodes([product.id]).catch(() =>
                    toast.error('Не удалось создать штрихкод. Подключитесь к сети и повторите.'),
                  )
                }
              >
                Создать штрихкод
              </Button>
            )}
          </div>
          <ProductGallery photos={productPhotoUrls(product)} name={product.name} />
          {canManage && <ProductShareButton id={product.id} name={product.name} />}
          {product.assemblyId && (
            <ProductKitPanel
              key={product.id}
              product={product}
              canManage={!!canManage}
              onChanged={onProductChanged}
              onOverlayChange={setKitOverlay}
            />
          )}
          <section className="space-y-2" aria-label="Последние движения">
            <p className="text-sm font-medium text-ink-2">Последние движения</p>
            {movementsQuery.isPending ? (
              <p className="text-xs text-ink-3">Загрузка истории…</p>
            ) : movementsQuery.isError && !movements.length ? (
              <Button variant="ghost" size="sm" onClick={() => void movementsQuery.refetch()}>
                Не удалось загрузить историю · Повторить
              </Button>
            ) : (
              movements.slice(0, 4).map((movement) => (
                <div
                  key={movement.id}
                  className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm"
                >
                  <div>
                    <p>
                      {movement.legacyBaseline
                        ? 'Из истории чека'
                        : (MOVEMENT_LABELS[movement.type]?.label ?? movement.type)}{' '}
                      · {formatQty(movement.quantity)} {uLabel}
                    </p>
                    <p className="text-xs text-ink-3">{formatDayTime(movement.createdAt)}</p>
                    {documentDateNote(movement) && <p className="text-xs text-ink-3">{documentDateNote(movement)}</p>}
                  </div>
                  {movement.checkId && movement.receiptAvailable !== false && hasPermission('checks_view') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onClose();
                        navigate(`/checks/${movement.checkId}`);
                      }}
                    >
                      {movement.checkNumber ? `Чек №${movement.checkNumber}` : 'Открыть чек'}
                    </Button>
                  )}
                </div>
              ))
            )}
            <Button variant="ghost" size="sm" onClick={() => setTab('movements')}>
              Вся история
            </Button>
          </section>
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {product.category && <Badge outline>{product.category}</Badge>}
                {product.isBundle && (
                  <Badge tone="accent">
                    {product.assemblyId ? 'Собранный комплект' : 'Набор позиций · без сборки'}
                  </Badge>
                )}
                {product.barcode && <Badge tone="neutral">Заводской {product.barcode}</Badge>}
                {product.internalBarcode && <Badge tone="neutral">Внутренний {product.internalBarcode}</Badge>}
                {product.storageCellCode && (
                  <StorageCellBadge code={product.storageCellCode} name={product.storageCellName} size="md" withLabel />
                )}
                {isLow && (
                  <Badge tone="bad" icon={AlertTriangle}>
                    Ниже минимума
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-base font-semibold text-ink">{product.name}</p>
              {product.warrantyDays != null && product.warrantyDays > 0 && (
                <p className="mt-0.5 text-xs text-ink-3">Гарантия {product.warrantyDays} дн.</p>
              )}
            </div>
          </div>

          {!product.assemblyId && product.isBundle && product.bundleItems && product.bundleItems.length > 0 && (
            <div className="rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
              <p className="mb-2 text-sm font-medium text-ink">Состав комплекта</p>
              <ul className="space-y-1.5 text-sm">
                {product.bundleItems.map((bi, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 flex-shrink-0 text-accent" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-ink">{bi.name}</span>
                    <span className="tabular-nums text-ink-2">
                      {bi.quantity} {unitLabel('pcs')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Закуп. цена — cost price is manage-only (backend zeroes it for
                users without warehouse_manage; never render "0 ₽" as real). */}
            {canManage &&
              infoTile(
                product.costPriceIsPlaceholder ? 'Закупочная цена · заготовка' : 'Закупочная цена',
                product.assemblyId ? (
                  formatKitUnitCost(product.assemblyExactCost ?? product.costPrice)
                ) : (
                  <Money value={product.costPrice} />
                ),
              )}
            {infoTile(
              product.sellPriceIsPlaceholder ? 'Продажная цена · заготовка' : 'Продажная цена',
              <Money value={product.sellPrice} />,
              'accent',
            )}
            {infoTile('Остаток', `${formatQty(product.stock)} ${uLabel}`, isLow ? 'bad' : undefined)}
            {infoTile('Минимальный остаток', `${formatQty(product.minStock)} ${uLabel}`)}
          </div>

          {/* Manage actions — edit / transfer / writeoff / inventory / delete.
              Hidden entirely for users who cannot manage the warehouse. */}
          {canManage && (
            <div className="space-y-2 border-t border-line pt-4">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={Pencil} onClick={onEdit}>
                  Редактировать
                </Button>
                {!product.assemblyId && canTransfer && onTransfer && (
                  <Button variant="secondary" icon={ArrowLeftRight} onClick={onTransfer}>
                    В брак / Б/У
                  </Button>
                )}
                {!product.assemblyId && (
                  <Button variant="secondary" icon={PackageMinus} onClick={onWriteoff}>
                    Списание
                  </Button>
                )}
                {!product.assemblyId && (
                  <Button variant="secondary" icon={ClipboardCheck} onClick={onInventory}>
                    Инвентаризация
                  </Button>
                )}
              </div>
              {onChangeCell && (
                <Button variant="secondary" fullWidth icon={MapPin} onClick={onChangeCell}>
                  {product.storageCellId ? 'Изменить адрес' : 'Назначить ячейку'}
                </Button>
              )}
              <Button
                variant="ghost"
                fullWidth
                icon={Trash2}
                onClick={onDelete}
                className="text-bad-text hover:bg-bad-soft hover:text-bad-text"
              >
                Удалить товар (в корзину)
              </Button>
            </div>
          )}
        </TabPanel>

        <TabPanel idPrefix="product-detail" tabKey="movements" active={tab === 'movements'}>
          <QueryState
            isLoading={movementsQuery.isLoading}
            isError={movementsQuery.isError && movements.length === 0}
            onRetry={() => movementsQuery.refetch()}
            isFetching={movementsQuery.isFetching}
            loader={<ListSkeleton />}
            isEmpty={movements.length === 0}
            empty={{ icon: Package, title: 'Движений по товару нет' }}
            errorTitle="Не удалось загрузить движения"
            errorDescription={
              (movementsQuery.error as { response?: { data?: { message?: string } } } | null)?.response?.data
                ?.message || 'Проверьте подключение и попробуйте ещё раз.'
            }
            minHeight="py-8"
          >
            <ul className="max-h-[400px] space-y-1.5 overflow-y-auto">
              {movements.map((m) => {
                const info = MOVEMENT_LABELS[m.type] || { label: m.type, tone: 'neutral' as Tone };
                const before = m.stockBefore;
                const after = m.stockAfter;
                const diff =
                  typeof m.stockDelta === 'number'
                    ? m.stockDelta
                    : before !== null && after !== null
                      ? after - before
                      : null;
                return (
                  <li key={m.id} className="flex items-start gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
                    <Badge tone={info.tone} className="mt-0.5 flex-shrink-0">
                      {m.legacyBaseline ? 'Из истории чека' : info.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            diff !== null && diff > 0
                              ? 'text-ok-text'
                              : diff !== null && diff < 0
                                ? 'text-bad-text'
                                : 'text-ink-2',
                          )}
                        >
                          {diff !== null && diff > 0 ? '+' : ''}
                          {formatQty(diff ?? m.quantity)} {uLabel}
                        </span>
                        {before !== null && after !== null && (
                          <span className="text-xs tabular-nums text-ink-3">
                            {formatQty(before)} → {formatQty(after)}
                          </span>
                        )}
                        {m.checkId && m.receiptAvailable !== false && hasPermission('checks_view') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              onClose();
                              navigate(`/checks/${m.checkId}`);
                            }}
                          >
                            {m.checkNumber ? `Чек №${m.checkNumber}` : 'Открыть чек'}
                          </Button>
                        )}
                      </div>
                      {m.reason && <p className="mt-0.5 truncate text-xs text-ink-2">{m.reason}</p>}
                      <p className="mt-0.5 text-xs text-ink-3">
                        {formatDayTime(m.createdAt)}
                        {m.user ? ` · ${m.user.fullName}` : ''}
                      </p>
                      {documentDateNote(m) && <p className="text-xs text-ink-3">{documentDateNote(m)}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
            {(movementsQuery.hasNextPage || movementsQuery.isFetchNextPageError) && (
              <Button
                variant="secondary"
                size="sm"
                loading={movementsQuery.isFetchingNextPage}
                onClick={() => void movementsQuery.fetchNextPage()}
              >
                {movementsQuery.isFetchNextPageError ? 'Не удалось загрузить продолжение · Повторить' : 'Загрузить ещё'}
              </Button>
            )}
          </QueryState>
        </TabPanel>

        <TabPanel idPrefix="product-detail" tabKey="prices" active={tab === 'prices'} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {infoTile(
              product.costPriceIsPlaceholder ? 'Закупочная · заготовка' : 'Закупочная',
              product.assemblyId ? (
                formatKitUnitCost(product.assemblyExactCost ?? product.costPrice)
              ) : (
                <Money value={product.costPrice} />
              ),
            )}
            {infoTile(
              product.sellPriceIsPlaceholder ? 'Продажная · заготовка' : 'Продажная',
              <Money value={product.sellPrice} />,
              'accent',
            )}
          </div>
          <p className="text-sm font-medium text-ink">История изменений</p>
          <QueryState
            isLoading={pricesQuery.isLoading}
            isError={pricesQuery.isError}
            onRetry={() => pricesQuery.refetch()}
            isFetching={pricesQuery.isFetching}
            loader={<ListSkeleton />}
            isEmpty={priceHistory.length === 0}
            empty={{ title: 'Цены не менялись' }}
            errorTitle="Не удалось загрузить историю цен"
            minHeight="py-8"
          >
            <ul className="max-h-[350px] space-y-1.5 overflow-y-auto">
              {priceHistory.map((p: any) => {
                const costChanged = p.costPriceBefore !== p.costPriceAfter;
                const sellChanged = p.sellPriceBefore !== p.sellPriceAfter;
                const row = (label: string, before: number, after: number, upIsGood: boolean) => (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-20 text-ink-3">{label}</span>
                    <Money value={before} className="text-ink-3 line-through" />
                    <span className="text-ink-4" aria-hidden="true">
                      →
                    </span>
                    <Money
                      value={after}
                      className={cn('font-semibold', after > before === upIsGood ? 'text-ok-text' : 'text-bad-text')}
                    />
                  </div>
                );
                return (
                  <li key={p.id} className="rounded-lg bg-surface-2 px-3 py-2.5">
                    <div className="space-y-1">
                      {costChanged && row('Закупочная', p.costPriceBefore, p.costPriceAfter, false)}
                      {sellChanged && row('Продажная', p.sellPriceBefore, p.sellPriceAfter, true)}
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {formatDayTime(p.createdAt)}
                      {p.user ? ` · ${p.user.fullName}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </QueryState>
        </TabPanel>
      </div>
      <ProductLabelPrint
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        products={labelProducts}
        onGenerateInternal={canManage ? generateLabelCodes : undefined}
      />
    </Modal>
  );
}
