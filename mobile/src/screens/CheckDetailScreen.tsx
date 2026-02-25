import React from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check } from '../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatDateTime(d: string) { const dt = new Date(d); return formatDate(d) + ' ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

const paymentLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', warranty: 'Гарантия', cash_card: 'Нал/Карта' };

export default function CheckDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { id } = route.params;

  const { data: check, isLoading } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => { const res = await checksApi.getById(id); return res.data; },
  });

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      navigation.goBack();
    },
  });

  if (isLoading) return <LoadingSpinner />;
  if (!check) return <Text style={{ padding: 20, textAlign: 'center' }}>Чек не найден</Text>;

  const canEdit = hasPermission('checks_edit');
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Чек #{check.number}</Text>
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {canEdit && (
            <TouchableOpacity onPress={() => navigation.navigate('CheckCreate', { id: check.id })}>
              <Text style={styles.editText}>✎</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={() => {
              Alert.alert('Удалить?', 'Это действие необратимо', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
              ]);
            }}>
              <Text style={styles.deleteText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Info card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Дата</Text>
            <Text style={styles.infoValue}>{formatDateTime(check.date)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Клиент</Text>
            <Text style={styles.infoValue}>{check.client?.fullName ?? 'Розничный покупатель'}</Text>
          </View>
          {check.car && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Авто</Text>
              <Text style={styles.infoValue}>{check.car.makeModel} · {check.car.plateNumber}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Мастер</Text>
            <Text style={styles.infoValue}>{check.master?.fullName ?? '—'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Оплата</Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.text }]}>
                {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
              </Text>
            </View>
          </View>
          {check.mileage ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Пробег</Text>
              <Text style={styles.infoValue}>{check.mileage} км</Text>
            </View>
          ) : null}
          {check.comment && (
            <View style={[styles.infoRow, { flexDirection: 'column', gap: 4 }]}>
              <Text style={styles.infoLabel}>Комментарий</Text>
              <Text style={[styles.infoValue, { textAlign: 'left' }]}>{check.comment}</Text>
            </View>
          )}
        </View>

        {/* Services */}
        {check.services.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Услуги</Text>
            {check.services.map((line, idx) => (
              <View key={idx} style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  {line.master && <Text style={styles.lineSub}>{line.master.fullName}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.linePrice}>{formatMoney(line.total)}</Text>
                  {line.quantity > 1 && <Text style={styles.lineSub}>{line.quantity} × {formatMoney(line.price)}</Text>}
                </View>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Итого услуги</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.serviceTotal)}</Text>
            </View>
          </View>
        )}

        {/* Products */}
        {check.products.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Товары</Text>
            {check.products.map((line, idx) => (
              <View key={idx} style={styles.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.linePrice}>{formatMoney(line.totalSell)}</Text>
                  {line.quantity > 1 && <Text style={styles.lineSub}>{line.quantity} × {formatMoney(line.sellPrice)}</Text>}
                </View>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Итого товары</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.productTotal)}</Text>
            </View>
          </View>
        )}

        {/* Total summary */}
        <View style={styles.totalCard}>
          {(check.discount ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Скидка</Text>
              <Text style={[styles.totalValue, { color: colors.orange[500] }]}>-{formatMoney(check.discount ?? 0)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalFinalLabel}>Итого</Text>
            <Text style={styles.totalFinalValue}>{formatMoney(check.totalRevenue)}</Text>
          </View>
          {canViewProfit && (
            <View style={[styles.totalRow, { borderTopWidth: 1, borderTopColor: colors.gray[200], marginTop: spacing[2], paddingTop: spacing[2] }]}>
              <Text style={styles.totalLabel}>Прибыль</Text>
              <Text style={[styles.totalFinalValue, check.profit >= 0 ? { color: colors.green[600] } : { color: colors.red[500] }]}>
                {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  editText: { fontSize: 18, color: colors.primary[600] },
  deleteText: { fontSize: 18, color: colors.red[500] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginBottom: spacing[3] },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  infoLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, textAlign: 'right' },
  badge: { paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full },
  badgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2.5], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  lineSub: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  linePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  subtotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing[3], marginTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  subtotalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  subtotalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 2, borderColor: colors.primary[100], padding: spacing[4] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1.5] },
  totalLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  totalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  totalFinalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalFinalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
});
