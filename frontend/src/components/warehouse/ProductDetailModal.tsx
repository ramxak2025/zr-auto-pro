import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeftRight, ClipboardCheck, Package, PackageMinus, Pencil, Trash2 } from 'lucide-react';
import type { Product } from '../../types';
import { productsApi } from '../../api/services';
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

type DetailTab = 'info' | 'movements' | 'prices';

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
  /** Owner-class or warehouse_manage. Gates cost-price + all manage actions. */
  canManage?: boolean;
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
  canManage,
}: ProductDetailModalProps) {
  // Non-managers can only ever see the Info tab (cost + price history leak
  // costPrice, so those tabs are hidden entirely for them).
  const [tab, setTab] = useState<DetailTab>('info');
  const isLow = product.stock <= product.minStock;
  const uLabel = unitLabel(product.unit);

  const movementsQuery = useQuery({
    queryKey: ['product-movements', product.id],
    queryFn: async () => (await productsApi.getProductMovements(product.id)).data,
    enabled: tab === 'movements',
    staleTime: 30_000,
  });

  const pricesQuery = useQuery({
    queryKey: ['product-prices', product.id],
    queryFn: async () => (await productsApi.getProductPriceHistory(product.id)).data,
    enabled: tab === 'prices',
    staleTime: 30_000,
  });

  const movements = movementsQuery.data ?? [];
  const priceHistory = pricesQuery.data ?? [];

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
    <Modal isOpen onClose={onClose} title={product.name} description={product.category || 'Без папки'} size="lg">
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
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3">
              {product.photo ? (
                <img src={product.photo} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <Package className="h-8 w-8 text-ink-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {product.category && <Badge outline>{product.category}</Badge>}
                {product.isBundle && <Badge tone="accent">Комплект</Badge>}
                {product.barcode && <Badge tone="neutral">Штрихкод {product.barcode}</Badge>}
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

          {product.isBundle && product.bundleItems && product.bundleItems.length > 0 && (
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
            {canManage && infoTile('Закупочная цена', <Money value={product.costPrice} />)}
            {infoTile('Продажная цена', <Money value={product.sellPrice} />, 'accent')}
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
                {canTransfer && onTransfer && (
                  <Button variant="secondary" icon={ArrowLeftRight} onClick={onTransfer}>
                    В брак / Б/У
                  </Button>
                )}
                <Button variant="secondary" icon={PackageMinus} onClick={onWriteoff}>
                  Списание
                </Button>
                <Button variant="secondary" icon={ClipboardCheck} onClick={onInventory}>
                  Инвентаризация
                </Button>
              </div>
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
            isError={movementsQuery.isError}
            onRetry={() => movementsQuery.refetch()}
            isFetching={movementsQuery.isFetching}
            loader={<ListSkeleton />}
            isEmpty={movements.length === 0}
            empty={{ icon: Package, title: 'Движений по товару нет' }}
            errorTitle="Не удалось загрузить движения"
            minHeight="py-8"
          >
            <ul className="max-h-[400px] space-y-1.5 overflow-y-auto">
              {movements.map((m: any) => {
                const info = MOVEMENT_LABELS[m.type] || { label: m.type, tone: 'neutral' as Tone };
                const diff = m.stockAfter - m.stockBefore;
                return (
                  <li key={m.id} className="flex items-start gap-3 rounded-lg bg-surface-2 px-3 py-2.5">
                    <Badge tone={info.tone} className="mt-0.5 flex-shrink-0">
                      {info.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            diff > 0 ? 'text-ok-text' : diff < 0 ? 'text-bad-text' : 'text-ink-2',
                          )}
                        >
                          {diff > 0 ? '+' : ''}
                          {formatQty(diff)} {uLabel}
                        </span>
                        <span className="text-xs tabular-nums text-ink-3">
                          {formatQty(m.stockBefore)} → {formatQty(m.stockAfter)}
                        </span>
                      </div>
                      {m.reason && <p className="mt-0.5 truncate text-xs text-ink-2">{m.reason}</p>}
                      <p className="mt-0.5 text-xs text-ink-3">
                        {formatDayTime(m.createdAt)}
                        {m.user ? ` · ${m.user.fullName}` : ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </QueryState>
        </TabPanel>

        <TabPanel idPrefix="product-detail" tabKey="prices" active={tab === 'prices'} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {infoTile('Закупочная', <Money value={product.costPrice} />)}
            {infoTile('Продажная', <Money value={product.sellPrice} />, 'accent')}
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
    </Modal>
  );
}
