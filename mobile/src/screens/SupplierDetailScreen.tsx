import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { suppliersApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import ProductPickerModal from '../components/ProductPickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Supplier, Delivery, SupplierPayment, Product } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

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
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);

  // Delivery form
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [deliveryComment, setDeliveryComment] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);

  // Payment form
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentComment, setPaymentComment] = useState('');

  const { data: supplier, isLoading } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const res = await suppliersApi.getById(id);
      return res.data;
    },
  });

  const { data: deliveries } = useQuery<Delivery[]>({
    queryKey: ['supplier-deliveries', id],
    queryFn: async () => {
      const res = await suppliersApi.getDeliveries({ supplierId: id });
      return res.data;
    },
  });

  const { data: payments } = useQuery<SupplierPayment[]>({
    queryKey: ['supplier-payments', id],
    queryFn: async () => {
      const res = await suppliersApi.getPayments({ supplierId: id });
      return res.data;
    },
  });

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['supplier', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', id] }),
      queryClient.invalidateQueries({ queryKey: ['supplier-payments', id] }),
      queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
    ]);

  const createDeliveryMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createDelivery(d),
    onSuccess: () => {
      invalidateAll();
      setDeliveryModalOpen(false);
      setDeliveryItems([]);
      setDeliveryComment('');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании поставки'),
  });

  const createPaymentMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.createPayment(d),
    onSuccess: () => {
      invalidateAll();
      setPaymentModalOpen(false);
      setPaymentAmount('');
      setPaymentComment('');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании платежа'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await invalidateAll();
    setRefreshing(false);
  };

  const addProduct = (product: Product) => {
    const existing = deliveryItems.find((i) => i.productId === product.id);
    if (existing) {
      setDeliveryItems((prev) =>
        prev.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)),
      );
    } else {
      setDeliveryItems((prev) => [
        ...prev,
        { productId: product.id, productName: product.name, quantity: 1, price: product.costPrice || 0 },
      ]);
    }
  };

  const updateItemQty = (productId: string, delta: number) => {
    setDeliveryItems((prev) =>
      prev.map((i) => {
        if (i.productId !== productId) return i;
        const newQty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQty };
      }),
    );
  };

  const updateItemPrice = (productId: string, price: string) => {
    setDeliveryItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, price: Number(price) || 0 } : i)));
  };

  const removeItem = (productId: string) => {
    setDeliveryItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const deliveryTotal = deliveryItems.reduce((s, i) => s + i.quantity * i.price, 0);

  const handleCreateDelivery = () => {
    if (deliveryItems.length === 0) {
      Alert.alert('Ошибка', 'Добавьте хотя бы один товар');
      return;
    }
    createDeliveryMutation.mutate({
      supplierId: id,
      comment: deliveryComment || undefined,
      items: deliveryItems.map((i) => ({ productId: i.productId, quantity: i.quantity, price: i.price })),
    });
  };

  const handleCreatePayment = () => {
    const amt = parseFloat(paymentAmount);
    if (!amt || amt <= 0) {
      Alert.alert('Ошибка', 'Укажите сумму');
      return;
    }
    createPaymentMutation.mutate({
      supplierId: id,
      amount: amt,
      comment: paymentComment || undefined,
    });
  };

  const handlePayFullDebt = () => {
    if (!supplier || supplier.currentDebt <= 0) return;
    setPaymentAmount(String(supplier.currentDebt));
    setPaymentComment('');
    setPaymentModalOpen(true);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!supplier) return <Text style={{ padding: 20, textAlign: 'center' }}>Поставщик не найден</Text>;

  return (
    <View style={styles.safe}>
      <IosScreenHeader title={supplier.name} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
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
          <AnimatedCard
            style={[styles.statCard, { backgroundColor: supplier.currentDebt > 0 ? colors.red[50] : colors.gray[50] }]}
            index={2}
          >
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={supplier.currentDebt > 0 ? colors.red[600] : colors.gray[500]}
              style={{ marginBottom: 2 }}
            />
            <Text style={[styles.statLabel, { color: supplier.currentDebt > 0 ? colors.red[600] : colors.gray[500] }]}>
              Долг
            </Text>
            <Text style={[styles.statValue, { color: supplier.currentDebt > 0 ? colors.red[700] : colors.gray[700] }]}>
              {formatMoney(supplier.currentDebt)}
            </Text>
          </AnimatedCard>
        </View>

        {/* Quick pay debt button */}
        {supplier.currentDebt > 0 && (
          <TouchableOpacity style={styles.quickPayBtn} onPress={handlePayFullDebt}>
            <Ionicons name="wallet-outline" size={18} color={colors.white} />
            <Text style={styles.quickPayText}>Погасить долг {formatMoney(supplier.currentDebt)}</Text>
          </TouchableOpacity>
        )}

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
                <Text style={styles.infoText}>{formatPhone(supplier.phone)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Tabs */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'deliveries' && styles.tabBtnActive]}
            onPress={() => setTab('deliveries')}
          >
            <Ionicons
              name="cube-outline"
              size={15}
              color={tab === 'deliveries' ? colors.primary[600] : colors.gray[400]}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.tabText, tab === 'deliveries' && styles.tabTextActive]}>
              Поставки ({deliveries?.length || 0})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'payments' && styles.tabBtnActive]}
            onPress={() => setTab('payments')}
          >
            <Ionicons
              name="cash-outline"
              size={15}
              color={tab === 'payments' ? colors.primary[600] : colors.gray[400]}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.tabText, tab === 'payments' && styles.tabTextActive]}>
              Платежи ({payments?.length || 0})
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'deliveries' && (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setDeliveryItems([]);
                setDeliveryComment('');
                setDeliveryModalOpen(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.actionBtnText}>Новая поставка</Text>
            </TouchableOpacity>

            {(deliveries || []).length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="cube-outline" size={36} color={colors.gray[300]} />
                <Text style={styles.emptyText}>Нет поставок</Text>
              </View>
            )}

            {(deliveries || []).map((d) => {
              const isExpanded = expandedDelivery === d.id;
              return (
                <TouchableOpacity
                  key={d.id}
                  style={styles.deliveryCard}
                  onPress={() => setExpandedDelivery(isExpanded ? null : d.id)}
                  activeOpacity={0.7}
                >
                  {/* Left accent bar */}
                  {/* Subtle accent — only for fully paid (green); unpaid/partial
                      look neutral, reflecting our "all deliveries go on debt
                      by default and are settled in bulk" workflow. */}
                  <View
                    style={[
                      styles.deliveryAccent,
                      {
                        backgroundColor: d.paymentStatus === 'paid' ? colors.green[500] : 'transparent',
                      },
                    ]}
                  />
                  <View style={styles.deliveryContent}>
                    <View style={styles.deliveryTop}>
                      <View style={styles.deliveryTopLeft}>
                        <Text style={styles.deliveryDate}>{formatDate(d.date)}</Text>
                        {d.paymentStatus === 'paid' && (
                          <View style={[styles.statusBadge, styles.statusPaid]}>
                            <Ionicons name="checkmark-circle" size={11} color={colors.green[700]} />
                            <Text style={[styles.statusBadgeText, { color: colors.green[700] }]}>Оплачено</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.deliveryTopRight}>
                        <Text style={styles.deliveryAmount}>{formatMoney(d.totalAmount)}</Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={16}
                          color={colors.gray[400]}
                        />
                      </View>
                    </View>

                    {/* Item count summary */}
                    <Text style={styles.itemsSummary}>
                      {d.items.length} {d.items.length === 1 ? 'товар' : d.items.length < 5 ? 'товара' : 'товаров'}
                    </Text>

                    {/* Expanded items list */}
                    {isExpanded && (
                      <View style={styles.expandedItems}>
                        {d.items.map((item, idx) => (
                          <View key={idx} style={styles.expandedItemRow}>
                            <Text style={styles.expandedItemName} numberOfLines={1}>
                              {item.product?.name || '—'}
                            </Text>
                            <Text style={styles.expandedItemQty}>
                              {item.quantity} x {formatMoney(item.price)}
                            </Text>
                            <Text style={styles.expandedItemTotal}>{formatMoney(item.total)}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {d.comment && <Text style={styles.commentText}>{d.comment}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {tab === 'payments' && (
          <>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                setPaymentAmount('');
                setPaymentComment('');
                setPaymentModalOpen(true);
              }}
            >
              <Ionicons name="add-circle-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.actionBtnText}>Новый платёж</Text>
            </TouchableOpacity>

            {(payments || []).length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="cash-outline" size={36} color={colors.gray[300]} />
                <Text style={styles.emptyText}>Нет платежей</Text>
              </View>
            )}

            {(payments || []).map((p) => (
              <View key={p.id} style={styles.paymentCard}>
                <View style={[styles.deliveryAccent, { backgroundColor: colors.green[500] }]} />
                <View style={styles.paymentContent}>
                  <View style={styles.paymentTop}>
                    <View>
                      <Text style={styles.paymentDate}>{formatDate(p.date)}</Text>
                      {p.comment && <Text style={styles.commentText}>{p.comment}</Text>}
                    </View>
                    <Text style={styles.paymentAmount}>{formatMoney(p.amount)}</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* New Delivery Modal */}
      <Modal visible={deliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} title="Новая поставка">
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={styles.addItemBtn}
            onPress={() => {
              setDeliveryModalOpen(false);
              setTimeout(() => setProductPickerOpen(true), 300);
            }}
          >
            <Ionicons name="add" size={18} color={colors.primary[600]} />
            <Text style={styles.addItemText}>Добавить товар</Text>
          </TouchableOpacity>

          {deliveryItems.map((item) => (
            <View key={item.productId} style={styles.deliveryFormItem}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.productName}
                </Text>
                <View style={styles.itemControls}>
                  <TouchableOpacity onPress={() => updateItemQty(item.productId, -1)} style={styles.qtyBtn}>
                    <Ionicons name="remove" size={16} color={colors.gray[600]} />
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{item.quantity}</Text>
                  <TouchableOpacity onPress={() => updateItemQty(item.productId, 1)} style={styles.qtyBtn}>
                    <Ionicons name="add" size={16} color={colors.gray[600]} />
                  </TouchableOpacity>
                  <Text style={styles.timesSign}>x</Text>
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
            <TextInput
              value={deliveryComment}
              onChangeText={setDeliveryComment}
              style={[styles.formInput, { height: 50, textAlignVertical: 'top' }]}
              multiline
              placeholder="Необязательно"
              placeholderTextColor={colors.gray[400]}
            />
          </View>
        </ScrollView>

        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setDeliveryModalOpen(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreateDelivery}>
            {createDeliveryMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Создать</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Product Picker with folder navigation */}
      <ProductPickerModal
        visible={productPickerOpen}
        onClose={() => {
          setProductPickerOpen(false);
          setTimeout(() => setDeliveryModalOpen(true), 300);
        }}
        onSelectProduct={addProduct}
        title="Выберите товар"
        showCostPrice={true}
        getCartQty={(id) => deliveryItems.find((i) => i.productId === id)?.quantity || 0}
      />

      {/* New Payment Modal */}
      <Modal visible={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Новый платёж">
        {supplier.currentDebt > 0 && (
          <View style={styles.debtInfo}>
            <View>
              <Text style={styles.debtInfoLabel}>Текущий долг</Text>
              <Text style={styles.debtInfoValue}>{formatMoney(supplier.currentDebt)}</Text>
            </View>
            <TouchableOpacity style={styles.payFullBtn} onPress={() => setPaymentAmount(String(supplier.currentDebt))}>
              <Text style={styles.payFullBtnText}>Весь долг</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сумма *</Text>
          <TextInput
            value={paymentAmount}
            onChangeText={setPaymentAmount}
            style={styles.formInput}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput
            value={paymentComment}
            onChangeText={setPaymentComment}
            style={[styles.formInput, { height: 50, textAlignVertical: 'top' }]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setPaymentModalOpen(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleCreatePayment}>
            {createPaymentMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Оплатить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Stats
  statsRow: { flexDirection: 'row', gap: spacing[2] },
  statCard: { flex: 1, borderRadius: borderRadius.xl, padding: spacing[3] },
  statLabel: { fontSize: 11, fontWeight: fontWeight.semibold },
  statValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginTop: 2 },
  // Quick pay
  quickPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.red[500],
  },
  quickPayText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  // Info card
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1.5] },
  infoText: { fontSize: fontSize.sm, color: colors.gray[700] },
  // Tabs
  tabRow: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: borderRadius.xl, padding: 3 },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBtnActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[500] },
  tabTextActive: { color: colors.gray[900], fontWeight: fontWeight.semibold },
  // Action button
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderStyle: 'dashed',
    backgroundColor: colors.primary[50],
  },
  actionBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: spacing[8] },
  emptyText: { fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] },
  // Delivery card with accent bar
  deliveryCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.gray[100],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  deliveryAccent: { width: 3.5 },
  deliveryContent: { flex: 1, padding: spacing[3] },
  deliveryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  deliveryTopLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  deliveryTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  deliveryDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deliveryAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  statusPaid: { backgroundColor: colors.green[50] },
  statusPartial: { backgroundColor: colors.yellow[50] },
  statusUnpaid: { backgroundColor: colors.red[50] },
  statusBadgeText: { fontSize: 10, fontWeight: fontWeight.semibold },
  itemsSummary: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1.5] },
  expandedItems: { marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[100] },
  expandedItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[1.5] },
  expandedItemName: { flex: 1, fontSize: fontSize.xs, color: colors.gray[700] },
  expandedItemQty: { fontSize: fontSize.xs, color: colors.gray[400], marginHorizontal: spacing[2] },
  expandedItemTotal: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
    minWidth: 60,
    textAlign: 'right',
  },
  commentText: { fontSize: fontSize.xs, color: colors.gray[400], fontStyle: 'italic', marginTop: spacing[1.5] },
  // Payments
  paymentCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.gray[100],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  paymentContent: { flex: 1, padding: spacing[3] },
  paymentTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  paymentDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  paymentAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.green[600] },
  // Delivery form
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[300],
    borderStyle: 'dashed',
    backgroundColor: colors.primary[50],
    marginBottom: spacing[3],
  },
  addItemText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  deliveryFormItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  itemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  itemControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: 4 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
    minWidth: 20,
    textAlign: 'center',
  },
  timesSign: { color: colors.gray[400], fontSize: fontSize.sm },
  priceInput: {
    width: 60,
    height: 28,
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    fontSize: fontSize.xs,
    color: colors.gray[900],
    textAlign: 'center',
  },
  itemTotal: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  deliveryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderTopWidth: 2,
    borderTopColor: colors.gray[200],
    marginBottom: spacing[3],
  },
  deliveryTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  deliveryTotalValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.primary[600] },
  // Payment form
  debtInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.red[50],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[4],
  },
  debtInfoLabel: { fontSize: fontSize.xs, color: colors.red[500] },
  debtInfoValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.red[700] },
  payFullBtn: {
    backgroundColor: colors.red[500],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.lg,
  },
  payFullBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
  // Form common
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
