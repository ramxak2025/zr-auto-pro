import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ScrollView,
  Platform,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
// entityLinks намеренно не импортируются здесь: тап по карточке журнала
// должен всегда вести в CheckDetail, а не на клиента/авто/мастера.
// Переходы на сущности живут внутри открытой деталки чека.
import { checksApi, usersApi, journalApi } from '../api/services';
// Единый список денежных ключей, пересчитываемых backend'ом из checks
// (зарплата / мотивация / фин-отчёт / рейтинг / история клиента) — живёт
// рядом с мутациями деталки (mobile-audit C1).
import { CHECK_MONEY_DEPENDENT_KEYS } from './CheckDetailScreen';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import FreshnessBadge from '../components/FreshnessBadge';
import {
  colors,
  fontSize,
  fontWeight,
  borderRadius,
  spacing,
  getBadgeColors,
  paymentMethodBadgeColor,
  softTint,
} from '../theme';
import { buildShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import {
  useOfflineCheckQueue,
  flushOfflineCheckQueue,
  removeOfflineCheck,
  retryOfflineCheck,
  type QueuedCheck,
} from '../utils/offlineCheckQueue';
import { dedupeById } from '../utils/dedupeById';
import type { Check, PaginatedResponse, User, JournalDoc } from '../../../shared/types';
// Канонический словарь оплат (включая installment: «Рассрочка») — единый
// для web и mobile. Локальные копии словаря запрещены: они отстают от
// новых способов оплаты и журнал показывает сырой англ. ключ.
import { paymentMethodLabels } from '../../../shared/utils/formatters';
function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
// Пробег: те же разряды, что и деньги, но единица «км». Hermes-safe —
// без toLocaleString (Intl в Hermes урезан), только регексп группировки.
function formatMileage(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' км'
  );
}
function formatDate(d: string) {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
}
function formatDateGroup(d: string) {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Сегодня';
  if (dt.toDateString() === yesterday.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const paymentStatusLabels: Record<string, string> = { paid: 'Оплачено', partial: 'Частично', unpaid: 'Не оплачено' };
const paymentStatusColors: Record<string, { bg: string; text: string }> = {
  paid: { bg: colors.green[50], text: colors.green[700] },
  partial: { bg: colors.amber[50], text: colors.amber[600] },
  unpaid: { bg: colors.red[50], text: colors.red[700] },
};

// ── Journal warehouse-docs kind metadata ───────────────────────────────
// Owner-facing labels for each JournalDoc kind. Mirrors the backend
// `KIND_META` map (backend/src/journal/journal.service.ts) so chip
// labels and row titles stay consistent across web and mobile.
type JournalKind = JournalDoc['kind'];

const journalKindLabels: Record<JournalKind, string> = {
  purchase: 'Покупки',
  return_to_supplier: 'Возврат поставщику',
  customer_return: 'Возврат клиента',
  defect_transfer: 'Брак',
  writeoff: 'Списания',
  supplier_payment: 'Платежи',
  // 144: возврат денег ОТ поставщика — отдельный kind (не supplier_payment),
  // потому что supplier_payment сидит в NEGATIVE_KINDS: возврат с минусом
  // читался бы как отток, хотя деньги ПРИШЛИ.
  supplier_refund: 'Возврат от поставщика',
  used_purchase: 'Б/У',
};

// Visual tokens for each JournalDoc kind. Used by both the row card
// (left accent bar + icon background) and the kind chip filter row.
// Each block intentionally uses a distinct color so a glance is enough
// to tell a purchase apart from a writeoff / payment / used-purchase.
const journalKindVisual: Record<
  JournalKind,
  {
    icon: keyof typeof Ionicons.glyphMap;
    accentColor: string;
    iconColor: string;
    // Optional override for the row card background — used by
    // `used_purchase` so those rows visually pop (purple tint).
    cardBg?: string;
  }
> = {
  purchase: { icon: 'cube-outline', accentColor: colors.green[500], iconColor: colors.green[600] },
  return_to_supplier: { icon: 'arrow-undo-outline', accentColor: colors.orange[500], iconColor: colors.orange[600] },
  // Customer return — goods come BACK into stock (an inflow, like a purchase),
  // but visually teal so it never reads as a supplier purchase or a supplier
  // return. Distinct from green (purchase) and orange (return_to_supplier).
  customer_return: {
    icon: 'arrow-undo-outline',
    accentColor: colors.teal[600],
    iconColor: colors.teal[600],
    cardBg: colors.teal[50],
  },
  defect_transfer: { icon: 'warning-outline', accentColor: colors.red[500], iconColor: colors.red[600] },
  writeoff: { icon: 'trash-outline', accentColor: colors.gray[400], iconColor: colors.gray[600] },
  supplier_payment: { icon: 'cash-outline', accentColor: colors.blue[500], iconColor: colors.blue[600] },
  // Возврат от поставщика — деньги пришли (приток, знак «+», НЕ в
  // NEGATIVE_KINDS). Teal перекликается с customer_return («вернулось»), но
  // иконка кошелька отличает денежный возврат от складского.
  supplier_refund: { icon: 'wallet-outline', accentColor: colors.teal[600], iconColor: colors.teal[600] },
  // Used-purchase rows get a stronger visual treatment per owner brief —
  // soft purple background so they stand out from the generic green
  // purchase rows even on a busy day.
  used_purchase: {
    icon: 'car-outline',
    accentColor: colors.purple[600],
    iconColor: colors.purple[700],
    cardBg: colors.purple[50],
  },
};

// Outflow rows — amount shown with `-` prefix and red tint. `customer_return`
// is deliberately NOT here: like `purchase`, it is a STOCK INFLOW (goods come
// back onto the shelf), and the row amount is the goods' cost value, so it reads
// as `+` to match the existing purchase convention. (The customer's cash refund
// is reversed separately on the check itself — F1 in returns.service.ts — and is
// not what this warehouse-doc row represents.) Its teal tint keeps it visually
// distinct from a green purchase.
const NEGATIVE_KINDS = new Set<JournalKind>(['return_to_supplier', 'defect_transfer', 'writeoff', 'supplier_payment']);

// Ordered list of kind chips above the warehouse-docs list. `null` is
// the "Все" filter — passes no `type` param to the API.
const KIND_CHIPS: Array<{ key: JournalKind | null; label: string }> = [
  { key: null, label: 'Все' },
  { key: 'purchase', label: journalKindLabels.purchase },
  { key: 'customer_return', label: journalKindLabels.customer_return },
  { key: 'return_to_supplier', label: journalKindLabels.return_to_supplier },
  { key: 'defect_transfer', label: journalKindLabels.defect_transfer },
  { key: 'writeoff', label: journalKindLabels.writeoff },
  { key: 'supplier_payment', label: journalKindLabels.supplier_payment },
  { key: 'supplier_refund', label: journalKindLabels.supplier_refund },
  { key: 'used_purchase', label: journalKindLabels.used_purchase },
];

type ActiveTab = 'checks' | 'warehouse';

// Stable separator — module-level so the list doesn't get a new
// component identity each parent render (would force unnecessary
// separator unmounts/remounts between rows).
const ListGap = () => <View style={{ height: spacing[2] }} />;

// ── Executor accent ────────────────────────────────────────────────────
// «Исполнитель»: чек, в строке услуг которого текущий мастер назначен
// исполнителем, но НЕ является его создателем (backend отдаёт
// `check.isExecutor`). Мастеру нужно с одного взгляда отличать «свои»
// чеки от «где я просто исполнитель». Берём фиолетовый акцент — заведомо
// отличный от синего primary (свои чеки) и от красного (отложен/возврат),
// при этом спокойный и премиальный. Все тинты проводим через softTint,
// поэтому в light и dark выходит корректно (пастель / приглушённое стекло).
const EXECUTOR_ACCENT = colors.violet[600];

// ── CheckRow ───────────────────────────────────────────────────────────
// Memoised journal row. Extracted to module scope so FlashList can
// recycle the React element without prop identity changing every parent
// render. Only re-renders when ITS row's props (check, showDateHeader,
// permissions) shift — the previous version rebuilt every visible row
// whenever any of `dateHeaderByIndex / canDelete / canViewProfit /
// handleDelete / navigation / queryClient` recreated, which happened
// on every Journal-screen re-render (typing in search, refetching,
// SWR data swap). Net: 30+ rows worth of TouchableOpacity / 6 nested
// Views / 4 Ionicons per row would re-render on each parent tick. With
// React.memo + stable props we keep cells static across SWR refetches.
interface CheckRowProps {
  check: Check;
  showDateHeader: boolean;
  dateGroupLabel: string;
  canDelete: boolean;
  canViewProfit: boolean;
  onOpen: (checkId: string) => void;
  /**
   * Fires on `onPressIn` — kicks off the detail prefetch BEFORE the
   * navigation push happens. By the time the CheckDetailScreen mounts,
   * the canonical `['check', id]` query is already resolved (or at
   * least in-flight). Net: detail view paints instantly on iPhone.
   */
  onPressIn: (checkId: string) => void;
  onDelete: (checkId: string, checkNumber: number) => void;
  palette: SemanticPalette;
}
const CheckRow = React.memo(function CheckRow({
  check,
  showDateHeader,
  dateGroupLabel,
  canDelete,
  canViewProfit,
  onOpen,
  onPressIn,
  onDelete,
  palette,
}: CheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  // Один lookup палитры бейджей на строку (внутри getBadgeColors — статические
  // module-level объекты по mode, сам вызов дёшев; но раньше он звался дважды
  // на каждую карточку — способ оплаты + чип «Исполнитель»).
  const rowBadges = getBadgeColors(palette.mode);
  const badge = rowBadges[badgeKey];
  // Чек, где текущий мастер — исполнитель, но не автор. Тонируем карточку
  // и показываем чип «Исполнитель». `execBadge` берём из той же палитры
  // бейджей, что и способ оплаты рядом, — визуально согласованно и
  // корректно в обеих темах (light: пастель, dark: приглушённое стекло).
  const isExecutor = check.isExecutor === true;
  const execBadge = rowBadges.purple;
  // «По гарантии» — работа в убыток (выручки нет; totalRevenue = 0). Помечаем
  // карточку красной плашкой «УБЫТОК» рядом с жёлтым бейджем оплаты «Гарантия»,
  // а в подвале (для тех, кто видит прибыль) показываем сумму убытка.
  const isWarranty = check.isWarranty === true;
  const warrantyLoss = check.warrantyLoss ?? 0;
  // Пробег авто и скидка на товары — доп. чипы в строке инфо. Показываем
  // только когда значение осмысленно (> 0); 0 / отсутствие — прячем.
  const mileage = typeof check.mileage === 'number' && check.mileage > 0 ? check.mileage : null;
  const discount = typeof check.discount === 'number' && check.discount > 0 ? check.discount : null;
  // Time string — computed once per row mount; row is memoised, so the
  // `new Date(...).toLocaleTimeString(...)` no longer runs on every
  // parent re-render of the screen.
  const timeLabel = new Date(check.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <View>
      {showDateHeader && (
        <View style={styles.dateGroupHeader}>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
          <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{dateGroupLabel}</Text>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.checkCard,
          buildShadow(palette),
          {
            // Свои чеки — без изменений (palette.bg.card). Чек, где мастер лишь
            // исполнитель, получает мягкий фиолетовый тинт, чтобы отличаться от
            // «своих» с одного взгляда. Отложенный сохраняет свою карточную
            // поверхность (его состояние сигналит красная рамка ниже), поэтому
            // два трактования не конфликтуют.
            backgroundColor:
              isExecutor && !check.isDeferred ? softTint(EXECUTOR_ACCENT, palette.mode) : palette.bg.card,
            borderColor: check.isDeferred
              ? palette.mode === 'dark'
                ? 'rgba(239,68,68,0.3)'
                : colors.red[100]
              : isExecutor
                ? palette.mode === 'dark'
                  ? 'rgba(124,58,237,0.35)'
                  : colors.purple[200]
                : palette.border.subtle,
          },
        ]}
        onPress={() => onOpen(check.id)}
        onPressIn={() => onPressIn(check.id)}
        activeOpacity={0.7}
      >
        {/* Акцентная полоса — ТОЛЬКО флаг состояния (красный = отложен,
            фиолетовый = исполнитель). Обычный чек полосы не имеет: постоянная
            синяя полоса на каждой карточке была декорацией, а не информацией —
            без неё исключительные состояния считываются мгновенно, как
            непрочитанная точка в Mail. Полоса рендерится всегда (transparent),
            чтобы геометрия контента не гуляла между строками. */}
        <View
          style={[
            styles.accentBar,
            {
              backgroundColor: check.isDeferred ? colors.red[400] : isExecutor ? EXECUTOR_ACCENT : 'transparent',
            },
          ]}
        />
        <View style={styles.checkContent}>
          {/* ── Иерархия карточки (дизайн-проход 2026-07) ────────────────
              Первичное:  клиент (слева, 15pt semibold) + сумма (справа, 17pt bold).
              Вторичное:  №, авто+госномер, пробег, скидка — строка меты 13pt.
              Статусы:    бейджи отдельной строкой ТОЛЬКО у исключительных чеков.
              Способ оплаты — бейдж ПОД суммой: семантически это свойство денег,
              и правый столбец занимает те же две строки, что и левый, — карточка
              не растёт. */}
          <View style={styles.checkTopRow}>
            <View style={styles.checkPrimaryCol}>
              <Text style={[styles.checkTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {check.client?.fullName || `Чек #${check.number}`}
              </Text>
              <View style={styles.checkMetaRow}>
                {/* Номер дублируем в мете только когда заголовок занят клиентом. */}
                {check.client?.fullName ? (
                  <Text style={[styles.metaText, { color: palette.text.tertiary }]}>#{check.number}</Text>
                ) : null}
                {check.car && (
                  <View style={styles.metaItem}>
                    <Ionicons name="car-outline" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                      {check.car.makeModel}
                    </Text>
                    {check.car.plateNumber && (
                      <Text
                        style={[
                          styles.plateTag,
                          palette.mode === 'dark' && {
                            backgroundColor: softTint(colors.primary[600], 'dark'),
                            color: colors.primary[300],
                          },
                        ]}
                      >
                        {check.car.plateNumber}
                      </Text>
                    )}
                  </View>
                )}
                {/* Пробег авто — справочная мета. Показывается только когда он есть. */}
                {mileage !== null && (
                  <View style={styles.metaItem}>
                    <Ionicons name="speedometer-outline" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                      {formatMileage(mileage)}
                    </Text>
                  </View>
                )}
                {/* Скидка на товары — зелёная мета «Скидка N ₽» (только при > 0). */}
                {discount !== null && (
                  <View style={styles.metaItem}>
                    <Ionicons name="pricetag-outline" size={12} color={colors.green[600]} />
                    <Text style={[styles.metaText, { color: colors.green[600] }]} numberOfLines={1}>
                      Скидка {formatMoney(discount)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.checkAmountCol}>
              <View style={styles.checkSumRow}>
                <Text style={[styles.checkTotal, { color: palette.text.primary }]}>
                  {formatMoney(check.totalRevenue)}
                </Text>
                {canDelete && (
                  <TouchableOpacity
                    onPress={() => onDelete(check.id, check.number)}
                    style={styles.deleteBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={15} color={palette.text.tertiary} />
                  </TouchableOpacity>
                )}
              </View>
              <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
                  {paymentMethodLabels[check.paymentMethod] ?? check.paymentMethod}
                </Text>
              </View>
            </View>
          </View>

          {/* Статусы — отдельная строка бейджей, рендерится только когда есть
              хоть один. Порядок по критичности: ВОЗВРАТ (терминальное) →
              Отложен → УБЫТОК → Исполнитель. Обычный оплаченный чек этой
              строки не имеет — карточка остаётся двухстрочной. */}
          {(check.isReturned || check.isDeferred || isWarranty || isExecutor) && (
            <View style={styles.statusRow}>
              {/* Возвращённый чек — красная плашка с иконкой стрелки. Сам чек
                  остаётся кликабельным — деталка откроется как обычно. */}
              {check.isReturned && (
                <View style={styles.returnedBadge}>
                  <Ionicons name="arrow-undo" size={10} color={colors.white} />
                  <Text style={styles.returnedBadgeText}>ВОЗВРАТ</Text>
                </View>
              )}
              {check.isDeferred && (
                <View
                  style={[
                    styles.deferredBadge,
                    {
                      backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.18)' : colors.red[100],
                    },
                  ]}
                >
                  <Text style={styles.deferredText}>Отложен</Text>
                </View>
              )}
              {/* «По гарантии» — красная плашка «УБЫТОК»: жёлтый бейдж «Гарантия»
                  под суммой + УБЫТОК тут читаются как «гарантия → в убыток».
                  Сплошной rose[500]/белый текст — корректно в обеих темах. */}
              {isWarranty && (
                <View style={styles.warrantyLossBadge}>
                  <Ionicons name="trending-down" size={10} color={colors.white} />
                  <Text style={styles.warrantyLossBadgeText}>УБЫТОК</Text>
                </View>
              )}
              {isExecutor && (
                <View style={[styles.executorBadge, { backgroundColor: execBadge.bg }]}>
                  <Ionicons name="construct" size={10} color={execBadge.text} />
                  <Text style={[styles.executorBadgeText, { color: execBadge.text }]}>Исполнитель</Text>
                </View>
              )}
            </View>
          )}

          {/* Комментарий — спокойный вторичный курсив с иконкой вместо прежнего
              янтарного: цветной текст на каждой карточке конкурировал со
              статусами, хотя комментарий — справка, а не предупреждение. */}
          {check.comment && (
            <View style={styles.commentRow}>
              <Ionicons name="chatbubble-ellipses-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.commentText, { color: palette.text.secondary }]} numberOfLines={1}>
                {check.comment}
              </Text>
            </View>
          )}

          <View style={styles.checkFooter}>
            <Text style={[styles.footerTime, { color: palette.text.tertiary }]}>{timeLabel}</Text>
            {check.master && (
              <Text style={[styles.footerMaster, { color: palette.text.tertiary }]} numberOfLines={1}>
                {check.master.fullName}
              </Text>
            )}
            {canViewProfit &&
              (isWarranty && warrantyLoss > 0 ? (
                // Гарантийный чек: вместо прибыли показываем убыток (запчасти +
                // выплата мастеру) красным со знаком минус.
                <Text style={[styles.footerProfit, styles.profitNegative]}>−{formatMoney(warrantyLoss)}</Text>
              ) : (
                <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                  {check.profit >= 0 ? '+' : ''}
                  {formatMoney(check.profit)}
                </Text>
              ))}
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
});

// ── WarehouseDocRow ────────────────────────────────────────────────────
// Memoised row for the warehouse-documents tab. Renders a unified
// `JournalDoc` regardless of kind — the backend `journal/warehouse-docs`
// endpoint normalises stock_movements + supplier_payments into a single
// shape. Kind-specific styling (accent bar color, icon, money sign) is
// driven by `journalKindVisual[item.kind]`.
//
// Module-scope so React can `React.memo` correctly without per-render
// closure recreation. The only prop that ever changes is `item`; the
// `onSelect` setter from `useState` is stable across renders.
interface WarehouseDocRowProps {
  item: JournalDoc;
  // Date-group divider above this row (rendered on the first row of each
  // calendar day). Mirrors CheckRow's `showDateHeader` / `dateGroupLabel`
  // contract so both Journal tabs render identical «Сегодня / Вчера / 5 июня»
  // headers with the same visual treatment.
  showDateHeader: boolean;
  dateGroupLabel: string;
  onSelect: (doc: JournalDoc) => void;
  palette: SemanticPalette;
}
const WarehouseDocRow = React.memo(function WarehouseDocRow({
  item,
  showDateHeader,
  dateGroupLabel,
  onSelect,
  palette,
}: WarehouseDocRowProps) {
  const visual = journalKindVisual[item.kind];
  const isNegative = NEGATIVE_KINDS.has(item.kind);
  const amountColor =
    item.kind === 'used_purchase'
      ? colors.purple[700]
      : item.kind === 'customer_return'
        ? colors.teal[600]
        : isNegative
          ? colors.red[600]
          : colors.green[600];
  // Title prefers payeeName for supplier_payment ("Оплата: ООО Х"),
  // otherwise falls back to the backend-provided title.
  const title = item.kind === 'supplier_payment' && item.payeeName ? `Оплата: ${item.payeeName}` : item.title;
  const subtitle = item.subtitle || journalKindLabels[item.kind];
  return (
    <View>
      {showDateHeader && (
        <View style={styles.dateGroupHeader}>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
          <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{dateGroupLabel}</Text>
          <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
        </View>
      )}
      <TouchableOpacity
        style={[
          styles.warehouseCard,
          buildShadow(palette),
          {
            // Card tint (teal/purple) is a near-white pastel in light; on the
            // dark canvas it washes out, so dark uses a translucent glow of the
            // SAME accent. Kinds without a cardBg keep the neutral card surface.
            backgroundColor: visual.cardBg
              ? palette.mode === 'dark'
                ? softTint(visual.accentColor, 'dark')
                : visual.cardBg
              : palette.bg.card,
            borderColor: palette.border.subtle,
          },
        ]}
        activeOpacity={0.7}
        onPress={() => onSelect(item)}
      >
        <View style={[styles.warehouseAccent, { backgroundColor: visual.accentColor }]} />
        <View style={styles.warehouseCardContent}>
          <View style={styles.warehouseCardHeader}>
            <View style={[styles.warehouseIconWrap, { backgroundColor: visual.accentColor + '18' }]}>
              <Ionicons name={visual.icon} size={18} color={visual.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.warehouseCardTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {title}
              </Text>
              <Text style={[styles.warehouseCardSubtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
                {subtitle}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.warehouseQty, { color: amountColor }]}>
                {isNegative ? '-' : '+'}
                {formatMoney(Math.abs(item.amount))}
              </Text>
              <Text style={[styles.warehouseDate, { color: palette.text.tertiary }]}>
                {formatDate(item.occurredAt)}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
});

// ── ActiveFilterChip ───────────────────────────────────────────────────
// Чип активного фильтра над списком — виден, только когда панель фильтров
// СВЁРНУТА. Раньше о включённом фильтре напоминала лишь точка-счётчик на
// воронке, и «куда делись чеки?» превращалось в загадку. Тап по чипу
// (крестик) снимает ровно свой фильтр. Palette-aware: light — пастель
// primary[50], dark — приглушённое стекло того же акцента (softTint) —
// та же пара, что у активной кнопки-воронки рядом.
function ActiveFilterChip({
  label,
  onClear,
  palette,
}: {
  label: string;
  onClear: () => void;
  palette: SemanticPalette;
}) {
  const dark = palette.mode === 'dark';
  return (
    <TouchableOpacity
      onPress={() => {
        haptic('tap');
        onClear();
      }}
      activeOpacity={0.7}
      style={[
        styles.activeFilterChip,
        {
          backgroundColor: dark ? softTint(colors.primary[600], 'dark') : colors.primary[50],
          borderColor: dark ? 'rgba(37,99,235,0.35)' : colors.primary[200],
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Снять фильтр: ${label}`}
    >
      <Text
        style={[styles.activeFilterChipText, { color: dark ? colors.primary[300] : colors.primary[700] }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ionicons name="close-circle" size={14} color={dark ? colors.primary[300] : colors.primary[600]} />
    </TouchableOpacity>
  );
}

export default function ChecksScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
  // «Корзина» — часть цикла удаления: бэкенд гейтит GET /checks/trash и
  // POST /checks/:id/restore ключом checks_delete («права как в Битрикс24»,
  // 2026-07: admin живёт по матрице из /auth/me, superadmin/director
  // байпасятся внутри hasPermission).
  const canSeeTrash = canDelete;

  // ── Офлайн-очередь чеков (Round 9) ────────────────────────────────────
  // Бейдж «Ожидают отправки: N» над поиском (виден только при N > 0) + шит
  // со списком отложенных чеков, ручной отправкой и удалением. Сами данные
  // живут в utils/offlineCheckQueue.ts; здесь — чистое представление.
  const queuedChecks = useOfflineCheckQueue();
  const queuedPendingCount = useMemo(() => queuedChecks.filter((e) => e.status === 'pending').length, [queuedChecks]);
  const queuedFailedCount = queuedChecks.length - queuedPendingCount;
  const [showPendingSheet, setShowPendingSheet] = useState(false);
  const [sendingQueueNow, setSendingQueueNow] = useState(false);

  // Очередь опустела (всё улетело / удалено) — закрываем шит сами.
  useEffect(() => {
    if (showPendingSheet && queuedChecks.length === 0) setShowPendingSheet(false);
  }, [showPendingSheet, queuedChecks.length]);

  const handleSendQueueNow = async () => {
    if (sendingQueueNow) return;
    haptic('tap');
    const hadPending = queuedPendingCount > 0;
    setSendingQueueNow(true);
    try {
      const result = await flushOfflineCheckQueue();
      if (hadPending && result.sent === 0 && result.rejected === 0) {
        Alert.alert(
          'Сервер пока недоступен',
          'Отправить не удалось — чеки остаются на телефоне и уйдут автоматически, когда появится связь.',
        );
      }
    } finally {
      setSendingQueueNow(false);
    }
  };

  const confirmDeleteQueued = (entry: QueuedCheck) => {
    Alert.alert(
      'Удалить отложенный чек?',
      'Этот чек НЕ был отправлен на сервер — после удаления он исчезнет безвозвратно.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => {
            haptic('warning');
            void removeOfflineCheck(entry.clientRequestId);
          },
        },
      ],
    );
  };

  const retryQueued = (entry: QueuedCheck) => {
    haptic('tap');
    void retryOfflineCheck(entry.clientRequestId);
  };

  const [activeTab, setActiveTab] = useState<ActiveTab>('checks');
  const [search, setSearch] = useState('');
  // Page-based infinite scroll. The first page is the most recent checks
  // (the API sorts desc by date, so today's rows land first); subsequent
  // pages are appended below as the user scrolls. We stay on a small page
  // size so the first paint feels instant and old data is fetched lazily.
  const limit = 20;
  const [refreshing, setRefreshing] = useState(false);
  // No-op kept so historical onChange handlers below stay readable.
  // Filter changes flip the queryKey; useInfiniteQuery resets to page 1
  // automatically — we never need to reset a page counter explicitly.
  const setPage = (_: number | ((p: number) => number)) => {
    /* noop — useInfiniteQuery owns paging now */
  };

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [filterMasterId, setFilterMasterId] = useState('');
  // «Возврат клиента» — СЕРВЕРНЫЙ фильтр: бэк принимает аддитивный
  // параметр isReturned=true (GET /checks) и отдаёт только возвраты.
  // Раньше это был клиентский filter по уже загруженным страницам —
  // возвраты со старых, ещё не догруженных страниц просто не попадали
  // в выдачу. Теперь фильтрует сервер, как и isDeferred ниже.
  const [returnsOnly, setReturnsOnly] = useState(false);
  // «Отложенные» — СЕРВЕРНЫЙ фильтр: бэк принимает аддитивный параметр
  // isDeferred=true (GET /checks) и отдаёт только отложенные черновики —
  // тот же контракт, что у isReturned выше.
  const [deferredOnly, setDeferredOnly] = useState(false);
  const [showDateFromPicker, setShowDateFromPicker] = useState(false);
  const [showDateToPicker, setShowDateToPicker] = useState(false);

  // Warehouse-tab kind filter — null means "Все". Persists across tab
  // switches so toggling Чеки → Складские документы keeps the last
  // chosen chip active.
  const [warehouseKind, setWarehouseKind] = useState<JournalKind | null>(null);
  // Warehouse-docs date range — client-side filter over the already-loaded
  // feed (no per-change server round-trip). Kept SEPARATE from the checks
  // tab's `dateFrom`/`dateTo` so the two tabs' filters never bleed together.
  const [warehouseDateFrom, setWarehouseDateFrom] = useState<Date | null>(null);
  const [warehouseDateTo, setWarehouseDateTo] = useState<Date | null>(null);
  const [showWhDateFromPicker, setShowWhDateFromPicker] = useState(false);
  const [showWhDateToPicker, setShowWhDateToPicker] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<JournalDoc | null>(null);

  // Funnel-badge count is tab-aware — each tab owns its own filter set, so
  // the dot/active-state reflects only the filters of the visible tab. The
  // checks panel below still reads `activeFilterCount` (== checksFilterCount
  // whenever that panel is on screen), so its behaviour is unchanged.
  const checksFilterCount =
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (filterMasterId ? 1 : 0) + (returnsOnly ? 1 : 0) + (deferredOnly ? 1 : 0);
  const warehouseFilterCount = (warehouseKind ? 1 : 0) + (warehouseDateFrom ? 1 : 0) + (warehouseDateTo ? 1 : 0);
  const activeFilterCount = activeTab === 'warehouse' ? warehouseFilterCount : checksFilterCount;

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['users-for-filter'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  const activeUsers = useMemo(() => (Array.isArray(allUsers) ? allUsers : []).filter((u) => u.isActive), [allUsers]);

  // Near-live journal: poll the loaded pages every 30s, but only while the
  // screen is focused, so a backgrounded Журнал tab spends no JS tick or
  // network roundtrip. (The client-side If-None-Match/304 layer was removed —
  // see api/axios.ts — so each poll is a normal full GET.) Pattern mirrors
  // CallsScreen's focus-gated poll.
  const [pollEnabled, setPollEnabled] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setPollEnabled(true);
      return () => setPollEnabled(false);
    }, []),
  );

  const formatFilterDate = (d: Date) =>
    `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const {
    data: checksData,
    isLoading,
    isFetching,
    isError,
    isPlaceholderData,
    dataUpdatedAt,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedResponse<Check>>({
    // Page key intentionally excludes the page number so all loaded
    // pages share a single cache entry. This is what lets the user
    // come back from a check detail and still see today + older
    // pages already loaded — no re-fetch flash.
    queryKey: [
      'checks-infinite',
      search,
      dateFrom ? toISODate(dateFrom) : '',
      dateTo ? toISODate(dateTo) : '',
      filterMasterId,
      // Слот 5 — фильтр «Отложенные». Всегда присутствует (стабильная
      // длина ключа); позиции 0..4 НЕ двигать — persistentCache
      // (POSITIONAL_SEARCH_IDX) опирается на то, что search стоит в
      // индексе 1. Новые фильтры — только дописывать в хвост.
      deferredOnly ? 'deferred' : '',
      // Слот 6 — фильтр «Возврат клиента» (серверный isReturned).
      // Дописан строго в хвост по тому же правилу.
      returnsOnly ? 'returns' : '',
    ],
    // КУРСОР, а не номер страницы. Offset-пагинация по живой ленте — источник
    // жалоб «при скролле чеки исчезают / появляется пустота / дубли»: пока
    // мастера создают чеки, каждая вставка сдвигает ленту, и следующая
    // страница по НОМЕРУ отдаёт уже не то — строки пропускаются или приходят
    // дважды (дубль ключа в FlatList → белые ячейки). Курсор указывает на
    // конкретную строку, поэтому вставки его не двигают. Пустая строка =
    // первая страница (сервер трактует наличие параметра как keyset-режим).
    initialPageParam: '',
    queryFn: async ({ pageParam = '' }) => {
      const params: Record<string, any> = { cursor: pageParam as string, limit };
      if (search) params.search = search;
      if (dateFrom) params.dateFrom = toISODate(dateFrom);
      if (dateTo) params.dateTo = toISODate(dateTo);
      if (filterMasterId) params.masterId = filterMasterId;
      // isDeferred — аддитивный серверный параметр: true → только
      // отложенные. Выключенный фильтр параметр НЕ шлёт (undefined),
      // поведение и ответ сервера идентичны прежним.
      if (deferredOnly) params.isDeferred = true;
      // isReturned — тот же аддитивный контракт: true → только возвраты
      // клиентов. Выключен — параметр не шлём вовсе.
      if (returnsOnly) params.isReturned = true;
      const res = await checksApi.getAll(params);
      return res.data;
    },
    // Конец ленты определяет СЕРВЕР: nextCursor === null. Не считаем страницы
    // по total — общий счётчик меняется прямо во время листания (создали чек),
    // и арифметика по нему как раз и промахивалась мимо конца ленты.
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    // Пагинация теперь ТОЛЬКО вниз (append) на обычном RN FlatList — как на
    // экране Клиентов. Убрали maxPages / fetchPreviousPage / getPreviousPageParam:
    // симметричная догрузка вверх работала лишь на FlashList (onStartReached +
    // maintainVisibleContentPosition) и как раз давала ре-анкор / мерцание /
    // пропадание строк на Android. Без maxPages массив данных только РАСТЁТ,
    // никогда не усыхает сверху, поэтому строки не прыгают. Журнал редко
    // превышает пару сотен строк; gcTime 30 мин ограничивает память, а
    // focus-poll обновляет удержанные страницы на месте.
    // Журнал — холодный список, который меняется редко (новые чеки идут
    // через invalidate в delete/create мутациях). 5 минут «свежо», 30 минут
    // живёт в памяти — возврат с CheckDetail попадает прямо в кеш.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // ЖУРНАЛ ОБЯЗАН ДОГОНЯТЬ. Раньше здесь стоял refetchOnMount: false, и в
    // паре с persistentCache (ключ 'checks-infinite' в белом списке) это давало
    // главную жалобу владельца: «чеки за последние дни пропали». На холодном
    // старте с диска поднимались страницы, записанные в момент последней удачной
    // загрузки, и экран НАМЕРЕННО их не перезапрашивал — лента застывала на той
    // дате навсегда, отсюда и «плавающая» граница 16-е/19-е у разных устройств.
    //
    // Мгновенное открытие при этом не теряется: кэш поднят, placeholderData
    // держит прежние данные, спиннера нет — обновление приезжает поверх. Цена
    // возврата с карточки чека — один фоновый запрос первой страницы.
    refetchOnMount: 'always',
    // Near-live: refetch loaded pages on network reconnect + on a focus-gated
    // 30s poll. Scroll position / pagination untouched — useInfiniteQuery
    // refetches the already-loaded pages in place.
    refetchOnReconnect: true,
    // Poll живёт только пока загружено немного страниц (≤3). refetch у
    // useInfiniteQuery перезапрашивает ВСЕ загруженные страницы разом:
    // после глубокого скролла 30-секундный поллинг превращался в пачку
    // последовательных запросов + полный пересбор ленты — то самое
    // «лагает, мерцает блоками». Наскроллил глубоко — живость дают
    // refetchOnMount:'always', refetchOnReconnect и pull-to-refresh.
    refetchInterval: (query) => {
      if (!pollEnabled) return false;
      const pageCount = query.state.data?.pages?.length ?? 0;
      return pageCount <= 3 ? 30_000 : false;
    },
    placeholderData: (prev) => prev,
  });

  // ── Warehouse documents (unified journal feed) ──────────────────
  // Single source of truth: `journalApi.warehouseDocs(...)` merges
  // stock_movements + supplier_payments serverside and returns a
  // pre-sorted JournalDoc[].
  //
  // We deliberately fetch the FULL feed (no `?type=` param) and filter
  // by `kind` on the client below. Reasons:
  //   1. Robustness — the server's `?type=` whitelist (journal.controller
  //      WarehouseDocsQueryDto `@IsIn`) lagged behind the kinds the FE
  //      offers: `customer_return` was added to the journal everywhere
  //      EXCEPT that DTO, so `?type=customer_return` 400'd and the
  //      «Возврат клиента» chip showed an empty list. Filtering the loaded
  //      list by `kind` makes every chip work regardless of the DTO and
  //      future-proofs new kinds without a backend round-trip.
  //   2. Speed — the backend already caps the feed at 500 rows, so one
  //      cached fetch + an in-memory filter is instant when switching
  //      chips (no per-chip refetch / white flash).
  // The cache key has no `warehouseKind`, so all chips share one entry.
  const { data: allWarehouseDocs = [], isLoading: warehouseLoading } = useQuery<JournalDoc[]>({
    queryKey: ['journal-warehouse-docs'],
    queryFn: async () => {
      const res = await journalApi.warehouseDocs({});
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 60_000,
    enabled: activeTab === 'warehouse',
    placeholderData: (prev) => prev,
  });

  // Apply the active kind chip on the client. `null` («Все») passes
  // everything through. Each non-null chip shows EXACTLY its own kind —
  // the backend `kind` is already canonical (stock_movements.type →
  // kind mapping lives in journal.service.ts), so this is a 1:1 match
  // with no duplicates and no empty-from-bad-mapping results.
  const warehouseDocs = useMemo(() => {
    // Local YYYY-MM-DD formatter — compares calendar days regardless of the
    // doc's time-of-day, matching how `formatDateGroup` buckets rows. Inlined
    // (not the component's `toISODate`) so this memo doesn't depend on a
    // per-render function identity.
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const fromISO = warehouseDateFrom ? fmt(warehouseDateFrom) : null;
    const toISO = warehouseDateTo ? fmt(warehouseDateTo) : null;
    // Поиск на вкладке документов — КЛИЕНТСКИЙ фильтр по уже загруженной
    // ленте (название / поставщик / комментарий). Раньше поле поиска на этой
    // вкладке было мёртвым контролом: текст вводился, но ни на что не влиял.
    // Серверных параметров запроса это не меняет — лента одна, фильтрация
    // in-memory, как и у чипов типа документа.
    const q = search.trim().toLowerCase();
    return allWarehouseDocs.filter((d) => {
      if (warehouseKind && d.kind !== warehouseKind) return false;
      if (fromISO || toISO) {
        const docISO = fmt(new Date(d.occurredAt));
        if (fromISO && docISO < fromISO) return false;
        if (toISO && docISO > toISO) return false;
      }
      if (q) {
        const hay = `${d.title} ${d.subtitle ?? ''} ${d.payeeName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allWarehouseDocs, warehouseKind, warehouseDateFrom, warehouseDateTo, search]);

  // Date-group headers for the warehouse-docs list — same precompute as
  // `dateHeaderByIndex` on the checks tab: flag the first row of each
  // calendar day so the row component renders a «Сегодня / Вчера / 5 июня»
  // divider above it. Relies on the backend feed being date-desc sorted
  // (journal.service.ts orders by occurredAt DESC).
  const warehouseDateHeaderByIndex = useMemo(() => {
    const flags: boolean[] = new Array(warehouseDocs.length).fill(false);
    let prev = '';
    for (let i = 0; i < warehouseDocs.length; i++) {
      const grp = formatDateGroup(warehouseDocs[i].occurredAt);
      if (grp !== prev) {
        flags[i] = true;
        prev = grp;
      }
    }
    return flags;
  }, [warehouseDocs]);

  // Optimistic delete — UX feels instant because the row disappears
  // BEFORE the server confirms. The rollback path restores the cache
  // snapshot if the network rejects (rare, but possible: 403 on a
  // permission downgrade, 404 if someone else already deleted, etc.).
  const deleteMutation = useMutation({
    mutationFn: (id: string) => checksApi.remove(id),
    onMutate: async (id: string) => {
      // Cancel anything in-flight against this list — otherwise the
      // refetch lands after our local mutation and resurrects the row.
      await queryClient.cancelQueries({ queryKey: ['checks-infinite'] });
      const prev = queryClient.getQueriesData<{ pages?: { data?: Check[]; total?: number }[] }>({
        queryKey: ['checks-infinite'],
      });
      // Eager remove across every page-set variant currently in cache.
      // Each `data.pages[*].data[*]` is the flat per-page array.
      queryClient.setQueriesData<{ pages?: { data?: Check[]; total?: number }[] } | undefined>(
        { queryKey: ['checks-infinite'] },
        (old) => {
          if (!old?.pages) return old;
          // `total` каждой страницы — ОБЩИЙ счётчик чеков (getNextPageParam
          // читает lastPage.total). Декрементируем его на ВСЕХ страницах,
          // если строка нашлась хоть на одной — иначе страницы несли разные
          // total и пагинация могла запросить лишнюю/пропустить хвостовую
          // страницу до сервер-инвалидации (mobile-audit M6).
          const found = old.pages.some((p) => (p?.data ?? []).some((c) => c.id === id));
          return {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: (p?.data ?? []).filter((c) => c.id !== id),
              total: (p?.total ?? 0) - (found ? 1 : 0),
            })),
          };
        },
      );
      return { prev };
    },
    onError: (err: any, _id, ctx) => {
      // Restore every variant we snapshotted in onMutate.
      ctx?.prev.forEach(([key, val]) => queryClient.setQueryData(key, val));
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить');
    },
    onSettled: () => {
      // Server is authoritative once the mutation settles. Cover both
      // the legacy `['checks', ...]` key (used by paginated queries
      // elsewhere — Reports / Salary etc.) and the new infinite key
      // the journal owns. invalidateQueries with a prefix invalidates
      // any longer key that starts with it.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      // Real dashboard keys (legacy `['dashboard']` matched no active
      // query). Owner deleting a check from the Journal still wants
      // the dashboard / cashflow numbers to drop accordingly.
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      // Деньги чека каскадно меняют зарплату / отчёты / рейтинг / историю
      // клиента (backend считает их из checks) — mobile-audit C1.
      for (const queryKey of CHECK_MONEY_DEPENDENT_KEYS) {
        queryClient.invalidateQueries({ queryKey });
      }
      // Корзина (106): удалённый чек тут же должен появиться в списке
      // CheckTrashScreen, если owner откроет его следом.
      queryClient.invalidateQueries({ queryKey: ['checks-trash'] });
    },
  });

  const handleDelete = useCallback(
    (checkId: string, checkNumber: number) => {
      // Формулировка честная про корзину (106): DELETE — это софт-удаление,
      // «Это действие необратимо» больше неправда. 30 дней на восстановление.
      Alert.alert('Удалить чек', `Заказ-наряд #${checkNumber} будет перемещён в корзину (хранится 30 дней).`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate(checkId) },
      ]);
    },
    [deleteMutation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    if (activeTab === 'checks') {
      await queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
    } else {
      await queryClient.invalidateQueries({ queryKey: ['journal-warehouse-docs'] });
    }
    setRefreshing(false);
  };

  // Flatten all loaded pages — newest first comes from page 1, older
  // appended below from page 2+. The reduce avoids creating a fresh
  // array on every render unless the underlying pages change.
  // «Возврат клиента» фильтрует СЕРВЕР (isReturned в queryFn выше) —
  // клиентского пост-фильтра по страницам больше нет.
  const checks = useMemo(
    () =>
      dedupeById(
        (Array.isArray(checksData?.pages) ? checksData.pages : []).flatMap((p) =>
          Array.isArray(p?.data) ? p.data : [],
        ),
      ),
    [checksData?.pages],
  );
  const total = checksData?.pages?.[0]?.total ?? 0;

  // Group checks by date — precompute «у этого индекса нужен заголовок?»
  // на основе всего массива `checks`. Раньше использовался mutable
  // `lastDateGroup`, который через closure rendered'ил неправильно при
  // recycling в FlashList (карточки рисовались не строго по порядку).
  const dateHeaderByIndex = useMemo(() => {
    const flags: boolean[] = new Array(checks.length).fill(false);
    let prev = '';
    for (let i = 0; i < checks.length; i++) {
      const grp = formatDateGroup(checks[i].date);
      if (grp !== prev) {
        flags[i] = true;
        prev = grp;
      }
    }
    return flags;
  }, [checks]);

  // Любая смена фильтра/поиска возвращает список наверх (без анимации).
  // Без этого пользователь, наскролливший вглубь, при смене фильтра
  // оставался на прежнем offset'е: placeholderData схлопывается до
  // page-1 нового ключа, список резко укорачивается — и человек повисал
  // в пустоте под концом контента. Даты сравниваем по ISO-строке, чтобы
  // повторный выбор того же дня (новый Date-объект) не дёргал скролл.
  const checksListRef = useRef<FlatList<Check>>(null);
  const dateFromKey = dateFrom ? toISODate(dateFrom) : '';
  const dateToKey = dateTo ? toISODate(dateTo) : '';
  useEffect(() => {
    checksListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [search, dateFromKey, dateToKey, filterMasterId, deferredOnly, returnsOnly]);

  // Единая точка сброса фильтров вкладки «Чеки» — используется кнопкой
  // «Сбросить фильтры» в панели, чипом «Сбросить всё» над списком и
  // empty-state'ом «ничего не найдено». Сеттеры стабильны — deps пусты.
  const resetChecksFilters = useCallback(() => {
    setDateFrom(null);
    setDateTo(null);
    setFilterMasterId('');
    setReturnsOnly(false);
    setDeferredOnly(false);
  }, []);

  // Stable navigation handler — `useCallback` so the prop passed to
  // CheckRow doesn't change across screen renders (would bust React.memo).
  const openCheckDetail = useCallback(
    (checkId: string) => {
      // ВАЖНО: НЕ прайми кеш `['check', id]` row-данными из журнала.
      // Прошлая итерация делала setQueryData с row payload, в котором
      // `services` / `products` могут быть undefined (list endpoint
      // не отдаёт их детально), и CheckDetailScreen потом крэшил на
      // `check.services.length` / `(check.products || []).map(...)`.
      // CheckDetailScreen теперь сам делает безопасный placeholderData
      // lookup через queryClient.getQueriesData(['checks-infinite']),
      // и при этом guard'ит .length / .map от undefined. См. iter#12.
      navigation.navigate('CheckDetail', { id: checkId });
    },
    [navigation],
  );

  // Prefetch-on-tap — fires on `onPressIn` (before the navigation push)
  // so the detail screen mounts with the canonical query already
  // in-flight. CheckDetailScreen forces `refetchOnMount: 'always'`
  // because payment status is critical, but the prefetch shaves the
  // network round-trip off the perceived load time.
  const prefetchCheckDetail = useCallback(
    (checkId: string) => {
      queryClient.prefetchQuery({
        queryKey: ['check', checkId],
        queryFn: async () => {
          const res = await checksApi.getById(checkId);
          return res.data;
        },
        staleTime: 30_000,
      });
    },
    [queryClient],
  );

  const renderCheck = useCallback(
    ({ item: check, index }: { item: Check; index: number }) => (
      <CheckRow
        check={check}
        showDateHeader={dateHeaderByIndex[index] === true}
        dateGroupLabel={formatDateGroup(check.date)}
        canDelete={canDelete}
        canViewProfit={canViewProfit}
        onOpen={openCheckDetail}
        onPressIn={prefetchCheckDetail}
        onDelete={handleDelete}
        palette={palette}
      />
    ),
    [dateHeaderByIndex, canDelete, canViewProfit, openCheckDetail, prefetchCheckDetail, handleDelete, palette],
  );

  const renderWarehouseDoc = useCallback(
    ({ item, index }: { item: JournalDoc; index: number }) => (
      <WarehouseDocRow
        item={item}
        showDateHeader={warehouseDateHeaderByIndex[index] === true}
        dateGroupLabel={formatDateGroup(item.occurredAt)}
        onSelect={setSelectedDoc}
        palette={palette}
      />
    ),
    [warehouseDateHeaderByIndex, palette],
  );

  const isWarehouseLoading = warehouseLoading;
  // No IosScreenHeader on this screen — the tab bar already names it
  // «Журнал», so we just reserve the top safe-area inset ourselves so
  // the search bar doesn't slide under the Dynamic Island / status bar.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.safe, { paddingTop: insets.top + 8, backgroundColor: palette.bg.canvas }]}>
      {/* Header removed per owner — the screen reads as Журнал from the
          tab-bar label already, and the count duplicates info shown at
          the bottom of the list (pagination). Less chrome → more list. */}

      {/* Freshness pill — HYBRID-perf plan. ChecksScreen renders from
          persistent cache instantly on cold start, so we expose the
          "background refresh" state to the user as a 10pt secondary pill.
          Position: above the search row, right-aligned, no chrome unless
          actively fetching. */}
      <View style={styles.freshnessRow}>
        {/* «Доска» — вход на канбан-доску заказ-нарядов (приёмка → в работе →
            готов → выдан). Живёт в ChecksStack, поэтому плавающий таб-бар
            остаётся виден, а back возвращает в Журнал. Доска — другой ракурс
            тех же чеков, поэтому вход логично рядом с журналом. */}
        <View style={styles.entryBtnRow}>
          <TouchableOpacity
            style={[styles.boardEntryBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => {
              haptic('tap');
              navigation.navigate('WorkBoard');
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Открыть доску заказ-нарядов"
          >
            <Ionicons name="albums-outline" size={15} color={colors.primary[600]} />
            <Text style={styles.boardEntryText}>Доска</Text>
          </TouchableOpacity>
          {/* «Корзина» (106) — рядом с Доской, тот же pill-паттерн (owner
              brief: «корзина должна быть в разделе журнал рядом с доской»).
              Гейт checks_delete — бэкенд гейтит trash/restore тем же ключом,
              без права кнопку не показываем. Тоже пуш внутри ChecksStack —
              таб-бар остаётся, back возвращает в Журнал. */}
          {canSeeTrash && (
            <TouchableOpacity
              style={[styles.boardEntryBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                navigation.navigate('CheckTrash');
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Открыть корзину удалённых заказ-нарядов"
            >
              <Ionicons name="trash-outline" size={15} color={colors.primary[600]} />
              <Text style={styles.boardEntryText}>Корзина</Text>
            </TouchableOpacity>
          )}
        </View>
        <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
      </View>

      {/* «Ожидают отправки» — офлайн-очередь чеков (Round 9). Узкая пилюля в
          визуальном языке «Доски» выше; видна ТОЛЬКО когда очередь непуста.
          Красная точка-алерт — есть отклонённые сервером записи. */}
      {queuedChecks.length > 0 && (
        <View style={styles.pendingQueueRow}>
          <TouchableOpacity
            style={[
              styles.pendingQueuePill,
              {
                backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50],
                borderColor: palette.mode === 'dark' ? 'rgba(217, 119, 6, 0.35)' : colors.amber[100],
              },
            ]}
            onPress={() => {
              haptic('tap');
              setShowPendingSheet(true);
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Чеки, ожидающие отправки: ${queuedChecks.length}. Открыть список`}
          >
            <Ionicons name="cloud-upload-outline" size={14} color={colors.amber[600]} />
            <Text style={styles.pendingQueueText}>Ожидают отправки: {queuedChecks.length}</Text>
            {queuedFailedCount > 0 && <Ionicons name="alert-circle" size={14} color={colors.red[600]} />}
          </TouchableOpacity>
        </View>
      )}

      {/* Segmented control: Чеки | Складские документы. Стоит НАД поиском:
          сначала выбираешь, НА ЧТО смотришь, потом ищешь и фильтруешь в этом
          контексте (iOS-иерархия «scope → tools»). Внешний вид —
          UISegmentedControl: серая подложка, активный сегмент — карточка
          с мягкой тенью. */}
      <View style={styles.segmentedWrap}>
        <View style={[styles.segmentedControl, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              activeTab === 'checks' && [
                styles.segmentBtnActive,
                buildShadow(palette),
                { backgroundColor: palette.bg.card },
              ],
            ]}
            onPress={() => {
              // Хаптика только при реальном переключении (selection changed);
              // повторный тап по активному сегменту молчит.
              if (activeTab !== 'checks') haptic('select');
              setActiveTab('checks');
            }}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'checks' }}
          >
            <Ionicons
              name="receipt-outline"
              size={15}
              color={activeTab === 'checks' ? colors.primary[700] : palette.text.secondary}
            />
            <Text
              style={[
                styles.segmentBtnText,
                { color: palette.text.secondary },
                activeTab === 'checks' && styles.segmentBtnTextActive,
              ]}
            >
              Чеки
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              activeTab === 'warehouse' && [
                styles.segmentBtnActive,
                buildShadow(palette),
                { backgroundColor: palette.bg.card },
              ],
            ]}
            onPress={() => {
              if (activeTab !== 'warehouse') haptic('select');
              setActiveTab('warehouse');
            }}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'warehouse' }}
          >
            <Ionicons
              name="cube-outline"
              size={15}
              color={activeTab === 'warehouse' ? colors.primary[700] : palette.text.secondary}
            />
            <Text
              style={[
                styles.segmentBtnText,
                { color: palette.text.secondary },
                activeTab === 'warehouse' && styles.segmentBtnTextActive,
              ]}
            >
              Склад. документы
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search + Filter. Placeholder честный и тоже tab-aware: на чеках
          перечисляет РЕАЛЬНЫЕ поля серверного поиска (включая свежий поиск
          по № чека), на складских документах — клиентский фильтр по
          названию / поставщику / комментарию загруженной ленты. */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrap}>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={
              activeTab === 'checks' ? 'Клиент, телефон, госномер, № чека' : 'Название, поставщик, комментарий'
            }
          />
        </View>
        <TouchableOpacity
          style={[
            styles.filterBtn,
            buildShadow(palette),
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            activeFilterCount > 0 && styles.filterBtnActive,
            activeFilterCount > 0 && {
              backgroundColor: palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50],
            },
          ]}
          onPress={() => {
            haptic('tap');
            setShowFilters(!showFilters);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={showFilters ? 'Скрыть фильтры' : 'Показать фильтры'}
        >
          <Ionicons
            name={activeFilterCount > 0 ? 'funnel' : 'funnel-outline'}
            size={18}
            color={
              activeFilterCount > 0
                ? palette.mode === 'dark'
                  ? colors.primary[300]
                  : colors.primary[600]
                : palette.text.secondary
            }
          />
          {activeFilterCount > 0 && (
            <View style={[styles.filterCountDot, { borderColor: palette.bg.canvas }]}>
              <Text style={styles.filterCountDotText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Активные фильтры при СВЁРНУТОЙ панели — строка чипов с крестиками.
          Каждый чип снимает свой фильтр; «Сбросить всё» — разом. Когда
          панель открыта, чипы не дублируем: состояние видно в ней самой. */}
      {activeTab === 'checks' && !showFilters && checksFilterCount > 0 && (
        <View style={styles.activeFiltersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.activeFiltersRowInner}>
              {dateFrom && (
                <ActiveFilterChip
                  label={`С ${formatFilterDate(dateFrom)}`}
                  onClear={() => setDateFrom(null)}
                  palette={palette}
                />
              )}
              {dateTo && (
                <ActiveFilterChip
                  label={`По ${formatFilterDate(dateTo)}`}
                  onClear={() => setDateTo(null)}
                  palette={palette}
                />
              )}
              {filterMasterId !== '' && (
                <ActiveFilterChip
                  label={activeUsers.find((u) => u.id === filterMasterId)?.fullName?.split(' ')[0] ?? 'Сотрудник'}
                  onClear={() => setFilterMasterId('')}
                  palette={palette}
                />
              )}
              {returnsOnly && (
                <ActiveFilterChip label="Возврат клиента" onClear={() => setReturnsOnly(false)} palette={palette} />
              )}
              {deferredOnly && (
                <ActiveFilterChip label="Отложенные" onClear={() => setDeferredOnly(false)} palette={palette} />
              )}
              <TouchableOpacity
                onPress={() => {
                  haptic('tap');
                  resetChecksFilters();
                }}
                activeOpacity={0.7}
                style={[
                  styles.activeFilterChip,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50],
                    borderColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.35)' : colors.red[100],
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Сбросить все фильтры"
              >
                <Ionicons
                  name="close-circle-outline"
                  size={14}
                  color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                />
                <Text
                  style={[
                    styles.activeFilterChipText,
                    { color: palette.mode === 'dark' ? colors.red[300] : colors.red[600] },
                  ]}
                >
                  Сбросить всё
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}

      {/* Filters panel (only for checks tab) — сгруппированный «лоток»:
          приглушённая подложка + hairline, внутри секции с 11pt-лейблами
          (паттерн iOS grouped list). Белые контролы читаются на подложке
          как отдельные кнопки, а сам лоток — как единый временный слой
          настроек над списком. */}
      {showFilters && activeTab === 'checks' && (
        <View style={[styles.filtersPanel, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          {/* Date range */}
          <Text style={[styles.filterSectionLabel, { color: palette.text.tertiary }]}>Период</Text>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowDateFromPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  dateFrom && { color: palette.text.primary },
                ]}
              >
                {dateFrom ? formatFilterDate(dateFrom) : 'С даты'}
              </Text>
              {dateFrom && (
                <TouchableOpacity
                  onPress={() => {
                    setDateFrom(null);
                    setPage(1);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <Ionicons name="arrow-forward" size={12} color={palette.text.tertiary} />
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowDateToPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  dateTo && { color: palette.text.primary },
                ]}
              >
                {dateTo ? formatFilterDate(dateTo) : 'По дату'}
              </Text>
              {dateTo && (
                <TouchableOpacity
                  onPress={() => {
                    setDateTo(null);
                    setPage(1);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Employee filter */}
          <Text style={[styles.filterSectionLabel, styles.filterSectionLabelNext, { color: palette.text.tertiary }]}>
            Сотрудник
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing[1.5] }}>
              <TouchableOpacity
                style={[
                  styles.empChip,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  !filterMasterId && styles.empChipActive,
                  !filterMasterId && {
                    backgroundColor:
                      palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50],
                  },
                ]}
                onPress={() => {
                  setFilterMasterId('');
                  setPage(1);
                }}
              >
                <Text
                  style={[
                    styles.empChipText,
                    { color: palette.text.secondary },
                    !filterMasterId && styles.empChipTextActive,
                    !filterMasterId && palette.mode === 'dark' && { color: colors.primary[300] },
                  ]}
                >
                  Все
                </Text>
              </TouchableOpacity>
              {activeUsers.map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={[
                    styles.empChip,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    filterMasterId === u.id && styles.empChipActive,
                    filterMasterId === u.id && {
                      backgroundColor:
                        palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50],
                    },
                  ]}
                  onPress={() => {
                    setFilterMasterId(filterMasterId === u.id ? '' : u.id);
                    setPage(1);
                  }}
                >
                  <Text
                    style={[
                      styles.empChipText,
                      { color: palette.text.secondary },
                      filterMasterId === u.id && styles.empChipTextActive,
                      filterMasterId === u.id && palette.mode === 'dark' && { color: colors.primary[300] },
                    ]}
                  >
                    {u.fullName?.split(' ')[0]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Returns-only toggle — moved inside the filter sheet (was
              a standalone chip above the list). Owner brief: keep the
              functionality but hide it behind the funnel button so the
              main view stays clean. */}
          <Text style={[styles.filterSectionLabel, styles.filterSectionLabelNext, { color: palette.text.tertiary }]}>
            Показать только
          </Text>
          <View style={{ gap: spacing[2] }}>
            <TouchableOpacity
              onPress={() => {
                // Тумблер — значимое переключение состояния списка: та же
                // selection-хаптика, что у сегментов (не на каждом чипе).
                haptic('select');
                setReturnsOnly((v) => !v);
              }}
              activeOpacity={0.7}
              style={[
                styles.returnsToggleRow,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                returnsOnly && styles.returnsToggleRowActive,
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: returnsOnly }}
              accessibilityLabel="Только возвраты клиентов"
            >
              <Ionicons
                name="arrow-undo-outline"
                size={14}
                color={returnsOnly ? colors.red[600] : palette.text.secondary}
              />
              <Text
                style={[styles.returnsToggleLabel, { color: returnsOnly ? colors.red[700] : palette.text.primary }]}
              >
                Возврат клиента
              </Text>
              <View
                style={[
                  styles.returnsToggleSwitch,
                  // Off-трек — border.strong: subtle в тёмной теме почти невидим,
                  // и выключенный тумблер сливался с фоном ряда.
                  { backgroundColor: returnsOnly ? colors.red[500] : palette.border.strong },
                ]}
              >
                <View style={[styles.returnsToggleSwitchKnob, returnsOnly && styles.returnsToggleSwitchKnobOn]} />
              </View>
            </TouchableOpacity>

            {/* «Отложенные» — серверный фильтр по isDeferred. Тот же
              toggle-row паттерн, что и «Только возвраты» выше. Красная
              палитра сознательно совпадает с плашкой «Отложен» на
              карточках чеков (red[100]/red[700]) — фильтр и статус
              читаются как одно состояние. */}
            <TouchableOpacity
              onPress={() => {
                haptic('select');
                setDeferredOnly((v) => !v);
                setPage(1);
              }}
              activeOpacity={0.7}
              style={[
                styles.returnsToggleRow,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                deferredOnly && styles.returnsToggleRowActive,
              ]}
              accessibilityRole="switch"
              accessibilityState={{ checked: deferredOnly }}
              accessibilityLabel="Только отложенные"
            >
              <Ionicons name="time-outline" size={14} color={deferredOnly ? colors.red[600] : palette.text.secondary} />
              <Text
                style={[styles.returnsToggleLabel, { color: deferredOnly ? colors.red[700] : palette.text.primary }]}
              >
                Отложенные
              </Text>
              {/* Счётчик «бесплатный»: когда фильтр активен, total первой
                страницы УЖЕ равен числу отложенных — отдельный запрос
                ради цифры не нужен. isPlaceholderData-guard прячет цифру,
                пока на экране данные предыдущего ключа (иначе на миг
                мелькал бы общий total всех чеков). */}
              {deferredOnly && !isPlaceholderData && checksData !== undefined && (
                <View
                  style={[
                    styles.deferredCountBadge,
                    { backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.18)' : colors.red[100] },
                  ]}
                >
                  <Text style={styles.deferredCountBadgeText}>{total}</Text>
                </View>
              )}
              <View
                style={[
                  styles.returnsToggleSwitch,
                  { backgroundColor: deferredOnly ? colors.red[500] : palette.border.strong },
                ]}
              >
                <View style={[styles.returnsToggleSwitchKnob, deferredOnly && styles.returnsToggleSwitchKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.clearFiltersBtn} onPress={resetChecksFilters}>
              <Ionicons name="close-circle-outline" size={14} color={colors.red[500]} />
              <Text style={styles.clearFiltersBtnText}>Сбросить фильтры</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Filters panel (warehouse-documents tab) — mirrors the checks
          funnel panel exactly: collapsed by default, revealed by the SAME
          filter button. Holds the warehouse-doc-specific filters — document
          type (kind) + period (date range). Supplier / warehouse filters are
          intentionally absent: the journal feed exposes no warehouse
          dimension, and supplier debt/balance lives in the Suppliers screen
          (see journal-documents-ux). */}
      {showFilters && activeTab === 'warehouse' && (
        <View style={[styles.filtersPanel, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          {/* Period — same date-range control as the checks panel */}
          <Text style={[styles.filterSectionLabel, { color: palette.text.tertiary }]}>Период</Text>
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowWhDateFromPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  warehouseDateFrom && { color: palette.text.primary },
                ]}
              >
                {warehouseDateFrom ? formatFilterDate(warehouseDateFrom) : 'С даты'}
              </Text>
              {warehouseDateFrom && (
                <TouchableOpacity
                  onPress={() => setWarehouseDateFrom(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
            <Ionicons name="arrow-forward" size={12} color={palette.text.tertiary} />
            <TouchableOpacity
              style={[styles.filterDateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setShowWhDateToPicker(true)}
            >
              <Ionicons name="calendar-outline" size={14} color={palette.text.secondary} />
              <Text
                style={[
                  styles.filterDateText,
                  { color: palette.text.tertiary },
                  warehouseDateTo && { color: palette.text.primary },
                ]}
              >
                {warehouseDateTo ? formatFilterDate(warehouseDateTo) : 'По дату'}
              </Text>
              {warehouseDateTo && (
                <TouchableOpacity
                  onPress={() => setWarehouseDateTo(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={14} color={palette.text.tertiary} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          </View>

          {/* Document type — the kind chips, moved here from the old
              always-visible glass strip so the tab opens clean (same
              collapse-behind-funnel UX as the checks tab). Horizontal
              scroll keeps all chips reachable; per-kind accent + icon
              preserved from the previous strip. */}
          <Text style={[styles.filterSectionLabel, styles.filterSectionLabelNext, { color: palette.text.tertiary }]}>
            Тип документа
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.kindChipsRowInner}>
              {KIND_CHIPS.map((chip) => {
                const active = warehouseKind === chip.key;
                const visual = chip.key ? journalKindVisual[chip.key] : null;
                return (
                  <TouchableOpacity
                    key={chip.key ?? 'all'}
                    onPress={() => setWarehouseKind(chip.key)}
                    activeOpacity={0.7}
                    style={[
                      styles.kindChip,
                      {
                        // На приглушённой подложке лотка неактивный чип —
                        // карточная поверхность (bg.muted сливался бы с ней).
                        backgroundColor: active ? (visual?.accentColor ?? colors.primary[600]) : palette.bg.card,
                        borderColor: active ? (visual?.accentColor ?? colors.primary[600]) : palette.border.subtle,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={chip.label}
                  >
                    {visual && (
                      <Ionicons name={visual.icon} size={12} color={active ? colors.white : palette.text.secondary} />
                    )}
                    <Text style={[styles.kindChipText, { color: active ? colors.white : palette.text.secondary }]}>
                      {chip.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {warehouseFilterCount > 0 && (
            <TouchableOpacity
              style={styles.clearFiltersBtn}
              onPress={() => {
                setWarehouseKind(null);
                setWarehouseDateFrom(null);
                setWarehouseDateTo(null);
              }}
            >
              <Ionicons name="close-circle-outline" size={14} color={colors.red[500]} />
              <Text style={styles.clearFiltersBtnText}>Сбросить фильтры</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Date pickers */}
      <DateTimePickerModal
        visible={showDateFromPicker}
        value={dateFrom || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDateFromPicker(false);
          setDateFrom(d);
          setPage(1);
        }}
        onCancel={() => setShowDateFromPicker(false)}
      />
      <DateTimePickerModal
        visible={showDateToPicker}
        value={dateTo || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDateToPicker(false);
          setDateTo(d);
          setPage(1);
        }}
        onCancel={() => setShowDateToPicker(false)}
      />
      {/* Warehouse-tab date pickers — separate visibility + state from the
          checks pickers above so the two tabs' date ranges stay independent. */}
      <DateTimePickerModal
        visible={showWhDateFromPicker}
        value={warehouseDateFrom || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowWhDateFromPicker(false);
          setWarehouseDateFrom(d);
        }}
        onCancel={() => setShowWhDateFromPicker(false)}
      />
      <DateTimePickerModal
        visible={showWhDateToPicker}
        value={warehouseDateTo || new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowWhDateToPicker(false);
          setWarehouseDateTo(d);
        }}
        onCancel={() => setShowWhDateToPicker(false)}
      />

      {/* Content */}
      {activeTab === 'checks' ? (
        <>
          {/* Cold-start path:
             - `isError` И ни одной загруженной страницы (нет даже кеша) ⇒
               честный error-state с «Повторить» — раньше тут показывался
               вводящий в заблуждение skeleton/empty. Если кеш есть —
               показываем список (SWR), фон сам дотянет свежее.
             - `checksData === undefined` ⇒ never fetched yet AND no cached
               value — show skeleton (NOT an EmptyState — empty state on
               cold start was the "пусто" flash the owner reported).
             - `checksData` defined but list empty AND not currently fetching ⇒
               legitimate empty state.
             - `checksData` defined ⇒ render the list immediately, even
               while a background refetch is in flight (SWR). */}
          {isError && checksData === undefined ? (
            // ScrollView-обёртка нужна ради pull-to-refresh: жест должен
            // работать и из error-state, а не только когда список жив.
            <ScrollView
              contentContainerStyle={styles.errorStateWrap}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
            >
              <EmptyState
                icon="warning"
                title="Не удалось загрузить журнал"
                description="Проверьте подключение к интернету и попробуйте ещё раз"
                action={{ label: 'Повторить', onPress: () => refetch() }}
              />
            </ScrollView>
          ) : checksData === undefined ? (
            <ListSkeleton count={8} />
          ) : checks.length === 0 && !isLoading ? (
            // Filter-aware empty: «ничего не найдено с фильтрами» — не то же
            // самое, что «чеков вообще нет». В первом случае даём кнопку,
            // которая сбрасывает фильтры И поиск одним тапом — выход из
            // тупика без раскапывания панели.
            checksFilterCount > 0 || search ? (
              <EmptyState
                icon="search"
                title="Ничего не найдено"
                description="С текущими фильтрами и поиском чеков нет"
                action={{
                  label: 'Сбросить фильтры',
                  onPress: () => {
                    resetChecksFilters();
                    setSearch('');
                  },
                }}
              />
            ) : (
              <EmptyState
                icon="receipt"
                title="Чеков пока нет"
                description="Создайте первый заказ-наряд на вкладке «Касса»"
              />
            )
          ) : (
            <FlatList
              ref={checksListRef}
              data={checks}
              keyExtractor={(item) => item.id}
              renderItem={renderCheck}
              contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
              contentInset={{ bottom: tabBarHeight }}
              scrollIndicatorInsets={{ bottom: tabBarHeight }}
              automaticallyAdjustContentInsets={false}
              // Обычный RN FlatList (НЕ FlashList) — тот же фикс, что вылечил
              // экран Клиентов. FlashList РЕЦИКЛИТ ячейки; на Fabric/Android
              // рециклированная ячейка может на кадр показать пустую / устаревшую
              // строку — ровно «то показывает, то нет, то мерцает» у владельца.
              // FlatList монтирует по строке на чек и не переиспользует их,
              // поэтому строка физически не может «побелеть». removeClippedSubviews
              // OFF — офскрин-строку никогда не отсоединяют/присоединяют заново
              // (ещё один источник пустого кадра на Android). Список только
              // ДОПОЛНЯЕТСЯ снизу (onEndReached), верх не переанкорится.
              // windowSize 21 (~10 экранов в обе стороны) + батчинг раз в
              // 50мс: при быстром флике виртуализация не успевала отрисовать
              // догоняющие строки — владелец видел «пустые блоки». Строки
              // журнала лёгкие (мемоизированные карточки), десять экранов
              // в памяти дешевле одного мигающего кадра.
              removeClippedSubviews={false}
              initialNumToRender={12}
              windowSize={21}
              maxToRenderPerBatch={12}
              updateCellsBatchingPeriod={50}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              onEndReached={() => {
                // Догружаем следующую страницу вниз. `!isPlaceholderData`
                // критичен: сразу после смены поиска/фильтра список ещё
                // показывает страницы ПРЕДЫДУЩЕГО ключа через глобальный
                // placeholderData — пагинация этого «одолженного» снапшота
                // гонялась бы с загрузкой page-1 нового ключа и подменяла бы
                // видимые строки (как раз мерцание / пропадание).
                if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) fetchNextPage();
              }}
              onEndReachedThreshold={0.5}
              ItemSeparatorComponent={ListGap}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary[600]} />
                  </View>
                ) : null
              }
            />
          )}
        </>
      ) : (
        <>
          {/* Cold-start path: skeleton only while the very first (unfiltered)
             fetch is in flight. Switching chips never shows a skeleton —
             the feed is already loaded and we filter it in memory.
             Empty state is filter-aware: distinguish «no documents at all»
             from «no documents of THIS kind», so an empty chip reads as a
             real (correct) result, not a broken filter. */}
          {isWarehouseLoading && allWarehouseDocs.length === 0 ? (
            <ListSkeleton count={8} />
          ) : warehouseDocs.length === 0 ? (
            // Filter-aware empty — тот же паттерн, что на вкладке чеков:
            // «ничего не найдено под фильтрами» отличается от «документов нет
            // вообще», и из первого состояния есть выход одним тапом.
            (warehouseKind || warehouseDateFrom || warehouseDateTo || search) && allWarehouseDocs.length > 0 ? (
              <EmptyState
                icon="search"
                title="Ничего не найдено"
                description="С текущими фильтрами и поиском документов нет"
                action={{
                  label: 'Сбросить фильтры',
                  onPress: () => {
                    setWarehouseKind(null);
                    setWarehouseDateFrom(null);
                    setWarehouseDateTo(null);
                    setSearch('');
                  },
                }}
              />
            ) : (
              <EmptyState
                icon="cube"
                title="Документов не найдено"
                description="Складские движения и поставки появятся здесь"
              />
            )
          ) : (
            <FlatList
              data={warehouseDocs}
              keyExtractor={(item) => `${item.kind}-${item.id}`}
              renderItem={renderWarehouseDoc}
              contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
              contentInset={{ bottom: tabBarHeight }}
              scrollIndicatorInsets={{ bottom: tabBarHeight }}
              automaticallyAdjustContentInsets={false}
              // Обычный RN FlatList (НЕ FlashList) — см. пояснение у списка
              // чеков выше. removeClippedSubviews=false убирает пустые кадры
              // от отсоединения офскрин-строк на Android. windowSize 21 +
              // updateCellsBatchingPeriod 50 — тот же анти-blank-cells
              // тюнинг, что и у списка чеков выше.
              removeClippedSubviews={false}
              initialNumToRender={12}
              windowSize={21}
              maxToRenderPerBatch={12}
              updateCellsBatchingPeriod={50}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              ItemSeparatorComponent={ListGap}
            />
          )}
        </>
      )}
      {/* Warehouse Document Detail Modal — driven by JournalDoc. The
          backend already normalises kind / title / subtitle / amount, so
          the modal is a thin presentational view. Payment-status badges
          are intentionally absent: warehouse docs have no "paid /
          unpaid" semantic; supplier debt lives in the Suppliers screen. */}
      <Modal
        visible={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        title={selectedDoc ? journalKindLabels[selectedDoc.kind] : ''}
      >
        {selectedDoc &&
          (() => {
            const doc = selectedDoc;
            const visual = journalKindVisual[doc.kind];
            const isNegative = NEGATIVE_KINDS.has(doc.kind);
            const amountColor =
              doc.kind === 'used_purchase'
                ? colors.purple[700]
                : doc.kind === 'customer_return'
                  ? colors.teal[600]
                  : isNegative
                    ? colors.red[600]
                    : colors.green[600];
            return (
              <View style={{ gap: spacing[3] }}>
                <View style={[styles.docDetailHeader, { borderBottomColor: palette.border.subtle }]}>
                  <View style={[styles.docDetailIcon, { backgroundColor: visual.accentColor + '18' }]}>
                    <Ionicons name={visual.icon} size={28} color={visual.iconColor} />
                  </View>
                  <Text style={[styles.docDetailType, { color: palette.text.primary }]}>
                    {journalKindLabels[doc.kind]}
                  </Text>
                </View>

                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Описание</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]} numberOfLines={3}>
                    {doc.title}
                  </Text>
                </View>
                {doc.payeeName && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Поставщик</Text>
                    <Text style={[styles.docDetailValue, { color: palette.text.primary }]} numberOfLines={2}>
                      {doc.payeeName}
                    </Text>
                  </View>
                )}
                {doc.subtitle && (
                  <View style={styles.docDetailRow}>
                    <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Комментарий</Text>
                    <Text
                      style={[styles.docDetailValue, { color: palette.text.primary, fontStyle: 'italic' }]}
                      numberOfLines={4}
                    >
                      {doc.subtitle}
                    </Text>
                  </View>
                )}
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Сумма</Text>
                  <Text style={[styles.docDetailValue, { color: amountColor, fontWeight: fontWeight.bold }]}>
                    {isNegative ? '-' : '+'}
                    {formatMoney(Math.abs(doc.amount))}
                  </Text>
                </View>
                <View style={styles.docDetailRow}>
                  <Text style={[styles.docDetailLabel, { color: palette.text.secondary }]}>Дата</Text>
                  <Text style={[styles.docDetailValue, { color: palette.text.primary }]}>
                    {formatDate(doc.occurredAt)}
                  </Text>
                </View>
              </View>
            );
          })()}
      </Modal>

      {/* Шит офлайн-очереди (Round 9): список отложенных чеков — сумма /
          клиент / время, глобальная «Отправить сейчас», per-item удаление с
          подтверждением; отклонённые сервером — с сообщением и «Повторить». */}
      <Modal visible={showPendingSheet} onClose={() => setShowPendingSheet(false)} title="Ожидают отправки">
        <View style={{ gap: spacing[3] }}>
          <Text style={[styles.queueSheetIntro, { color: palette.text.secondary }]}>
            Эти чеки сохранены на телефоне и отправятся автоматически, когда появится связь с сервером.
          </Text>

          {queuedChecks.map((entry) => {
            const failed = entry.status === 'failed';
            return (
              <View
                key={entry.clientRequestId}
                style={[
                  styles.queueEntryCard,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
              >
                <View style={styles.queueEntryTop}>
                  <Text style={[styles.queueEntrySum, { color: palette.text.primary }]}>
                    {typeof entry.meta?.total === 'number' ? formatMoney(entry.meta.total) : 'Чек'}
                  </Text>
                  <Text style={[styles.queueEntryTime, { color: palette.text.tertiary }]}>
                    {formatDate(new Date(entry.createdAt).toISOString())}
                  </Text>
                  <TouchableOpacity
                    onPress={() => confirmDeleteQueued(entry)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Удалить отложенный чек"
                  >
                    <Ionicons name="trash-outline" size={18} color={palette.text.tertiary} />
                  </TouchableOpacity>
                </View>

                {(entry.meta?.clientName || entry.meta?.carInfo) && (
                  <Text style={[styles.queueEntryClient, { color: palette.text.secondary }]} numberOfLines={1}>
                    {[entry.meta?.clientName, entry.meta?.carInfo].filter(Boolean).join(' · ')}
                  </Text>
                )}

                {failed ? (
                  <>
                    <View style={styles.queueEntryFailedRow}>
                      <Ionicons name="alert-circle" size={14} color={colors.red[600]} />
                      <Text style={[styles.queueEntryFailedText, { color: colors.red[600] }]} numberOfLines={3}>
                        {entry.failedMessage || 'Сервер отклонил чек'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.queueRetryBtn,
                        {
                          backgroundColor:
                            palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50],
                        },
                      ]}
                      onPress={() => retryQueued(entry)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Повторить отправку чека"
                    >
                      <Ionicons
                        name="refresh"
                        size={14}
                        color={palette.mode === 'dark' ? colors.primary[300] : colors.primary[600]}
                      />
                      <Text
                        style={[
                          styles.queueRetryText,
                          { color: palette.mode === 'dark' ? colors.primary[300] : colors.primary[600] },
                        ]}
                      >
                        Повторить
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={[styles.queueEntryStatus, { color: palette.text.tertiary }]}>
                    Ожидает сети{entry.attempts > 0 ? ` · попыток: ${entry.attempts}` : ''}
                  </Text>
                )}
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.queueSendAllBtn, (sendingQueueNow || queuedPendingCount === 0) && { opacity: 0.55 }]}
            onPress={handleSendQueueNow}
            disabled={sendingQueueNow || queuedPendingCount === 0}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Отправить все отложенные чеки сейчас"
          >
            {sendingQueueNow ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="cloud-upload" size={16} color={colors.white} />
                <Text style={styles.queueSendAllText}>Отправить сейчас</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // «Доска» entry (left) + FreshnessBadge (right) — single row above search.
  // (Bespoke title-header styles removed — the header itself was removed
  // per owner brief, tab bar already names the screen «Журнал».)
  freshnessRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[1],
    minHeight: 28,
  },
  // Группа входов слева («Доска» + owner-only «Корзина») — pills в ряд,
  // FreshnessBadge остаётся прижат вправо через space-between родителя.
  entryBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  boardEntryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  boardEntryText: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  // ── Офлайн-очередь чеков (Round 9) ──────────────────────────────
  // Пилюля «Ожидают отправки: N» — тот же pill-язык, что «Доска» выше,
  // но амберный (внимание без паники); видна только при N > 0.
  pendingQueueRow: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[1],
    flexDirection: 'row',
  },
  pendingQueuePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  pendingQueueText: { fontSize: 13, fontWeight: fontWeight.semibold, color: colors.amber[600] },
  // Шит «Ожидают отправки»
  queueSheetIntro: { fontSize: fontSize.sm, lineHeight: 19 },
  queueEntryCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3],
    gap: spacing[1.5],
  },
  queueEntryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  queueEntrySum: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  queueEntryTime: { fontSize: fontSize.xs },
  queueEntryClient: { fontSize: fontSize.sm },
  queueEntryStatus: { fontSize: fontSize.xs },
  queueEntryFailedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[1.5],
  },
  queueEntryFailedText: { flex: 1, fontSize: fontSize.xs, lineHeight: 16 },
  queueRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
  },
  queueRetryText: { fontSize: 13, fontWeight: fontWeight.semibold },
  queueSendAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    minHeight: 44,
  },
  queueSendAllText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.white },
  // ── Search + Filter row ─────────────────────────────────────────
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[1],
  },
  searchInputWrap: {
    flex: 1,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: {
    // backgroundColor moved inline at render so dark mode can swap the
    // washed primary[50] pastel for a translucent accent glow (light keeps
    // primary[50]). Border stays the saturated accent in both themes.
    borderColor: colors.primary[300],
  },
  filterCountDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.white,
  },
  filterCountDotText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },

  // ── Returns-only toggle row (lives inside the filter sheet) ─────
  // Owner brief: "Возвраты" is hidden from the main header — it now
  // lives behind the funnel button as a labelled switch row, matching
  // the rest of the filter UI.
  returnsToggleRow: {
    // Вертикальный ритм задаёт обёртка тумблеров (gap: spacing[2]) — свой
    // marginTop убран, чтобы отступ после лейбла секции не удваивался.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  returnsToggleRowActive: {
    // No background flip — the switch itself signals state. We only
    // boost the border to a faint red so it reads as "filter on" at
    // a glance.
    borderColor: colors.red[300],
  },
  returnsToggleLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  returnsToggleSwitch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    padding: 2,
    justifyContent: 'center',
  },
  returnsToggleSwitchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  returnsToggleSwitchKnobOn: {
    transform: [{ translateX: 16 }],
  },
  // Счётчик отложенных на toggle-row «Отложенные». Цветовая пара
  // red[100]/red[700] — ровно та же, что у плашки «Отложен» на карточке
  // чека (deferredBadge/deferredText), bg в dark-mode задаётся inline.
  deferredCountBadge: {
    minWidth: 20,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    marginRight: spacing[1],
  },
  deferredCountBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.red[700] },

  // ── Warehouse kind chips (now inside the funnel filter panel) ───
  // Document-type filter chips for the warehouse-docs tab. Moved out of the
  // old always-visible Liquid-Glass strip and behind the funnel button so the
  // tab opens clean, mirroring the checks tab. `kindChipsRowInner` lays the
  // chips out in a row inside a horizontal ScrollView within the filter panel.
  kindChipsRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    height: 32,
    minHeight: 32,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  kindChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // ── Segmented Control ───────────────────────────────────────────
  segmentedWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    // 2pt — как у нативного UISegmentedControl (было 3).
    padding: 2,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
  },
  segmentBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  segmentBtnTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },

  // ── Filters panel ───────────────────────────────────────────────
  // Сгруппированный лоток настроек: приглушённая подложка (bg.muted inline) +
  // hairline-рамка + радиус 2xl. Отступы кратны 4: снаружи 16, внутри 12.
  filtersPanel: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  // 11pt uppercase section label — тот же рисунок, что iosSectionLabel
  // (единый язык лейблов секций по всему приложению).
  filterSectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing[1.5],
  },
  // Отбивка между секциями внутри лотка.
  filterSectionLabelNext: { marginTop: spacing[3] },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  filterDateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  // 13pt (iOS footnote) — прежний 12pt xs был мельче, чем нужно полю с датой.
  filterDateText: { flex: 1, fontSize: 13, color: colors.gray[400] },
  empChip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[100],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  // backgroundColor moved inline at render (dark → accent glow, light → primary[50]).
  empChipActive: { borderColor: colors.primary[500] },
  empChipText: { fontSize: 13, fontWeight: fontWeight.medium, color: colors.gray[600] },
  empChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
  clearFiltersBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    marginTop: spacing[3],
    paddingVertical: spacing[1.5],
    minHeight: 32,
  },
  clearFiltersBtnText: { fontSize: 13, color: colors.red[500], fontWeight: fontWeight.medium },

  // ── Active-filter chips (collapsed panel) ───────────────────────
  // Строка чипов активных фильтров над списком чеков — видна только при
  // свёрнутой панели. Цвета chip'а задаются inline (palette-aware).
  activeFiltersRow: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  activeFiltersRowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  activeFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    height: 28,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    maxWidth: 200,
  },
  activeFilterChipText: { fontSize: 13, fontWeight: fontWeight.medium },

  // ── List ────────────────────────────────────────────────────────
  // iOS: bottom space reserved via the list's contentInset prop so
  // the floating Liquid Glass bar shows live content scrolling under
  // it. Android: contentInset is silently ignored by the platform, so
  // we add an explicit paddingBottom equal to the M3 NavigationBar
  // height (added inline at the FlatList consumers below to avoid
  // hard-coding the bar height here).
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  // Error-state контейнер (чеки не загрузились и кеша нет): растягиваем
  // ScrollView на весь экран и центрируем EmptyState, чтобы блок стоял
  // там же, где skeleton/empty — без прыжков layout'а между состояниями.
  errorStateWrap: { flexGrow: 1, justifyContent: 'center' },

  // Date group headers
  dateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
  },
  dateGroupLine: { flex: 1, height: 1 },
  // 11pt / tracking 1 — тот же рисунок, что iosSectionLabel и лейблы секций
  // панели фильтров: один типографический голос у всех «надписей-разделителей».
  dateGroupText: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // ── Check card ──────────────────────────────────────────────────
  // Лёгкая карточка для FlatList на сотни строк: hairline-рамка + мягкая
  // buildShadow-тень, НИКАКИХ blur/тяжёлых слоёв. Типографика по iOS-шкале:
  // 17 сумма / 15 заголовок / 13 мета / 12 подвал / 11-10 бейджи.
  checkCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  accentBar: { width: 3.5 },
  checkContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[3] },

  // Верхний блок: слева клиент + мета, справа сумма + способ оплаты.
  checkTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  checkPrimaryCol: { flex: 1, gap: spacing[1] },
  // 15pt semibold — subheadline emphasized: первичный текст строки списка.
  checkTitle: { fontSize: 15, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  checkMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing[2],
    rowGap: spacing[1],
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // 13pt footnote — вторичная строка (№, авто, пробег, скидка).
  metaText: { fontSize: 13, maxWidth: 150 },
  plateTag: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.primary[700],
    backgroundColor: colors.primary[50],
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    marginLeft: 2,
    letterSpacing: 0.3,
  },
  checkAmountCol: { alignItems: 'flex-end', gap: spacing[1] },
  checkSumRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  // 17pt bold + tabular-nums — деньги: самый крупный текст карточки,
  // разряды выравниваются по колонке при скролле.
  checkTotal: { fontSize: 17, fontWeight: fontWeight.bold, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  deleteBtn: { padding: 2 },

  // Строка статусов (только у исключительных чеков).
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[1.5], marginTop: spacing[2] },
  paymentBadge: {
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.full,
  },
  paymentBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  deferredBadge: {
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.full,
  },
  deferredText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.red[700] },
  // «Исполнитель» — компактный фиолетовый чип; цвета приходят inline из
  // getBadgeColors (purple), поэтому корректны в light и dark.
  executorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.full,
  },
  executorBadgeText: { fontSize: 10, fontWeight: fontWeight.bold },
  // Возвращённый чек — насыщенно красная плашка с иконкой стрелки.
  // Сильнее «Отложен», потому что возврат — терминальное состояние:
  // редактировать чек больше нельзя.
  returnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    backgroundColor: colors.red[500],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.full,
  },
  returnedBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: 0.4 },
  // «По гарантии» → убыток. Сплошной rose[500] + белый текст (как returnedBadge)
  // — читается одинаково в light и dark, не зависит от палитры бейджей.
  warrantyLossBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    backgroundColor: colors.rose[500],
    paddingHorizontal: spacing[2],
    borderRadius: borderRadius.full,
  },
  warrantyLossBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: 0.4 },

  // Comment — спокойный вторичный курсив (цвет inline, palette-aware).
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[2] },
  commentText: { flex: 1, fontSize: 12, fontStyle: 'italic' },

  // Footer — 12pt caption; прибыль 13pt semibold (денежный акцент подвала).
  checkFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  footerTime: { fontSize: 12, fontVariant: ['tabular-nums'] },
  footerMaster: { fontSize: 12, flex: 1 },
  footerProfit: { fontSize: 13, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },

  // ── Warehouse document cards ────────────────────────────────────
  // Тот же типографический ряд, что у карточки чека: 15 заголовок/сумма,
  // 13 подзаголовок, 12 дата — обе вкладки журнала читаются как один список.
  warehouseCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[100],
  },
  warehouseAccent: {
    width: 3.5,
  },
  warehouseCardContent: {
    flex: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  warehouseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
  },
  warehouseIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warehouseCardTitle: {
    fontSize: 15,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
    color: colors.gray[900],
    marginBottom: 1,
  },
  warehouseCardSubtitle: {
    fontSize: 13,
    color: colors.gray[400],
  },
  warehouseQty: {
    fontSize: 15,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  warehouseDate: {
    fontSize: 12,
    color: colors.gray[400],
    marginTop: 1,
  },
  // ── Document Detail Modal ─────────────────────────────────────
  docDetailHeader: {
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  docDetailIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docDetailType: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  docDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1.5],
  },
  docDetailLabel: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    flex: 1,
  },
  docDetailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[900],
    flex: 1,
    textAlign: 'right',
  },
});
