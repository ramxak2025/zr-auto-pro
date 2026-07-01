/**
 * CheckTrashScreen — «Корзина» заказ-нарядов (106).
 *
 * Вход — кнопка «Корзина» рядом с «Доской» в Журнале (ChecksScreen), видна
 * только owner-классу (director/admin/superadmin); GET /checks/trash гейтится
 * на бэке той же ролью. Экран живёт в ChecksStack, поэтому плавающий таб-бар
 * остаётся виден, back возвращает в Журнал — ровно как у Доски.
 *
 * DELETE чека теперь СОФТ-удаление (бэкенд d4e06e9): чек уходит в корзину и
 * хранится 30 дней, затем вычищается навсегда. Здесь его можно восстановить —
 * POST /checks/:id/restore заново применяет весь footprint (склад / ЗП /
 * мотивация / гарантия / касса), поэтому confirm проговаривает это явно.
 * Ошибка «Недостаточно товара на складе для восстановления: …» показывается
 * дословно — она действенная (пополнить остатки и повторить).
 *
 * Android-совместимо: только кросс-платформенные примитивы (FlashList,
 * RefreshControl, Alert, Ionicons) — никаких iOS-only API.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import IosScreenHeader from '../components/IosScreenHeader';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import type { TrashedCheck } from '../../../shared/types';

// Бэкенд хранит удалённые чеки 30 дней с момента deletedAt, потом вычищает
// навсегда (см. shared/api/createServices.ts → checksApi.trash).
const PURGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Сколько дней осталось до безвозвратной очистки (0 — вычистится сегодня). */
function purgeDaysLeft(deletedAt: string): number {
  const purgeAt = new Date(deletedAt).getTime() + PURGE_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS));
}

/** Русская плюрализация: 1 день / 2 дня / 5 дней / 11 дней / 21 день. */
function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
}

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// Дата продажи чека — только день, без времени: в корзине она нужна для
// идентификации («тот чек за 25.06»), а не для тайминга.
function formatDay(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Момент удаления — день + время (тот же формат, что formatDate в журнале).
function formatDateTime(d: string) {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
}

// Stable separator — module scope, как ListGap в ChecksScreen, чтобы FlashList
// не получал новую component identity на каждый рендер экрана.
const ListGap = () => <View style={{ height: spacing[2] }} />;

// ── TrashRow ───────────────────────────────────────────────────────────
// Memoised строка корзины — тот же карточный паттерн, что CheckRow в журнале
// (левый accent bar + карточка с номером/клиентом/суммой), но приглушённый:
// серый accent (чек «мёртв», пока не восстановлен) и кнопка «Восстановить»
// вместо крестика удаления.
interface TrashRowProps {
  item: TrashedCheck;
  /** true — restore этой строки в полёте: спиннер в кнопке + disabled. */
  restoring: boolean;
  onRestore: (item: TrashedCheck) => void;
  palette: SemanticPalette;
}
const TrashRow = React.memo(function TrashRow({ item, restoring, onRestore, palette }: TrashRowProps) {
  const daysLeft = purgeDaysLeft(item.deletedAt);
  // ≤3 дней до очистки — красный акцент на чипе, дальше — нейтральный.
  const urgent = daysLeft <= 3;
  const deletedLine =
    `Удалён ${formatDateTime(item.deletedAt)}` + (item.deletedByName ? ` · ${item.deletedByName}` : '');
  const restoreColor = palette.mode === 'dark' ? colors.primary[300] : colors.primary[600];
  return (
    <View
      style={[
        styles.card,
        buildShadow(palette),
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <View style={styles.accentBar} />
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={[styles.checkNumber, { color: palette.text.primary }]}>#{item.number}</Text>
            <Text style={[styles.checkDate, { color: palette.text.tertiary }]}>{formatDay(item.date)}</Text>
            {item.isDeferred && (
              <View
                style={[
                  styles.deferredBadge,
                  { backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.18)' : colors.red[100] },
                ]}
              >
                <Text style={styles.deferredText}>Отложен</Text>
              </View>
            )}
          </View>
          <Text style={[styles.total, { color: palette.text.primary }]}>{formatMoney(item.totalRevenue)}</Text>
        </View>

        {item.clientName ? (
          <View style={styles.clientRow}>
            <Ionicons name="person-outline" size={11} color={palette.text.tertiary} />
            <Text style={[styles.clientText, { color: palette.text.secondary }]} numberOfLines={1}>
              {item.clientName}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.deletedLine, { color: palette.text.tertiary }]} numberOfLines={1}>
          {deletedLine}
        </Text>

        <View style={styles.cardFooter}>
          <View
            style={[
              styles.daysLeftChip,
              {
                backgroundColor: urgent
                  ? palette.mode === 'dark'
                    ? 'rgba(239,68,68,0.18)'
                    : colors.red[50]
                  : palette.bg.muted,
              },
            ]}
          >
            <Ionicons name="hourglass-outline" size={11} color={urgent ? colors.red[600] : palette.text.tertiary} />
            <Text style={[styles.daysLeftText, { color: urgent ? colors.red[600] : palette.text.tertiary }]}>
              {daysLeft > 0 ? `Осталось ${daysLeft} ${pluralDays(daysLeft)}` : 'Будет удалён сегодня'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.restoreBtn,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
              restoring && { opacity: 0.6 },
            ]}
            onPress={() => onRestore(item)}
            disabled={restoring}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Восстановить заказ-наряд номер ${item.number}`}
            accessibilityState={{ disabled: restoring }}
          >
            {restoring ? (
              <ActivityIndicator size="small" color={restoreColor} />
            ) : (
              <>
                <Ionicons name="arrow-undo-outline" size={14} color={restoreColor} />
                <Text style={[styles.restoreBtnText, { color: restoreColor }]}>Восстановить</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

export default function CheckTrashScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: trashed,
    isLoading,
    isError,
    refetch,
  } = useQuery<TrashedCheck[]>({
    queryKey: ['checks-trash'],
    queryFn: async () => {
      const res = await checksApi.trash();
      return Array.isArray(res.data) ? res.data : [];
    },
    // Корзина должна быть точной на каждый вход: чек могли удалить с другого
    // устройства или из веба, а список маленький — refetch дешёвый.
    refetchOnMount: 'always',
    staleTime: 30_000,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => checksApi.restore(id),
    onSuccess: () => {
      haptic('success');
      // Тот же invalidation-набор, что и после удаления чека (ChecksScreen
      // deleteMutation.onSettled / CheckDetail deleteMutation.onSuccess), плюс
      // сама корзина: восстановленный чек обязан сразу вернуться в журнал,
      // на доску (['checks'] префиксом накрывает ['checks','board']), в
      // дашборд и кассу по дням.
      queryClient.invalidateQueries({ queryKey: ['checks-trash'] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
    onError: (err: any) => {
      haptic('error');
      // Бэкендовое «Недостаточно товара на складе для восстановления: …»
      // показываем дословно — это действенное сообщение.
      Alert.alert(
        'Не удалось восстановить',
        err?.response?.data?.message || 'Проверьте подключение к интернету и попробуйте ещё раз',
      );
    },
  });

  // id строки, чей restore сейчас в полёте — у неё в кнопке спиннер.
  const restoringId = restoreMutation.isPending ? (restoreMutation.variables ?? null) : null;

  const handleRestore = useCallback(
    (item: TrashedCheck) => {
      Alert.alert(`Восстановить заказ-наряд №${item.number}?`, 'Он вернётся во все отчёты, ЗП и склад', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Восстановить', onPress: () => restoreMutation.mutate(item.id) },
      ]);
    },
    [restoreMutation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const renderItem = useCallback(
    ({ item }: { item: TrashedCheck }) => (
      <TrashRow item={item} restoring={restoringId === item.id} onRestore={handleRestore} palette={palette} />
    ),
    [restoringId, handleRestore, palette],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* IosScreenHeader сам учитывает insets.top — плюс тот же back-паттерн,
          что у Доски (goBack → Журнал). */}
      <IosScreenHeader title="Корзина" subtitle="Восстановление доступно 30 дней" onBack={() => navigation.goBack()} />
      {isError && trashed === undefined ? (
        <View style={styles.centerFill}>
          <QueryErrorState
            title="Не удалось загрузить корзину"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        </View>
      ) : trashed === undefined ? (
        <ListSkeleton count={6} />
      ) : trashed.length === 0 && !isLoading ? (
        <EmptyState title="Корзина пуста" description="Удалённые заказ-наряды хранятся 30 дней" />
      ) : (
        <FlashList
          data={trashed}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          // iOS: нижний отступ через contentInset — контент скроллится под
          // плавающим Liquid Glass таб-баром. Android игнорирует contentInset,
          // поэтому явный paddingBottom (тот же паттерн, что в ChecksScreen).
          contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          ItemSeparatorComponent={ListGap}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, justifyContent: 'center' },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  // Карточка — та же геометрия, что checkCard в журнале (accent bar 3.5pt +
  // borderRadius.xl), чтобы корзина читалась как «те же чеки, только в архиве».
  card: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
  },
  // Серый accent — «неактивный» чек. В журнале синий/красный/фиолетовый
  // сигналят живые состояния; здесь их сознательно нет.
  accentBar: { width: 3.5, backgroundColor: colors.gray[400] },
  cardContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  checkDate: { fontSize: 11 },
  deferredBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  total: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  clientRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: spacing[1] },
  clientText: { fontSize: 12, flexShrink: 1 },

  deletedLine: { fontSize: 11, marginBottom: spacing[2] },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  daysLeftChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  daysLeftText: { fontSize: 10, fontWeight: fontWeight.medium },
  restoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    // Спиннер во время restore не «схлопывает» кнопку.
    minWidth: 132,
  },
  restoreBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
});
