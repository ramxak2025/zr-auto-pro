/**
 * BookingsScreen — раздел «Записи» (внутренний инструмент персонала).
 *
 * Две вкладки: «Предстоящие» (scope=upcoming) и «Прошедшие» (scope=past).
 * Сервер сам отдаёт правильные строки под роль (мастер видит свои, админ/
 * владелец — все), UI просто рендерит ответ. Список — FlashList, pull-to-
 * refresh, persistent-cache-friendly (ключ ['bookings', scope] в whitelist).
 *
 * Reliability pattern (как в Журнале): пока data === undefined — скелетон;
 * isError && data === undefined — QueryErrorState с «Повторить»; есть данные —
 * рендерим список сразу, даже во время фонового рефетча (SWR).
 *
 * Android-safe: FlashList + RefreshControl + DateTimePickerModal внутри
 * BookingCreate — всё кроссплатформенно.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, ScrollView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import AnimatedCard from '../components/AnimatedCard';
import { useColors } from '../contexts/ThemeContext';
import { bookingsApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { colors, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { type Booking } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { statusChip, formatBookingTime, formatBookingDay, masterLabel } from './bookings/bookingHelpers';

type Scope = 'upcoming' | 'past';

// ── BookingRow ──────────────────────────────────────────────────────────────
// Module-scope React.memo'd row — stable identity across parent re-renders so
// switching tabs / refetching doesn't tear down + rebuild every card. Theme
// tokens are passed in so the memoised row reads dark/light without
// subscribing to the theme context itself.
interface BookingRowProps {
  item: Booking;
  index: number;
  onPress: (id: string) => void;
  onOpenCheck: (checkId: string) => void;
  cardBg: string;
  separatorColor: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  mutedBg: string;
}
const BookingRow = React.memo(function BookingRow({
  item,
  index,
  onPress,
  onOpenCheck,
  cardBg,
  separatorColor,
  textPrimary,
  textSecondary,
  textTertiary,
  mutedBg,
}: BookingRowProps) {
  const chip = statusChip(item.status);
  const clientName = item.clientName || 'Клиент';
  const phone = item.clientPhone ? formatPhone(item.clientPhone) : null;

  return (
    <AnimatedCard
      style={[styles.card, { backgroundColor: cardBg, borderBottomColor: separatorColor }]}
      index={index}
      onPress={() => onPress(item.id)}
    >
      {/* ── Time column — день + время крупно слева ── */}
      <View style={[styles.timeCol, { backgroundColor: mutedBg }]}>
        <Text style={[styles.timeDay, { color: textTertiary }]} numberOfLines={1}>
          {formatBookingDay(item.scheduledAt)}
        </Text>
        <Text style={[styles.timeClock, { color: textPrimary }]}>{formatBookingTime(item.scheduledAt)}</Text>
      </View>

      {/* ── Main info ── */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.clientName, { color: textPrimary }]} numberOfLines={1}>
            {clientName}
          </Text>
          <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.statusChipText, { color: chip.text }]} numberOfLines={1}>
              {chip.label}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          {item.carPlate ? (
            <View style={[styles.plateChip, { borderColor: separatorColor }]}>
              <Text style={[styles.plateChipText, { color: textSecondary }]} numberOfLines={1}>
                {item.carPlate}
              </Text>
            </View>
          ) : null}
          {phone ? (
            <Text style={[styles.metaText, { color: textTertiary }]} numberOfLines={1}>
              {phone}
            </Text>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Ionicons name="person-outline" size={12} color={textTertiary} />
          <Text style={[styles.metaText, { color: item.masterId ? textSecondary : textTertiary }]} numberOfLines={1}>
            {masterLabel(item)}
          </Text>
        </View>

        {/* Проведённая запись со связанным чеком — тап ведёт в чек. */}
        {item.checkId ? (
          <TouchableOpacity
            style={[styles.checkLink, { backgroundColor: mutedBg }]}
            onPress={() => onOpenCheck(item.checkId!)}
            activeOpacity={0.7}
            hitSlop={6}
          >
            <Ionicons name="receipt-outline" size={13} color={colors.primary[600]} />
            <Text style={styles.checkLinkText} numberOfLines={1}>
              {item.checkNumber != null ? `Чек №${item.checkNumber}` : 'Открыть чек'}
            </Text>
            <Ionicons name="chevron-forward" size={12} color={colors.primary[600]} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Ionicons name="chevron-forward" size={16} color={textTertiary} style={styles.rowChevron} />
    </AnimatedCard>
  );
});

export default function BookingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: bookings,
    isLoading,
    isError,
    refetch,
  } = useQuery<Booking[]>({
    queryKey: ['bookings', scope],
    queryFn: async () => (await bookingsApi.list({ scope })).data,
    // SWR: при переключении вкладок держим прошлые строки до прихода новых —
    // без «пустого кадра» между upcoming ↔ past.
    placeholderData: (prev) => prev,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Обе вкладки разом — пользователь часто щёлкает их подряд.
    await queryClient.invalidateQueries({ queryKey: ['bookings'] });
    setRefreshing(false);
  }, [queryClient]);

  const handlePressBooking = useCallback((id: string) => navigation.navigate('BookingDetail', { id }), [navigation]);

  // Проведённая запись → связанный чек. Внутри MoreStack зарегистрирован
  // CheckDetail, так что push остаётся в секции (tab bar на месте).
  const handleOpenCheck = useCallback(
    (checkId: string) => navigation.navigate('CheckDetail', { id: checkId }),
    [navigation],
  );

  const openCreate = useCallback(() => {
    haptic('tap');
    navigation.navigate('BookingCreate');
  }, [navigation]);

  const renderBooking = useCallback(
    ({ item, index }: { item: Booking; index: number }) => (
      <BookingRow
        item={item}
        index={index}
        onPress={handlePressBooking}
        onOpenCheck={handleOpenCheck}
        cardBg={palette.bg.card}
        separatorColor={palette.border.subtle}
        textPrimary={palette.text.primary}
        textSecondary={palette.text.secondary}
        textTertiary={palette.text.tertiary}
        mutedBg={palette.bg.muted}
      />
    ),
    [
      handlePressBooking,
      handleOpenCheck,
      palette.bg.card,
      palette.bg.muted,
      palette.border.subtle,
      palette.text.primary,
      palette.text.secondary,
      palette.text.tertiary,
    ],
  );

  const list = bookings ?? [];
  const emptyCopy = useMemo(
    () =>
      scope === 'upcoming'
        ? { title: 'Нет предстоящих записей', desc: 'Запланируйте первую запись клиента' }
        : { title: 'Нет прошедших записей', desc: 'Здесь появятся завершённые и отменённые записи' },
    [scope],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Записи"
        onBack={() => navigation.goBack()}
        trailing={
          <View style={styles.headerTrailing}>
            <TouchableOpacity
              onPress={() => navigation.navigate('BookingSettings')}
              style={[styles.headerIconBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Настройки записей"
            >
              <Ionicons name="settings-outline" size={17} color={palette.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={openCreate}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Новая запись"
            >
              <Ionicons name="add" size={18} color={colors.white} />
            </TouchableOpacity>
          </View>
        }
      />

      {/* ── Segmented control: Предстоящие / Прошедшие ── */}
      <View style={styles.segmentWrap}>
        <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
          {(['upcoming', 'past'] as Scope[]).map((s) => {
            const active = scope === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.segmentItem, active && [styles.segmentItemActive, { backgroundColor: palette.bg.card }]]}
                onPress={() => {
                  if (s === scope) return;
                  haptic('select');
                  setScope(s);
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? palette.text.primary : palette.text.tertiary },
                    active && styles.segmentTextActive,
                  ]}
                >
                  {s === 'upcoming' ? 'Предстоящие' : 'Прошедшие'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {isError && bookings === undefined ? (
        // Pull-to-refresh должен работать и из error-state.
        <ScrollView
          contentContainerStyle={styles.errorWrap}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          <QueryErrorState
            title="Не удалось загрузить записи"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        </ScrollView>
      ) : bookings === undefined ? (
        <ListSkeleton count={6} />
      ) : list.length === 0 && !isLoading ? (
        <ScrollView
          contentContainerStyle={styles.errorWrap}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          <EmptyState
            icon="calendar"
            title={emptyCopy.title}
            description={emptyCopy.desc}
            action={scope === 'upcoming' ? { label: 'Новая запись', onPress: openCreate } : undefined}
          />
        </ScrollView>
      ) : (
        <FlashList
          data={list}
          keyExtractor={(i) => i.id}
          renderItem={renderBooking}
          contentContainerStyle={[styles.list, Platform.OS === 'android' ? { paddingBottom: tabBarHeight } : null]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    backgroundColor: colors.primary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Segmented control
  segmentWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  segment: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentItemActive: {
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  segmentText: { fontSize: 13, fontWeight: '500' },
  segmentTextActive: { fontWeight: '700' },

  // List
  list: { paddingHorizontal: 0, paddingTop: 0 },
  errorWrap: { flexGrow: 1, justifyContent: 'center' },

  // Row
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeCol: {
    width: 60,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  timeDay: { fontSize: 10, fontWeight: '600', letterSpacing: -0.1 },
  timeClock: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },

  info: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  clientName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.2, flexShrink: 1 },
  statusChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  statusChipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], minWidth: 0 },
  metaText: { fontSize: 12, flexShrink: 1 },
  plateChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plateChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  checkLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.md,
    marginTop: 2,
  },
  checkLinkText: { fontSize: 12, fontWeight: '600', color: colors.primary[600] },

  rowChevron: { marginLeft: 2 },
});
