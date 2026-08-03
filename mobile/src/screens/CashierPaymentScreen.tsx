/**
 * CashierPaymentScreen — центральный таб кассира «Оплата»
 * (Round 14, режим «Кассир», CASHIER_MODE_SPEC).
 *
 * Очередь заказов, готовых к оплате: карточки из колонок доски с
 * notify_client=true («Готова») — это сигнал «машина готова, клиент у кассы».
 * Ниже — остальные отложенные заказы конвейера (если кассиру нужно принять
 * оплату раньше готовности). Сверху — КРУПНЫЙ поиск по госномеру
 * (normalizePlateForSearch, RU+INT нормализация: латиница→кириллица, пробелы
 * и дефисы игнорируются) + терпимый матч по клиенту и №заказа.
 *
 * Тап по карточке → AcceptPaymentScreen (корневой стек) — единый флоу приёма
 * оплаты (скидка + нал/карта/смешанная).
 *
 * Источник данных — общий board-ключ ['checks','board'] (SWR, мгновенный
 * повторный вход). Оплаченные-но-не-выданные карточки показываются отдельной
 * свёрнутой строкой-счётчиком — кассиру они больше не нужны, но видно, что
 * машины ждут выдачи мастером.
 *
 * Android-совместимо: только кросс-платформенные примитивы.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import FreshnessBadge from '../components/FreshnessBadge';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { normalizePlateForSearch } from '../utils/plateMask';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import type { Check, ChecksBoard } from '../../../shared/types';

const BOARD_KEY = ['checks', 'board'] as const;

function formatMoney(v: number) {
  return (
    Math.round(v ?? 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/** Матч заказа по строке поиска: госномер (RU+INT нормализация) / клиент / №. */
function matchesQuery(check: Check, qRaw: string, qRu: string, qIntl: string): boolean {
  const plate = check.car?.plateNumber ?? '';
  if (plate) {
    const plateRu = normalizePlateForSearch(plate, 'ru');
    const plateIntl = normalizePlateForSearch(plate, 'foreign');
    if (qRu && plateRu.includes(qRu)) return true;
    if (qIntl && plateIntl.includes(qIntl)) return true;
  }
  const lower = qRaw.toLowerCase();
  if (check.client?.fullName?.toLowerCase().includes(lower)) return true;
  if (String(check.number).includes(qRaw.replace(/\D/g, '')) && qRaw.replace(/\D/g, '').length > 0) return true;
  return false;
}

interface QueueCardProps {
  check: Check;
  palette: SemanticPalette;
  columnLabel?: string;
  onPress: (check: Check) => void;
}

/** Карточка очереди: авто+номер, клиент, исполнители, место, сумма. */
const QueueCard = React.memo(function QueueCard({ check, palette, columnLabel, onPress }: QueueCardProps) {
  const isDark = palette.mode === 'dark';
  const assignees = check.assignees ?? [];
  return (
    <TouchableOpacity
      style={[
        styles.card,
        buildShadow(palette),
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
      activeOpacity={0.7}
      onPress={() => onPress(check)}
      accessibilityRole="button"
      accessibilityLabel={`Принять оплату по заказ-наряду №${check.number}`}
    >
      <View style={styles.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.cardCar, { color: palette.text.primary }]} numberOfLines={1}>
            {check.car?.makeModel || check.client?.fullName || `Заказ-наряд #${check.number}`}
          </Text>
          <Text style={[styles.cardClient, { color: palette.text.secondary }]} numberOfLines={1}>
            {check.client?.fullName ?? 'Розничный покупатель'} · #{check.number}
          </Text>
        </View>
        {check.car?.plateNumber ? (
          <View
            style={[
              styles.plateTag,
              isDark && {
                backgroundColor: softTint(colors.primary[600], 'dark'),
                borderColor: palette.border.strong,
              },
            ]}
          >
            <Text style={[styles.plateTagText, isDark && { color: palette.accent.primaryText }]}>
              {check.car.plateNumber}
            </Text>
          </View>
        ) : null}
      </View>

      {(assignees.length > 0 || check.location?.name || columnLabel) && (
        <View style={styles.cardMetaRow}>
          {columnLabel ? (
            <View style={[styles.columnChip, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.columnChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                {columnLabel}
              </Text>
            </View>
          ) : null}
          {assignees.length > 0 && (
            <View style={styles.metaItem}>
              <Ionicons name="people-outline" size={12} color={palette.text.tertiary} />
              <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                {assignees
                  .slice(0, 3)
                  .map((a) => (a.fullName ?? '').split(' ')[0] || '—')
                  .join(', ')}
                {assignees.length > 3 ? ` +${assignees.length - 3}` : ''}
              </Text>
            </View>
          )}
          {check.location?.name ? (
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={12} color={palette.text.tertiary} />
              <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                {check.location.name}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      <View style={[styles.cardBottom, { borderTopColor: palette.border.subtle }]}>
        <Text style={[styles.cardTotal, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue)}</Text>
        <View style={styles.payHint}>
          <Text style={styles.payHintText}>Принять оплату</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary[600]} />
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function CashierPaymentScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: board,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery<ChecksBoard>({
    queryKey: BOARD_KEY,
    queryFn: async () => (await checksApi.board()).data,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    setRefreshing(false);
  }, [queryClient]);

  // Push-цепочка (Round 14): «Машина готова к выдаче» приходит кассиру пушем
  // (data.type='order-ready'; см. checks.service). Если приложение открыто —
  // очередь обновляется сама, без pull-to-refresh.
  React.useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const t = typeof data?.type === 'string' ? data.type : '';
      if (t.startsWith('order-')) {
        queryClient.invalidateQueries({ queryKey: BOARD_KEY });
      }
    });
    return () => sub.remove();
  }, [queryClient]);

  const openAccept = useCallback(
    (check: Check) => {
      haptic('select');
      navigation.navigate('AcceptPayment', { id: check.id });
    },
    [navigation],
  );

  // ── Очередь ──────────────────────────────────────────────────────────
  // ready = ОТЛОЖЕННЫЕ заказы в notify-колонках («Готова»); rest — остальные
  // отложенные на доске; paidWaiting — оплачены, ждут выдачи (счётчик).
  // Если notify-колонок нет вообще — вся отложенная доска идёт в ready.
  const { ready, rest, paidWaiting, columnLabelByKey } = useMemo(() => {
    const labels = new Map<string, string>();
    const readyList: Check[] = [];
    const restList: Check[] = [];
    let paidCount = 0;
    if (!board) return { ready: readyList, rest: restList, paidWaiting: 0, columnLabelByKey: labels };
    const notifyKeys = new Set(board.columns.filter((c) => c.notifyClient).map((c) => c.key));
    for (const col of board.columns) {
      labels.set(col.key, col.label);
      for (const c of board.groups[col.key] ?? []) {
        if (!c.isDeferred) {
          if (!c.deliveredAt) paidCount += 1;
          continue;
        }
        if (notifyKeys.size === 0 || notifyKeys.has(col.key)) readyList.push(c);
        else restList.push(c);
      }
    }
    return { ready: readyList, rest: restList, paidWaiting: paidCount, columnLabelByKey: labels };
  }, [board]);

  // ── Поиск: по ВСЕЙ отложенной доске (ready + rest) ───────────────────
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const found = useMemo(() => {
    if (!searching) return [];
    const qRu = normalizePlateForSearch(trimmed, 'ru');
    const qIntl = normalizePlateForSearch(trimmed, 'foreign');
    return [...ready, ...rest].filter((c) => matchesQuery(c, trimmed, qRu, qIntl));
  }, [searching, trimmed, ready, rest]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Оплата"
        subtitle={board ? `${ready.length} готов${ready.length === 1 ? '' : 'ы'} к оплате` : undefined}
        trailing={<FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />}
      />

      {/* ── КРУПНЫЙ поиск по госномеру ──────────────────────────────────── */}
      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchBox,
            buildShadow(palette),
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          ]}
        >
          <Ionicons name="search" size={20} color={palette.text.tertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            style={[styles.searchInput, { color: palette.text.primary }]}
            placeholder="Госномер"
            placeholderTextColor={palette.text.tertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Поиск заказа по госномеру"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Очистить поиск">
              <Ionicons name="close-circle" size={20} color={palette.text.tertiary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {board === undefined && isLoading ? (
        <View style={styles.centerFill}>
          <LoadingSpinner />
        </View>
      ) : isError && board === undefined ? (
        <View style={styles.centerFill}>
          <QueryErrorState
            description="Не удалось загрузить очередь. Проверьте соединение."
            onRetry={() => refetch()}
          />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          {searching ? (
            // ── Результаты поиска ───────────────────────────────────────
            found.length === 0 ? (
              <View style={styles.emptyBlock}>
                <Ionicons name="search-outline" size={36} color={palette.text.tertiary} />
                <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Ничего не найдено</Text>
                <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                  Ищем по неоплаченным заказам на доске: госномер, клиент или № заказа.
                </Text>
              </View>
            ) : (
              found.map((c) => (
                <QueueCard
                  key={c.id}
                  check={c}
                  palette={palette}
                  columnLabel={c.workStatus ? columnLabelByKey.get(c.workStatus) : undefined}
                  onPress={openAccept}
                />
              ))
            )
          ) : (
            <>
              {/* ── Готовы к оплате ───────────────────────────────────── */}
              <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Готовы к оплате</Text>
              {ready.length === 0 ? (
                <View style={styles.emptyBlock}>
                  <Ionicons name="checkmark-done-circle-outline" size={36} color={palette.text.tertiary} />
                  <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>Очередь пуста</Text>
                  <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                    Когда мастер переведёт машину в «Готова», она появится здесь.
                  </Text>
                </View>
              ) : (
                ready.map((c) => <QueueCard key={c.id} check={c} palette={palette} onPress={openAccept} />)
              )}

              {/* ── Остальные неоплаченные на доске ───────────────────── */}
              {rest.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: palette.text.tertiary, marginTop: spacing[4] }]}>
                    Ещё в работе
                  </Text>
                  {rest.map((c) => (
                    <QueueCard
                      key={c.id}
                      check={c}
                      palette={palette}
                      columnLabel={c.workStatus ? columnLabelByKey.get(c.workStatus) : undefined}
                      onPress={openAccept}
                    />
                  ))}
                </>
              )}

              {/* ── Оплачены, ждут выдачи — информационная строка ─────── */}
              {paidWaiting > 0 && (
                <View style={[styles.paidRow, { backgroundColor: softTint(colors.green[500], palette.mode) }]}>
                  <Ionicons
                    name="checkmark-circle"
                    size={16}
                    color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
                  />
                  <Text
                    style={[
                      styles.paidRowText,
                      { color: palette.mode === 'dark' ? colors.green[200] : colors.green[700] },
                    ]}
                  >
                    Оплачены и ждут выдачи мастером: {paidWaiting}
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, justifyContent: 'center' },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[2.5] },

  // Крупный поиск — главный инструмент кассира.
  searchWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    minHeight: 56,
  },
  searchInput: {
    flex: 1,
    fontSize: 22,
    fontWeight: fontWeight.semibold,
    letterSpacing: 2,
    paddingVertical: spacing[3],
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginLeft: spacing[1],
    marginBottom: spacing[0.5],
  },

  // Карточка очереди
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    gap: spacing[2],
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cardCar: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  cardClient: { fontSize: fontSize.xs, marginTop: 2 },
  plateTag: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  plateTagText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[700], letterSpacing: 1 },
  cardMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2.5] },
  columnChip: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  columnChipText: { fontSize: 10, fontWeight: fontWeight.semibold },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], flexShrink: 1 },
  metaText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, flexShrink: 1 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardTotal: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  payHint: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  payHintText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary[600] },

  // Пустые состояния
  emptyBlock: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[8], paddingHorizontal: spacing[6] },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyHint: { fontSize: fontSize.xs, textAlign: 'center', lineHeight: 17 },

  // Оплачены, ждут выдачи
  paidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[2],
  },
  paidRowText: { flex: 1, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
});
