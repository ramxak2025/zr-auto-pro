import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { suppliersApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Supplier, Delivery, SupplierPayment } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export default function SupplierDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { id } = route.params;
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: supplier, isLoading } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => { const res = await suppliersApi.getById(id); return res.data; },
  });

  const { data: deliveries } = useQuery<Delivery[]>({
    queryKey: ['supplier-deliveries', id],
    queryFn: async () => { const res = await suppliersApi.getDeliveries({ supplierId: id }); return res.data; },
  });

  const { data: payments } = useQuery<SupplierPayment[]>({
    queryKey: ['supplier-payments', id],
    queryFn: async () => { const res = await suppliersApi.getPayments({ supplierId: id }); return res.data; },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] }),
    ]);
    setRefreshing(false);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!supplier) return <Text style={{ padding: 20, textAlign: 'center' }}>Поставщик не найден</Text>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{supplier.name}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        {/* Info */}
        <View style={styles.card}>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Телефон</Text><Text style={styles.infoValue}>{supplier.phone || '—'}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Контакт</Text><Text style={styles.infoValue}>{supplier.contactPerson || '—'}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Покупки</Text><Text style={styles.infoValue}>{formatMoney(supplier.totalPurchases)}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Оплачено</Text><Text style={styles.infoValue}>{formatMoney(supplier.totalPaid)}</Text></View>
          <View style={styles.infoRow}><Text style={styles.infoLabel}>Долг</Text><Text style={[styles.infoValue, supplier.currentDebt > 0 && { color: colors.red[600] }]}>{formatMoney(supplier.currentDebt)}</Text></View>
        </View>

        {/* Deliveries */}
        <Text style={styles.sectionTitle}>Поставки ({deliveries?.length || 0})</Text>
        {(deliveries || []).map(d => (
          <View key={d.id} style={styles.card}>
            <View style={styles.deliveryTop}>
              <Text style={styles.deliveryDate}>{formatDate(d.date)}</Text>
              <Text style={styles.deliveryAmount}>{formatMoney(d.totalAmount)}</Text>
            </View>
            <View style={styles.deliveryStatusRow}>
              <View style={[styles.statusBadge, d.paymentStatus === 'paid' ? styles.statusPaid : d.paymentStatus === 'partial' ? styles.statusPartial : styles.statusUnpaid]}>
                <Text style={styles.statusText}>{d.paymentStatus === 'paid' ? 'Оплачено' : d.paymentStatus === 'partial' ? 'Частично' : 'Не оплачено'}</Text>
              </View>
            </View>
            {d.items.map((item, idx) => (
              <Text key={idx} style={styles.deliveryItem}>
                {item.product?.name || '—'} × {item.quantity} — {formatMoney(item.total)}
              </Text>
            ))}
          </View>
        ))}

        {/* Payments */}
        <Text style={styles.sectionTitle}>Платежи ({payments?.length || 0})</Text>
        {(payments || []).map(p => (
          <View key={p.id} style={styles.paymentCard}>
            <Text style={styles.paymentDate}>{formatDate(p.date)}</Text>
            <Text style={styles.paymentAmount}>{formatMoney(p.amount)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1, textAlign: 'center' },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  infoLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: spacing[4] },
  deliveryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deliveryDate: { fontSize: fontSize.sm, color: colors.gray[500] },
  deliveryAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deliveryStatusRow: { marginTop: spacing[2], marginBottom: spacing[2] },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full, alignSelf: 'flex-start' },
  statusPaid: { backgroundColor: colors.green[50] },
  statusPartial: { backgroundColor: colors.yellow[50] },
  statusUnpaid: { backgroundColor: colors.red[50] },
  statusText: { fontSize: 11, fontWeight: fontWeight.medium },
  deliveryItem: { fontSize: fontSize.xs, color: colors.gray[500], paddingVertical: 2 },
  paymentCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  paymentDate: { fontSize: fontSize.sm, color: colors.gray[500] },
  paymentAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
});
