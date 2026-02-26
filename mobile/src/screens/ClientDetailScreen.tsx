import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi, checksApi } from '../api/services';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car, Check } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export default function ClientDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { id } = route.params;
  const [refreshing, setRefreshing] = useState(false);

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

  const paymentLabels: Record<string, string> = { cash: 'Нал', card: 'Карта', warranty: 'Гарант', cash_card: 'Нал/Карта' };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{client.fullName}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* Client info card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Информация</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Телефон</Text>
            <Text style={styles.infoValue}>{client.phone}</Text>
          </View>
          {client.comment && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Комментарий</Text>
              <Text style={styles.infoValue}>{client.comment}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Дата</Text>
            <Text style={styles.infoValue}>{formatDate(client.createdAt)}</Text>
          </View>
        </View>

        {/* Cars */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Автомобили ({client.cars?.length || 0})</Text>
          <TouchableOpacity style={styles.smallBtn} onPress={openAddCar}>
            <Text style={styles.smallBtnText}>+ Добавить</Text>
          </TouchableOpacity>
        </View>

        {(client.cars || []).map(car => (
          <View key={car.id} style={styles.carCard}>
            <View style={styles.carTop}>
              <View>
                <Text style={styles.carModel}>{car.makeModel}</Text>
                <Text style={styles.carPlate}>{car.plateNumber}</Text>
              </View>
              <View style={styles.carActions}>
                <TouchableOpacity onPress={() => openEditCar(car)} style={styles.iconBtn}>
                  <Text style={styles.iconBtnText}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDeleteCarId(car.id)} style={styles.iconBtn}>
                  <Text style={[styles.iconBtnText, { color: colors.red[400] }]}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            {car.comment && <Text style={styles.carComment}>{car.comment}</Text>}
          </View>
        ))}

        {/* Recent checks */}
        <Text style={[styles.sectionTitle, { marginTop: spacing[6] }]}>
          Последние чеки ({checks?.length || 0})
        </Text>
        {(checks || []).slice(0, 20).map(check => (
          <TouchableOpacity
            key={check.id}
            style={styles.checkCard}
            onPress={() => navigation.navigate('CheckDetail', { id: check.id })}
          >
            <View style={styles.checkTop}>
              <Text style={styles.checkNumber}>#{check.number}</Text>
              <Text style={styles.checkDate}>{formatDate(check.date)}</Text>
            </View>
            <View style={styles.checkBottom}>
              <Text style={styles.checkMaster}>{check.master?.fullName || '—'}</Text>
              <Text style={styles.checkAmount}>{formatMoney(check.totalRevenue)}</Text>
            </View>
            {check.car && (
              <Text style={styles.checkCar}>{check.car.makeModel} · {check.car.plateNumber}</Text>
            )}
          </TouchableOpacity>
        ))}
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
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginBottom: spacing[3] },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  infoLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, textAlign: 'right' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[4] },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  smallBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
  smallBtnText: { color: colors.white, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  carCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], marginTop: spacing[2] },
  carTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carModel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  carPlate: { fontSize: fontSize.sm, color: colors.gray[500], marginTop: 2 },
  carActions: { flexDirection: 'row', gap: spacing[1] },
  iconBtn: { padding: spacing[1.5] },
  iconBtnText: { fontSize: 14, color: colors.gray[400] },
  carComment: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: spacing[2] },
  checkCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], marginTop: spacing[2] },
  checkTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkNumber: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  checkDate: { fontSize: fontSize.xs, color: colors.gray[400] },
  checkBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[1] },
  checkMaster: { fontSize: fontSize.sm, color: colors.gray[500] },
  checkAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  checkCar: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1] },
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
