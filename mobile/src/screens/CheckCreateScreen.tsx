import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { checksApi, clientsApi, usersApi, servicesApi, productsApi } from '../api/services';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car, User, Service, Product, CheckServiceLine, CheckProductLine, PaymentMethod } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function CheckCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const editId = route.params?.id;

  // Client/Car selection
  const [clientId, setClientId] = useState('');
  const [carId, setCarId] = useState('');
  const [masterId, setMasterId] = useState('');
  const [mileage, setMileage] = useState('');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash' as PaymentMethod);

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
      checksApi.getById(editId).then(res => {
        const c = res.data;
        setClientId(c.clientId || '');
        setCarId(c.carId || '');
        setMasterId(c.masterId || '');
        setMileage(c.mileage ? String(c.mileage) : '');
        setComment(c.comment || '');
        setDiscount(c.discount ? String(c.discount) : '');
        setPaymentMethod(c.paymentMethod);
        setServiceLines(c.services || []);
        setProductLines(c.products || []);
      });
    }
  }, [editId]);

  const selectedClient = clients?.find(c => c.id === clientId);

  const createMutation = useMutation({
    mutationFn: (data: any) => editId ? checksApi.update(editId, data) : checksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigation.goBack();
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
      serviceId: service.id,
      name: service.name,
      price: service.defaultPrice,
      quantity: 1,
      total: service.defaultPrice,
      masterId: masterId || undefined,
    }]);
    setShowServicePicker(false);
  };

  const removeServiceLine = (idx: number) => {
    setServiceLines(prev => prev.filter((_, i) => i !== idx));
  };

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
      productId: product.id,
      name: product.name,
      sellPrice: product.sellPrice,
      costPrice: product.costPrice,
      quantity: 1,
      totalSell: product.sellPrice,
      totalCost: product.costPrice,
    }]);
    setShowProductPicker(false);
  };

  const removeProductLine = (idx: number) => {
    setProductLines(prev => prev.filter((_, i) => i !== idx));
  };

  const updateProductLine = (idx: number, field: string, value: any) => {
    setProductLines(prev => prev.map((line, i) => {
      if (i !== idx) return line;
      const updated = { ...line, [field]: value };
      updated.totalSell = updated.sellPrice * updated.quantity;
      updated.totalCost = updated.costPrice * updated.quantity;
      return updated;
    }));
  };

  const handleSubmit = () => {
    if (!masterId) { Alert.alert('Ошибка', 'Выберите мастера'); return; }
    if (serviceLines.length === 0 && productLines.length === 0) {
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
      services: serviceLines.map(l => ({
        serviceId: l.serviceId,
        masterId: l.masterId || masterId,
        name: l.name,
        price: l.price,
        quantity: l.quantity,
      })),
      products: productLines.map(l => ({
        productId: l.productId,
        name: l.name,
        sellPrice: l.sellPrice,
        costPrice: l.costPrice,
        quantity: l.quantity,
      })),
    };
    createMutation.mutate(payload);
  };

  const paymentMethods: { key: PaymentMethod; label: string }[] = [
    { key: 'cash' as PaymentMethod, label: 'Наличные' },
    { key: 'card' as PaymentMethod, label: 'Карта' },
    { key: 'cash_card' as PaymentMethod, label: 'Нал/Карта' },
    { key: 'warranty' as PaymentMethod, label: 'Гарантия' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editId ? 'Редактировать чек' : 'Новый чек'}</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Client selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Клиент</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowClientPicker(true)}>
              <Text style={clientId ? styles.selectorText : styles.selectorPlaceholder}>
                {selectedClient?.fullName || 'Выберите клиента (или пропустите)'}
              </Text>
            </TouchableOpacity>
            {clientId && (
              <TouchableOpacity onPress={() => { setClientId(''); setCarId(''); }}>
                <Text style={styles.clearText}>Очистить</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Car selection */}
          {clientId && clientCars && clientCars.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Автомобиль</Text>
              {clientCars.map(car => (
                <TouchableOpacity
                  key={car.id}
                  style={[styles.optionCard, carId === car.id && styles.optionCardSelected]}
                  onPress={() => setCarId(car.id)}
                >
                  <Text style={styles.optionTitle}>{car.makeModel}</Text>
                  <Text style={styles.optionSub}>{car.plateNumber}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Master selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Мастер *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -spacing[4] }}>
              <View style={{ flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4] }}>
                {(masters || []).map(master => (
                  <TouchableOpacity
                    key={master.id}
                    style={[styles.masterChip, masterId === master.id && styles.masterChipSelected]}
                    onPress={() => setMasterId(master.id)}
                  >
                    <Text style={[styles.masterChipText, masterId === master.id && styles.masterChipTextSelected]} numberOfLines={1}>
                      {master.fullName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Services */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Услуги ({serviceLines.length})</Text>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowServicePicker(true)}>
                <Text style={styles.addLineBtnText}>+ Добавить</Text>
              </TouchableOpacity>
            </View>
            {serviceLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeServiceLine(idx)}>
                    <Text style={{ color: colors.red[400], fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.lineInputs}>
                  <View style={styles.lineInputGroup}>
                    <Text style={styles.lineInputLabel}>Цена</Text>
                    <TextInput
                      value={String(line.price)}
                      onChangeText={(v) => updateServiceLine(idx, 'price', Number(v) || 0)}
                      style={styles.lineInput}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.lineInputGroup}>
                    <Text style={styles.lineInputLabel}>Кол-во</Text>
                    <TextInput
                      value={String(line.quantity)}
                      onChangeText={(v) => updateServiceLine(idx, 'quantity', Number(v) || 1)}
                      style={styles.lineInput}
                      keyboardType="numeric"
                    />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.price * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Products */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Товары ({productLines.length})</Text>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowProductPicker(true)}>
                <Text style={styles.addLineBtnText}>+ Добавить</Text>
              </TouchableOpacity>
            </View>
            {productLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeProductLine(idx)}>
                    <Text style={{ color: colors.red[400], fontSize: 16 }}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.lineInputs}>
                  <View style={styles.lineInputGroup}>
                    <Text style={styles.lineInputLabel}>Цена</Text>
                    <TextInput
                      value={String(line.sellPrice)}
                      onChangeText={(v) => updateProductLine(idx, 'sellPrice', Number(v) || 0)}
                      style={styles.lineInput}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={styles.lineInputGroup}>
                    <Text style={styles.lineInputLabel}>Кол-во</Text>
                    <TextInput
                      value={String(line.quantity)}
                      onChangeText={(v) => updateProductLine(idx, 'quantity', Number(v) || 1)}
                      style={styles.lineInput}
                      keyboardType="numeric"
                    />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.sellPrice * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Payment method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Способ оплаты</Text>
            <View style={styles.paymentGrid}>
              {paymentMethods.map(pm => (
                <TouchableOpacity
                  key={pm.key}
                  style={[styles.paymentChip, paymentMethod === pm.key && styles.paymentChipSelected]}
                  onPress={() => setPaymentMethod(pm.key)}
                >
                  <Text style={[styles.paymentChipText, paymentMethod === pm.key && styles.paymentChipTextSelected]}>
                    {pm.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Extra fields */}
          <View style={styles.section}>
            <View style={styles.extraRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineInputLabel}>Пробег (км)</Text>
                <TextInput value={mileage} onChangeText={setMileage} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineInputLabel}>Скидка (₽)</Text>
                <TextInput value={discount} onChangeText={setDiscount} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
              </View>
            </View>
            <Text style={styles.lineInputLabel}>Комментарий</Text>
            <TextInput value={comment} onChangeText={setComment} style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Total */}
          <View style={styles.totalCard}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Услуги</Text>
              <Text style={styles.totalValue}>{formatMoney(serviceTotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Товары</Text>
              <Text style={styles.totalValue}>{formatMoney(productTotal)}</Text>
            </View>
            {discountNum > 0 && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Скидка</Text>
                <Text style={[styles.totalValue, { color: colors.orange[500] }]}>-{formatMoney(discountNum)}</Text>
              </View>
            )}
            <View style={[styles.totalRow, styles.totalRowFinal]}>
              <Text style={styles.totalFinalLabel}>Итого</Text>
              <Text style={styles.totalFinalValue}>{formatMoney(total)}</Text>
            </View>
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, createMutation.isPending && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>{editId ? 'Сохранить' : 'Создать чек'}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Client Picker Modal */}
      <Modal visible={showClientPicker} onClose={() => setShowClientPicker(false)} title="Выберите клиента">
        <TextInput
          value={clientSearch}
          onChangeText={setClientSearch}
          style={styles.formInput}
          placeholder="Поиск клиента..."
          placeholderTextColor={colors.gray[400]}
        />
        <View style={{ marginTop: spacing[3], maxHeight: 300 }}>
          {(clients || []).map(client => (
            <TouchableOpacity
              key={client.id}
              style={styles.pickerItem}
              onPress={() => { setClientId(client.id); setCarId(''); setShowClientPicker(false); }}
            >
              <Text style={styles.pickerItemName}>{client.fullName}</Text>
              <Text style={styles.pickerItemSub}>{client.phone}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Service Picker Modal */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title="Добавить услугу">
        <ScrollView style={{ maxHeight: 400 }}>
          {(allServices || []).map(service => (
            <TouchableOpacity key={service.id} style={styles.pickerItem} onPress={() => addServiceLine(service)}>
              <Text style={styles.pickerItemName}>{service.name}</Text>
              <Text style={styles.pickerItemSub}>{formatMoney(service.defaultPrice)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Modal>

      {/* Product Picker Modal */}
      <Modal visible={showProductPicker} onClose={() => setShowProductPicker(false)} title="Добавить товар">
        <ScrollView style={{ maxHeight: 400 }}>
          {(allProducts || []).map(product => (
            <TouchableOpacity key={product.id} style={styles.pickerItem} onPress={() => addProductLine(product)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerItemName}>{product.name}</Text>
                <Text style={styles.pickerItemSub}>Остаток: {product.stock}</Text>
              </View>
              <Text style={styles.pickerItemPrice}>{formatMoney(product.sellPrice)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[12] },
  section: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[3] },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginBottom: spacing[2] },
  selector: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[3] },
  selectorText: { fontSize: fontSize.sm, color: colors.gray[900] },
  selectorPlaceholder: { fontSize: fontSize.sm, color: colors.gray[400] },
  clearText: { fontSize: fontSize.xs, color: colors.primary[600], marginTop: spacing[1] },
  optionCard: { borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[2] },
  optionCardSelected: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  optionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  optionSub: { fontSize: fontSize.xs, color: colors.gray[500] },
  masterChip: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.xl, backgroundColor: colors.gray[100] },
  masterChipSelected: { backgroundColor: colors.primary[600] },
  masterChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  masterChipTextSelected: { color: colors.white },
  addLineBtn: { backgroundColor: colors.primary[50], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
  addLineBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  lineItem: { backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[2] },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, marginRight: spacing[2] },
  lineInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  lineInputGroup: { flex: 1 },
  lineInputLabel: { fontSize: 11, color: colors.gray[500], marginBottom: 4 },
  lineInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5], fontSize: fontSize.sm, color: colors.gray[900] },
  lineTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], minWidth: 80, textAlign: 'right' },
  paymentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  paymentChip: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[300], backgroundColor: colors.white },
  paymentChipSelected: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  paymentChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  paymentChipTextSelected: { color: colors.primary[700] },
  extraRow: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  totalCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[1.5] },
  totalLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  totalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  totalRowFinal: { borderTopWidth: 1, borderTopColor: colors.gray[200], marginTop: spacing[2], paddingTop: spacing[3] },
  totalFinalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalFinalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  submitBtn: { backgroundColor: colors.primary[600], paddingVertical: spacing[4], borderRadius: borderRadius.xl, alignItems: 'center' },
  submitBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  // Picker
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  pickerItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  pickerItemSub: { fontSize: fontSize.xs, color: colors.gray[500] },
  pickerItemPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
});
