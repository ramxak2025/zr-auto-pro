/**
 * ProductMovementHistoryModal — «История движения товара».
 *
 * Full-screen modal (iOS-presentation: slide-up, edge-to-edge) showing the
 * stock-movement ledger for ONE product. Backend is fully ready:
 *   GET /stock-movements?productId=:id  (shared `stockMovementsApi.list`).
 *
 * Контракт API НЕ меняется — используем уже существующую фабрику.
 *
 * Принципы:
 *   • FlashList — 60 fps на длинном журнале движений.
 *   • Cache-first: useQuery + глобальный `placeholderData: prev => prev`
 *     (QueryClient в App.tsx) даёт мгновенное появление при повторном
 *     открытии того же товара, фон обновляется silently.
 *   • Loading / empty / error states зеркалят остальной апп
 *     (ListSkeleton / EmptyState / QueryErrorState).
 *   • Тема/цвета — только из semantic palette (`useColors`) + theme tokens.
 *   • Android-совместимо: общий код, без iOS-only API в JS.
 */
import React, { useCallback } from 'react';
import { Modal as RNModal, Pressable, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';

import { stockMovementsApi } from '../api/services';
import { formatQtyUnit } from '../utils/units';
import { useColors } from '../contexts/ThemeContext';
import { Text } from '../platform/Typography';
import { borderRadius, colors, spacing } from '../theme';
import IosScreenHeader from './IosScreenHeader';
import { ListSkeleton } from './Skeleton';
import EmptyState from './EmptyState';
import QueryErrorState from './QueryErrorState';
import type { StockMovement, StockMovementType } from '../../../shared/types';

// ─── Тип движения → визуальная подача ────────────────────────────────────────
// Иконка + цвет + русское имя. Покрыты ВСЕ значения StockMovementType, чтобы
// `Record` оставался исчерпывающим (TS подскажет при добавлении нового типа в
// shared/types — это сознательный type-safety guard, а не any-хак).
type MovementVisual = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Семантический цвет иконки/знака. */
  color: string;
  label: string;
  /** Знак перед количеством: '+' приход, '−' расход, '' нейтрально. */
  sign: '+' | '−' | '';
};

const MOVEMENT_VISUALS: Record<StockMovementType, MovementVisual> = {
  income: { icon: 'add-circle', color: colors.green[600], label: 'Поступление', sign: '+' },
  expense: { icon: 'remove-circle', color: colors.red[600], label: 'Расход', sign: '−' },
  writeoff: { icon: 'close-circle', color: colors.orange[600], label: 'Списание', sign: '−' },
  inventory: { icon: 'checkmark-circle', color: colors.blue[600], label: 'Инвентаризация', sign: '' },
  defect_transfer: { icon: 'arrow-forward-circle', color: colors.red[600], label: 'В брак', sign: '−' },
  used_transfer: { icon: 'arrow-forward-circle', color: colors.amber[600], label: 'В б/у', sign: '−' },
  defect_return_to_supplier: {
    icon: 'arrow-undo-circle',
    color: colors.purple[600],
    label: 'Возврат брака поставщику',
    sign: '−',
  },
  // Возврат товара клиентом на склад — это ПРИХОД (товар возвращается на полку),
  // поэтому знак '+'. Бирюзовый, чтобы не путать с зелёным поступлением от
  // поставщика и с возвратом брака поставщику.
  customer_return: {
    icon: 'arrow-undo-circle',
    color: colors.teal[600],
    label: 'Возврат клиента',
    sign: '+',
  },
  // Продажа товара из чека (волна G): подмешивается в ленту при includeSales,
  // строка нажимаема и ведёт в чек по checkId. Расход со склада → знак '−'.
  // Индиго — чтобы отличать от синей инвентаризации и зелёного поступления.
  sale: { icon: 'cart', color: colors.indigo[600], label: 'Продажа', sign: '−' },
};

// Fallback на случай, если бэк пришлёт неизвестный (будущий) тип — не падаем,
// показываем нейтральную подачу.
const FALLBACK_VISUAL: MovementVisual = {
  icon: 'ellipse',
  color: colors.gray[500],
  label: 'Движение',
  sign: '',
};

// Exported so ProductDetailScreen can render an inline "recent movements"
// slice with the EXACT same type→icon/colour/label/sign mapping as the full
// modal — single source of truth, no duplicated movement semantics.
export function visualFor(type: StockMovementType): MovementVisual {
  return MOVEMENT_VISUALS[type] ?? FALLBACK_VISUAL;
}

// ─── Дата/время движения ─────────────────────────────────────────────────────
// «16 июня, 14:32» — компактно, по-русски, в локальной зоне устройства.
export function formatMovementDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    // Среды без полного ICU — graceful degrade на ручной формат.
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${month}, ${hh}:${mm}`;
  }
}

// Количество без хвостовых нулей — единая реализация в utils/units.ts (120,
// дробные количества). Re-export сохраняет существующие импорты экранов.
export { formatQty } from '../utils/units';

export interface ProductMovementHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  /** Товар, для которого показываем журнал. null → запрос отключён. */
  productId: string | null;
  productName?: string;
  /** Единица измерения товара ('шт','м','кг'…). Не передана → 'шт'. */
  productUnit?: string;
  /** Опционально сузить журнал до конкретного склада. */
  warehouseId?: string;
  /**
   * Тап по строке-продаже (type='sale') → открыть чек, из которого пришла
   * продажа. Не передан → строка-продажа остаётся нажимаемой визуально не
   * отличается, но по тапу ничего не делает (переход недоступен из этого места).
   */
  onOpenCheck?: (checkId: string) => void;
}

function MovementRow({
  item,
  palette,
  unit,
  onOpenCheck,
}: {
  item: StockMovement;
  palette: ReturnType<typeof useColors>;
  unit?: string;
  onOpenCheck?: (checkId: string) => void;
}) {
  const v = visualFor(item.type);
  const operator = item.user?.fullName?.trim();

  // Продажа с привязкой к чеку → строка нажимаема и ведёт в чек. Остаток
  // (stockAfter) для продажи не осмыслен (0/0), поэтому вместо «Остаток: N»
  // показываем «Чек №N» + chevron.
  const isSale = item.type === 'sale';
  const checkId = item.checkId ?? null;
  const canOpenCheck = isSale && !!checkId && !!onOpenCheck;

  const body = (
    <>
      <View style={[styles.iconWrap, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name={v.icon} size={24} color={v.color} />
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text variant="bodyEmph" color={palette.text.primary} numberOfLines={1} style={styles.typeLabel}>
            {v.label}
          </Text>
          <Text variant="bodyEmph" color={v.sign === '' ? palette.text.primary : v.color}>
            {v.sign}
            {formatQtyUnit(item.quantity, unit)}
          </Text>
        </View>

        <View style={styles.rowMeta}>
          <Text variant="caption" color={palette.text.tertiary}>
            {formatMovementDateTime(item.createdAt)}
          </Text>
          {isSale ? (
            <View style={styles.checkLink}>
              <Text variant="caption" color={v.color}>
                {item.checkNumber != null ? `Чек №${item.checkNumber}` : 'Открыть чек'}
              </Text>
              {canOpenCheck ? <Ionicons name="chevron-forward" size={14} color={v.color} /> : null}
            </View>
          ) : (
            <Text variant="caption" color={palette.text.tertiary}>
              {'Остаток: '}
              {formatQtyUnit(item.stockAfter, unit)}
            </Text>
          )}
        </View>

        {operator ? (
          <View style={styles.metaLine}>
            <Ionicons name="person-circle-outline" size={14} color={palette.text.tertiary} />
            <Text variant="caption" color={palette.text.secondary} numberOfLines={1} style={styles.metaText}>
              {operator}
            </Text>
          </View>
        ) : null}

        {item.reason ? (
          <View style={styles.metaLine}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={palette.text.tertiary} />
            <Text variant="footnote" color={palette.text.secondary} numberOfLines={3} style={styles.metaText}>
              {item.reason}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );

  if (canOpenCheck) {
    return (
      <Pressable
        onPress={() => onOpenCheck?.(checkId)}
        accessibilityRole="button"
        accessibilityLabel={item.checkNumber != null ? `Открыть чек №${item.checkNumber}` : 'Открыть чек'}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          pressed && styles.rowPressed,
        ]}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>{body}</View>
  );
}

export default function ProductMovementHistoryModal({
  visible,
  onClose,
  productId,
  productName,
  productUnit,
  warehouseId,
  onOpenCheck,
}: ProductMovementHistoryModalProps) {
  const palette = useColors();

  const { data, isLoading, isError, refetch } = useQuery<StockMovement[]>({
    // Ключ зависит от товара (+ склада, если задан) — каждый товар кэшируется
    // отдельно, повторное открытие того же товара мгновенно отдаёт прошлый
    // список, фон ревалидируется.
    queryKey: ['stock-movements', 'product', productId, warehouseId ?? null],
    queryFn: async () => {
      const res = await stockMovementsApi.list({
        productId: productId ?? undefined,
        warehouseId,
        // Волна G: подмешиваем продажи товара из чеков в ленту движения —
        // строки type='sale' с checkId/checkNumber для перехода в чек.
        includeSales: true,
      });
      return res.data;
    },
    // Запрос активен только пока модалка открыта и есть товар — иначе не жжём
    // сеть в фоне на закрытом экране.
    enabled: visible && !!productId,
    staleTime: 60_000,
  });

  const renderItem = useCallback(
    ({ item }: { item: StockMovement }) => (
      <MovementRow item={item} palette={palette} unit={productUnit} onOpenCheck={onOpenCheck} />
    ),
    [palette, productUnit, onOpenCheck],
  );

  const keyExtractor = useCallback((m: StockMovement) => m.id, []);

  const movements = data ?? [];
  const showSkeleton = isLoading && movements.length === 0;
  const showError = isError && movements.length === 0;
  const showEmpty = !isLoading && !isError && movements.length === 0;

  return (
    <RNModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={[styles.container, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader
          title="История движения"
          subtitle={productName}
          showDivider
          trailing={
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="close" size={20} color={palette.text.primary} />
            </Pressable>
          }
        />

        {showSkeleton ? (
          <View style={styles.stateWrap}>
            <ListSkeleton count={7} />
          </View>
        ) : showError ? (
          <QueryErrorState
            description="Не удалось загрузить историю движения товара."
            onRetry={() => {
              void refetch();
            }}
          />
        ) : showEmpty ? (
          <EmptyState
            icon="arrow-swap"
            title="Движений пока нет"
            description="Поступления, расход, списания и переносы по этому товару появятся здесь."
          />
        ) : (
          <FlashList
            data={movements}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </SafeAreaView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateWrap: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[8],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[3],
    marginBottom: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowPressed: {
    opacity: 0.6,
  },
  checkLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[0.5],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  typeLabel: {
    flexShrink: 1,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  metaText: {
    flexShrink: 1,
  },
});
