import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { scheduleApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { TodayEmployeeStatus, ScheduleEntry, User } from '../../../shared/types';

type TabType = 'today' | 'schedule' | 'settings';

const DAY_ABBR = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= count; i++) {
    days.push(new Date(year, month, i));
  }
  return days;
}

// ── Today Tab ──
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
  const isSick = (s: TodayEmployeeStatus) => (s.note || '').toLowerCase().includes('больнич');

  const getStatusInfo = (s: TodayEmployeeStatus) => {
    if (isSick(s)) return { label: 'Больничный', color: colors.rose[400], emoji: '🏥' };
    if (s.isDayOff) return { label: 'Выходной', color: colors.gray[400], emoji: '🌙' };
    if (s.lateStatus === 'late_major') return { label: 'Опоздание > 1ч', color: colors.orange[500], emoji: '⚠️' };
    if (s.lateStatus === 'late_minor') return { label: 'Опоздание < 1ч', color: colors.yellow[400], emoji: '⏰' };
    if (s.isWorking) return { label: 'На смене', color: colors.green[500], emoji: '✅' };
    if (s.hasSchedule) return { label: 'Не пришёл', color: colors.gray[300], emoji: '❌' };
    return { label: '—', color: colors.gray[200], emoji: '' };
  };

  // Group
  const onShift = statuses.filter(s => s.isWorking && !s.isDayOff && !isSick(s));
  const notArrived = statuses.filter(s => !s.isWorking && !s.isDayOff && s.hasSchedule && !isSick(s));
  const dayOff = statuses.filter(s => s.isDayOff && !isSick(s));
  const sick = statuses.filter(s => isSick(s));

  const renderGroup = (title: string, icon: string, items: TodayEmployeeStatus[]) => {
    if (items.length === 0) return null;
    return (
      <View style={styles.groupSection}>
        <Text style={styles.groupTitle}>{icon} {title} ({items.length})</Text>
        {items.map(s => {
          const info = getStatusInfo(s);
          return (
            <View key={s.userId} style={styles.empCard}>
              <View style={styles.empCardRow}>
                <View style={[styles.statusDot, { backgroundColor: info.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{s.fullName}</Text>
                  {s.shiftStart && s.shiftEnd && (
                    <Text style={styles.empShift}>{s.shiftStart} — {s.shiftEnd}</Text>
                  )}
                </View>
                <View style={styles.statusRight}>
                  <Text style={{ fontSize: 16 }}>{info.emoji}</Text>
                  <Text style={styles.statusLabel}>{info.label}</Text>
                </View>
              </View>
              {s.actualArrival && (
                <Text style={styles.arrivalText}>Пришёл: {new Date(s.actualArrival).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text>
              )}
              {s.note && <Text style={styles.noteText}>{s.note}</Text>}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.tabContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
      {isLoading ? <LoadingSpinner /> : statuses.length === 0 ? (
        <Text style={styles.empty}>Расписание не настроено</Text>
      ) : (
        <>
          {renderGroup('На смене', '🟢', onShift)}
          {renderGroup('Ещё не пришёл', '⏳', notArrived)}
          {renderGroup('Выходной', '🌙', dayOff)}
          {renderGroup('Больничный', '🏥', sick)}
        </>
      )}
    </ScrollView>
  );
}

// ── Calendar Tab ──
function CalendarTab() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canEdit = user?.role === 'director' || user?.role === 'superadmin' || user?.role === 'admin';
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<ScheduleEntry | null>(null);
  const [formUserId, setFormUserId] = useState('');
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('18:00');
  const [formIsDayOff, setFormIsDayOff] = useState(false);
  const [formNote, setFormNote] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const dateFrom = formatDate(new Date(year, month, 1));
  const dateTo = formatDate(new Date(year, month + 1, 0));

  const { data: entries, isLoading } = useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', dateFrom, dateTo],
    queryFn: async () => { const res = await scheduleApi.getAll({ dateFrom, dateTo }); return res.data; },
  });

  const { data: usersData } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => scheduleApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Не удалось создать запись'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => scheduleApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['schedule'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Не удалось обновить'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  const days = getDaysInMonth(year, month);
  const firstDayOffset = (days[0].getDay() + 6) % 7; // Mon=0

  const entryMap = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    (entries ?? []).forEach(e => {
      const d = e.date?.split('T')[0] || '';
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    });
    return map;
  }, [entries]);

  const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

  const openAddEntry = (date: string) => {
    setSelectedDate(date);
    setEditEntry(null);
    setFormUserId(usersData?.[0]?.id || '');
    setFormStart('09:00');
    setFormEnd('18:00');
    setFormIsDayOff(false);
    setFormNote('');
    setModalOpen(true);
  };

  const openEditEntry = (entry: ScheduleEntry) => {
    setSelectedDate(entry.date?.split('T')[0] || '');
    setEditEntry(entry);
    setFormUserId(entry.userId);
    setFormStart(entry.shiftStart || '09:00');
    setFormEnd(entry.shiftEnd || '18:00');
    setFormIsDayOff(entry.isDayOff || false);
    setFormNote(entry.note || '');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditEntry(null); };

  const handleSubmit = () => {
    const payload = {
      userId: formUserId,
      date: selectedDate,
      shiftStart: formIsDayOff ? undefined : formStart,
      shiftEnd: formIsDayOff ? undefined : formEnd,
      isDayOff: formIsDayOff,
      note: formNote || undefined,
    };
    if (editEntry) {
      updateMutation.mutate({ id: editEntry.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const today = formatDate(new Date());

  const dayEntries = selectedDate ? (entryMap.get(selectedDate) || []) : [];

  return (
    <ScrollView contentContainerStyle={styles.tabContent}>
      {/* Month navigation */}
      <View style={styles.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={styles.monthNavBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.gray[600]} />
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{MONTH_NAMES[month]} {year}</Text>
        <TouchableOpacity onPress={nextMonth} style={styles.monthNavBtn}>
          <Ionicons name="chevron-forward" size={20} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={styles.calRow}>
        {DAY_ABBR.map(d => (
          <View key={d} style={styles.calHeaderCell}>
            <Text style={styles.calHeaderText}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      {isLoading ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary[600]} /> : (
        <View style={styles.calGrid}>
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <View key={`empty-${i}`} style={styles.calCell} />
          ))}
          {days.map(d => {
            const ds = formatDate(d);
            const isToday = ds === today;
            const dayEnts = entryMap.get(ds) || [];
            const hasWork = dayEnts.some(e => !e.isDayOff);
            const hasDayOff = dayEnts.some(e => e.isDayOff);

            return (
              <TouchableOpacity
                key={ds}
                style={[styles.calCell, isToday && styles.calCellToday]}
                onPress={() => canEdit ? openAddEntry(ds) : setSelectedDate(ds)}
              >
                <Text style={[styles.calDayText, isToday && styles.calDayTextToday]}>{d.getDate()}</Text>
                <View style={styles.calDots}>
                  {hasWork && <View style={[styles.calDot, { backgroundColor: colors.green[500] }]} />}
                  {hasDayOff && <View style={[styles.calDot, { backgroundColor: colors.gray[400] }]} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Selected day entries */}
      {selectedDate && (
        <View style={styles.selectedDay}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={styles.selectedDayTitle}>
              {new Date(selectedDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
            </Text>
            {canEdit && (
              <TouchableOpacity style={styles.addEntryBtn} onPress={() => openAddEntry(selectedDate)}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
                <Text style={styles.addEntryText}>Добавить</Text>
              </TouchableOpacity>
            )}
          </View>
          {dayEntries.length === 0 ? (
            <Text style={styles.noEntries}>Нет записей</Text>
          ) : (
            dayEntries.map(e => (
              <TouchableOpacity key={e.id} style={styles.entryCard} onPress={() => canEdit && openEditEntry(e)}>
                <View style={styles.entryRow}>
                  <View style={[styles.entryDot, { backgroundColor: e.isDayOff ? colors.gray[400] : colors.green[500] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryName}>{e.user?.fullName || 'Сотрудник'}</Text>
                    <Text style={styles.entryInfo}>
                      {e.isDayOff ? 'Выходной' : `${e.shiftStart} — ${e.shiftEnd}`}
                    </Text>
                    {e.note && <Text style={styles.entryNote}>{e.note}</Text>}
                  </View>
                  {canEdit && (
                    <TouchableOpacity onPress={() => setDeleteId(e.id)} style={{ padding: spacing[1] }}>
                      <Ionicons name="trash-outline" size={16} color={colors.red[400]} />
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* Add/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editEntry ? 'Редактировать' : 'Добавить в расписание'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сотрудник</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              {(usersData || []).filter(u => u.isActive).map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={[styles.userChip, formUserId === u.id && styles.userChipActive]}
                  onPress={() => setFormUserId(u.id)}
                >
                  <Text style={[styles.userChipText, formUserId === u.id && styles.userChipTextActive]}>{u.fullName?.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        <TouchableOpacity
          style={[styles.dayOffToggle, formIsDayOff && styles.dayOffToggleActive]}
          onPress={() => setFormIsDayOff(!formIsDayOff)}
        >
          <Ionicons name={formIsDayOff ? 'checkbox' : 'square-outline'} size={20} color={formIsDayOff ? colors.primary[600] : colors.gray[400]} />
          <Text style={styles.dayOffToggleText}>Выходной</Text>
        </TouchableOpacity>

        {!formIsDayOff && (
          <View style={styles.formRowFields}>
            <View style={{ flex: 1 }}>
              <Text style={styles.formLabel}>Начало</Text>
              <TextInput value={formStart} onChangeText={setFormStart} style={styles.formInput} placeholder="09:00" placeholderTextColor={colors.gray[400]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.formLabel}>Конец</Text>
              <TextInput value={formEnd} onChangeText={setFormEnd} style={styles.formInput} placeholder="18:00" placeholderTextColor={colors.gray[400]} />
            </View>
          </View>
        )}

        <View style={styles.formField}>
          <Text style={styles.formLabel}>Заметка</Text>
          <TextInput value={formNote} onChangeText={setFormNote} style={styles.formInput} placeholder="Опционально" placeholderTextColor={colors.gray[400]} />
        </View>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {(createMutation.isPending || updateMutation.isPending) ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editEntry ? 'Сохранить' : 'Добавить'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить запись"
        message="Удалить эту запись расписания?"
        confirmText="Удалить"
        variant="danger"
      />
    </ScrollView>
  );
}

// ── Main Screen ──
export default function ScheduleScreen() {
  const navigation = useNavigation<any>();
  const [tab, setTab] = useState<TabType>('today');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Расписание</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['today', 'schedule'] as TabType[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.tabItem, tab === t && styles.tabItemActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabItemText, tab === t && styles.tabItemTextActive]}>
              {t === 'today' ? 'Сегодня' : 'Календарь'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'today' ? <TodayTab /> : <CalendarTab />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  tabs: { flexDirection: 'row', backgroundColor: colors.white, paddingHorizontal: spacing[4], paddingBottom: spacing[2], gap: spacing[1] },
  tabItem: { flex: 1, paddingVertical: spacing[2.5], alignItems: 'center', borderRadius: borderRadius.lg, backgroundColor: colors.gray[50] },
  tabItemActive: { backgroundColor: colors.primary[600] },
  tabItemText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabItemTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
  tabContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Today tab
  empty: { textAlign: 'center', padding: spacing[8], color: colors.gray[400] },
  groupSection: { gap: spacing[2] },
  groupTitle: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 1 },
  empCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  empCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empShift: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  statusRight: { alignItems: 'center', gap: 4 },
  statusLabel: { fontSize: 10, color: colors.gray[500] },
  arrivalText: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[2] },
  noteText: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: spacing[1], fontStyle: 'italic' },
  // Calendar
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  monthNavBtn: { padding: spacing[2], borderRadius: borderRadius.lg, backgroundColor: colors.gray[100] },
  monthTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  calRow: { flexDirection: 'row' },
  calHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: spacing[1] },
  calHeaderText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[400] },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: '14.28%', alignItems: 'center', paddingVertical: spacing[2], borderRadius: borderRadius.md },
  calCellToday: { backgroundColor: colors.primary[50] },
  calDayText: { fontSize: fontSize.sm, color: colors.gray[700] },
  calDayTextToday: { fontWeight: fontWeight.bold, color: colors.primary[600] },
  calDots: { flexDirection: 'row', gap: 2, marginTop: 2, height: 6 },
  calDot: { width: 5, height: 5, borderRadius: 3 },
  // Selected day
  selectedDay: { marginTop: spacing[4], gap: spacing[3] },
  selectedDayTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addEntryBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], backgroundColor: colors.primary[50], borderRadius: borderRadius.lg },
  addEntryText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.primary[600] },
  noEntries: { textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] },
  entryCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3] },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  entryDot: { width: 10, height: 10, borderRadius: 5 },
  entryName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  entryInfo: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  entryNote: { fontSize: fontSize.xs, color: colors.gray[500], fontStyle: 'italic', marginTop: 2 },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formRowFields: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  userChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, backgroundColor: colors.gray[100], borderWidth: 1, borderColor: colors.gray[200] },
  userChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  userChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  userChipTextActive: { color: colors.primary[700] },
  dayOffToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[3], marginBottom: spacing[3] },
  dayOffToggleActive: {},
  dayOffToggleText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
});
