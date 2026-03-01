import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { suppliersApi, productsApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Supplier, Delivery, SupplierPayment, Product } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

interface DeliveryItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export default function SupplierDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { id } = route.params;
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'deliveries' | 'payments'>('deliveries');

  // Delivery form
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [deliveryComment, setDeliveryComment] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  // Payment form
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentComment, setPaymentComment] = useState('');

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

  const { data: products } = useQuery<Product[]>({
    queryKey: ['products-for-delivery', productSearch],
    queryFn: async () => { const res = await productsApi.getAll({ search: productSearch }); return res.data?.data || res.data; },
    enabled: productPickerOpen,
  });

  const invalidateAll = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] }),
    queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  ]);

  const createDeliveryMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createDelivery(d),
    onSuccess: () => { invalidateAll(); setDeliveryModalOpen(false); setDeliveryItems([]); setDeliveryComment(''); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании поставки'),
  });

  const createPaymentMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createPayment(d),
    onSuccess: () => { invalidateAll(); setPaymentModalOpen(false); setPaymentAmount(''); setPaymentComment(''); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании платежа'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await invalidateAll();
    setRefreshing(false);
  };

  const addProduct = (product: Product) => {
    const existing = deliveryItems.find(i => i.productId === product.id);
    if (existing) {
      setDeliveryItems(prev => prev.map(i => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setDeliveryItems(prev => [...prev, { productId: product.id, productName: product.name, quantity: 1, price: product.costPrice || 0 }]);
    }
    setProductPickerOpen(false);
    setProductSearch('');
  };

  const updateItemQty = (productId: string, delta: number) => {
    setDeliveryItems(prev => prev.map(i => {
      if (i.productId !== productId) return i;
      const newQty = Math.max(1, i.quantity + delta);
      return { ...i, quantity: newQty };
    }));
  };

  const updateItemPrice = (productId: string, price: string) => {
    setDeliveryItems(prev => prev.map(i => i.productId === productId ? { ...i, price: Number(price) || 0 } : i));
  };

  const removeItem = (productId: string) => {
    setDeliveryItems(prev => prev.filter(i => i.productId !== productId));
  };

  const deliveryTotal = deliveryItems.reduce((s, i) => s + i.quantity * i.price, 0);

  const handleCreateDelivery = () => {
    if (deliveryItems.length === 0) { Alert.alert('Ошибка', 'Добавьте хотя бы один товар'); return; }
    createDeliveryMutation.mutate({
      supplierId: id,
      comment: deliveryComment || undefined,
      items: deliveryItems.map(i => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
    });
  };

  const handleCreatePayment = () => {
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) { Alert.alert('Ошибка', 'Укажите сумму'); return; }
    createPaymentMutation.mutate({
      supplierId: id,
      amount: amt,
      comment: paymentComment || undefined,
    });
  };

  if (isLoading) return <LoadingSpinner />;
  if (!supplier) return <Text style={{ padding: 20, textAlign: 'center' }}>Поставщик не найден</Text>;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{supplier.name}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}>
        {/* Stats cards */}
        <View style={styles.statsRow}>
          <AnimatedCard style={[styles.statCard, { backgroundColor: colors.blue[50] }]} index={0}>
            <Ionicons name="cart-outline" size={16} color={colors.blue[600]} style={{ marginBottom: 2 }} />
            <Text style={[styles.statLabel, { color: colors.blue[600] }]}>Закупки</Text>
            <Text style={[styles.statValue, { color: colors.blue[800] }]}>{formatMoney(supplier.totalPurchases)}</Text>
          </AnimatedCard>
          <AnimatedCard style={[styles.statCard, { backgroundColor: colors.green[50] }]} index={1}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.green[600]} style={{ marginBottom: 2 }} />
            <Text style={[styles.statLabel, { color: colors.green[600] }]}>Оплачено</Text>
            <Text style={[styles.statValue, { color: colors.green[800] }]}>{formatMoney(supplier.totalPaid)}</Text>
          </AnimatedCard>
          <AnimatedCard style={[styles.statCard, { backgroundColor: supplier.currentDebt > 0 ? colors.red[50] : colors.gray[50] }]} index={2}>
            <Ionicons name="alert-circle-outline" size={16} color={supplier.currentDebt > 0 ? colors.red[600] : colors.gray[500]} style={{ marginBottom: 2 }} />
            <Text style={[styles.statLabel, { color: supplier.currentDebt > 0 ? colors.red[600] : colors.gray[500] }]}>Долг</Text>
            <Text style={[styles.statValue, { color: supplier.currentDebt > 0 ? colors.red[700] : colors.gray[700] }]}>{formatMoney(supplier.currentDebt)}</Text>
          </AnimatedCard>
        </View>

        {/* Info */}
        {(supplier.phone || supplier.contactPerson) && (
          <View style={styles.card}>
            {supplier.contactPerson && (
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={16} color={colors.gray[400]} />
                <Text style={styles.infoText}>{supplier.contactPerson}</Text>
              </View>
            )}
            {supplier.phone && (
              <View style={styles.infoRow}>
                <Ionicons name="call-outline" size={16} color={colors.gray[400]} />
                <Text style={styles.infoText}>{supplier.phone}</Text>
              </View>
            )}
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'deliveries' && styles.tabBtnActive]} onPress={() => setTab('deliveries')}>
            <Text style={[styles.tabText, tab === 'deliveries' && styles.tabTextActive]}>Поставки ({deliveries?.length || 0})</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'payments' && styles.tabBtnActive]} onPress={() => setTab('payments')}>
            <Text style={[styles.tabText, tab === 'payments' && styles.tabTextActive]}>Платежи ({payments?.length || 0})</Text>
          </TouchableOpacity>
        </View>

        {tab === 'deliveries' && (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => { setDeliveryItems([]); setDeliveryComment(''); setDeliveryModalOpen(true); }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.actionBtnText}>Новая поставка</Text>
            </TouchableOpacity>

            {(deliveries || []).map(d => (
              <View key={d.id} style={styles.card}>
                <View style={styles.deliveryTop}>
                  <Text style={styles.deliveryDate}>{formatDate(d.date)}</Text>
                  <Text style={styles.deliveryAmount}>{formatMoney(d.totalAmount)}</Text>
                </View>
                <View style={styles.deliveryStatusRow}>
                  <View style={[styles.statusBadge, d.paymentStatus === 'paid' ? styles.statusPaid : d.paymentStatus === 'partial' ? styles.statusPartial : styles.statusUnpaid]}>
                    <Text style={[styles.statusBadgeText, { color: d.paymentStatus === 'paid' ? colors.green[700] : d.paymentStatus === 'partial' ? colors.yellow[700] : colors.red[700] }]}>
                      {d.paymentStatus === 'paid' ? 'Оплачено' : d.paymentStatus === 'partial' ? 'Частично' : 'Не оплачено'}
                    </Text>
                  </View>
                </View>
                {d.items.map((item, idx) => (
                  <Text key={idx} style={styles.deliveryItem}>
                    {item.product?.name || '—'} × {item.quantity} — {formatMoney(item.total)}
                  </Text>
                ))}
                {d.comment && <Text style={styles.commentText}>{d.comment}</Text>}
              </View>
            ))}
          </>
        )}

        {tab === 'payments' && (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => { setPaymentAmount(''); setPaymentComment(''); setPaymentModalOpen(true); }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.actionBtnText}>Новый платёж</Text>
            </TouchableOpacity>

            {(payments || []).map(p => (
              <View key={p.id} style={styles.paymentCard}>
                <View>
                  <Text style={styles.paymentDate}>{formatDate(p.date)}</Text>
                  {p.comment && <Text style={styles.commentText}>{p.comment}</Text>}
                </View>
                <Text style={styles.paymentAmount}>{formatMoney(p.amount)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* New Delivery Modal */}
      <Modal visible={deliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} title="Новая поставка">
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.addItemBtn} onPress={() => setProductPickerOpen(true)}>
            <Ionicons name="add" size={18} color={colors.primary[600]} />
            <Text style={styles.addItemText}>Добавить товар</Text>
          </TouchableOpacity>

          {deliveryItems.map((item) => (
            <View key={item.productId} style={styles.deliveryFormItem}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemName} numberOfLines={1}>{item.productName}</Text>
                <View style={styles.itemControls}>
                  <TouchableOpacity onPress={() => updateItemQty(item.productId, -1)} style={styles.qtyBtn}>
                    <Ionicons name="remove" size={16} color={colors.gray[600]} />
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                  <TouchableOpacity onPress={() => updateItemQty(item.productId, 1)} style={styles.qtyBtn}>
                    <Ionicons name="add" size={16} color={colors.gray[600]} />
                  </TouchableOpacity>
                  <Text style={styles.timesSign}>×</Text>
                  <TextInput
                    value={String(item.price)}
                    onChangeText={(v) => updateItemPrice(item.productId, v)}
                    style={styles.priceInput}
                    keyboardType="numeric"
                  />
                  <Text style={styles.itemTotal}>{formatMoney(item.quantity * item.price)}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => removeItem(item.productId)} style={{ padding: 4 }}>
                <Ionicons name="close" size={18} color={colors.red[400]} />
              </TouchableOpacity>
            </View>
          ))}

          {deliveryItems.length > 0 && (
            <View style={styles.deliveryTotalRow}>
              <Text style={styles.deliveryTotalLabel}>Итого:</Text>
              <Text style={styles.deliveryTotalValue}>{formatMoney(deliveryTotal)}</Text>
            </View>
          )}

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Комментарий</Text>
            <TextInput value={deliveryComment} onChangeText={setDeliveryComment} style={[styles.formInput, { height: 50, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} />
          </View>
        </ScrollView>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeliveryModalOpen(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreateDelivery}>
            {createDeliveryMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.submitBtnText}>Создать</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Product Picker Modal */}
      <Modal visible={productPickerOpen} onClose={() => { setProductPickerOpen(false); setProductSearch(''); }} title="Выбрать товар">
        <TextInput
          value={productSearch}
          onChangeText={setProductSearch}
          style={[styles.formInput, { marginBottom: spacing[3] }]}
          placeholder="Поиск товара..."
          placeholderTextColor={colors.gray[400]}
          autoFocus
        />
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {(products || []).map((item: Product) => (
            <TouchableOpacity key={item.id} style={styles.productRow} onPress={() => addProduct(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.productInfo}>Себестоимость: {formatMoney(item.costPrice || 0)} · Остаток: {item.stock}</Text>
              </View>
              <Ionicons name="add-circle" size={24} color={colors.primary[500]} />
            </TouchableOpacity>
          ))}
          {(products || []).length === 0 && (
            <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[6] }}>Нет товаров</Text>
          )}
        </ScrollView>
      </Modal>

      {/* New Payment Modal */}
      <Modal visible={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Новый платёж">
        {supplier.currentDebt > 0 && (
          <View style={styles.debtInfo}>
            <Text style={styles.debtInfoLabel}>Текущий долг:</Text>
            <Text style={styles.debtInfoValue}>{formatMoney(supplier.currentDebt)}</Text>
          </View>
        )}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сумма *</Text>
          <TextInput value={paymentAmount} onChangeText={setPaymentAmount} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput value={paymentComment} onChangeText={setPaymentComment} style={[styles.formInput, { height: 50, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setPaymentModalOpen(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreatePayment}>
            {createPaymentMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.submitBtnText}>Оплатить</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1, textAlign: 'center' },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[2] },
  statCard: { flex: 1, borderRadius: borderRadius.xl, padding: spacing[3] },
  statLabel: { fontSize: 11, fontWeight: fontWeight.semibold },
  statValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginTop: 2 },
  // Info card
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1.5] },
  infoText: { fontSize: fontSize.sm, color: colors.gray[700] },
  // Tabs
  tabRow: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: borderRadius.xl, padding: 3 },
  tabBtn: { flex: 1, paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.white, shadowColor: colors.black, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  tabText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabTextActive: { color: colors.gray[900], fontWeight: fontWeight.semibold },
  // Action button
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[3], borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.primary[200], borderStyle: 'dashed', backgroundColor: colors.primary[50] },
  actionBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  // Deliveries
  deliveryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deliveryDate: { fontSize: fontSize.sm, color: colors.gray[500] },
  deliveryAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deliveryStatusRow: { marginTop: spacing[2], marginBottom: spacing[2] },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full, alignSelf: 'flex-start' },
  statusPaid: { backgroundColor: colors.green[50] },
  statusPartial: { backgroundColor: colors.yellow[50] },
  statusUnpaid: { backgroundColor: colors.red[50] },
  statusBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  deliveryItem: { fontSize: fontSize.xs, color: colors.gray[500], paddingVertical: 2 },
  commentText: { fontSize: fontSize.xs, color: colors.gray[400], fontStyle: 'italic', marginTop: spacing[1] },
  // Payments
  paymentCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  paymentDate: { fontSize: fontSize.sm, color: colors.gray[500] },
  paymentAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
  // Delivery form
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[3], borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.primary[300], borderStyle: 'dashed', backgroundColor: colors.primary[50], marginBottom: spacing[3] },
  addItemText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  deliveryFormItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  itemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], minWidth: 20, textAlign: 'center' },
  timesSign: { color: colors.gray[400], fontSize: fontSize.sm },
  priceInput: { width: 60, height: 28, borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], fontSize: fontSize.xs, color: colors.gray[900], textAlign: 'center' },
  itemTotal: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  deliveryTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderTopWidth: 2, borderTopColor: colors.gray[200], marginBottom: spacing[3] },
  deliveryTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deliveryTotalValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.primary[600] },
  // Product picker
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  productInfo: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  // Payment form
  debtInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.red[50], padding: spacing[3], borderRadius: borderRadius.xl, marginBottom: spacing[4] },
  debtInfoLabel: { fontSize: fontSize.sm, color: colors.red[600] },
  debtInfoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.red[700] },
  // Form common
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
