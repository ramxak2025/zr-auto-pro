import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { checksApi, clientsApi, carsApi, usersApi, servicesApi, productsApi } from '../api/services';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car, User, Service, Product, CheckServiceLine, CheckProductLine, PaymentMethod } from '../../../shared/types';

const SCREEN_HEIGHT = Dimensions.get('window').height;

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD'; }

const paymentOptions: { key: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }[] = [
  { key: 'cash' as PaymentMethod, label: '\u041D\u0430\u043B', icon: 'cash-outline', color: colors.green[600], bg: colors.green[50] },
  { key: 'card' as PaymentMethod, label: '\u041A\u0430\u0440\u0442\u0430', icon: 'card-outline', color: colors.blue[600], bg: colors.blue[50] },
  { key: 'cash_card' as PaymentMethod, label: '\u0421\u043F\u043B\u0438\u0442', icon: 'swap-horizontal-outline', color: colors.purple[700], bg: colors.purple[50] },
  { key: 'warranty' as PaymentMethod, label: '\u0413\u0430\u0440.', icon: 'shield-checkmark-outline', color: colors.amber[600], bg: colors.amber[50] },
];

export default function CheckCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const editId = route.params?.id;
  const isStackScreen = !!editId;

  // Date
  const [checkDate, setCheckDate] = useState(new Date());
  const [showDateEdit, setShowDateEdit] = useState(false);
  const [dateInput, setDateInput] = useState('');

  // Client/Car selection
  const [clientId, setClientId] = useState('');
  const [carId, setCarId] = useState('');
  const [mileage, setMileage] = useState('');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash' as PaymentMethod);
  const [cashAmount, setCashAmount] = useState('');
  const [isDeferred, setIsDeferred] = useState(false);

  // Line items
  const [serviceLines, setServiceLines] = useState<(CheckServiceLine & { lineMasterId?: string })[]>([]);
  const [productLines, setProductLines] = useState<CheckProductLine[]>([]);

  // Pickers
  const [plateSearch, setPlateSearch] = useState('');
  const [showPlatePicker, setShowPlatePicker] = useState(false);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showMasterPicker, setShowMasterPicker] = useState<number | null>(null); // index of service line

  // Product folder navigation
  const [productPath, setProductPath] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Load data
  const { data: plateClients } = useQuery<Client[]>({
    queryKey: ['clients-plate', plateSearch],
    queryFn: async () => { const res = await clientsApi.getAll({ search: plateSearch, limit: 20 }); return res.data.data || []; },
    enabled: showPlatePicker && plateSearch.length >= 1,
  });

  const { data: clientData } = useQuery<Client>({
    queryKey: ['client-detail', clientId],
    queryFn: async () => { const res = await clientsApi.getById(clientId); return res.data; },
    enabled: !!clientId,
  });
  const clientCars = clientData?.cars;

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  const masters = useMemo(() => (allUsers || []).filter(u => u.isActive), [allUsers]);

  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['all-services'],
    queryFn: async () => { const res = await servicesApi.getAll({ limit: 500 }); return res.data.data || res.data; },
    enabled: showServicePicker,
  });

  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['all-products-check'],
    queryFn: async () => { const res = await productsApi.getAll({ limit: 500 }); return res.data.data || res.data; },
    enabled: showProductPicker,
  });

  // Plate search results — flatten cars from clients
  const plateResults = useMemo(() => {
    if (!plateClients) return [];
    const results: { client: Client; car: Car }[] = [];
    for (const client of plateClients) {
      if (client.cars) {
        for (const car of client.cars) {
          if (!plateSearch || car.plateNumber?.toLowerCase().includes(plateSearch.toLowerCase()) || client.fullName?.toLowerCase().includes(plateSearch.toLowerCase())) {
            results.push({ client, car });
          }
        }
      }
    }
    return results;
  }, [plateClients, plateSearch]);

  // Product folder navigation
  const { productFolders, visibleProducts } = useMemo(() => {
    const products = allProducts || [];
    if (productSearch) {
      const q = productSearch.toLowerCase();
      return {
        productFolders: new Map<string, number>(),
        visibleProducts: products.filter(p => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q))),
      };
    }

    const subs = new Map<string, number>();
    const prods: Product[] = [];

    for (const p of products) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];
      const matchesPath = productPath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && productPath.length > 0) continue;

      if (catParts.length > productPath.length) {
        const folderName = catParts[productPath.length];
        subs.set(folderName, (subs.get(folderName) || 0) + 1);
      } else if (catParts.length === productPath.length) {
        prods.push(p);
      }
    }

    if (productPath.length === 0) {
      for (const p of products) {
        if (!p.category && !prods.includes(p)) prods.push(p);
      }
    }

    return { productFolders: subs, visibleProducts: prods };
  }, [allProducts, productPath, productSearch]);

  const sortedProductFolders = Array.from(productFolders.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // Load existing check for editing
  useEffect(() => {
    if (editId) {
      checksApi.getById(editId).then((res: any) => {
        const c = res.data;
        setClientId(c.clientId || '');
        setCarId(c.carId || '');
        setMileage(c.mileage ? String(c.mileage) : '');
        setComment(c.comment || '');
        setDiscount(c.discount ? String(c.discount) : '');
        setPaymentMethod(c.paymentMethod);
        setIsDeferred(c.isDeferred || false);
        setServiceLines(c.services || []);
        setProductLines(c.products || []);
        if (c.date) setCheckDate(new Date(c.date));
      });
    }
  }, [editId]);

  const selectedClient = clientData || plateClients?.find(c => c.id === clientId);

  const resetForm = () => {
    setClientId(''); setCarId(''); setMileage('');
    setComment(''); setDiscount(''); setPaymentMethod('cash' as PaymentMethod);
    setCashAmount(''); setIsDeferred(false);
    setServiceLines([]); setProductLines([]);
    setCheckDate(new Date());
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
        Alert.alert('\u0413\u043E\u0442\u043E\u0432\u043E', '\u0427\u0435\u043A \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u0441\u043E\u0437\u0434\u0430\u043D');
      }
    },
    onError: (err: any) => Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', err?.response?.data?.message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0447\u0435\u043A'),
  });

  // Calculations
  const serviceTotal = serviceLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const productTotal = productLines.reduce((sum, l) => sum + l.sellPrice * l.quantity, 0);
  const discountNum = Number(discount) || 0;
  const total = serviceTotal + productTotal - discountNum;
  const cardAmountCalc = Math.max(total - (Number(cashAmount) || 0), 0);

  // Get current user as default master
  const { user: currentUser } = require('../contexts/AuthContext').useAuth();
  const defaultMasterId = currentUser?.id || '';

  const addServiceLine = (service: Service) => {
    setServiceLines(prev => [...prev, {
      serviceId: service.id, name: service.name, price: service.defaultPrice,
      quantity: 1, total: service.defaultPrice, masterId: defaultMasterId,
      lineMasterId: defaultMasterId,
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
    if (!shouldDefer && serviceLines.length === 0 && productLines.length === 0) {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u0414\u043E\u0431\u0430\u0432\u044C\u0442\u0435 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u043D\u0443 \u0443\u0441\u043B\u0443\u0433\u0443 \u0438\u043B\u0438 \u0442\u043E\u0432\u0430\u0440');
      return;
    }

    let finalCash = 0;
    let finalCard = 0;
    if (paymentMethod === ('cash' as PaymentMethod)) {
      finalCash = total;
    } else if (paymentMethod === ('card' as PaymentMethod)) {
      finalCard = total;
    } else if (paymentMethod === ('cash_card' as PaymentMethod)) {
      finalCash = Number(cashAmount) || 0;
      finalCard = Math.max(total - finalCash, 0);
    }

    const payload = {
      clientId: clientId || undefined,
      carId: carId || undefined,
      masterId: defaultMasterId,
      date: checkDate.toISOString(),
      mileage: mileage ? Number(mileage) : undefined,
      comment: comment || undefined,
      discount: discountNum || undefined,
      paymentMethod,
      cashAmount: finalCash || undefined,
      cardAmount: finalCard || undefined,
      isDeferred: shouldDefer,
      services: serviceLines.map(l => ({
        serviceId: l.serviceId, masterId: l.lineMasterId || l.masterId || defaultMasterId,
        name: l.name, price: l.price, quantity: l.quantity,
      })),
      products: productLines.map(l => ({
        productId: l.productId, name: l.name,
        sellPrice: l.sellPrice, costPrice: l.costPrice, quantity: l.quantity,
      })),
    };
    createMutation.mutate(payload);
  };

  // Date formatting
  const dateStr = `${checkDate.getDate().toString().padStart(2, '0')}.${String(checkDate.getMonth() + 1).padStart(2, '0')}.${checkDate.getFullYear()} ${String(checkDate.getHours()).padStart(2, '0')}:${String(checkDate.getMinutes()).padStart(2, '0')}`;

  const applyDateInput = () => {
    // Parse DD.MM.YYYY HH:MM
    const match = dateInput.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (match) {
      const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]));
      if (!isNaN(d.getTime())) {
        setCheckDate(d);
        setShowDateEdit(false);
        return;
      }
    }
    Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u0424\u043E\u0440\u043C\u0430\u0442: ДД.ММ.ГГГГ ЧЧ:ММ');
  };

  // Master name helper
  const getMasterName = (id?: string) => {
    if (!id) return '\u041C\u0430\u0441\u0442\u0435\u0440...';
    const m = masters.find(u => u.id === id);
    return m?.fullName?.split(' ')[0] || '\u041C\u0430\u0441\u0442\u0435\u0440';
  };

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
        <Text style={styles.headerTitle}>{editId ? '\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C' : '\u041D\u043E\u0432\u044B\u0439 \u0447\u0435\u043A'}</Text>
        <TouchableOpacity style={styles.receiptBtn}>
          <Ionicons name="receipt-outline" size={18} color={colors.gray[400]} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Dark header card with editable date */}
          <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.darkCard}>
            <Text style={styles.darkCardTitle}>{'\u0417\u0410\u041A\u0410\u0417-\u041D\u0410\u0420\u042F\u0414'}</Text>
            {showDateEdit ? (
              <View style={styles.dateEditRow}>
                <TextInput
                  value={dateInput}
                  onChangeText={setDateInput}
                  style={styles.dateEditInput}
                  placeholder="ДД.ММ.ГГГГ ЧЧ:ММ"
                  placeholderTextColor={colors.slate[500]}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={applyDateInput}
                />
                <TouchableOpacity onPress={applyDateInput} style={styles.dateEditOk}>
                  <Ionicons name="checkmark" size={16} color={colors.green[400]} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowDateEdit(false)} style={styles.dateEditCancel}>
                  <Ionicons name="close" size={16} color={colors.red[400]} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.dateRow}
                onPress={() => { setDateInput(dateStr); setShowDateEdit(true); }}
              >
                <Ionicons name="calendar-outline" size={14} color={colors.slate[400]} />
                <Text style={styles.darkCardDate}>{dateStr}</Text>
                <Ionicons name="pencil-outline" size={12} color={colors.slate[500]} />
              </TouchableOpacity>
            )}
          </LinearGradient>

          {/* Search by plate number */}
          <View style={styles.plateSearch}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TouchableOpacity style={{ flex: 1 }} onPress={() => { setPlateSearch(''); setShowPlatePicker(true); }}>
              <Text style={[styles.plateSearchText, clientId && { color: colors.gray[900] }]}>
                {selectedClient ? `${selectedClient.fullName}` : '\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440\u0443 \u0438\u043B\u0438 \u0438\u043C\u0435\u043D\u0438'}
              </Text>
            </TouchableOpacity>
            {clientId ? (
              <TouchableOpacity onPress={() => { setClientId(''); setCarId(''); }}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Retail customer badge */}
          {!clientId && (
            <View style={styles.retailBadge}>
              <Ionicons name="person-outline" size={14} color={colors.blue[500]} />
              <Text style={styles.retailText}>{'\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'}</Text>
            </View>
          )}

          {/* Car selection */}
          {clientId && clientCars && clientCars.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{'\u0410\u0412\u0422\u041E\u041C\u041E\u0411\u0418\u041B\u042C'}</Text>
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
            <TextInput value={mileage} onChangeText={setMileage} style={styles.mileageInput} keyboardType="numeric" placeholder={'\u041F\u0440\u043E\u0431\u0435\u0433, \u043A\u043C'} placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Services — with per-line master */}
          <View style={styles.linesSection}>
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <Ionicons name="build-outline" size={16} color={colors.gray[500]} />
                <Text style={styles.linesSectionTitle}>{'\u0423\u0441\u043B\u0443\u0433\u0438'}</Text>
                <View style={styles.lineBadge}>
                  <Text style={styles.lineBadgeText}>{serviceLines.length}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowServicePicker(true)}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
                <Text style={styles.addLineBtnText}>{'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C'}</Text>
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
                {/* Per-service master selector */}
                <TouchableOpacity
                  style={styles.lineMasterRow}
                  onPress={() => setShowMasterPicker(idx)}
                >
                  <Ionicons name="person-outline" size={13} color={colors.primary[500]} />
                  <Text style={styles.lineMasterText}>{getMasterName(line.lineMasterId || line.masterId)}</Text>
                  <Ionicons name="chevron-down" size={12} color={colors.gray[400]} />
                </TouchableOpacity>
                <View style={styles.lineInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>{'\u0426\u0435\u043D\u0430'}</Text>
                    <TextInput value={String(line.price)} onChangeText={(v) => updateServiceLine(idx, 'price', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>{'\u041A\u043E\u043B-\u0432\u043E'}</Text>
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
                <Text style={styles.linesSectionTitle}>{'\u0422\u043E\u0432\u0430\u0440\u044B'}</Text>
                <View style={styles.lineBadge}>
                  <Text style={styles.lineBadgeText}>{productLines.length}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => { setProductPath([]); setProductSearch(''); setShowProductPicker(true); }}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
                <Text style={styles.addLineBtnText}>{'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C'}</Text>
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
                    <Text style={styles.lineInputLabel}>{'\u0426\u0435\u043D\u0430'}</Text>
                    <TextInput value={String(line.sellPrice)} onChangeText={(v) => updateProductLine(idx, 'sellPrice', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>{'\u041A\u043E\u043B-\u0432\u043E'}</Text>
                    <TextInput value={String(line.quantity)} onChangeText={(v) => updateProductLine(idx, 'quantity', Number(v) || 1)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.sellPrice * line.quantity)}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Discount — above payment */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', gap: spacing[3] }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionLabel}>{'\u0421\u041A\u0418\u0414\u041A\u0410'}</Text>
                <TextInput value={discount} onChangeText={setDiscount} style={styles.formInput} keyboardType="numeric" placeholder="0 \u20BD" placeholderTextColor={colors.gray[400]} />
              </View>
            </View>
          </View>

          {/* Comment — above payment */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{'\u041A\u041E\u041C\u041C\u0415\u041D\u0422\u0410\u0420\u0418\u0419'}</Text>
            <TextInput value={comment} onChangeText={setComment} style={[styles.formInput, { minHeight: 56, textAlignVertical: 'top' }]} multiline placeholder={'\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E'} placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Payment method */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{'\u0421\u041F\u041E\u0421\u041E\u0411 \u041E\u041F\u041B\u0410\u0422\u042B'}</Text>
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

            {/* Split payment — clear cash/card breakdown */}
            {paymentMethod === ('cash_card' as PaymentMethod) && (
              <View style={styles.splitWrap}>
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
                    <Text style={styles.splitLabel}>{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435:'}</Text>
                  </View>
                  <TextInput
                    value={cashAmount}
                    onChangeText={setCashAmount}
                    style={styles.splitInput}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={colors.gray[400]}
                  />
                </View>
                <View style={styles.splitDivider} />
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="card-outline" size={16} color={colors.blue[600]} />
                    <Text style={styles.splitLabel}>{'\u041A\u0430\u0440\u0442\u0430:'}</Text>
                  </View>
                  <Text style={styles.splitCardAmount}>{formatMoney(cardAmountCalc)}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Deferred toggle */}
          <TouchableOpacity
            style={[styles.deferToggle, isDeferred && styles.deferToggleActive]}
            onPress={() => setIsDeferred(!isDeferred)}
          >
            <Ionicons name={isDeferred ? 'checkbox' : 'square-outline'} size={20} color={isDeferred ? colors.red[600] : colors.gray[400]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.deferLabel, isDeferred && { color: colors.red[700] }]}>{'\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0447\u0435\u043A'}</Text>
              <Text style={styles.deferHint}>{'\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043A\u0430\u043A \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A'}</Text>
            </View>
          </TouchableOpacity>

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
                  {isDeferred ? '\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0447\u0435\u043A' : editId ? '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C' : `\u041F\u0440\u043E\u0431\u0438\u0442\u044C \u0447\u0435\u043A \u2014 ${formatMoney(total)}`}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Plate / Client Picker */}
      <Modal visible={showPlatePicker} onClose={() => setShowPlatePicker(false)} title={'\u041F\u043E\u0438\u0441\u043A \u043F\u043E \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440\u0443'}>
        <TextInput
          value={plateSearch}
          onChangeText={setPlateSearch}
          style={styles.formInput}
          placeholder={'\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440 \u0438\u043B\u0438 \u0438\u043C\u044F...'}
          placeholderTextColor={colors.gray[400]}
          autoFocus
          autoCapitalize="characters"
        />
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4, marginTop: spacing[3] }}>
          {plateResults.map(({ client, car }) => (
            <TouchableOpacity
              key={`${client.id}-${car.id}`}
              style={styles.pickerItem}
              onPress={() => { setClientId(client.id); setCarId(car.id); setShowPlatePicker(false); }}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  {car.plateNumber && (
                    <View style={styles.plateChip}>
                      <Text style={styles.plateChipText}>{car.plateNumber}</Text>
                    </View>
                  )}
                  <Text style={styles.pickerName}>{car.makeModel}</Text>
                </View>
                <Text style={styles.pickerSub}>{client.fullName} {client.phone ? `\u2022 ${client.phone}` : ''}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {plateSearch.length >= 1 && plateResults.length === 0 && (
            <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] }}>{'\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E'}</Text>
          )}
        </ScrollView>
      </Modal>

      {/* Master Picker for service line */}
      <Modal visible={showMasterPicker !== null} onClose={() => setShowMasterPicker(null)} title={'\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043C\u0430\u0441\u0442\u0435\u0440\u0430'}>
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4 }}>
          {masters.map(m => {
            const isSelected = showMasterPicker !== null && (serviceLines[showMasterPicker]?.lineMasterId || serviceLines[showMasterPicker]?.masterId) === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.pickerItem, isSelected && { backgroundColor: colors.primary[50] }]}
                onPress={() => {
                  if (showMasterPicker !== null) {
                    updateServiceLine(showMasterPicker, 'lineMasterId', m.id);
                    updateServiceLine(showMasterPicker, 'masterId', m.id);
                  }
                  setShowMasterPicker(null);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <Ionicons name="person-circle-outline" size={22} color={isSelected ? colors.primary[600] : colors.gray[400]} />
                  <Text style={[styles.pickerName, isSelected && { color: colors.primary[700] }]}>{m.fullName}</Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={18} color={colors.primary[600]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Modal>

      {/* Service Picker */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title={'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443'}>
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }}>
          {(allServices || []).map(service => (
            <TouchableOpacity key={service.id} style={styles.pickerItem} onPress={() => addServiceLine(service)}>
              <Text style={styles.pickerName}>{service.name}</Text>
              <Text style={styles.pickerPrice}>{formatMoney(service.defaultPrice)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Modal>

      {/* Product Picker with Folder Navigation */}
      <Modal visible={showProductPicker} onClose={() => setShowProductPicker(false)} title={'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440'}>
        {/* Search */}
        <TextInput
          value={productSearch}
          onChangeText={setProductSearch}
          style={[styles.formInput, { marginBottom: spacing[3] }]}
          placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
          placeholderTextColor={colors.gray[400]}
        />

        {/* Breadcrumbs */}
        {!productSearch && productPath.length > 0 && (
          <View style={styles.breadcrumbRow}>
            <TouchableOpacity onPress={() => setProductPath([])} style={styles.breadcrumbItem}>
              <Ionicons name="home-outline" size={12} color={colors.primary[600]} />
              <Text style={styles.breadcrumbText}>{'\u0412\u0441\u0435'}</Text>
            </TouchableOpacity>
            {productPath.map((seg, i) => (
              <React.Fragment key={i}>
                <Ionicons name="chevron-forward" size={10} color={colors.gray[300]} />
                <TouchableOpacity onPress={() => setProductPath(prev => prev.slice(0, i + 1))} style={styles.breadcrumbItem}>
                  <Text style={[styles.breadcrumbText, i === productPath.length - 1 && { color: colors.gray[900], fontWeight: fontWeight.bold }]}>{seg}</Text>
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        )}

        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.45 }}>
          {/* Folders */}
          {!productSearch && sortedProductFolders.length > 0 && (
            <View style={styles.productFoldersGrid}>
              {sortedProductFolders.map(([name, count]) => (
                <TouchableOpacity key={name} style={styles.productFolderCard} onPress={() => setProductPath(prev => [...prev, name])}>
                  <Ionicons name="folder-open-outline" size={20} color={colors.primary[500]} />
                  <Text style={styles.productFolderName} numberOfLines={2}>{name}</Text>
                  <Text style={styles.productFolderCount}>{count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Products list */}
          {visibleProducts.map(product => (
            <TouchableOpacity key={product.id} style={styles.pickerItem} onPress={() => addProductLine(product)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerName}>{product.name}</Text>
                <Text style={styles.pickerSub}>{'\u041E\u0441\u0442\u0430\u0442\u043E\u043A: '}{product.stock} {'\u0448\u0442'}</Text>
              </View>
              <Text style={styles.pickerPrice}>{formatMoney(product.sellPrice)}</Text>
            </TouchableOpacity>
          ))}

          {!productSearch && sortedProductFolders.length === 0 && visibleProducts.length === 0 && (
            <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] }}>{'\u041F\u0443\u0441\u0442\u043E'}</Text>
          )}
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
  darkCardDate: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.slate[300] },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 4 },
  dateEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 4 },
  dateEditInput: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: borderRadius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], color: colors.white, fontSize: fontSize.sm, minWidth: 160, textAlign: 'center' },
  dateEditOk: { padding: spacing[1] },
  dateEditCancel: { padding: spacing[1] },
  // Plate search
  plateSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[3] },
  plateSearchText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Retail
  retailBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.blue[50], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderWidth: 1, borderColor: colors.blue[200] },
  retailText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.blue[700] },
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
  // Lines
  linesSection: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  linesSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  linesSectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  lineBadge: { backgroundColor: colors.gray[100], paddingHorizontal: 6, paddingVertical: 1, borderRadius: borderRadius.full },
  lineBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500] },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], backgroundColor: colors.primary[50], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.lg },
  addLineBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  lineItem: { backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[2] },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, marginRight: spacing[2] },
  lineMasterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1], marginBottom: spacing[2], alignSelf: 'flex-start' },
  lineMasterText: { fontSize: 12, color: colors.primary[700], fontWeight: fontWeight.medium },
  lineInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  lineInputLabel: { fontSize: 11, color: colors.gray[500], marginBottom: 4 },
  lineInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5], fontSize: fontSize.sm, color: colors.gray[900] },
  lineTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], minWidth: 70, textAlign: 'right' },
  // Payment
  paymentRow: { flexDirection: 'row', gap: spacing[2] },
  paymentBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing[3], borderRadius: borderRadius.xl, borderWidth: 1.5, borderColor: colors.gray[200], backgroundColor: colors.white, gap: spacing[1] },
  paymentBtnText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[500] },
  // Split
  splitWrap: { marginTop: spacing[3], backgroundColor: colors.purple[50], borderRadius: borderRadius.xl, padding: spacing[3], borderWidth: 1, borderColor: colors.purple[200] },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitIconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  splitLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  splitInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.purple[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900], width: 120, textAlign: 'right' },
  splitDivider: { height: 1, backgroundColor: colors.purple[200], marginVertical: spacing[2] },
  splitCardAmount: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.blue[600] },
  // Defer
  deferToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
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
  pickerSub: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  pickerPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  plateChip: { backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: 2, borderWidth: 1, borderColor: colors.primary[200] },
  plateChipText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.primary[700] },
  // Breadcrumbs
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[1], marginBottom: spacing[3] },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  breadcrumbText: { fontSize: 12, color: colors.primary[600], fontWeight: fontWeight.medium },
  // Product folders in picker
  productFoldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  productFolderCard: { width: '30%', backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[2], alignItems: 'center', gap: 4 },
  productFolderName: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[900], textAlign: 'center', lineHeight: 14 },
  productFolderCount: { fontSize: 10, color: colors.gray[400] },
});
