import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { reportsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import AnimatedCard from '../components/AnimatedCard';
import { Skeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole } from '../../../shared/types';

// ── MasterPickerRow ────────────────────────────────────────────────────
// Module-scope memoised row for the master-picker FlashList. Without
// memoisation the inline renderItem rebuilt every closure each time the
// parent re-rendered (which happens on every text input + filter change),
// thrashing the FlashList cell recycler.
interface MasterPickerRowProps {
  id: string;
  fullName: string;
  active: boolean;
  onPick: (id: string, fullName: string) => void;
  palette: ReturnType<typeof useColors>;
}
const MasterPickerRow = React.memo(function MasterPickerRow({ id, fullName, active, onPick, palette }: MasterPickerRowProps) {
  return (
    <TouchableOpacity
      style={[styles.masterOption, active && styles.masterOptionActive]}
      onPress={() => onPick(id, fullName)}
    >
      <View style={styles.masterAvatar}>
        <Text style={styles.masterAvatarText}>{fullName?.charAt(0) || '?'}</Text>
      </View>
      <Text
        style={[
          styles.masterOptionText,
          { color: palette.text.secondary },
          active && { color: colors.primary[600], fontWeight: fontWeight.bold },
        ]}
      >
        {fullName}
      </Text>
      {active && <Ionicons name="checkmark-circle" size={18} color={colors.primary[600]} />}
    </TouchableOpacity>
  );
});

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function CashFlowScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const palette = useColors();
  const canFilterByMaster = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN, UserRole.ADMIN);
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = useState(false);

  const now = new Date();
  const [dateFrom, setDateFrom] = useState(fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [dateTo, setDateTo] = useState(fmt(now));
  const [masterId, setMasterId] = useState('');
  const [masterName, setMasterName] = useState('');
  const [showMasterPicker, setShowMasterPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState<'from' | 'to' | null>(null);
  const [dateInput, setDateInput] = useState('');

  const { data: masters } = useQuery<any[]>({
    queryKey: ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters();
      return res.data;
    },
    enabled: canFilterByMaster,
    placeholderData: (prev) => prev,
  });

  const { data: cashflow, isLoading } = useQuery<any>({
    queryKey: ['cashflow', dateFrom, dateTo, masterId],
    queryFn: async () => {
      const params: any = { dateFrom, dateTo };
      if (masterId) params.masterId = masterId;
      const res = await reportsApi.getCashFlow(params);
      return res.data;
    },
    // Keep previous period's cashflow visible while the user picks
    // a new range — no flash to "Нет данных" between fetches.
    placeholderData: (prev: unknown) => prev,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    setRefreshing(false);
  };

  // Memoise the derived "totals" so its identity is stable across renders
  // when cashflow.totals didn't change. ChannelRow is a plain function but
  // its parent (the AnimatedCard) participates in the AnimatedCard entrance
  // sequencing, and a stable totals object keeps useMemo deps clean.
  const totals = useMemo(
    () => cashflow?.totals || { cash: 0, card: 0, warranty: 0, total: 0 },
    [cashflow?.totals],
  );

  // Memoise the daily breakdown array so each child <AnimatedCard> sees
  // the same row reference between renders (e.g. master-picker open).
  const days = useMemo<any[]>(() => cashflow?.days || [], [cashflow?.days]);

  // Stable picker handler — kept here so MasterPickerRow's React.memo
  // doesn't bust on each parent render.
  const pickMaster = useCallback((id: string, fullName: string) => {
    setMasterId(id);
    setMasterName(fullName);
    setShowMasterPicker(false);
  }, []);

  const setQuickPeriod = (period: 'today' | 'week' | 'month') => {
    const now = new Date();
    const to = fmt(now);
    setDateTo(to);
    if (period === 'today') {
      setDateFrom(to);
    } else if (period === 'week') {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      setDateFrom(fmt(d));
    } else {
      setDateFrom(fmt(new Date(now.getFullYear(), now.getMonth(), 1)));
    }
  };

  const handleDateConfirm = () => {
    // Parse DD.MM.YYYY
    const parts = dateInput.split('.');
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
      const iso = `${y}-${m}-${d}`;
      const date = new Date(iso);
      if (!isNaN(date.getTime())) {
        if (showDatePicker === 'from') setDateFrom(iso);
        else setDateTo(iso);
      }
    }
    setShowDatePicker(null);
    setDateInput('');
  };

  // Cold-start skeleton — branded shimmer so the screen "comes alive"
  // before the first response, instead of a generic dimmed spinner.
  const renderColdStart = () => (
    <View style={{ gap: spacing[3] }}>
      <View
        style={[
          styles.totalsCard,
          { gap: spacing[3], backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
        ]}
      >
        <Skeleton width={140} height={11} radius={4} />
        <Skeleton width={180} height={32} radius={6} />
        <View style={{ gap: spacing[2.5], marginTop: spacing[2] }}>
          <Skeleton width="100%" height={14} radius={4} />
          <Skeleton width="100%" height={14} radius={4} />
          <Skeleton width="100%" height={14} radius={4} />
        </View>
      </View>
      <View style={{ height: spacing[2] }} />
      <Skeleton width={100} height={11} radius={4} style={{ marginLeft: spacing[3] }} />
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.dayCard,
            { gap: spacing[2], backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
          ]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton width={110} height={14} radius={4} />
            <Skeleton width={80} height={14} radius={4} />
          </View>
          <Skeleton width="60%" height={12} radius={4} />
        </View>
      ))}
    </View>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Унифицированная iOS-шапка — единый стиль с Расписанием/Журналом. */}
      <IosScreenHeader title="Движение денег" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Platform.OS === 'ios' ? spacing[4] : tabBarHeight + spacing[4] },
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Quick period buttons */}
        <View style={styles.quickRow}>
          {[
            { key: 'today' as const, label: 'Сегодня' },
            { key: 'week' as const, label: 'Неделя' },
            { key: 'month' as const, label: 'Месяц' },
          ].map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.quickBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => setQuickPeriod(p.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.quickBtnText, { color: palette.text.secondary }]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date range selector */}
        <View style={styles.dateRow}>
          <TouchableOpacity
            style={[styles.dateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => {
              setDateInput('');
              setShowDatePicker('from');
            }}
          >
            <Ionicons name="calendar-outline" size={14} color={colors.primary[600]} />
            <Text style={[styles.dateBtnText, { color: palette.text.secondary }]}>{formatDateLabel(dateFrom)}</Text>
          </TouchableOpacity>
          <Text style={[styles.dateSep, { color: palette.text.tertiary }]}>—</Text>
          <TouchableOpacity
            style={[styles.dateBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => {
              setDateInput('');
              setShowDatePicker('to');
            }}
          >
            <Ionicons name="calendar-outline" size={14} color={colors.primary[600]} />
            <Text style={[styles.dateBtnText, { color: palette.text.secondary }]}>{formatDateLabel(dateTo)}</Text>
          </TouchableOpacity>
        </View>

        {/* Master filter */}
        {canFilterByMaster && (
          <TouchableOpacity
            style={[styles.masterFilter, { backgroundColor: palette.bg.card }]}
            onPress={() => setShowMasterPicker(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="person-outline" size={16} color={colors.primary[600]} />
            <Text style={[styles.masterFilterText, { color: palette.text.secondary }]}>
              {masterName || 'Все мастера'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={palette.text.tertiary} />
          </TouchableOpacity>
        )}

        {/* Cold-start: branded skeleton until a real response lands.
            Once we have any data (cached or fresh), SWR keeps it on screen
            across period changes — no "Нет данных" flash. */}
        {cashflow === undefined ? (
          renderColdStart()
        ) : !cashflow && !isLoading ? (
          <EmptyState
            title="Нет данных"
            description="За выбранный период чеков не было"
            icon="wallet"
          />
        ) : (
          <>
            {/* Hero totals — one big card.
                Top: caption + 32pt hero number for Итого.
                Bottom: 3 channel rows (Нал / Карта / Гарантия) with money
                and tiny share-of-total caption. Single visual unit reads
                an order of magnitude cleaner than the previous 4-tile grid. */}
            <AnimatedCard
              index={0}
              style={[styles.totalsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[iosSectionLabel, { marginBottom: 4, color: palette.text.tertiary }]}>Итого за период</Text>
              <Text style={[styles.totalsHero, { color: palette.text.primary }]}>{formatMoney(totals.total)}</Text>
              <View style={styles.totalsBreakdown}>
                <ChannelRow
                  iconName="cash-outline"
                  iconBg={colors.green[50]}
                  iconColor={colors.green[600]}
                  label="Наличные"
                  amount={totals.cash}
                  total={totals.total}
                  palette={palette}
                />
                <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                <ChannelRow
                  iconName="card-outline"
                  iconBg={colors.blue[50]}
                  iconColor={colors.blue[600]}
                  label="Карта"
                  amount={totals.card}
                  total={totals.total}
                  palette={palette}
                />
                <View style={[styles.totalsDivider, { backgroundColor: palette.border.subtle }]} />
                <ChannelRow
                  iconName="shield-checkmark-outline"
                  iconBg={colors.yellow[50]}
                  iconColor={colors.yellow[700]}
                  label="Гарантия"
                  amount={totals.warranty}
                  total={totals.total}
                  palette={palette}
                />
              </View>
            </AnimatedCard>

            {/* Daily breakdown */}
            <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.tertiary }]}>По дням</Text>
            {days.length === 0 ? (
              <EmptyState
                title="Нет операций"
                description="За выбранный период чеков не было"
                icon="receipt"
              />
            ) : (
              days.map((day: any, idx: number) => (
                <AnimatedCard
                  key={day.date}
                  style={[styles.dayCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                  index={idx + 1}
                >
                  <View style={styles.dayHeader}>
                    <Text style={[styles.dayDate, { color: palette.text.secondary }]}>
                      {new Date(day.date).toLocaleDateString('ru-RU', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </Text>
                    <Text style={[styles.dayTotal, { color: palette.text.primary }]}>{formatMoney(day.total)}</Text>
                  </View>
                  <View style={[styles.dayDetails, { borderTopColor: palette.border.subtle }]}>
                    {day.cash > 0 && (
                      <View style={styles.dayDetailItem}>
                        <View style={[styles.dayDot, { backgroundColor: colors.green[500] }]} />
                        <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                          Нал: {formatMoney(day.cash)}
                        </Text>
                      </View>
                    )}
                    {day.card > 0 && (
                      <View style={styles.dayDetailItem}>
                        <View style={[styles.dayDot, { backgroundColor: colors.blue[500] }]} />
                        <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                          Карта: {formatMoney(day.card)}
                        </Text>
                      </View>
                    )}
                    {day.warranty > 0 && (
                      <View style={styles.dayDetailItem}>
                        <View style={[styles.dayDot, { backgroundColor: colors.yellow[500] }]} />
                        <Text style={[styles.dayDetailText, { color: palette.text.secondary }]}>
                          Гарант: {formatMoney(day.warranty)}
                        </Text>
                      </View>
                    )}
                  </View>
                </AnimatedCard>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Master picker modal */}
      <Modal visible={showMasterPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: palette.bg.card }]}>
            <View style={[styles.modalHeader, { borderBottomColor: palette.border.subtle }]}>
              <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Выберите мастера</Text>
              <TouchableOpacity onPress={() => setShowMasterPicker(false)}>
                <Ionicons name="close" size={22} color={palette.text.secondary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.masterOption, !masterId && styles.masterOptionActive]}
              onPress={() => {
                setMasterId('');
                setMasterName('');
                setShowMasterPicker(false);
              }}
            >
              <Ionicons name="people-outline" size={18} color={!masterId ? colors.primary[600] : palette.text.secondary} />
              <Text
                style={[
                  styles.masterOptionText,
                  { color: palette.text.secondary },
                  !masterId && { color: colors.primary[600], fontWeight: fontWeight.bold },
                ]}
              >
                Все мастера
              </Text>
            </TouchableOpacity>
            <FlashList
              data={masters || []}
              keyExtractor={(item: any) => item.id}
              extraData={masterId}
              renderItem={({ item }: { item: any }) => (
                <MasterPickerRow
                  id={item.id}
                  fullName={item.fullName}
                  active={masterId === item.id}
                  onPick={pickMaster}
                  palette={palette}
                />
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Date input modal */}
      <Modal visible={showDatePicker !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDatePicker(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.dateModal, { backgroundColor: palette.bg.card }]}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>
              {showDatePicker === 'from' ? 'Дата начала' : 'Дата окончания'}
            </Text>
            <TextInput
              style={[styles.dateInput, { borderColor: palette.border.subtle, color: palette.text.primary }]}
              placeholder="ДД.ММ.ГГГГ"
              placeholderTextColor={palette.text.tertiary}
              value={dateInput}
              onChangeText={setDateInput}
              keyboardType="numeric"
              autoFocus
              onSubmitEditing={handleDateConfirm}
            />
            <View style={styles.dateModalBtns}>
              <TouchableOpacity
                style={[styles.dateModalCancel, { backgroundColor: palette.bg.muted }]}
                onPress={() => setShowDatePicker(null)}
              >
                <Text style={[styles.dateModalCancelText, { color: palette.text.secondary }]}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dateModalConfirm, { backgroundColor: palette.accent.primary }]}
                onPress={handleDateConfirm}
              >
                <Text style={styles.dateModalConfirmText}>ОК</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChannelRow — single line inside the Итого card. Icon | label + share% | amount.
// Memo not strictly needed (3 instances) but keeps the JSX tidy.
// ─────────────────────────────────────────────────────────────────────────────
function ChannelRow({
  iconName,
  iconBg,
  iconColor,
  label,
  amount,
  total,
  palette,
}: {
  iconName: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  label: string;
  amount: number;
  total: number;
  palette: ReturnType<typeof useColors>;
}) {
  const pct = total > 0 ? ((amount / total) * 100).toFixed(0) : '0';
  return (
    <View style={styles.channelRow}>
      <View style={[styles.channelIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName} size={16} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.channelLabel, { color: palette.text.primary }]}>{label}</Text>
        {total > 0 && amount > 0 && (
          <Text style={[styles.channelShare, { color: palette.text.tertiary }]}>{pct}% от итого</Text>
        )}
      </View>
      <Text style={[styles.channelAmount, { color: palette.text.primary }]}>{formatMoney(amount)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[3] },

  // Quick period
  quickRow: { flexDirection: 'row', gap: spacing[2] },
  quickBtn: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    alignItems: 'center',
  },
  quickBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[700] },

  // Date range
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
  },
  dateBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  dateSep: { color: colors.gray[400], fontSize: fontSize.sm },

  // Master filter
  masterFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary[200],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
  },
  masterFilterText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },

  // Totals card — one hero card replaces the 4-tile colour grid.
  totalsCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  totalsHero: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -0.6,
    marginBottom: spacing[3],
  },
  totalsBreakdown: { gap: 0 },
  totalsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[200],
    marginVertical: spacing[2.5],
  },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  channelIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  channelShare: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  channelAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Section
  sectionLabel: {
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },

  // Day cards
  dayCard: {
    ...iosCard,
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[4],
  },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  dayTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  dayDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  dayDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayDetailText: { fontSize: fontSize.xs, color: colors.gray[500] },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius['2xl'],
    borderTopRightRadius: borderRadius['2xl'],
    maxHeight: '60%',
    paddingBottom: spacing[8],
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  modalTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  masterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  masterOptionActive: { backgroundColor: colors.primary[50] },
  masterOptionText: { flex: 1, fontSize: fontSize.sm, color: colors.gray[700] },
  masterAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  masterAvatarText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[700] },

  // Date modal
  dateModal: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    margin: spacing[6],
    padding: spacing[5],
    gap: spacing[4],
  },
  dateInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    fontSize: fontSize.lg,
    color: colors.gray[900],
    textAlign: 'center',
  },
  dateModalBtns: { flexDirection: 'row', gap: spacing[3] },
  dateModalCancel: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[100],
  },
  dateModalCancelText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[600] },
  dateModalConfirm: {
    flex: 1,
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  dateModalConfirmText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
});
