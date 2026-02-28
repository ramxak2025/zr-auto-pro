import React, { useState, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Dimensions, NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { scheduleApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { TodayEmployeeStatus, ScheduleEntry, User } from '../../../shared/types';

type TabType = 'grid' | 'today' | 'shifts' | 'settings';

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

function getCellStyle(entry?: ScheduleEntry) {
  if (!entry) return { bg: 'transparent', text: '', textColor: colors.gray[300] };
  const note = (entry.note || '').toLowerCase();
  if (note.includes('больнич')) return { bg: colors.rose[50], text: 'Б/Л', textColor: colors.rose[600] };
  if (entry.isDayOff) return { bg: colors.gray[100], text: 'Вых', textColor: colors.gray[500] };
  if (entry.lateStatus === 'late_major') return { bg: colors.orange[50], text: entry.shiftStart || '✔', textColor: colors.orange[600] };
  if (entry.lateStatus === 'late_minor') return { bg: colors.yellow[50], text: entry.shiftStart || '✔', textColor: colors.yellow[600] };
  if (entry.shiftStart) return { bg: colors.green[50], text: entry.shiftStart, textColor: colors.green[700] };
  return { bg: 'transparent', text: '', textColor: colors.gray[300] };
}

// ============== GRID TAB ==============
function GridTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === 'director' || user?.role === 'superadmin' || user?.role === 'admin';
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [quickPopup, setQuickPopup] = useState<{ userId: string; date: string; entry?: ScheduleEntry; userName?: string } | null>(null);

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
  });

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  const activeUsers = useMemo(() => (usersData || []).filter(u => u.isActive), [usersData]);
  const days = getDaysInMonth(year, month);

  const entryMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry>();
    (entries ?? []).forEach(e => {
      const d = e.date?.split('T')[0] || '';
      map.set(`${e.userId}-${d}`, e);
    });
    return map;
  }, [entries]);

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

  const createMutation = useMutation({
    mutationFn: (d: any) => scheduleApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); setQuickPopup(null); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); setQuickPopup(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); setQuickPopup(null); },
  });

  const quickAction = (type: string) => {
    if (!quickPopup) return;
    const { userId, date, entry } = quickPopup;
    const base: any = { userId, date };

    if (type === 'delete' && entry) { deleteMutation.mutate(entry.id); return; }
    if (type === 'shift') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.note = ''; }
    else if (type === 'dayoff') { base.isDayOff = true; base.note = ''; }
    else if (type === 'sick') { base.isDayOff = true; base.note = 'Больничный'; }
    else if (type === 'late_minor') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.note = 'Опоздание <1ч'; }
    else if (type === 'late_major') { base.shiftStart = '09:00'; base.shiftEnd = '18:00'; base.isDayOff = false; base.note = 'Опоздание >1ч'; }

    if (entry) { updateMutation.mutate({ id: entry.id, data: base }); }
    else { createMutation.mutate(base); }
  };

  const CELL_W = 44;
  const NAME_W = 110;
  const ROW_H = 44;

  // Sync vertical scroll between left (names) and right (cells)
  const handleLeftScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isRightScrolling.current) return;
    isLeftScrolling.current = true;
    rightScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false });
    setTimeout(() => { isLeftScrolling.current = false; }, 16);
  };

  const handleRightScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isLeftScrolling.current) return;
    isRightScrolling.current = true;
    leftScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false });
    setTimeout(() => { isRightScrolling.current = false; }, 16);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month - 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]}</Text>
          <Text style={styles.monthYear}>{year}</Text>
        </View>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month + 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.green[500] }]} /><Text style={styles.legendText}>Смена</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.gray[400] }]} /><Text style={styles.legendText}>Вых</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.rose[500] }]} /><Text style={styles.legendText}>Б/Л</Text></View>
        <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.orange[500] }]} /><Text style={styles.legendText}>Опозд.</Text></View>
      </View>

      {isLoading ? <LoadingSpinner /> : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Sticky left column — employee names */}
          <View style={styles.stickyColumn}>
            {/* Header cell */}
            <View style={[styles.gridNameCell, { width: NAME_W, height: ROW_H, borderBottomWidth: 2, borderBottomColor: colors.gray[200] }]}>
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
                return (
                  <View key={u.id} style={[styles.gridNameCell, { width: NAME_W, height: ROW_H }, rowIdx % 2 === 1 && { backgroundColor: colors.gray[50] + '40' }]}>
                    <Text style={styles.gridName} numberOfLines={1}>{u.fullName?.split(' ')[0]}</Text>
                    {stats && <Text style={styles.gridNameStats}>{stats.worked}см / {stats.off}вых</Text>}
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {/* Scrollable right section — day columns */}
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
                    <View key={ds} style={[styles.gridHeaderCell, { width: CELL_W, height: ROW_H }, isWeekend && { backgroundColor: colors.red[50] }, isToday && { backgroundColor: colors.primary[50] }]}>
                      <Text style={[styles.gridHeaderDow, isWeekend && { color: colors.red[400] }, isToday && { color: colors.primary[600] }]}>{DAY_ABBR[dow]}</Text>
                      <Text style={[styles.gridHeaderDay, isToday && { color: colors.primary[600], fontWeight: fontWeight.bold }]}>{d.getDate()}</Text>
                    </View>
                  );
                })}
              </View>

              {/* Day cells */}
              <ScrollView
                ref={rightScrollRef}
                showsVerticalScrollIndicator={false}
                onScroll={handleRightScroll}
                scrollEventThrottle={16}
                bounces={false}
              >
                {activeUsers.map((u, rowIdx) => (
                  <View key={u.id} style={[{ flexDirection: 'row', height: ROW_H }, rowIdx % 2 === 1 && { backgroundColor: colors.gray[50] + '40' }]}>
                    {days.map(d => {
                      const ds = formatDate(d);
                      const entry = entryMap.get(`${u.id}-${ds}`);
                      const cell = getCellStyle(entry);
                      const dow = (d.getDay() + 6) % 7;
                      const isWeekend = dow >= 5;

                      return (
                        <TouchableOpacity
                          key={ds}
                          style={[styles.gridCell, { width: CELL_W, backgroundColor: cell.bg || (isWeekend ? colors.red[50] + '30' : 'transparent') }]}
                          onPress={() => canEdit && setQuickPopup({ userId: u.id, date: ds, entry, userName: u.fullName?.split(' ')[0] })}
                          activeOpacity={canEdit ? 0.5 : 1}
                        >
                          {cell.text ? (
                            <Text style={[styles.gridCellText, { color: cell.textColor }]}>{cell.text}</Text>
                          ) : (
                            canEdit && <View style={styles.gridCellEmpty} />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}

      <Modal visible={!!quickPopup} onClose={() => setQuickPopup(null)} title={quickPopup?.userName ? `${quickPopup.userName} — ${quickPopup.date?.split('-').reverse().join('.')}` : 'Быстрое действие'}>
        {quickPopup && (
          <View style={styles.quickActions}>
            {[
              { type: 'shift', label: 'Смена', icon: 'checkmark-circle' as const, iconColor: colors.green[500], bg: colors.green[50] },
              { type: 'dayoff', label: 'Выходной', icon: 'moon-outline' as const, iconColor: colors.gray[500], bg: colors.gray[100] },
              { type: 'sick', label: 'Больничный', icon: 'medkit-outline' as const, iconColor: colors.rose[500], bg: colors.rose[50] },
              { type: 'late_minor', label: 'Опоздал <1ч', icon: 'alarm-outline' as const, iconColor: colors.yellow[600], bg: colors.yellow[50] },
              { type: 'late_major', label: 'Опоздал >1ч', icon: 'warning-outline' as const, iconColor: colors.orange[500], bg: colors.orange[50] },
            ].map(item => (
              <TouchableOpacity key={item.type} style={styles.quickBtn} onPress={() => quickAction(item.type)}>
                <View style={[styles.quickIcon, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={20} color={item.iconColor} />
                </View>
                <Text style={styles.quickLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            {quickPopup.entry && (
              <TouchableOpacity style={styles.quickBtn} onPress={() => quickAction('delete')}>
                <View style={[styles.quickIcon, { backgroundColor: colors.red[50] }]}>
                  <Ionicons name="trash-outline" size={20} color={colors.red[600]} />
                </View>
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
    if (note.includes('больнич')) return { label: 'Больничный', color: colors.rose[500], icon: 'medkit-outline' as const, bgColor: colors.rose[50] };
    if (s.isDayOff) return { label: 'Выходной', color: colors.gray[500], icon: 'moon-outline' as const, bgColor: colors.gray[100] };
    if (s.lateStatus === 'late_major') return { label: 'Опозд. >1ч', color: colors.orange[500], icon: 'warning-outline' as const, bgColor: colors.orange[50] };
    if (s.lateStatus === 'late_minor') return { label: 'Опозд. <1ч', color: colors.yellow[600], icon: 'alarm-outline' as const, bgColor: colors.yellow[50] };
    if (s.isWorking) return { label: 'На смене', color: colors.green[600], icon: 'checkmark-circle' as const, bgColor: colors.green[50] };
    if (s.hasSchedule) return { label: 'Прогул', color: colors.red[500], icon: 'close-circle' as const, bgColor: colors.red[50] };
    return { label: '—', color: colors.gray[400], icon: 'remove-outline' as const, bgColor: colors.gray[50] };
  };

  const todayDate = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <ScrollView contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
      <View style={styles.todayDateHeader}>
        <Ionicons name="today-outline" size={18} color={colors.primary[600]} />
        <Text style={styles.todayDateText}>{todayDate}</Text>
      </View>

      <View style={styles.todayStatsRow}>
        <View style={[styles.todayStatCard, { borderLeftColor: colors.green[500] }]}>
          <Text style={[styles.todayStatNum, { color: colors.green[600] }]}>{working.length}</Text>
          <Text style={styles.todayStatLabel}>На смене</Text>
        </View>
        <View style={[styles.todayStatCard, { borderLeftColor: colors.gray[400] }]}>
          <Text style={[styles.todayStatNum, { color: colors.gray[600] }]}>{notWorking.length}</Text>
          <Text style={styles.todayStatLabel}>Отсутствуют</Text>
        </View>
      </View>

      {isLoading ? <LoadingSpinner /> : statuses.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
          <Ionicons name="calendar-outline" size={40} color={colors.gray[300]} />
          <Text style={styles.empty}>Расписание не настроено</Text>
        </View>
      ) : (
        statuses.map(s => {
          const info = getStatusInfo(s);
          return (
            <View key={s.userId} style={styles.todayCard}>
              <View style={[styles.todayStatusIcon, { backgroundColor: info.bgColor }]}>
                <Ionicons name={info.icon} size={20} color={info.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.todayName}>{s.fullName}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 }}>
                  {s.shiftStart && s.shiftEnd && <Text style={styles.todayShift}>{s.shiftStart} — {s.shiftEnd}</Text>}
                  {s.actualArrival && <Text style={styles.todayArrival}>Пришёл {new Date(s.actualArrival).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text>}
                </View>
                {s.note && <Text style={styles.todayNote}>{s.note}</Text>}
              </View>
              <View style={[styles.todayStatusBadge, { backgroundColor: info.bgColor }]}>
                <Text style={[styles.todayStatusText, { color: info.color }]}>{info.label}</Text>
              </View>
            </View>
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
    { label: 'Рабочих дней', value: s.totalWorked || 0, icon: 'calendar' as const, color: colors.primary[600], bg: colors.primary[50] },
    { label: 'Вовремя', value: s.totalOnTime || 0, icon: 'checkmark-circle' as const, color: colors.green[600], bg: colors.green[50] },
    { label: 'Опозданий', value: s.totalLate || 0, icon: 'alarm-outline' as const, color: colors.orange[500], bg: colors.orange[50] },
    { label: 'Выходных', value: s.totalDaysOff || 0, icon: 'moon-outline' as const, color: colors.gray[500], bg: colors.gray[100] },
  ];

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month - 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.monthTitle}>{MONTH_NAMES[month]}</Text>
          <Text style={styles.monthYear}>{year}</Text>
        </View>
        <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month + 1, 1))} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      {isLoading ? <LoadingSpinner /> : (
        <>
          <View style={styles.statsGrid}>
            {statItems.map((item, idx) => (
              <View key={idx} style={styles.statCard}>
                <View style={[styles.statIcon, { backgroundColor: item.bg }]}>
                  <Ionicons name={item.icon} size={18} color={item.color} />
                </View>
                <Text style={[styles.statValue, { color: item.color }]}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {(s.totalLateMinor > 0 || s.totalLateMajor > 0) && (
            <View style={styles.detailCard}>
              <View style={styles.detailCardHeader}>
                <Ionicons name="analytics-outline" size={16} color={colors.gray[500]} />
                <Text style={styles.detailTitle}>Детали опозданий</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Опоздания {'<'}1ч</Text>
                <Text style={[styles.detailValue, { color: colors.yellow[600] }]}>{s.totalLateMinor || 0}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Опоздания {'>'}1ч</Text>
                <Text style={[styles.detailValue, { color: colors.orange[600] }]}>{s.totalLateMajor || 0}</Text>
              </View>
              {s.avgLateMinutes > 0 && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Ср. опоздание</Text>
                  <Text style={styles.detailValue}>{Math.round(s.avgLateMinutes)} мин</Text>
                </View>
              )}
            </View>
          )}
        </>
      )}
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

  const activeUsers = useMemo(() => (usersData || []).filter(u => u.isActive), [usersData]);

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
  const [applyFrom, setApplyFrom] = useState('');
  const [applyTo, setApplyTo] = useState('');
  const [showApplyModal, setShowApplyModal] = useState(false);

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
      <View style={styles.subTabs}>
        <TouchableOpacity style={[styles.subTabItem, settingsTab === 'daysoff' && styles.subTabActive]} onPress={() => setSettingsTab('daysoff')}>
          <Ionicons name="calendar-outline" size={14} color={settingsTab === 'daysoff' ? colors.white : colors.gray[500]} />
          <Text style={[styles.subTabText, settingsTab === 'daysoff' && styles.subTabTextActive]}>Выходные</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.subTabItem, settingsTab === 'modes' && styles.subTabActive]} onPress={() => setSettingsTab('modes')}>
          <Ionicons name="time-outline" size={14} color={settingsTab === 'modes' ? colors.white : colors.gray[500]} />
          <Text style={[styles.subTabText, settingsTab === 'modes' && styles.subTabTextActive]}>Режимы</Text>
        </TouchableOpacity>
      </View>

      {settingsTab === 'daysoff' ? (
        <View style={{ gap: spacing[3] }}>
          {activeUsers.map(u => {
            const daysOff: number[] = (u as any).daysOff || [];
            return (
              <View key={u.id} style={styles.daysOffCard}>
                <Text style={styles.daysOffName}>{u.fullName}</Text>
                <View style={styles.daysOffRow}>
                  {DAY_ABBR.map((label, dow) => {
                    const isOff = daysOff.includes(dow);
                    return (
                      <TouchableOpacity key={dow} style={[styles.dayBtn, isOff && styles.dayBtnActive]} onPress={() => toggleDayOff(u.id, dow)}>
                        <Text style={[styles.dayBtnText, isOff && styles.dayBtnTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ gap: spacing[3] }}>
          {(workModes || []).map((mode: any) => (
            <View key={mode.id} style={styles.modeCard}>
              <View style={styles.modeIconWrap}>
                <Ionicons name="time-outline" size={18} color={colors.primary[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modeName}>{mode.name}</Text>
                <Text style={styles.modeInfo}>{mode.shiftStart} — {mode.shiftEnd}</Text>
              </View>
              <TouchableOpacity style={styles.modeApplyBtn} onPress={() => { setApplyModeId(mode.id); setApplyUserId(''); setApplyFrom(''); setApplyTo(''); setShowApplyModal(true); }}>
                <Ionicons name="play" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>
          ))}
          {(!workModes || workModes.length === 0) && (
            <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
              <Ionicons name="time-outline" size={40} color={colors.gray[300]} />
              <Text style={styles.empty}>Нет режимов работы</Text>
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
            <TextInput value={applyFrom} onChangeText={setApplyFrom} style={styles.formInput} placeholder="2026-03-01" placeholderTextColor={colors.gray[400]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>По дату</Text>
            <TextInput value={applyTo} onChangeText={setApplyTo} style={styles.formInput} placeholder="2026-03-31" placeholderTextColor={colors.gray[400]} />
          </View>
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowApplyModal(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyBtn} onPress={() => {
            if (!applyFrom || !applyTo) { Alert.alert('Ошибка', 'Укажите даты'); return; }
            applyMutation.mutate({ workModeId: applyModeId, userId: applyUserId || undefined, dateFrom: applyFrom, dateTo: applyTo });
          }}>
            {applyMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : (
              <Text style={styles.applyBtnText}>Применить</Text>
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

  const tabIcons: Record<TabType, keyof typeof Ionicons.glyphMap> = {
    grid: 'grid-outline',
    today: 'today-outline',
    shifts: 'stats-chart-outline',
    settings: 'settings-outline',
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: 'grid', label: 'График' },
    { key: 'today', label: 'Сегодня' },
    { key: 'shifts', label: 'Смены' },
    ...(isAdmin ? [{ key: 'settings' as TabType, label: 'Настройки' }] : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <Text style={styles.title}>Расписание</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={styles.tabs}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabItem, tab === t.key && styles.tabItemActive]}
            onPress={() => setTab(t.key)}
          >
            <Ionicons name={tabIcons[t.key]} size={16} color={tab === t.key ? colors.white : colors.gray[500]} />
            <Text style={[styles.tabItemText, tab === t.key && styles.tabItemTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'grid' && <GridTab />}
      {tab === 'today' && <TodayTab />}
      {tab === 'shifts' && <ShiftsTab />}
      {tab === 'settings' && <SettingsTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  tabs: { flexDirection: 'row', backgroundColor: colors.white, paddingHorizontal: spacing[3], paddingBottom: spacing[2], paddingTop: spacing[1], gap: spacing[1.5] },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingVertical: spacing[2], borderRadius: borderRadius.lg, backgroundColor: colors.gray[50] },
  tabItemActive: { backgroundColor: colors.primary[600] },
  tabItemText: { fontSize: 12, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabItemTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
  tabContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  empty: { textAlign: 'center', padding: spacing[4], color: colors.gray[400], fontSize: fontSize.sm },
  // Month nav
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  monthNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  monthYear: { fontSize: fontSize.xs, color: colors.gray[400] },
  // Legend
  legendRow: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingBottom: spacing[2], gap: spacing[4] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: colors.gray[500] },
  // Sticky column
  stickyColumn: {
    width: 110,
    backgroundColor: colors.white,
    zIndex: 2,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 2, height: 0 },
    elevation: 4,
    borderRightWidth: 1,
    borderRightColor: colors.gray[200],
  },
  // Grid
  gridHeaderCell: { alignItems: 'center', paddingVertical: spacing[1.5], borderBottomWidth: 2, borderBottomColor: colors.gray[200] },
  gridHeaderDow: { fontSize: 9, color: colors.gray[400], fontWeight: fontWeight.medium },
  gridHeaderDay: { fontSize: 12, color: colors.gray[700] },
  gridHeaderLabel: { fontSize: 10, color: colors.gray[400], fontWeight: fontWeight.semibold },
  gridNameCell: { paddingHorizontal: spacing[2], justifyContent: 'center', borderBottomWidth: 0.5, borderBottomColor: colors.gray[50] },
  gridName: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  gridNameStats: { fontSize: 9, color: colors.gray[400], marginTop: 1 },
  gridCell: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[2.5], borderRightWidth: 0.5, borderRightColor: colors.gray[50], borderBottomWidth: 0.5, borderBottomColor: colors.gray[50] },
  gridCellText: { fontSize: 9, fontWeight: fontWeight.semibold },
  gridCellEmpty: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gray[200] },
  // Quick actions
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], justifyContent: 'center' },
  quickBtn: { alignItems: 'center', width: 80, gap: spacing[1.5] },
  quickIcon: { width: 48, height: 48, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[700], textAlign: 'center' },
  // Today tab
  todayDateHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  todayDateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[600], textTransform: 'capitalize' },
  todayStatsRow: { flexDirection: 'row', gap: spacing[3] },
  todayStatCard: { flex: 1, backgroundColor: colors.white, borderRadius: borderRadius.xl, borderLeftWidth: 3, padding: spacing[3], borderWidth: 1, borderColor: colors.gray[100] },
  todayStatNum: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  todayStatLabel: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  todayCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3.5] },
  todayStatusIcon: { width: 40, height: 40, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  todayName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  todayShift: { fontSize: fontSize.xs, color: colors.gray[400] },
  todayArrival: { fontSize: fontSize.xs, color: colors.primary[600] },
  todayNote: { fontSize: fontSize.xs, color: colors.gray[500], fontStyle: 'italic', marginTop: 2 },
  todayStatusBadge: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  todayStatusText: { fontSize: 10, fontWeight: fontWeight.semibold },
  // Shifts stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statCard: { width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3]) / 2, backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], alignItems: 'center', gap: spacing[1.5] },
  statIcon: { width: 40, height: 40, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  statLabel: { fontSize: 11, color: colors.gray[500], textAlign: 'center' },
  detailCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], gap: spacing[3] },
  detailCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  detailTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  detailValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Settings
  subTabs: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
  subTabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1.5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.gray[100] },
  subTabActive: { backgroundColor: colors.primary[600] },
  subTabText: { fontSize: 12, fontWeight: fontWeight.medium, color: colors.gray[500] },
  subTabTextActive: { color: colors.white },
  // Days off
  daysOffCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3] },
  daysOffName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], marginBottom: spacing[2] },
  daysOffRow: { flexDirection: 'row', gap: spacing[1.5] },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing[2], borderRadius: borderRadius.md, backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[200] },
  dayBtnActive: { backgroundColor: colors.primary[600], borderColor: colors.primary[600] },
  dayBtnText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[500] },
  dayBtnTextActive: { color: colors.white },
  // Work modes
  modeCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3], gap: spacing[3] },
  modeIconWrap: { width: 40, height: 40, borderRadius: borderRadius.lg, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  modeName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  modeInfo: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  modeApplyBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formRowFields: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[100] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[200] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  applyBtn: { paddingHorizontal: spacing[5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  applyBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  userChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[200] },
  userChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  userChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  userChipTextActive: { color: colors.primary[700] },
});
