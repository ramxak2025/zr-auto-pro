import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { scheduleApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import DateTimePickerModal from '../components/DateTimePickerModal';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { TodayEmployeeStatus, ScheduleEntry, User } from '../../../shared/types';

type TabType = 'grid' | 'today' | 'shifts' | 'rating' | 'settings';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DAY_ABBR = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= count; i++) days.push(new Date(year, month, i));
  return days;
}

function getInitials(fullName?: string): string {
  if (!fullName) return '?';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

const AVATAR_COLORS = [
  [colors.primary[500], colors.primary[700]],
  [colors.green[500], colors.green[700]],
  [colors.orange[500], colors.orange[600]],
  [colors.purple[700], colors.indigo[600]],
  [colors.teal[600], colors.green[700]],
  [colors.rose[500], colors.rose[600]],
  [colors.amber[600], colors.orange[600]],
  [colors.blue[500], colors.blue[700]],
];

function getAvatarColors(name?: string): string[] {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getCellDot(entry?: ScheduleEntry) {
  if (!entry) return { dotColor: 'transparent', hasEntry: false, icon: null, bgColor: 'transparent', label: '' };
  const note = (entry.note || '').toLowerCase();
  const lateMin = entry.lateMinutes || 0;
  const isPast = new Date(entry.date + 'T23:59:59') < new Date();
  const isToday = entry.date.slice(0, 10) === new Date().toISOString().slice(0, 10);

  // 1. Больничный
  if (note.includes('больнич')) return { dotColor: colors.rose[500], hasEntry: true, icon: 'medkit' as const, bgColor: colors.rose[50], label: '' };
  // 2. Прогул из note
  if (note.includes('прогул')) return { dotColor: colors.red[500], hasEntry: true, icon: 'close-circle' as const, bgColor: colors.red[50], label: '' };
  // 3. Выходной
  if (entry.isDayOff) return { dotColor: colors.gray[500], hasEntry: true, icon: 'moon' as const, bgColor: colors.gray[100], label: '' };
  // 4. Опоздание >1ч (треугольник)
  if (entry.lateStatus === 'late_major' || lateMin >= 60) return { dotColor: colors.yellow[600], hasEntry: true, icon: 'warning' as const, bgColor: colors.yellow[50], label: '' };
  // 5. Опоздание <1ч (будильник)
  if (entry.lateStatus === 'late_minor' || (lateMin > 0 && lateMin < 60)) return { dotColor: colors.yellow[500], hasEntry: true, icon: 'alarm' as const, bgColor: colors.yellow[50], label: '' };
  // 6. Открыл смену вовремя — показываем время
  if (entry.shiftStart && (entry.actualArrival || entry.lateStatus === 'on_time')) {
    return { dotColor: colors.green[600], hasEntry: true, icon: null, bgColor: colors.green[100], label: entry.shiftStart.slice(0, 5) };
  }
  // 7. Прогул для прошедших дней без смены
  if (entry.shiftStart && !entry.isDayOff && isPast && !isToday) {
    return { dotColor: colors.red[500], hasEntry: true, icon: 'close-circle' as const, bgColor: colors.red[50], label: '' };
  }
  // 8. Запланирована смена (сегодня или будущее) — зелёная галочка
  if (entry.shiftStart) {
    return { dotColor: colors.green[500], hasEntry: true, icon: 'checkmark' as const, bgColor: colors.green[50], label: '' };
  }
  return { dotColor: 'transparent', hasEntry: false, icon: null, bgColor: 'transparent', label: '' };
}

// Memoized grid row to avoid re-rendering all cells on unrelated state changes.
interface GridDayRowProps {
  userId: string;
  userName?: string;
  days: Date[];
  entryMap: Map<string, ScheduleEntry>;
  rowIdx: number;
  today: string;
  canEdit: boolean;
  CELL_W: number;
  ROW_H: number;
  onCellPress: (userId: string, date: string, entry: ScheduleEntry | undefined, userName?: string) => void;
}

const GridDayRow = memo(function GridDayRow({ userId, userName, days, entryMap, rowIdx, today, canEdit, CELL_W, ROW_H, onCellPress }: GridDayRowProps) {
  const firstName = userName?.split(' ')[0];
  return (
    <View style={[{ flexDirection: 'row', height: ROW_H }, rowIdx % 2 === 1 && { backgroundColor: colors.gray[50] + '60' }]}>
      {days.map(d => {
        const ds = formatDate(d);
        const entry = entryMap.get(`${userId}-${ds}`);
        const cell = getCellDot(entry);
        const dow = (d.getDay() + 6) % 7;
        const isWeekend = dow >= 5;
        const isToday = ds === today;

        return (
          <TouchableOpacity
            key={ds}
            style={[
              styles.gridCell,
              { width: CELL_W, height: ROW_H },
              isWeekend && !cell.hasEntry && { backgroundColor: colors.red[50] + '40' },
              isToday && styles.gridCellToday,
            ]}
            onPress={() => onCellPress(userId, ds, entry, firstName)}
            activeOpacity={canEdit ? 0.5 : 1}
          >
            {cell.hasEntry ? (
              <View style={[styles.gridDot, { backgroundColor: cell.bgColor || cell.dotColor + '30' }, cell.label ? styles.gridDotLabel : styles.gridDotRound]}>
                {cell.label ? (
                  <Text
                    style={{ fontSize: 9, fontWeight: '700', color: cell.dotColor }}
                    numberOfLines={1}
                    allowFontScaling={false}
                  >{cell.label}</Text>
                ) : cell.icon ? (
                  <Ionicons name={cell.icon} size={14} color={cell.dotColor} />
                ) : (
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cell.dotColor }} />
                )}
              </View>
            ) : (
              canEdit && <View style={styles.gridCellEmpty} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

// ============== GRID TAB ==============
function GridTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === 'director' || user?.role === 'superadmin' || user?.role === 'admin';
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [quickPopup, setQuickPopup] = useState<{ userId: string; date: string; entry?: ScheduleEntry; userName?: string } | null>(null);
  const [reorderUser, setReorderUser] = useState<{ userId: string; name: string; index: number } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Record<string, { userId: string; date: string; payload: any; existingEntryId?: string }>>({});

  // Synced vertical scroll refs
  const leftScrollRef = useRef<ScrollView>(null);
  const rightScrollRef = useRef<ScrollView>(null);
  const isLeftScrolling = useRef(false);
  const isRightScrolling = useRef(false);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const dateFrom = formatDate(new Date(year, month, 1));
  const dateTo = formatDate(new Date(year, month + 1, 0));
  const today = formatDate(new Date());

  const { data: entries, isLoading } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: async () => { const res = await scheduleApi.getAll({ dateFrom, dateTo }); return res.data; },
    staleTime: 30_000,
  });

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  // Global master order — uses backend sortOrder field
  const activeUsers = useMemo(() => {
    const list = (usersData || []).filter(u => u.isActive && u.role === 'master');
    return list.sort((a: any, b: any) => {
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.fullName || '').localeCompare(b.fullName || '');
    });
  }, [usersData]);

  const updateOrderMut = useMutation({
    mutationFn: (orderedIds: string[]) => usersApi.updateOrder(orderedIds),
    onMutate: async (orderedIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: ['users'] });
      const prev = queryClient.getQueryData<any>(['users']);
      queryClient.setQueryData<any>(['users'], (old: any) => {
        if (!old) return old;
        return old.map((u: any) => {
          const idx = orderedIds.indexOf(u.id);
          return idx >= 0 ? { ...u, sortOrder: idx } : u;
        });
      });
      return prev;
    },
    onError: (_e, _v, ctx) => { if (ctx) queryClient.setQueryData(['users'], ctx); },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const moveMaster = (userId: string, dir: 'up' | 'down') => {
    const ids = activeUsers.map(u => u.id);
    const idx = ids.indexOf(userId);
    if (idx < 0) return;
    const newIdx = dir === 'up' ? Math.max(0, idx - 1) : Math.min(ids.length - 1, idx + 1);
    if (idx === newIdx) return;
    const next = [...ids];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    updateOrderMut.mutate(next);
  };

  const days = useMemo(() => getDaysInMonth(year, month), [year, month]);

  const entryMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    (entries ?? []).forEach(e => {
      const d = e.date?.split('T')[0] || '';
      map.set(`${e.userId}-${d}`, e);
    });
    // Overlay pending changes
    Object.values(pendingChanges).forEach(c => {
      const d = c.date.slice(0, 10);
      const key = `${c.userId}-${d}`;
      const existing = map.get(key);
      map.set(key, { ...(existing || { id: `pending-${key}`, tenantId: '', userId: c.userId, date: c.date, isManualOverride: true }), ...c.payload } as ScheduleEntry);
    });
    return map;
  }, [entries, pendingChanges]);

  const userStats = useMemo(() => {
    const stats = new Map<string, { worked: number; off: number }>();
    activeUsers.forEach(u => {
      let worked = 0, off = 0;
      days.forEach(d => {
        const entry = entryMap.get(`${u.id}-${formatDate(d)}`);
        if (entry?.shiftStart && !entry.isDayOff) worked++;
        if (entry?.isDayOff) off++;
      });
      stats.set(u.id, { worked, off });
    });
    return stats;
  }, [activeUsers, days, entryMap]);

  const scheduleQueryKey = ['schedule', dateFrom, dateTo];

  // Optimistic update helper (React Query documented pattern)
  const optimisticUpdate = (userId: string, date: string, payload: any, existingEntry?: ScheduleEntry) => {
    const previous = queryClient.getQueryData(scheduleQueryKey);
    queryClient.setQueryData(scheduleQueryKey, (old: any) => {
      const arr = (old ?? []) as ScheduleEntry[];
      const temp = { id: existingEntry?.id || `temp-${userId}-${date}`, tenantId: '', userId, date, isManualOverride: true, ...payload } as ScheduleEntry;
      if (existingEntry) {
        return arr.map(e => e.id === existingEntry.id ? { ...e, ...temp } : e);
      }
      return [...arr, temp];
    });
    return previous;
  };

  // patchCache directly mutates RQ cache for instant UI
  const patchCache = (userId: string, date: string, payload: any, isNew: boolean) => {
    queryClient.setQueryData<ScheduleEntry[]>(scheduleQueryKey, (old) => {
      const arr = old ?? [];
      if (isNew) {
        return [...arr, { id: `t-${Date.now()}`, tenantId: '', userId, date, isManualOverride: true, ...payload } as ScheduleEntry];
      }
      return arr.map(e => (e.userId === userId && e.date.slice(0, 10) === date) ? { ...e, ...payload } : e);
    });
  };

  const createMutation = useMutation({
    mutationFn: (d: any) => scheduleApi.create(d),
    onSuccess: () => { setTimeout(() => queryClient.invalidateQueries({ queryKey: ['schedule'] }), 1500); },
    onError: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => { setTimeout(() => queryClient.invalidateQueries({ queryKey: ['schedule'] }), 1500); },
    onError: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: scheduleQueryKey });
      const previous = queryClient.getQueryData(scheduleQueryKey);
      queryClient.setQueryData(scheduleQueryKey, (old: any) => ((old ?? []) as ScheduleEntry[]).filter(e => e.id !== id));
      return previous;
    },
    onError: (_e: any, _d: any, ctx: any) => { if (ctx) queryClient.setQueryData(scheduleQueryKey, ctx); },
    onSettled: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); setQuickPopup(null); },
  });

  const quickAction = (type: string) => {
    if (!quickPopup) return;
    const { userId, date, entry } = quickPopup;
    const base: any = { userId, date };

    if (type === 'delete' && entry) { deleteMutation.mutate(entry.id); return; }
    if (type === 'shift') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.note = ''; base.lateStatus = 'on_time'; base.lateMinutes = 0; base.actualArrival = new Date().toISOString(); }
    else if (type === 'dayoff') { base.isDayOff = true; base.shiftStart = null; base.shiftEnd = null; base.note = ''; base.lateStatus = null; base.lateMinutes = 0; }
    else if (type === 'sick') { base.isDayOff = true; base.shiftStart = null; base.shiftEnd = null; base.note = 'Больничный'; base.lateStatus = null; base.lateMinutes = 0; }
    else if (type === 'late_minor') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.lateStatus = 'late_minor'; base.lateMinutes = 15; base.note = ''; }
    else if (type === 'late_major') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.lateStatus = 'late_major'; base.lateMinutes = 60; base.note = ''; }
    else if (type === 'absent') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.note = 'Прогул'; base.lateStatus = null; base.lateMinutes = 0; }

    // Save to pending changes — applied in batch via Apply button
    const key = `${userId}-${date}`;
    setPendingChanges(prev => ({
      ...prev,
      [key]: { userId, date, payload: base, existingEntryId: entry?.id },
    }));
    setQuickPopup(null);
  };

  const applyPending = async () => {
    const items = Object.values(pendingChanges);
    if (items.length === 0) return;
    let failed = 0;
    for (const c of items) {
      try {
        if (c.existingEntryId) await scheduleApi.update(c.existingEntryId, c.payload);
        else await scheduleApi.create(c.payload);
      } catch { failed++; }
    }
    setPendingChanges({});
    queryClient.invalidateQueries({ queryKey: ['schedule'] });
    queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    if (failed > 0) Alert.alert('Ошибка', `Не применено: ${failed}`);
  };

  const discardPending = () => setPendingChanges({});

  const CELL_W = 44;
  const NAME_W = 140;
  const ROW_H = 52;

  // Sync vertical scroll between left (names) and right (cells)
  const handleLeftScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isRightScrolling.current) return;
    isLeftScrolling.current = true;
    rightScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false });
    setTimeout(() => { isLeftScrolling.current = false; }, 16);
  }, []);

  const handleRightScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isLeftScrolling.current) return;
    isRightScrolling.current = true;
    leftScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false });
    setTimeout(() => { isRightScrolling.current = false; }, 16);
  }, []);

  const handleCellPress = useCallback((userId: string, date: string, entry: ScheduleEntry | undefined, userName?: string) => {
    if (canEdit) setQuickPopup({ userId, date, entry, userName });
  }, [canEdit]);

  return (
    <View style={{ flex: 1 }}>
      {/* Month navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month - 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCurrentMonth(new Date())}
          style={styles.monthCenter}
          activeOpacity={0.7}
        >
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month + 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
      </View>

      {/* Pending changes Apply bar */}
      {Object.keys(pendingChanges).length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginHorizontal: 16, marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            <Ionicons name="warning" size={14} color="#d97706" />
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e' }}>
              Не сохранено: {Object.keys(pendingChanges).length}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity onPress={discardPending} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#6b7280' }}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={applyPending} style={{ backgroundColor: '#d97706', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>Применить</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Legend */}
      <View style={styles.legendRow}>
        {[
          { color: colors.green[500], label: 'Смена', icon: 'checkmark-circle' as const },
          { color: colors.gray[400], label: 'Вых', icon: 'moon' as const },
          { color: colors.rose[500], label: 'Б/Л', icon: 'medkit' as const },
          { color: colors.yellow[500], label: '<1ч', icon: 'alarm' as const },
          { color: colors.orange[500], label: '>1ч', icon: 'warning' as const },
          { color: colors.red[500], label: 'Прогул', icon: 'close-circle' as const },
        ].map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <Ionicons name={item.icon} size={10} color={item.color} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>

      {isLoading ? <LoadingSpinner /> : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Sticky left column -- employee names with avatar initials */}
          <View style={styles.stickyColumn}>
            {/* Header cell */}
            <View style={[styles.gridNameCell, { width: NAME_W, height: ROW_H, borderBottomWidth: 0.5, borderBottomColor: colors.gray[200] }]}>
              <Text style={styles.gridHeaderLabel}>Сотрудник</Text>
            </View>
            {/* Name cells */}
            <ScrollView
              ref={leftScrollRef}
              showsVerticalScrollIndicator={false}
              onScroll={handleLeftScroll}
              scrollEventThrottle={16}
              bounces={false}
            >
              {activeUsers.map((u, rowIdx) => {
                const stats = userStats.get(u.id);
                const avatarColors = getAvatarColors(u.fullName);
                return (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => canEdit && setReorderUser({ userId: u.id, name: u.fullName, index: rowIdx })}
                    activeOpacity={canEdit ? 0.7 : 1}
                    style={[styles.gridNameCell, { width: NAME_W, height: ROW_H }, rowIdx % 2 === 1 && { backgroundColor: colors.gray[50] + '60' }]}
                  >
                    <View style={styles.gridNameInner}>
                      <LinearGradient
                        colors={avatarColors as [string, string]}
                        style={styles.gridAvatar}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <Text style={styles.gridAvatarText}>{getInitials(u.fullName)}</Text>
                      </LinearGradient>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.gridName} numberOfLines={1} ellipsizeMode="tail">{u.fullName}</Text>
                        {stats && (
                          <View style={styles.gridStatsRow}>
                            <View style={styles.gridStatPill}>
                              <View style={[styles.gridStatDot, { backgroundColor: colors.green[500] }]} />
                              <Text style={styles.gridStatText}>{stats.worked}</Text>
                            </View>
                            <View style={styles.gridStatPill}>
                              <View style={[styles.gridStatDot, { backgroundColor: colors.gray[400] }]} />
                              <Text style={styles.gridStatText}>{stats.off}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Scrollable right section -- day columns */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}>
            <View>
              {/* Day headers */}
              <View style={{ flexDirection: 'row' }}>
                {days.map(d => {
                  const ds = formatDate(d);
                  const dow = (d.getDay() + 6) % 7;
                  const isWeekend = dow >= 5;
                  const isToday = ds === today;
                  return (
                    <View key={ds} style={[
                      styles.gridHeaderCell,
                      { width: CELL_W, height: ROW_H, borderBottomWidth: 0.5, borderBottomColor: colors.gray[200] },
                      isWeekend && { backgroundColor: colors.red[50] },
                      isToday && styles.gridHeaderToday,
                    ]}>
                      <Text style={[
                        styles.gridHeaderDow,
                        isWeekend && { color: colors.red[400] },
                        isToday && { color: colors.primary[600] },
                      ]}>{DAY_ABBR[dow]}</Text>
                      {isToday ? (
                        <View style={styles.gridTodayCircle}>
                          <Text style={styles.gridTodayNum}>{d.getDate()}</Text>
                        </View>
                      ) : (
                        <Text style={[styles.gridHeaderDay, isWeekend && { color: colors.red[400] }]}>{d.getDate()}</Text>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Day cells with dot indicators */}
              <ScrollView
                ref={rightScrollRef}
                showsVerticalScrollIndicator={false}
                onScroll={handleRightScroll}
                scrollEventThrottle={16}
                bounces={false}
              >
                {activeUsers.map((u, rowIdx) => (
                  <GridDayRow
                    key={u.id}
                    userId={u.id}
                    userName={u.fullName}
                    days={days}
                    entryMap={entryMap}
                    rowIdx={rowIdx}
                    today={today}
                    canEdit={canEdit}
                    CELL_W={CELL_W}
                    ROW_H={ROW_H}
                    onCellPress={handleCellPress}
                  />
                ))}
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}

      <Modal visible={!!reorderUser} onClose={() => setReorderUser(null)} title={reorderUser ? `Позиция: ${reorderUser.name?.split(' ')[0] || ''}` : ''}>
        {reorderUser && (
          <ScrollView style={{ maxHeight: 400 }}>
            {activeUsers.map((_, idx) => {
              const isCurrent = idx === reorderUser.index;
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => {
                    if (!isCurrent) {
                      const ids = activeUsers.map(u => u.id);
                      const filtered = ids.filter(id => id !== reorderUser.userId);
                      filtered.splice(idx, 0, reorderUser.userId);
                      updateOrderMut.mutate(filtered);
                    }
                    setReorderUser(null);
                  }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 14, paddingHorizontal: 16,
                    backgroundColor: isCurrent ? colors.primary[50] : 'transparent',
                    borderBottomWidth: 0.5, borderBottomColor: colors.gray[100],
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '700', color: isCurrent ? colors.primary[600] : colors.gray[400], width: 24 }}>{idx + 1}</Text>
                  <Text style={{ fontSize: 14, color: isCurrent ? colors.primary[700] : colors.gray[700], flex: 1, fontWeight: isCurrent ? '600' : '500' }}>
                    {isCurrent ? '— текущая позиция —' : `Переместить на ${idx + 1}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </Modal>

      <Modal visible={!!quickPopup} onClose={() => setQuickPopup(null)} title={quickPopup?.userName ? `${quickPopup.userName} — ${quickPopup.date?.split('-').reverse().join('.')}` : 'Быстрое действие'}>
        {quickPopup && (
          <View style={styles.quickActions}>
            {[
              { type: 'shift', label: 'Смена', icon: 'checkmark-circle' as const, iconColor: colors.green[500], bg: colors.green[50], gradient: [colors.green[50], colors.green[100]] },
              { type: 'dayoff', label: 'Выходной', icon: 'moon-outline' as const, iconColor: colors.gray[500], bg: colors.gray[100], gradient: [colors.gray[50], colors.gray[100]] },
              { type: 'sick', label: 'Больничный', icon: 'medkit-outline' as const, iconColor: colors.rose[500], bg: colors.rose[50], gradient: [colors.rose[50], '#ffe4e6'] },
              { type: 'late_minor', label: 'Опоздал <1ч', icon: 'alarm-outline' as const, iconColor: colors.yellow[600], bg: colors.yellow[50], gradient: [colors.yellow[50], '#fef9c3'] },
              { type: 'late_major', label: 'Опоздал >1ч', icon: 'warning-outline' as const, iconColor: colors.orange[500], bg: colors.orange[50], gradient: [colors.orange[50], '#fed7aa'] },
              { type: 'absent', label: 'Прогул', icon: 'close-circle-outline' as const, iconColor: colors.red[500], bg: colors.red[50], gradient: [colors.red[50], '#fecaca'] },
            ].map(item => (
              <TouchableOpacity key={item.type} style={styles.quickBtn} onPress={() => quickAction(item.type)}>
                <LinearGradient
                  colors={item.gradient as [string, string]}
                  style={styles.quickIcon}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons name={item.icon} size={22} color={item.iconColor} />
                </LinearGradient>
                <Text style={styles.quickLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            {quickPopup.entry && (
              <TouchableOpacity style={styles.quickBtn} onPress={() => quickAction('delete')}>
                <LinearGradient
                  colors={[colors.red[50], colors.red[100]] as [string, string]}
                  style={styles.quickIcon}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons name="trash-outline" size={22} color={colors.red[600]} />
                </LinearGradient>
                <Text style={[styles.quickLabel, { color: colors.red[600] }]}>Удалить</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}

// ============== TODAY TAB ==============
function TodayTab() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: todayData, isLoading } = useQuery<TodayEmployeeStatus[]>({
    queryKey: ['schedule-today'],
    queryFn: async () => { const res = await scheduleApi.getToday(); return res.data; },
    staleTime: 30_000,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['schedule-today'] });
    setRefreshing(false);
  };

  const statuses = todayData ?? [];
  const working = statuses.filter(s => s.isWorking && !(s.note || '').toLowerCase().includes('больнич'));
  const notWorking = statuses.filter(s => !s.isWorking || (s.note || '').toLowerCase().includes('больнич'));

  const getStatusInfo = (s: TodayEmployeeStatus) => {
    const note = (s.note || '').toLowerCase();
    if (note.includes('больнич')) return { label: 'Больничный', color: colors.rose[500], icon: 'medkit-outline' as const, bgColor: colors.rose[50], accentColor: colors.rose[400] };
    if (s.isDayOff) return { label: 'Выходной', color: colors.gray[500], icon: 'moon-outline' as const, bgColor: colors.gray[100], accentColor: colors.gray[400] };
    if (s.lateStatus === 'late_major') return { label: s.lateMinutes ? `Опозд. ${s.lateMinutes} мин` : 'Опозд. >1ч', color: colors.orange[500], icon: 'warning' as const, bgColor: colors.orange[50], accentColor: colors.orange[500] };
    if (s.lateStatus === 'late_minor') return { label: s.lateMinutes ? `Опозд. ${s.lateMinutes} мин` : 'Опозд. <1ч', color: colors.yellow[600], icon: 'alarm' as const, bgColor: colors.yellow[50], accentColor: colors.yellow[500] };
    if (s.isWorking) return { label: 'На смене', color: colors.green[600], icon: 'checkmark-circle' as const, bgColor: colors.green[50], accentColor: colors.green[500] };
    if (s.hasSchedule && !s.isDayOff) return { label: 'Прогул', color: colors.red[500], icon: 'close-circle' as const, bgColor: colors.red[50], accentColor: colors.red[500] };
    return { label: '—', color: colors.gray[400], icon: 'remove-outline' as const, bgColor: colors.gray[50], accentColor: colors.gray[300] };
  };

  const todayDate = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <ScrollView contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
      {/* Date header card */}
      <AnimatedCard index={0}>
        <LinearGradient
          colors={[colors.primary[600], colors.primary[700]] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.todayDateCard}
        >
          <View style={styles.todayDateIconWrap}>
            <Ionicons name="today-outline" size={22} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.todayDateLabel}>Сегодня</Text>
            <Text style={styles.todayDateText}>{todayDate}</Text>
          </View>
          <View style={styles.todayTotalBadge}>
            <Text style={styles.todayTotalText}>{statuses.length}</Text>
            <Text style={styles.todayTotalLabel}>чел.</Text>
          </View>
        </LinearGradient>
      </AnimatedCard>

      {/* Status summary pills */}
      <AnimatedCard index={1}>
        <View style={styles.todayStatsRow}>
          <LinearGradient
            colors={[colors.green[50], colors.green[100]] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.todayStatCard}
          >
            <View style={styles.todayStatIconWrap}>
              <Ionicons name="checkmark-circle" size={20} color={colors.green[600]} />
            </View>
            <Text style={[styles.todayStatNum, { color: colors.green[700] }]}>{working.length}</Text>
            <Text style={[styles.todayStatLabel, { color: colors.green[600] }]}>На смене</Text>
          </LinearGradient>
          <LinearGradient
            colors={[colors.gray[50], colors.gray[100]] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.todayStatCard}
          >
            <View style={styles.todayStatIconWrap}>
              <Ionicons name="moon-outline" size={20} color={colors.gray[500]} />
            </View>
            <Text style={[styles.todayStatNum, { color: colors.gray[700] }]}>{notWorking.length}</Text>
            <Text style={[styles.todayStatLabel, { color: colors.gray[500] }]}>Отсутствуют</Text>
          </LinearGradient>
        </View>
      </AnimatedCard>

      {isLoading ? <LoadingSpinner /> : statuses.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="calendar-outline" size={36} color={colors.gray[300]} />
          </View>
          <Text style={styles.emptyTitle}>Расписание не настроено</Text>
          <Text style={styles.emptySubtitle}>Добавьте смены в разделе "График"</Text>
        </View>
      ) : (
        statuses.map((s, idx) => {
          const info = getStatusInfo(s);
          return (
            <AnimatedCard key={s.userId} index={idx + 2}>
              <View style={styles.todayCard}>
                <View style={[styles.todayCardAccent, { backgroundColor: info.accentColor }]} />
                <View style={styles.todayCardContent}>
                  <View style={[styles.todayStatusIcon, { backgroundColor: info.bgColor }]}>
                    <Ionicons name={info.icon} size={20} color={info.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.todayName}>{s.fullName}</Text>
                    <View style={styles.todayInfoRow}>
                      {s.shiftStart && s.shiftEnd && (
                        <View style={styles.todayShiftPill}>
                          <Ionicons name="time-outline" size={10} color={colors.gray[500]} />
                          <Text style={styles.todayShift}>{s.shiftStart} — {s.shiftEnd}</Text>
                        </View>
                      )}
                      {s.actualArrival && (
                        <View style={[styles.todayShiftPill, { backgroundColor: colors.primary[50] }]}>
                          <Ionicons name="enter-outline" size={10} color={colors.primary[600]} />
                          <Text style={[styles.todayShift, { color: colors.primary[600] }]}>
                            {new Date(s.actualArrival).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                          </Text>
                        </View>
                      )}
                    </View>
                    {s.note && <Text style={styles.todayNote}>{s.note}</Text>}
                  </View>
                  <View style={[styles.todayStatusBadge, { backgroundColor: info.bgColor }]}>
                    <Text style={[styles.todayStatusText, { color: info.color }]}>{info.label}</Text>
                  </View>
                </View>
              </View>
            </AnimatedCard>
          );
        })
      )}
    </ScrollView>
  );
}

// ============== SHIFTS TAB ==============
function ShiftsTab() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['schedule-my-stats', year, month],
    queryFn: async () => { const res = await scheduleApi.getMyStats(); return res.data; },
  });

  const s: any = stats || {};

  const statItems = [
    { label: 'Рабочих дней', value: s.totalWorked || 0, icon: 'calendar' as const, color: colors.primary[700], gradient: [colors.primary[50], colors.primary[100]] },
    { label: 'Вовремя', value: s.totalOnTime || 0, icon: 'checkmark-circle' as const, color: colors.green[700], gradient: [colors.green[50], colors.green[100]] },
    { label: 'Опозданий', value: s.totalLate || 0, icon: 'alarm-outline' as const, color: colors.orange[600], gradient: [colors.orange[50], '#fed7aa'] },
    { label: 'Выходных', value: s.totalDaysOff || 0, icon: 'moon-outline' as const, color: colors.gray[600], gradient: [colors.gray[50], colors.gray[100]] },
  ];

  const totalLate = (s.totalLateMinor || 0) + (s.totalLateMajor || 0);

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Month nav */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month - 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setCurrentMonth(new Date())}
          style={styles.monthCenter}
          activeOpacity={0.7}
        >
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month + 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
      </View>

      {isLoading ? <LoadingSpinner /> : (
        <>
          {/* 2x2 stat cards */}
          <View style={styles.statsGrid}>
            {statItems.map((item, idx) => (
              <AnimatedCard key={idx} index={idx}>
                <LinearGradient
                  colors={item.gradient as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.statCard}
                >
                  <View style={styles.statCardHeader}>
                    <View style={[styles.statIcon, { backgroundColor: colors.white + '90' }]}>
                      <Ionicons name={item.icon} size={18} color={item.color} />
                    </View>
                  </View>
                  <Text style={[styles.statValue, { color: item.color }]}>{item.value}</Text>
                  <Text style={[styles.statLabel, { color: item.color + 'B0' }]}>{item.label}</Text>
                </LinearGradient>
              </AnimatedCard>
            ))}
          </View>

          {/* Late details card with progress bars */}
          {(s.totalLateMinor > 0 || s.totalLateMajor > 0) && (
            <AnimatedCard index={4}>
              <View style={styles.detailCard}>
                <View style={styles.detailCardHeader}>
                  <View style={styles.detailHeaderIcon}>
                    <Ionicons name="analytics-outline" size={16} color={colors.primary[600]} />
                  </View>
                  <Text style={styles.detailTitle}>Детали опозданий</Text>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelRow}>
                      <View style={[styles.detailDotIndicator, { backgroundColor: colors.yellow[500] }]} />
                      <Text style={styles.detailLabel}>Опоздания {'<'}1ч</Text>
                    </View>
                    <Text style={[styles.detailValue, { color: colors.yellow[600] }]}>{s.totalLateMinor || 0}</Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBar, { width: `${totalLate > 0 ? ((s.totalLateMinor || 0) / totalLate) * 100 : 0}%`, backgroundColor: colors.yellow[400] }]} />
                  </View>
                </View>

                <View style={styles.detailSection}>
                  <View style={styles.detailRow}>
                    <View style={styles.detailLabelRow}>
                      <View style={[styles.detailDotIndicator, { backgroundColor: colors.orange[500] }]} />
                      <Text style={styles.detailLabel}>Опоздания {'>'}1ч</Text>
                    </View>
                    <Text style={[styles.detailValue, { color: colors.orange[600] }]}>{s.totalLateMajor || 0}</Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBar, { width: `${totalLate > 0 ? ((s.totalLateMajor || 0) / totalLate) * 100 : 0}%`, backgroundColor: colors.orange[500] }]} />
                  </View>
                </View>

                {s.avgLateMinutes > 0 && (
                  <View style={styles.avgLateRow}>
                    <View style={styles.avgLateIconWrap}>
                      <Ionicons name="hourglass-outline" size={14} color={colors.gray[500]} />
                    </View>
                    <Text style={styles.detailLabel}>Ср. опоздание</Text>
                    <Text style={styles.avgLateValue}>{Math.round(s.avgLateMinutes)} мин</Text>
                  </View>
                )}
              </View>
            </AnimatedCard>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ============== RATING TAB ==============
function RatingTab() {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthStart = `${selectedMonth}-01`;
  const monthEnd = (() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
  })();

  const { data: monthEntries = [] } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', monthStart, monthEnd],
    queryFn: async () => (await scheduleApi.getAll({ dateFrom: monthStart, dateTo: monthEnd })).data,
  });

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
  });

  const users = useMemo(() => (usersData || []).filter(u => u.isActive && u.role === 'master'), [usersData]);

  const stats = useMemo(() => {
    const map: Record<string, { full: number; lateMinor: number; lateMajor: number; absent: number; sick: number; total: number }> = {};
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Dedupe by user+date — prefer entry with more data (actualArrival > lateStatus)
    const uniqueByDay = new Map<string, ScheduleEntry>();
    monthEntries.forEach(e => {
      const dayKey = `${e.userId}-${(e.date || '').slice(0, 10)}`;
      const existing = uniqueByDay.get(dayKey);
      if (!existing) { uniqueByDay.set(dayKey, e); return; }
      const existingScore = (existing.actualArrival ? 2 : 0) + (existing.lateStatus ? 1 : 0);
      const currentScore = (e.actualArrival ? 2 : 0) + (e.lateStatus ? 1 : 0);
      if (currentScore > existingScore) uniqueByDay.set(dayKey, e);
    });

    uniqueByDay.forEach(e => {
      const ed = new Date((e.date || '').slice(0, 10) + 'T00:00:00');
      if (ed > todayEnd) return;
      if (!map[e.userId]) map[e.userId] = { full: 0, lateMinor: 0, lateMajor: 0, absent: 0, sick: 0, total: 0 };
      const s = map[e.userId];
      const note = (e.note || '').toLowerCase();
      if (note.includes('больнич')) { s.sick++; return; }
      if (note.includes('прогул')) { s.absent++; s.total++; return; }
      if (e.isDayOff) return;
      s.total++;
      if (e.lateStatus === 'late_major' || (e.lateMinutes || 0) >= 60) s.lateMajor++;
      else if (e.lateStatus === 'late_minor' || ((e.lateMinutes || 0) > 0 && (e.lateMinutes || 0) < 60)) s.lateMinor++;
      else if (e.actualArrival || e.lateStatus === 'on_time') s.full++;
      else {
        const d = new Date(e.date + 'T23:59:59');
        if (d < new Date()) s.absent++;
      }
    });
    return map;
  }, [monthEntries]);

  const ranked = useMemo(() => users.map(u => {
    const s = stats[u.id] || { full: 0, lateMinor: 0, lateMajor: 0, absent: 0, sick: 0, total: 0 };
    const score = s.total > 0 ? Math.round((s.full / s.total) * 100) : 0;
    return { ...u, stats: s, score };
  }).sort((a, b) => b.score - a.score || b.stats.full - a.stats.full), [users, stats]);

  const shiftMonth = (dir: number) => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + dir);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = (() => {
    const [y, m] = selectedMonth.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  })();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[3], backgroundColor: colors.white, borderRadius: borderRadius.xl, paddingVertical: spacing[2.5], borderWidth: 1, borderColor: colors.gray[100] }}>
        <TouchableOpacity onPress={() => shiftMonth(-1)} style={{ padding: spacing[1] }}>
          <Ionicons name="chevron-back" size={20} color={colors.gray[500]} />
        </TouchableOpacity>
        <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], textTransform: 'capitalize' as const, minWidth: 140, textAlign: 'center' }}>{monthLabel}</Text>
        <TouchableOpacity onPress={() => shiftMonth(1)} style={{ padding: spacing[1] }}>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[500]} />
        </TouchableOpacity>
      </View>

      {ranked.map((u, idx) => {
        const s = u.stats;
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
        const scoreColor = u.score >= 90 ? colors.green[600] : u.score >= 70 ? colors.yellow[600] : colors.red[500];
        const scoreBg = u.score >= 90 ? colors.green[50] : u.score >= 70 ? colors.yellow[50] : colors.red[50];

        return (
          <View key={u.id} style={{ backgroundColor: colors.white, borderRadius: borderRadius['2xl'], padding: spacing[3], borderWidth: 1, borderColor: idx < 3 ? colors.amber[200] : colors.gray[100] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: idx < 3 ? colors.amber[100] : colors.gray[100], alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: idx < 3 ? colors.amber[600] : colors.gray[500] }}>{medal || (idx + 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] }} numberOfLines={1}>{u.fullName}</Text>
                <View style={{ flexDirection: 'row', gap: spacing[1.5], marginTop: 4, flexWrap: 'wrap' }}>
                  <Text style={{ fontSize: 9, backgroundColor: colors.green[50], color: colors.green[700], paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, fontWeight: '600' }}>✓ {s.full}</Text>
                  {s.lateMinor > 0 && <Text style={{ fontSize: 9, backgroundColor: colors.yellow[50], color: colors.yellow[700], paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, fontWeight: '600' }}>⏰ {s.lateMinor}</Text>}
                  {s.lateMajor > 0 && <Text style={{ fontSize: 9, backgroundColor: colors.orange[50], color: colors.orange[600], paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, fontWeight: '600' }}>⚠ {s.lateMajor}</Text>}
                  {s.absent > 0 && <Text style={{ fontSize: 9, backgroundColor: colors.red[50], color: colors.red[700], paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, fontWeight: '600' }}>❌ {s.absent}</Text>}
                  {s.sick > 0 && <Text style={{ fontSize: 9, backgroundColor: colors.rose[50], color: colors.rose[600], paddingHorizontal: 5, paddingVertical: 2, borderRadius: 8, fontWeight: '600' }}>🏥 {s.sick}</Text>}
                </View>
              </View>
              <View style={{ backgroundColor: scoreBg, borderRadius: borderRadius.lg, paddingHorizontal: spacing[2.5], paddingVertical: spacing[1.5], alignItems: 'center' }}>
                <Text style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: scoreColor }}>{u.score}%</Text>
                <Text style={{ fontSize: 8, color: colors.gray[400] }}>посещ.</Text>
              </View>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ============== SETTINGS TAB ==============
function SettingsTab() {
  const queryClient = useQueryClient();
  const [settingsTab, setSettingsTab] = useState<'daysoff' | 'modes'>('daysoff');

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  const { data: workModes } = useQuery<any[]>({
    queryKey: ['work-modes'],
    queryFn: async () => { const res = await scheduleApi.getWorkModes(); return res.data; },
  });

  const activeUsers = useMemo(() => (usersData || []).filter(u => u.isActive && u.role === 'master'), [usersData]);

  const toggleDayOff = async (userId: string, dayOfWeek: number) => {
    const user = activeUsers.find(u => u.id === userId);
    if (!user) return;
    const current: number[] = (user as any).daysOff || [];
    const newDaysOff = current.includes(dayOfWeek) ? current.filter(d => d !== dayOfWeek) : [...current, dayOfWeek];
    try {
      await usersApi.update(userId, { daysOff: newDaysOff } as any);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch {
      Alert.alert('Ошибка', 'Не удалось обновить');
    }
  };

  const [applyModeId, setApplyModeId] = useState('');
  const [applyUserId, setApplyUserId] = useState('');
  const [applyFrom, setApplyFrom] = useState<Date | null>(null);
  const [applyTo, setApplyTo] = useState<Date | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showApplyFromPicker, setShowApplyFromPicker] = useState(false);
  const [showApplyToPicker, setShowApplyToPicker] = useState(false);

  const formatPickerDate = (d: Date) => `${d.getDate().toString().padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const toISODate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const applyMutation = useMutation({
    mutationFn: (data: any) => scheduleApi.applyWorkMode(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      setShowApplyModal(false);
      Alert.alert('Готово', 'Режим применён');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка'),
  });

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Segmented sub-tabs */}
      <View style={styles.subTabs}>
        <TouchableOpacity
          style={[styles.subTabItem, settingsTab === 'daysoff' && styles.subTabActive]}
          onPress={() => setSettingsTab('daysoff')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="calendar-outline"
            size={15}
            color={settingsTab === 'daysoff' ? colors.white : colors.gray[500]}
          />
          <Text style={[styles.subTabText, settingsTab === 'daysoff' && styles.subTabTextActive]}>Выходные</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTabItem, settingsTab === 'modes' && styles.subTabActive]}
          onPress={() => setSettingsTab('modes')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="time-outline"
            size={15}
            color={settingsTab === 'modes' ? colors.white : colors.gray[500]}
          />
          <Text style={[styles.subTabText, settingsTab === 'modes' && styles.subTabTextActive]}>Режимы</Text>
        </TouchableOpacity>
      </View>

      {settingsTab === 'daysoff' ? (
        <View style={{ gap: spacing[3] }}>
          {activeUsers.map((u, idx) => {
            const daysOff: number[] = (u as any).daysOff || [];
            const avatarColors = getAvatarColors(u.fullName);
            return (
              <AnimatedCard key={u.id} index={idx}>
                <View style={styles.daysOffCard}>
                  <View style={styles.daysOffHeader}>
                    <LinearGradient
                      colors={avatarColors as [string, string]}
                      style={styles.daysOffAvatar}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.daysOffAvatarText}>{getInitials(u.fullName)}</Text>
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.daysOffName}>{u.fullName}</Text>
                      <Text style={styles.daysOffCount}>
                        {daysOff.length > 0 ? `${daysOff.length} выходн.` : 'Нет выходных'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.daysOffRow}>
                    {DAY_ABBR.map((label, dow) => {
                      const isOff = daysOff.includes(dow);
                      const isWeekend = dow >= 5;
                      return (
                        <TouchableOpacity
                          key={dow}
                          style={[
                            styles.dayBtn,
                            isOff && styles.dayBtnActive,
                            !isOff && isWeekend && styles.dayBtnWeekend,
                          ]}
                          onPress={() => toggleDayOff(u.id, dow)}
                          activeOpacity={0.6}
                        >
                          <Text style={[
                            styles.dayBtnText,
                            isOff && styles.dayBtnTextActive,
                            !isOff && isWeekend && { color: colors.red[400] },
                          ]}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </AnimatedCard>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: spacing[3] }}>
          {(workModes || []).map((mode: any, idx: number) => (
            <AnimatedCard key={mode.id} index={idx}>
              <View style={styles.modeCard}>
                <LinearGradient
                  colors={[colors.primary[50], colors.primary[100]] as [string, string]}
                  style={styles.modeIconWrap}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons name="time-outline" size={20} color={colors.primary[600]} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modeName}>{mode.name}</Text>
                  <View style={styles.modeTimeRow}>
                    <Ionicons name="enter-outline" size={12} color={colors.green[600]} />
                    <Text style={styles.modeTimeText}>{mode.shiftStart}</Text>
                    <Ionicons name="remove-outline" size={10} color={colors.gray[300]} />
                    <Ionicons name="exit-outline" size={12} color={colors.orange[500]} />
                    <Text style={styles.modeTimeText}>{mode.shiftEnd}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.modeApplyBtn}
                  onPress={() => { setApplyModeId(mode.id); setApplyUserId(''); setApplyFrom(null); setApplyTo(null); setShowApplyModal(true); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modeApplyText}>Применить</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.primary[600]} />
                </TouchableOpacity>
              </View>
            </AnimatedCard>
          ))}
          {(!workModes || workModes.length === 0) && (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="time-outline" size={36} color={colors.gray[300]} />
              </View>
              <Text style={styles.emptyTitle}>Нет режимов работы</Text>
              <Text style={styles.emptySubtitle}>Создайте режимы в веб-панели</Text>
            </View>
          )}
        </View>
      )}

      <Modal visible={showApplyModal} onClose={() => setShowApplyModal(false)} title="Применить режим">
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сотрудник</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              <TouchableOpacity style={[styles.userChip, !applyUserId && styles.userChipActive]} onPress={() => setApplyUserId('')}>
                <Ionicons name="people-outline" size={12} color={!applyUserId ? colors.primary[700] : colors.gray[500]} />
                <Text style={[styles.userChipText, !applyUserId && styles.userChipTextActive]}>Все</Text>
              </TouchableOpacity>
              {activeUsers.map(u => (
                <TouchableOpacity key={u.id} style={[styles.userChip, applyUserId === u.id && styles.userChipActive]} onPress={() => setApplyUserId(u.id)}>
                  <Text style={[styles.userChipText, applyUserId === u.id && styles.userChipTextActive]}>{u.fullName?.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
        <View style={styles.formRowFields}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>С даты</Text>
            <TouchableOpacity style={styles.formInput} onPress={() => setShowApplyFromPicker(true)}>
              <Ionicons name="calendar-outline" size={14} color={colors.gray[400]} />
              <Text style={{ fontSize: fontSize.sm, color: applyFrom ? colors.gray[900] : colors.gray[400], flex: 1 }}>
                {applyFrom ? formatPickerDate(applyFrom) : 'Выберите'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>По дату</Text>
            <TouchableOpacity style={styles.formInput} onPress={() => setShowApplyToPicker(true)}>
              <Ionicons name="calendar-outline" size={14} color={colors.gray[400]} />
              <Text style={{ fontSize: fontSize.sm, color: applyTo ? colors.gray[900] : colors.gray[400], flex: 1 }}>
                {applyTo ? formatPickerDate(applyTo) : 'Выберите'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <DateTimePickerModal
          visible={showApplyFromPicker}
          value={applyFrom || new Date()}
          mode="date"
          onConfirm={(d) => { setShowApplyFromPicker(false); setApplyFrom(d); }}
          onCancel={() => setShowApplyFromPicker(false)}
        />
        <DateTimePickerModal
          visible={showApplyToPicker}
          value={applyTo || new Date()}
          mode="date"
          onConfirm={(d) => { setShowApplyToPicker(false); setApplyTo(d); }}
          onCancel={() => setShowApplyToPicker(false)}
        />
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowApplyModal(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.applyBtnMain}
            onPress={() => {
              if (!applyFrom || !applyTo) { Alert.alert('Ошибка', 'Укажите даты'); return; }
              applyMutation.mutate({ workModeId: applyModeId, userId: applyUserId || undefined, dateFrom: toISODate(applyFrom), dateTo: toISODate(applyTo) });
            }}
            activeOpacity={0.7}
          >
            {applyMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : (
              <>
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.applyBtnText}>Применить</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ============== MAIN SCREEN ==============
export default function ScheduleScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'director' || user?.role === 'superadmin' || user?.role === 'admin';
  const [tab, setTab] = useState<TabType>('grid');

  const tabConfig: { key: TabType; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'grid', label: 'График', icon: 'grid-outline', activeIcon: 'grid' },
    { key: 'today', label: 'Сегодня', icon: 'today-outline', activeIcon: 'today' },
    { key: 'shifts', label: 'Смены', icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
    { key: 'rating', label: 'Рейтинг', icon: 'trophy-outline', activeIcon: 'trophy' },
    ...(isAdmin ? [{ key: 'settings' as TabType, label: 'Настройки', icon: 'settings-outline' as keyof typeof Ionicons.glyphMap, activeIcon: 'settings' as keyof typeof Ionicons.glyphMap }] : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <LinearGradient
        colors={[colors.white, colors.gray[50]] as [string, string]}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LinearGradient
            colors={[colors.primary[500], colors.primary[700]] as [string, string]}
            style={styles.headerIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="calendar" size={16} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Расписание</Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <View style={styles.tabBarInner}>
          {tabConfig.map(t => {
            const isActive = tab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                style={[styles.tabItem, isActive && styles.tabItemActive]}
                onPress={() => setTab(t.key)}
                activeOpacity={0.7}
              >
                {isActive ? (
                  <LinearGradient
                    colors={[colors.primary[500], colors.primary[700]] as [string, string]}
                    style={styles.tabItemGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Ionicons name={t.activeIcon} size={16} color={colors.white} />
                    <Text style={styles.tabItemTextActive} numberOfLines={1} adjustsFontSizeToFit>{t.label}</Text>
                  </LinearGradient>
                ) : (
                  <View style={styles.tabItemInner}>
                    <Ionicons name={t.icon} size={16} color={colors.gray[400]} />
                    <Text style={styles.tabItemText} numberOfLines={1} adjustsFontSizeToFit>{t.label}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {tab === 'grid' && <GridTab />}
      {tab === 'today' && <TodayTab />}
      {tab === 'shifts' && <ShiftsTab />}
      {tab === 'rating' && <RatingTab />}
      {tab === 'settings' && <SettingsTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── Safe / Layout ──
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.3,
  },

  // ── Tab Bar ──
  tabBar: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  tabBarInner: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 2,
  },
  tabItem: {
    flex: 1,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    minWidth: 0,
  },
  tabItemActive: {
    shadowColor: colors.primary[700],
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tabItemGradient: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing[1.5],
    paddingHorizontal: 2,
    borderRadius: borderRadius.lg,
  },
  tabItemInner: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing[1.5],
    paddingHorizontal: 2,
  },
  tabItemText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    textAlign: 'center',
  },
  tabItemTextActive: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.white,
    textAlign: 'center',
  },

  // ── Tab content ──
  tabContent: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[8],
  },

  // ── Empty state ──
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing[10],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  emptyTitle: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
  },
  emptySubtitle: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },

  // ── Month Navigation ──
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCenter: {
    alignItems: 'center',
  },
  monthTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.5,
  },
  monthYear: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },

  // ── Legend ──
  legendRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2.5],
    gap: spacing[4],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },

  // ── Sticky Column ──
  stickyColumn: {
    width: 110,
    backgroundColor: colors.white,
    zIndex: 2,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 3, height: 0 },
    elevation: 5,
    borderRightWidth: 1,
    borderRightColor: colors.gray[200],
  },

  // ── Grid ──
  gridHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[1],
    borderBottomWidth: 2,
    borderBottomColor: colors.gray[200],
  },
  gridHeaderToday: {
    backgroundColor: colors.primary[50],
  },
  gridHeaderDow: {
    fontSize: 9,
    color: colors.gray[400],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
  },
  gridHeaderDay: {
    fontSize: 13,
    color: colors.gray[700],
    fontWeight: fontWeight.medium,
    marginTop: 1,
  },
  gridTodayCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  gridTodayNum: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  gridHeaderLabel: {
    fontSize: 10,
    color: colors.gray[400],
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  gridNameCell: {
    paddingHorizontal: spacing[1.5],
    justifyContent: 'center',
    borderBottomWidth: 0.5,
    borderBottomColor: colors.gray[100],
  },
  gridNameInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  gridAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridAvatarText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  gridName: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.gray[800],
  },
  gridStatsRow: {
    flexDirection: 'row',
    gap: spacing[1],
    marginTop: 1,
  },
  gridStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  gridStatDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  gridStatText: {
    fontSize: 8,
    color: colors.gray[400],
    fontWeight: fontWeight.medium,
  },
  gridCell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 0.5,
    borderRightColor: colors.gray[100],
    borderBottomWidth: 0.5,
    borderBottomColor: colors.gray[100],
  },
  gridCellToday: {
    backgroundColor: colors.primary[50] + '50',
  },
  gridDot: {
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridDotRound: {
    width: 22,
  },
  gridDotLabel: {
    minWidth: 36,
    paddingHorizontal: 5,
  },
  gridCellEmpty: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gray[200],
  },

  // ── Quick Actions ──
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    justifyContent: 'center',
  },
  quickBtn: {
    alignItems: 'center',
    width: 80,
    gap: spacing[1.5],
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    textAlign: 'center',
  },

  // ── Today Tab ──
  todayDateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    padding: spacing[4],
    gap: spacing[3],
  },
  todayDateIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.white + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayDateLabel: {
    fontSize: fontSize.xs,
    color: colors.white + 'B0',
    fontWeight: fontWeight.medium,
  },
  todayDateText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.white,
    textTransform: 'capitalize',
    marginTop: 1,
  },
  todayTotalBadge: {
    backgroundColor: colors.white + '20',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    alignItems: 'center',
  },
  todayTotalText: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  todayTotalLabel: {
    fontSize: 9,
    color: colors.white + '90',
    fontWeight: fontWeight.medium,
  },
  todayStatsRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  todayStatCard: {
    flex: 1,
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    alignItems: 'center',
    gap: spacing[1],
  },
  todayStatIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white + '70',
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayStatNum: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  todayStatLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  todayCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  todayCardAccent: {
    height: 3,
    width: '100%',
  },
  todayCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3.5],
  },
  todayStatusIcon: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  todayInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[1],
  },
  todayShiftPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.gray[50],
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  todayShift: {
    fontSize: 10,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
  todayNote: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    fontStyle: 'italic',
    marginTop: spacing[1],
  },
  todayStatusBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  todayStatusText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },

  // ── Shifts Stats ──
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  statCard: {
    width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2,
    borderRadius: borderRadius['2xl'],
    padding: spacing[4],
    gap: spacing[1],
  },
  statCardHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing[1],
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
  },

  // ── Detail Card (late details) ──
  detailCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[4],
    gap: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  detailHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  detailSection: {
    gap: spacing[1.5],
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  detailDotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  detailLabel: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.gray[100],
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
  },
  avgLateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  avgLateIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avgLateValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[800],
    marginLeft: 'auto',
  },

  // ── Settings ──
  subTabs: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    gap: 3,
    marginBottom: spacing[3],
  },
  subTabItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  subTabActive: {
    backgroundColor: colors.primary[600],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
  },
  subTabTextActive: {
    color: colors.white,
    fontWeight: fontWeight.bold,
  },

  // ── Days Off ──
  daysOffCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  daysOffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  daysOffAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysOffAvatarText: {
    fontSize: 12,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  daysOffName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  daysOffCount: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: 1,
  },
  daysOffRow: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  dayBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
  },
  dayBtnWeekend: {
    borderColor: colors.red[200],
    backgroundColor: colors.red[50] + '50',
  },
  dayBtnActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
    shadowColor: colors.primary[600],
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  dayBtnText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.gray[500],
  },
  dayBtnTextActive: {
    color: colors.white,
  },

  // ── Work Modes ──
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[3],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  modeIconWrap: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  modeTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[1],
  },
  modeTimeText: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
  modeApplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[50],
  },
  modeApplyText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary[600],
  },

  // ── Form / Modal ──
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formRowFields: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.gray[50],
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
  },
  applyBtnMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  applyBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
  },
  userChipActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[400],
  },
  userChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[600],
  },
  userChipTextActive: {
    color: colors.primary[700],
    fontWeight: fontWeight.semibold,
  },
});
