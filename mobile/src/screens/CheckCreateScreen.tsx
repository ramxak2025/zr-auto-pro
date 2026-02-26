import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { checksApi, clientsApi, usersApi, servicesApi, productsApi } from '../api/services';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car, User, Service, Product, CheckServiceLine, CheckProductLine, PaymentMethod } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

const paymentOptions: { key: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }[] = [
  { key: 'cash' as PaymentMethod, label: 'Нал', icon: 'cash-outline', color: colors.green[600], bg: colors.green[50] },
  { key: 'card' as PaymentMethod, label: 'Карта', icon: 'card-outline', color: colors.blue[600], bg: colors.blue[50] },
  { key: 'cash_card' as PaymentMethod, label: 'Сплит', icon: 'swap-horizontal-outline', color: colors.gray[700], bg: colors.gray[100] },
  { key: 'warranty' as PaymentMethod, label: 'Гар.', icon: 'shield-checkmark-outline', color: colors.amber[600], bg: colors.amber[50] },
];

export default function CheckCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const editId = route.params?.id;
  const isStackScreen = !!editId; // If editing, opened from stack navigator

  // Client/Car selection
  const [clientId, setClientId] = useState('');
  const [carId, setCarId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [mileage, setMileage] = useState('');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash' as PaymentMethod);
  const [cashAmount, setCashAmount] = useState('');
  const [isDeferred, setIsDeferred] = useState(false);

  // Line items
  const [serviceLines, setServiceLines] = useState<CheckServiceLine[]>([]);
  const [productLines, setProductLines] = useState<CheckProductLine[]>([]);

  // Pickers
  const [clientSearch, setClientSearch] = useState('');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);

  // Load data
  const { data: clients } = useQuery<Client[]>({
    queryKey: ['clients-search', clientSearch],
    queryFn: async () => { const res = await clientsApi.getAll({ search: clientSearch, limit: 20 }); return res.data.data || []; },
    enabled: showClientPicker,
  });

  const { data: clientData } = useQuery<Client>({
    queryKey: ['client-detail', clientId],
    queryFn: async () => { const res = await clientsApi.getById(clientId); return res.data; },
    enabled: !!clientId,
  });
  const clientCars = clientData?.cars;

  const { data: masters } = useQuery<User[]>({
    queryKey: ['masters'],
    queryFn: async () => { const res = await usersApi.getMasters(); return res.data; },
  });

  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['all-services'],
    queryFn: async () => { const res = await servicesApi.getAll({ limit: 500 }); return res.data.data || res.data; },
    enabled: showServicePicker,
  });

  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['all-products'],
    queryFn: async () => { const res = await productsApi.getAll({ limit: 500 }); return res.data.data || res.data; },
    enabled: showProductPicker,
  });

  // Load existing check for editing
  useEffect(() => {
    if (editId) {
      checksApi.getById(editId).then((res: any) => {
        const c = res.data;
        setClientId(c.clientId || '');
        setCarId(c.carId || '');
        setMasterId(c.masterId || '');
        setMileage(c.mileage ? String(c.mileage) : '');
        setComment(c.comment || '');
        setDiscount(c.discount ? String(c.discount) : '');
        setPaymentMethod(c.paymentMethod);
        setIsDeferred(c.isDeferred || false);
        setServiceLines(c.services || []);
        setProductLines(c.products || []);
      });
    }
  }, [editId]);

  const selectedClient = clientData || clients?.find(c => c.id === clientId);

  const resetForm = () => {
    setClientId(''); setCarId(''); setMasterId(''); setMileage('');
    setComment(''); setDiscount(''); setPaymentMethod('cash' as PaymentMethod);
    setCashAmount(''); setIsDeferred(false);
    setServiceLines([]); setProductLines([]);
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => editId ? checksApi.update(editId, data) : checksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (isStackScreen) {
        navigation.goBack();
      } else {
        resetForm();
        Alert.alert('Готово', 'Чек успешно создан');
      }
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить чек'),
  });

  // Calculations
  const serviceTotal = serviceLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const productTotal = productLines.reduce((sum, l) => sum + l.sellPrice * l.quantity, 0);
  const discountNum = Number(discount) || 0;
  const total = serviceTotal + productTotal - discountNum;

  const addServiceLine = (service: Service) => {
    setServiceLines(prev => [...prev, {
      serviceId: service.id, name: service.name, price: service.defaultPrice,
      quantity: 1, total: service.defaultPrice, masterId: masterId || undefined,
    }]);
    setShowServicePicker(false);
  };

  const removeServiceLine = (idx: number) => setServiceLines(prev => prev.filter((_, i) => i !== idx));

  const updateServiceLine = (idx: number, field: string, value: any) => {
    setServiceLines(prev => prev.map((line, i) => {
      if (i !== idx) return line;
      const updated = { ...line, [field]: value };
      updated.total = updated.price * updated.quantity;
      return updated;
    }));
  };

  const addProductLine = (product: Product) => {
    setProductLines(prev => [...prev, {
      productId: product.id, name: product.name, sellPrice: product.sellPrice,
      costPrice: product.costPrice, quantity: 1, totalSell: product.sellPrice, totalCost: product.costPrice,
    }]);
    setShowProductPicker(false);
  };

  const removeProductLine = (idx: number) => setProductLines(prev => prev.filter((_, i) => i !== idx));

  const updateProductLine = (idx: number, field: string, value: any) => {
    setProductLines(prev => prev.map((line, i) => {
      if (i !== idx) return line;
      const updated = { ...line, [field]: value };
      updated.totalSell = updated.sellPrice * updated.quantity;
      updated.totalCost = updated.costPrice * updated.quantity;
      return updated;
    }));
  };

  const handleSubmit = (deferred?: boolean) => {
    const shouldDefer = deferred !== undefined ? deferred : isDeferred;
    if (!masterId) { Alert.alert('Ошибка', 'Выберите мастера'); return; }
    if (!shouldDefer && serviceLines.length === 0 && productLines.length === 0) {
      Alert.alert('Ошибка', 'Добавьте хотя бы одну услугу или товар');
      return;
    }

    const payload = {
      clientId: clientId || undefined,
      carId: carId || undefined,
      masterId,
      mileage: mileage ? Number(mileage) : undefined,
      comment: comment || undefined,
      discount: discountNum || undefined,
      paymentMethod,
      cashAmount: paymentMethod === ('cash_card' as PaymentMethod) ? Number(cashAmount) || 0 : undefined,
      isDeferred: shouldDefer,
      services: serviceLines.map(l => ({
        serviceId: l.serviceId, masterId: l.masterId || masterId,
        name: l.name, price: l.price, quantity: l.quantity,
      })),
      products: productLines.map(l => ({
        productId: l.productId, name: l.name,
        sellPrice: l.sellPrice, costPrice: l.costPrice, quantity: l.quantity,
      })),
    };
    createMutation.mutate(payload);
  };

  const now = new Date();
  const dateStr = `${now.getDate()}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {isStackScreen ? (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.primary[600]} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerIcon}>
            <Ionicons name="calculator-outline" size={20} color={colors.primary[600]} />
          </View>
        )}
        <Text style={styles.headerTitle}>{editId ? 'Редактировать' : 'Новый чек'}</Text>
        <TouchableOpacity style={styles.receiptBtn}>
          <Ionicons name="receipt-outline" size={18} color={colors.gray[400]} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Dark header card */}
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.darkCard}>
            <Text style={styles.darkCardTitle}>ЗАКАЗ-НАРЯД</Text>
            <Text style={styles.darkCardDate}>{dateStr}</Text>
          </LinearGradient>

          {/* Search by plate */}
          <View style={styles.plateSearch}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowClientPicker(true)}>
              <Text style={styles.plateSearchText}>
                {selectedClient ? selectedClient.fullName : 'Поиск по госномеру или имени клиента'}
              </Text>
            </TouchableOpacity>
            {clientId ? (
              <TouchableOpacity onPress={() => { setClientId(''); setCarId(''); }}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Client info */}
          {!clientId && (
            <View style={styles.retailBadge}>
              <Ionicons name="person-outline" size={14} color={colors.gray[500]} />
              <Text style={styles.retailText}>Розничный покупатель</Text>
            </View>
          )}

          {/* Car selection */}
          {clientId && clientCars && clientCars.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Автомобиль</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                  {clientCars.map(car => (
                    <TouchableOpacity
                      key={car.id}
                      style={[styles.carChip, carId === car.id && styles.carChipActive]}
                      onPress={() => setCarId(car.id)}
                    >
                      <Ionicons name="car-outline" size={14} color={carId === car.id ? colors.primary[600] : colors.gray[500]} />
                      <Text style={[styles.carChipText, carId === car.id && styles.carChipTextActive]}>{car.makeModel}</Text>
                      {car.plateNumber && <Text style={styles.carPlate}>{car.plateNumber}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Mileage */}
          <View style={styles.mileageRow}>
            <Ionicons name="speedometer-outline" size={16} color={colors.gray[400]} />
            <TextInput value={mileage} onChangeText={setMileage} style={styles.mileageInput} keyboardType="numeric" placeholder="Пробег, км" placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Master selection */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Мастер *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                {(masters || []).map(master => (
                  <TouchableOpacity
                    key={master.id}
                    style={[styles.masterChip, masterId === master.id && styles.masterChipActive]}
                    onPress={() => setMasterId(master.id)}
                  >
                    <Text style={[styles.masterChipText, masterId === master.id && styles.masterChipTextActive]} numberOfLines={1}>
                      {master.fullName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Services */}
          <View style={styles.linesSection}>
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <Ionicons name="build-outline" size={16} color={colors.gray[500]} />
                <Text style={styles.linesSectionTitle}>Услуги</Text>
                <View style={styles.lineBadge}>
                  <Text style={styles.lineBadgeText}>{serviceLines.length}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowServicePicker(true)}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
                <Text style={styles.addLineBtnText}>Добавить</Text>
              </TouchableOpacity>
            </View>
            {serviceLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeServiceLine(idx)}>
                    <Ionicons name="close-circle" size={18} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
                <View style={styles.lineInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>Цена</Text>
                    <TextInput value={String(line.price)} onChangeText={(v) => updateServiceLine(idx, 'price', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>Кол-во</Text>
                    <TextInput value={String(line.quantity)} onChangeText={(v) => updateServiceLine(idx, 'quantity', Number(v) || 1)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.price * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Products */}
          <View style={styles.linesSection}>
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <Ionicons name="cube-outline" size={16} color={colors.gray[500]} />
                <Text style={styles.linesSectionTitle}>Товары</Text>
                <View style={styles.lineBadge}>
                  <Text style={styles.lineBadgeText}>{productLines.length}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowProductPicker(true)}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
                <Text style={styles.addLineBtnText}>Добавить</Text>
              </TouchableOpacity>
            </View>
            {productLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeProductLine(idx)}>
                    <Ionicons name="close-circle" size={18} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
                <View style={styles.lineInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>Цена</Text>
                    <TextInput value={String(line.sellPrice)} onChangeText={(v) => updateProductLine(idx, 'sellPrice', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>Кол-во</Text>
                    <TextInput value={String(line.quantity)} onChangeText={(v) => updateProductLine(idx, 'quantity', Number(v) || 1)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.sellPrice * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Payment method — icon buttons */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Способ оплаты</Text>
            <View style={styles.paymentRow}>
              {paymentOptions.map(pm => {
                const active = paymentMethod === pm.key;
                return (
                  <TouchableOpacity
                    key={pm.key}
                    style={[styles.paymentBtn, active && { borderColor: pm.color, backgroundColor: pm.bg }]}
                    onPress={() => setPaymentMethod(pm.key)}
                  >
                    <Ionicons name={pm.icon as any} size={20} color={active ? pm.color : colors.gray[400]} />
                    <Text style={[styles.paymentBtnText, active && { color: pm.color, fontWeight: fontWeight.bold }]}>{pm.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Cash amount for split payment */}
            {paymentMethod === ('cash_card' as PaymentMethod) && (
              <View style={{ marginTop: spacing[3] }}>
                <Text style={styles.lineInputLabel}>Клиент дал наличными</Text>
                <TextInput value={cashAmount} onChangeText={setCashAmount} style={styles.formInput} keyboardType="numeric" placeholder="0 ₽" placeholderTextColor={colors.gray[400]} />
              </View>
            )}
          </View>

          {/* Extra fields */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineInputLabel}>Скидка (₽)</Text>
                <TextInput value={discount} onChangeText={setDiscount} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
              </View>
            </View>

            {/* Deferred toggle */}
            <TouchableOpacity
              style={[styles.deferToggle, isDeferred && styles.deferToggleActive]}
              onPress={() => setIsDeferred(!isDeferred)}
            >
              <Ionicons name={isDeferred ? 'checkbox' : 'square-outline'} size={20} color={isDeferred ? colors.red[600] : colors.gray[400]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.deferLabel, isDeferred && { color: colors.red[700] }]}>Отложить чек</Text>
                <Text style={styles.deferHint}>Сохранить как черновик</Text>
              </View>
            </TouchableOpacity>

            <Text style={styles.lineInputLabel}>Комментарий</Text>
            <TextInput value={comment} onChangeText={setComment} style={[styles.formInput, { minHeight: 56, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, isDeferred && styles.submitBtnDeferred, createMutation.isPending && { opacity: 0.5 }]}
            onPress={() => handleSubmit()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <Ionicons name={isDeferred ? 'pause-circle-outline' : 'checkmark-circle-outline'} size={20} color={colors.white} />
                <Text style={styles.submitBtnText}>
                  {isDeferred ? 'Отложить чек' : editId ? 'Сохранить' : `Пробить чек — ${formatMoney(total)}`}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Client Picker */}
      <Modal visible={showClientPicker} onClose={() => setShowClientPicker(false)} title="Выберите клиента">
        <TextInput value={clientSearch} onChangeText={setClientSearch} style={styles.formInput} placeholder="Поиск по имени или телефону..." placeholderTextColor={colors.gray[400]} autoFocus />
        <View style={{ marginTop: spacing[3] }}>
          {(clients || []).map(client => (
            <TouchableOpacity key={client.id} style={styles.pickerItem} onPress={() => { setClientId(client.id); setCarId(''); setShowClientPicker(false); }}>
              <Text style={styles.pickerName}>{client.fullName}</Text>
              <Text style={styles.pickerSub}>{client.phone}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Service Picker */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title="Добавить услугу">
        <ScrollView style={{ maxHeight: 400 }}>
          {(allServices || []).map(service => (
            <TouchableOpacity key={service.id} style={styles.pickerItem} onPress={() => addServiceLine(service)}>
              <Text style={styles.pickerName}>{service.name}</Text>
              <Text style={styles.pickerPrice}>{formatMoney(service.defaultPrice)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Modal>

      {/* Product Picker */}
      <Modal visible={showProductPicker} onClose={() => setShowProductPicker(false)} title="Добавить товар">
        <ScrollView style={{ maxHeight: 400 }}>
          {(allProducts || []).map(product => (
            <TouchableOpacity key={product.id} style={styles.pickerItem} onPress={() => addProductLine(product)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerName}>{product.name}</Text>
                <Text style={styles.pickerSub}>Остаток: {product.stock}</Text>
              </View>
              <Text style={styles.pickerPrice}>{formatMoney(product.sellPrice)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  receiptBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[12] },
  // Dark card
  darkCard: { borderRadius: borderRadius['2xl'], padding: spacing[4], alignItems: 'center' },
  darkCardTitle: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.slate[400], letterSpacing: 3 },
  darkCardDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.slate[300], marginTop: 4 },
  // Plate search
  plateSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[3] },
  plateSearchText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Retail
  retailBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.gray[100], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  retailText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[500] },
  // Section
  section: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  sectionLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.gray[500], marginBottom: spacing[2], textTransform: 'uppercase', letterSpacing: 0.5 },
  // Car
  carChip: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  carChipActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  carChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  carChipTextActive: { color: colors.primary[700] },
  carPlate: { fontSize: 10, color: colors.gray[400], backgroundColor: colors.gray[100], paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  // Mileage
  mileageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[100], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[1] },
  mileageInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: spacing[2] },
  // Master
  masterChip: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.xl, backgroundColor: colors.gray[100] },
  masterChipActive: { backgroundColor: colors.primary[600] },
  masterChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  masterChipTextActive: { color: colors.white },
  // Lines
  linesSection: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  linesSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  linesSectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  lineBadge: { backgroundColor: colors.gray[100], paddingHorizontal: 6, paddingVertical: 1, borderRadius: borderRadius.full },
  lineBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500] },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary[50], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
  addLineBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  lineItem: { backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[2] },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, marginRight: spacing[2] },
  lineInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  lineInputLabel: { fontSize: 11, color: colors.gray[500], marginBottom: 4 },
  lineInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5], fontSize: fontSize.sm, color: colors.gray[900] },
  lineTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], minWidth: 70, textAlign: 'right' },
  // Payment
  paymentRow: { flexDirection: 'row', gap: spacing[2] },
  paymentBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing[3], borderRadius: borderRadius.xl, borderWidth: 1.5, borderColor: colors.gray[200], backgroundColor: colors.white, gap: spacing[1] },
  paymentBtnText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[500] },
  // Defer
  deferToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: colors.gray[100], marginTop: spacing[2], marginBottom: spacing[3] },
  deferToggleActive: {},
  deferLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deferHint: { fontSize: 11, color: colors.gray[400] },
  // Form
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  // Submit
  submitBtn: { backgroundColor: colors.primary[600], paddingVertical: spacing[4], borderRadius: borderRadius.xl, alignItems: 'center' },
  submitBtnDeferred: { backgroundColor: colors.red[600] },
  submitBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  // Picker
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  pickerName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  pickerSub: { fontSize: fontSize.xs, color: colors.gray[500] },
  pickerPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
});
