import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi, checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Client, Car, Check } from '../../../shared/types';

const paymentLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', warranty: 'Гарантия', cash_card: 'Нал/Карта' };

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatDateGroup(d: string) {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Сегодня';
  if (dt.toDateString() === yesterday.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

const avatarColors = [
  colors.primary[500], colors.green[600], colors.orange[500],
  colors.purple[700], colors.teal[600], colors.rose[500],
  colors.indigo[600], colors.yellow[600],
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const carIconColors = [
  colors.primary[500], colors.green[600], colors.orange[500],
  colors.purple[700], colors.teal[600], colors.rose[500],
];

function getCarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return carIconColors[Math.abs(hash) % carIconColors.length];
}

export default function ClientDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canViewProfit = hasPermission('profit_view');
  const { id } = route.params;
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);

  // Car modal state
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<Car | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [carComment, setCarComment] = useState('');
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => { const res = await clientsApi.getById(id); return res.data; },
  });

  const { data: checks } = useQuery<Check[]>({
    queryKey: ['client-checks', id],
    queryFn: async () => { const res = await checksApi.getAll({ clientId: id, limit: 50 }); return res.data.data || res.data; },
  });

  const filteredChecks = useMemo(() => {
    if (!checks) return [];
    if (!selectedCarId) return checks;
    return checks.filter(c => c.car?.id === selectedCarId);
  }, [checks, selectedCarId]);

  const totalSpent = useMemo(() => {
    return (checks || []).reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
  }, [checks]);

  const createCarMutation = useMutation({
    mutationFn: (d: any) => carsApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client', id] }); closeCarModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании авто'),
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: any }) => carsApi.update(carId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client', id] }); closeCarModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении авто'),
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', id] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении авто'),
  });

  const closeCarModal = () => { setCarModalOpen(false); setEditingCar(null); };

  const openAddCar = () => {
    setEditingCar(null);
    setPlateNumber('');
    setMakeModel('');
    setCarComment('');
    setCarModalOpen(true);
  };

  const openEditCar = (car: Car) => {
    setEditingCar(car);
    setPlateNumber(car.plateNumber);
    setMakeModel(car.makeModel);
    setCarComment(car.comment || '');
    setCarModalOpen(true);
  };

  const handleCarSubmit = () => {
    const payload = { plateNumber, makeModel, comment: carComment || undefined, clientId: id };
    if (editingCar) {
      updateCarMutation.mutate({ carId: editingCar.id, data: payload });
    } else {
      createCarMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['client', id] });
    await queryClient.invalidateQueries({ queryKey: ['client-checks', id] });
    setRefreshing(false);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!client) return <Text style={{ padding: 20, textAlign: 'center' }}>Клиент не найден</Text>;

  // Group filtered checks by date
  const groupedChecks: { label: string; checks: Check[] }[] = [];
  let lastGroup = '';
  for (const check of filteredChecks) {
    const group = formatDateGroup(check.date);
    if (group !== lastGroup) {
      groupedChecks.push({ label: group, checks: [check] });
      lastGroup = group;
    } else {
      groupedChecks[groupedChecks.length - 1].checks.push(check);
    }
  }

  const initials = getInitials(client.fullName);
  const avatarColor = getAvatarColor(client.fullName);
  const cars = client.cars || [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{client.fullName}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* Client info card */}
        <AnimatedCard style={styles.card} index={0}>
          {/* Avatar + name */}
          <View style={styles.avatarSection}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.clientName}>{client.fullName}</Text>
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{checks?.length || 0}</Text>
              <Text style={styles.statLabel}>чеков</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatMoney(totalSpent)}</Text>
              <Text style={styles.statLabel}>потрачено</Text>
            </View>
          </View>

          {/* Info rows */}
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={15} color={colors.gray[400]} />
            <Text style={styles.infoLabel}>Телефон</Text>
            <Text style={styles.infoValue}>{client.phone}</Text>
          </View>
          {client.comment && (
            <View style={styles.infoRow}>
              <Ionicons name="chatbubble-outline" size={15} color={colors.gray[400]} />
              <Text style={styles.infoLabel}>Комментарий</Text>
              <Text style={styles.infoValue}>{client.comment}</Text>
            </View>
          )}
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Ionicons name="calendar-outline" size={15} color={colors.gray[400]} />
            <Text style={styles.infoLabel}>Дата</Text>
            <Text style={styles.infoValue}>{formatDate(client.createdAt)}</Text>
          </View>
        </AnimatedCard>

        {/* Cars */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Автомобили ({cars.length})</Text>
          <TouchableOpacity style={styles.smallBtn} onPress={openAddCar}>
            <Text style={styles.smallBtnText}>+ Добавить</Text>
          </TouchableOpacity>
        </View>

        {cars.map((car, idx) => {
          const carColor = getCarColor(car.id);
          return (
            <AnimatedCard key={car.id} style={styles.carCard} index={idx + 1}>
              <View style={styles.carTop}>
                <View style={styles.carInfo}>
                  <View style={[styles.carIconWrap, { backgroundColor: carColor + '18' }]}>
                    <Ionicons name="car-sport" size={16} color={carColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carModel} numberOfLines={1}>{car.makeModel}</Text>
                    <Text style={styles.carPlate}>{car.plateNumber}</Text>
                  </View>
                </View>
                <View style={styles.carActions}>
                  <TouchableOpacity onPress={() => openEditCar(car)} style={styles.iconBtn}>
                    <Ionicons name="create-outline" size={15} color={colors.gray[400]} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setDeleteCarId(car.id)} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={15} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
              </View>
              {car.comment && <Text style={styles.carComment}>{car.comment}</Text>}
            </AnimatedCard>
          );
        })}

        {/* Checks section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Чеки ({filteredChecks.length})
          </Text>
        </View>

        {/* Car filter chips */}
        {cars.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carChipsScroll}>
            <View style={styles.carChipsRow}>
              <TouchableOpacity
                style={[styles.carChip, !selectedCarId && styles.carChipActive]}
                onPress={() => setSelectedCarId(null)}
              >
                <Text style={[styles.carChipText, !selectedCarId && styles.carChipTextActive]}>Все авто</Text>
              </TouchableOpacity>
              {cars.map(car => (
                <TouchableOpacity
                  key={car.id}
                  style={[styles.carChip, selectedCarId === car.id && styles.carChipActive]}
                  onPress={() => setSelectedCarId(selectedCarId === car.id ? null : car.id)}
                >
                  <Text style={[styles.carChipText, selectedCarId === car.id && styles.carChipTextActive]} numberOfLines={1}>
                    {car.makeModel} · {car.plateNumber}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Grouped checks list */}
        {filteredChecks.length === 0 ? (
          <View style={styles.emptyChecks}>
            <Ionicons name="receipt-outline" size={32} color={colors.gray[300]} />
            <Text style={styles.emptyChecksText}>Нет чеков</Text>
          </View>
        ) : (
          groupedChecks.map((group, gi) => (
            <View key={group.label + gi}>
              {/* Date group header */}
              <View style={styles.dateGroupHeader}>
                <View style={styles.dateGroupLine} />
                <Text style={styles.dateGroupText}>{group.label}</Text>
                <View style={styles.dateGroupLine} />
              </View>

              {group.checks.map((check, ci) => {
                const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
                const badge = badgeColors[badgeKey];
                return (
                  <TouchableOpacity
                    key={check.id}
                    style={[styles.checkCard, check.isDeferred && styles.checkCardDeferred]}
                    onPress={() => navigation.navigate('CheckDetail', { id: check.id })}
                    activeOpacity={0.7}
                  >
                    {/* Left accent bar */}
                    <View style={[styles.accentBar, check.isDeferred ? { backgroundColor: colors.red[400] } : { backgroundColor: colors.primary[400] }]} />

                    <View style={styles.checkContent}>
                      {/* Top row: number + badges | total */}
                      <View style={styles.checkHeader}>
                        <View style={styles.checkHeaderLeft}>
                          <Text style={styles.checkNumber}>#{check.number}</Text>
                          {check.isDeferred && (
                            <View style={styles.deferredBadge}>
                              <Text style={styles.deferredText}>Отложен</Text>
                            </View>
                          )}
                          <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
                            <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
                              {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.checkTotal}>{formatMoney(check.totalRevenue)}</Text>
                      </View>

                      {/* Middle: car info chip */}
                      {check.car && (
                        <View style={styles.checkInfoRow}>
                          <View style={styles.infoChip}>
                            <Ionicons name="car-outline" size={11} color={colors.gray[400]} />
                            <Text style={styles.infoChipText} numberOfLines={1}>{check.car.makeModel}</Text>
                            {check.car.plateNumber && (
                              <Text style={styles.plateTag}>{check.car.plateNumber}</Text>
                            )}
                          </View>
                        </View>
                      )}

                      {/* Comment preview */}
                      {check.comment && (
                        <Text style={styles.commentText} numberOfLines={1}>{check.comment}</Text>
                      )}

                      {/* Footer: time | master | profit */}
                      <View style={styles.checkFooter}>
                        <Text style={styles.footerTime}>
                          {new Date(check.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {check.master && <Text style={styles.footerMaster}>{check.master.fullName}</Text>}
                        {canViewProfit && check.profit !== undefined && (
                          <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
                            {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {/* Car Modal */}
      <Modal visible={carModalOpen} onClose={closeCarModal} title={editingCar ? 'Редактировать авто' : 'Добавить авто'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Гос. номер</Text>
          <TextInput value={plateNumber} onChangeText={setPlateNumber} style={styles.formInput} placeholder="А000АА 00" autoCapitalize="characters" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Марка и модель</Text>
          <TextInput value={makeModel} onChangeText={setMakeModel} style={styles.formInput} placeholder="Toyota Camry" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput value={carComment} onChangeText={setCarComment} style={[styles.formInput, { height: 80, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeCarModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCarSubmit}>
            <Text style={styles.submitBtnText}>{editingCar ? 'Сохранить' : 'Добавить'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete car confirm */}
      <ConfirmDialog
        visible={!!deleteCarId}
        onClose={() => setDeleteCarId(null)}
        onConfirm={() => { if (deleteCarId) deleteCarMutation.mutate(deleteCarId); setDeleteCarId(null); }}
        title="Удалить авто"
        message="Вы уверены?"
        confirmText="Удалить"
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backBtn: { width: 60 },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },

  // Client info card
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  avatarSection: { alignItems: 'center', marginBottom: spacing[3] },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2] },
  avatarText: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.white },
  clientName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gray[50], borderRadius: borderRadius.xl, paddingVertical: spacing[2.5], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  statLabel: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.gray[200], marginHorizontal: spacing[3] },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  infoLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, textAlign: 'right' },

  // Section
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[4] },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  smallBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
  smallBtnText: { color: colors.white, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // Car cards
  carCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], marginTop: spacing[2] },
  carTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  carIconWrap: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  carModel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  carPlate: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 1 },
  carActions: { flexDirection: 'row', gap: spacing[0.5] },
  iconBtn: { padding: spacing[1.5], borderRadius: borderRadius.md },
  carComment: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1.5], marginLeft: spacing[10] },

  // Car filter chips
  carChipsScroll: { marginTop: spacing[2] },
  carChipsRow: { flexDirection: 'row', gap: spacing[1.5] },
  carChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, backgroundColor: colors.gray[100], borderWidth: 1, borderColor: colors.gray[200] },
  carChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  carChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600], maxWidth: 160 },
  carChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },

  // Date group headers
  dateGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2.5], marginTop: spacing[1] },
  dateGroupLine: { flex: 1, height: 1, backgroundColor: colors.gray[200] },
  dateGroupText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 0.5 },

  // Check card — compact with left accent
  checkCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.gray[100],
    marginTop: spacing[2],
  },
  checkCardDeferred: { backgroundColor: '#fef8f8', borderColor: colors.red[100] },
  accentBar: { width: 3.5 },
  checkContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },

  // Check header row
  checkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1.5] },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deferredBadge: { backgroundColor: colors.red[100], paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Info chips row
  checkInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5], marginBottom: spacing[1] },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoChipText: { fontSize: 12, color: colors.gray[600], maxWidth: 120 },
  plateTag: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.primary[700], backgroundColor: colors.primary[50], paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden', marginLeft: 2 },

  // Comment
  commentText: { fontSize: 11, color: colors.amber[600], fontStyle: 'italic', marginBottom: spacing[1] },

  // Check footer
  checkFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footerTime: { fontSize: 11, color: colors.gray[400] },
  footerMaster: { fontSize: 11, color: colors.gray[400], flex: 1 },
  footerProfit: { fontSize: 11, fontWeight: fontWeight.bold },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },

  // Empty checks
  emptyChecks: { alignItems: 'center', paddingVertical: spacing[8] },
  emptyChecksText: { fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] },

  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
