import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Modal, FlatList, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { reportsApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

function fmt(d: Date) { return d.toISOString().slice(0, 10); }

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function CashFlowScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user, isRole } = useAuth();
  const canFilterByMaster = isRole('director', 'superadmin', 'admin');
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
    queryFn: async () => { const res = await usersApi.getMasters(); return res.data; },
    enabled: canFilterByMaster,
  });

  const { data: cashflow, isLoading } = useQuery<any>({
    queryKey: ['cashflow', dateFrom, dateTo, masterId],
    queryFn: async () => {
      const params: any = { dateFrom, dateTo };
      if (masterId) params.masterId = masterId;
      const res = await reportsApi.getCashFlow(params);
      return res.data;
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    setRefreshing(false);
  };

  const totals = cashflow?.totals || { cash: 0, card: 0, warranty: 0, total: 0 };

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text style={styles.title}>Движение денег</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        {/* Quick period buttons */}
        <View style={styles.quickRow}>
          {[
            { key: 'today' as const, label: 'Сегодня' },
            { key: 'week' as const, label: 'Неделя' },
            { key: 'month' as const, label: 'Месяц' },
          ].map((p) => (
            <TouchableOpacity key={p.key} style={styles.quickBtn} onPress={() => setQuickPeriod(p.key)} activeOpacity={0.7}>
              <Text style={styles.quickBtnText}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date range selector */}
        <View style={styles.dateRow}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => { setDateInput(''); setShowDatePicker('from'); }}>
            <Ionicons name="calendar-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.dateBtnText}>{formatDateLabel(dateFrom)}</Text>
          </TouchableOpacity>
          <Text style={styles.dateSep}>—</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => { setDateInput(''); setShowDatePicker('to'); }}>
            <Ionicons name="calendar-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.dateBtnText}>{formatDateLabel(dateTo)}</Text>
          </TouchableOpacity>
        </View>

        {/* Master filter */}
        {canFilterByMaster && (
          <TouchableOpacity style={styles.masterFilter} onPress={() => setShowMasterPicker(true)} activeOpacity={0.7}>
            <Ionicons name="person-outline" size={16} color={colors.primary[600]} />
            <Text style={styles.masterFilterText}>{masterName || 'Все мастера'}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.gray[400]} />
          </TouchableOpacity>
        )}

        {isLoading ? <LoadingSpinner /> : !cashflow ? (
          <Text style={styles.empty}>Нет данных</Text>
        ) : (
          <>
            {/* Summary cards */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: colors.green[50] }]}>
                <Ionicons name="cash-outline" size={20} color={colors.green[600]} />
                <Text style={styles.summaryLabel}>Наличные</Text>
                <Text style={[styles.summaryValue, { color: colors.green[700] }]}>{formatMoney(totals.cash)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.blue[50] }]}>
                <Ionicons name="card-outline" size={20} color={colors.blue[600]} />
                <Text style={styles.summaryLabel}>Карта</Text>
                <Text style={[styles.summaryValue, { color: colors.blue[700] }]}>{formatMoney(totals.card)}</Text>
              </View>
            </View>

            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: colors.yellow[50] }]}>
                <Ionicons name="shield-outline" size={20} color={colors.yellow[600]} />
                <Text style={styles.summaryLabel}>Гарантия</Text>
                <Text style={[styles.summaryValue, { color: colors.yellow[700] }]}>{formatMoney(totals.warranty)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: colors.primary[50] }]}>
                <Ionicons name="wallet-outline" size={20} color={colors.primary[600]} />
                <Text style={styles.summaryLabel}>Итого</Text>
                <Text style={[styles.summaryValue, { color: colors.gray[900] }]}>{formatMoney(totals.total)}</Text>
              </View>
            </View>

            {/* Daily breakdown */}
            <Text style={styles.sectionTitle}>По дням</Text>
            {(cashflow.days || []).length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="document-text-outline" size={32} color={colors.gray[300]} />
                <Text style={styles.emptyCardText}>Нет данных за выбранный период</Text>
              </View>
            ) : (cashflow.days || []).map((day: any) => (
              <View key={day.date} style={styles.dayCard}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayDate}>
                    {new Date(day.date).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </Text>
                  <Text style={styles.dayTotal}>{formatMoney(day.total)}</Text>
                </View>
                <View style={styles.dayDetails}>
                  {day.cash > 0 && (
                    <View style={styles.dayDetailItem}>
                      <View style={[styles.dayDot, { backgroundColor: colors.green[500] }]} />
                      <Text style={styles.dayDetailText}>Нал: {formatMoney(day.cash)}</Text>
                    </View>
                  )}
                  {day.card > 0 && (
                    <View style={styles.dayDetailItem}>
                      <View style={[styles.dayDot, { backgroundColor: colors.blue[500] }]} />
                      <Text style={styles.dayDetailText}>Карта: {formatMoney(day.card)}</Text>
                    </View>
                  )}
                  {day.warranty > 0 && (
                    <View style={styles.dayDetailItem}>
                      <View style={[styles.dayDot, { backgroundColor: colors.yellow[500] }]} />
                      <Text style={styles.dayDetailText}>Гарант: {formatMoney(day.warranty)}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Master picker modal */}
      <Modal visible={showMasterPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Выберите мастера</Text>
              <TouchableOpacity onPress={() => setShowMasterPicker(false)}>
                <Ionicons name="close" size={22} color={colors.gray[500]} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.masterOption, !masterId && styles.masterOptionActive]}
              onPress={() => { setMasterId(''); setMasterName(''); setShowMasterPicker(false); }}
            >
              <Ionicons name="people-outline" size={18} color={!masterId ? colors.primary[600] : colors.gray[500]} />
              <Text style={[styles.masterOptionText, !masterId && { color: colors.primary[600], fontWeight: fontWeight.bold }]}>Все мастера</Text>
            </TouchableOpacity>
            <FlatList
              data={masters || []}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.masterOption, masterId === item.id && styles.masterOptionActive]}
                  onPress={() => { setMasterId(item.id); setMasterName(item.fullName); setShowMasterPicker(false); }}
                >
                  <View style={styles.masterAvatar}>
                    <Text style={styles.masterAvatarText}>{item.fullName?.charAt(0) || '?'}</Text>
                  </View>
                  <Text style={[styles.masterOptionText, masterId === item.id && { color: colors.primary[600], fontWeight: fontWeight.bold }]}>{item.fullName}</Text>
                  {masterId === item.id && <Ionicons name="checkmark-circle" size={18} color={colors.primary[600]} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Date input modal */}
      <Modal visible={showDatePicker !== null} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDatePicker(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.dateModal}>
            <Text style={styles.modalTitle}>{showDatePicker === 'from' ? 'Дата начала' : 'Дата окончания'}</Text>
            <TextInput
              style={styles.dateInput}
              placeholder="ДД.ММ.ГГГГ"
              placeholderTextColor={colors.gray[400]}
              value={dateInput}
              onChangeText={setDateInput}
              keyboardType="numeric"
              autoFocus
              onSubmitEditing={handleDateConfirm}
            />
            <View style={styles.dateModalBtns}>
              <TouchableOpacity style={styles.dateModalCancel} onPress={() => setShowDatePicker(null)}>
                <Text style={styles.dateModalCancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateModalConfirm} onPress={handleDateConfirm}>
                <Text style={styles.dateModalConfirmText}>ОК</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  empty: { textAlign: 'center', padding: spacing[8], color: colors.gray[400] },

  // Quick period
  quickRow: { flexDirection: 'row', gap: spacing[2] },
  quickBtn: {
    flex: 1, paddingVertical: spacing[2], borderRadius: borderRadius.lg,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], alignItems: 'center',
  },
  quickBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[700] },

  // Date range
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[1.5],
    backgroundColor: colors.white, borderRadius: borderRadius.lg, borderWidth: 1,
    borderColor: colors.gray[200], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3],
  },
  dateBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  dateSep: { color: colors.gray[400], fontSize: fontSize.sm },

  // Master filter
  masterFilter: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.white, borderRadius: borderRadius.lg, borderWidth: 1,
    borderColor: colors.primary[200], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3],
  },
  masterFilterText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },

  // Summary
  summaryRow: { flexDirection: 'row', gap: spacing[2] },
  summaryCard: {
    flex: 1, borderRadius: borderRadius.xl, padding: spacing[3], alignItems: 'center', gap: 4,
  },
  summaryLabel: { fontSize: 10, color: colors.gray[500] },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  // Section
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[800], marginTop: spacing[1] },

  // Empty card
  emptyCard: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl, padding: spacing[8],
    alignItems: 'center', gap: spacing[2], borderWidth: 1, borderColor: colors.gray[100],
  },
  emptyCardText: { fontSize: fontSize.sm, color: colors.gray[400] },

  // Day cards
  dayCard: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[4],
  },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  dayTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  dayDetails: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  dayDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayDot: { width: 6, height: 6, borderRadius: 3 },
  dayDetailText: { fontSize: fontSize.xs, color: colors.gray[500] },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: colors.white, borderTopLeftRadius: borderRadius['2xl'],
    borderTopRightRadius: borderRadius['2xl'], maxHeight: '60%', paddingBottom: spacing[8],
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing[4], borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  modalTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  masterOption: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingVertical: spacing[3], paddingHorizontal: spacing[4],
  },
  masterOptionActive: { backgroundColor: colors.primary[50] },
  masterOptionText: { flex: 1, fontSize: fontSize.sm, color: colors.gray[700] },
  masterAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary[100],
    alignItems: 'center', justifyContent: 'center',
  },
  masterAvatarText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[700] },

  // Date modal
  dateModal: {
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'], margin: spacing[6],
    padding: spacing[5], gap: spacing[4],
  },
  dateInput: {
    borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg,
    paddingVertical: spacing[3], paddingHorizontal: spacing[4],
    fontSize: fontSize.lg, color: colors.gray[900], textAlign: 'center',
  },
  dateModalBtns: { flexDirection: 'row', gap: spacing[3] },
  dateModalCancel: { flex: 1, paddingVertical: spacing[3], alignItems: 'center', borderRadius: borderRadius.lg, backgroundColor: colors.gray[100] },
  dateModalCancelText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[600] },
  dateModalConfirm: { flex: 1, paddingVertical: spacing[3], alignItems: 'center', borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  dateModalConfirmText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
});
