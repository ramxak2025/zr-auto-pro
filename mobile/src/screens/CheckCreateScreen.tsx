import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Dimensions,
  Image, Animated, Modal as RNModal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { checksApi, clientsApi, carsApi, usersApi, servicesApi, productsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car, User, Service, Product, CheckServiceLine, CheckProductLine, PaymentMethod } from '../../../shared/types';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

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

  // Date with native picker
  const [checkDate, setCheckDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

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
  const [showMasterPicker, setShowMasterPicker] = useState<number | null>(null);

  // Product folder navigation
  const [productPath, setProductPath] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Service search
  const [serviceSearch, setServiceSearch] = useState('');

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

  // Plate search results
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

  // Filtered services
  const filteredServices = useMemo(() => {
    const services = allServices || [];
    if (!serviceSearch) return services;
    const q = serviceSearch.toLowerCase();
    return services.filter(s => s.name.toLowerCase().includes(q));
  }, [allServices, serviceSearch]);

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
  const subtotal = serviceTotal + productTotal;
  const total = subtotal - discountNum;
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
    const existing = productLines.findIndex(l => l.productId === product.id);
    if (existing >= 0) {
      updateProductLine(existing, 'quantity', productLines[existing].quantity + 1);
    } else {
      setProductLines(prev => [...prev, {
        productId: product.id, name: product.name, sellPrice: product.sellPrice,
        costPrice: product.costPrice, quantity: 1, totalSell: product.sellPrice, totalCost: product.costPrice,
      }]);
    }
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
  const dateStr = `${checkDate.getDate().toString().padStart(2, '0')}.${String(checkDate.getMonth() + 1).padStart(2, '0')}.${checkDate.getFullYear()}`;
  const timeStr = `${String(checkDate.getHours()).padStart(2, '0')}:${String(checkDate.getMinutes()).padStart(2, '0')}`;

  // Master name helper
  const getMasterName = (id?: string) => {
    if (!id) return '\u041C\u0430\u0441\u0442\u0435\u0440...';
    const m = masters.find(u => u.id === id);
    return m?.fullName?.split(' ')[0] || '\u041C\u0430\u0441\u0442\u0435\u0440';
  };

  // Product quantity in cart
  const getProductCartQty = (productId: string) => {
    const line = productLines.find(l => l.productId === productId);
    return line?.quantity || 0;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Minimal header — only show back button when editing */}
      {isStackScreen && (
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.primary[600]} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{'\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435'}</Text>
          <View style={{ width: 36 }} />
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Date/Time section with native picker */}
          <View style={styles.dateTimeCard}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
              <Ionicons name="calendar-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.dateBtnText}>{dateStr}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.timeBtn} onPress={() => setShowTimePicker(true)}>
              <Ionicons name="time-outline" size={18} color={colors.primary[600]} />
              <Text style={styles.timeBtnText}>{timeStr}</Text>
            </TouchableOpacity>
          </View>

          {/* Native DateTimePicker */}
          {showDatePicker && (
            <DateTimePicker
              value={checkDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, selectedDate) => {
                setShowDatePicker(false);
                if (selectedDate) {
                  const updated = new Date(checkDate);
                  updated.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
                  setCheckDate(updated);
                }
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={checkDate}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              is24Hour
              onChange={(_, selectedDate) => {
                setShowTimePicker(false);
                if (selectedDate) {
                  const updated = new Date(checkDate);
                  updated.setHours(selectedDate.getHours(), selectedDate.getMinutes());
                  setCheckDate(updated);
                }
              }}
            />
          )}

          {/* Search by plate number */}
          <TouchableOpacity style={styles.plateSearch} onPress={() => { setPlateSearch(''); setShowPlatePicker(true); }} activeOpacity={0.7}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <Text style={[styles.plateSearchText, clientId && { color: colors.gray[900], fontWeight: fontWeight.medium }]}>
              {selectedClient ? selectedClient.fullName : '\u041F\u043E\u0438\u0441\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0430 \u043F\u043E \u0433\u043E\u0441\u043D\u043E\u043C\u0435\u0440\u0443 \u0438\u043B\u0438 \u0438\u043C\u0435\u043D\u0438'}
            </Text>
            {clientId ? (
              <TouchableOpacity onPress={() => { setClientId(''); setCarId(''); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : (
              <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
            )}
          </TouchableOpacity>

          {/* Car selection */}
          {clientId && clientCars && clientCars.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: -spacing[1] }}>
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
          )}

          {/* Mileage */}
          <View style={styles.mileageRow}>
            <Ionicons name="speedometer-outline" size={16} color={colors.gray[400]} />
            <TextInput value={mileage} onChangeText={setMileage} style={styles.mileageInput} keyboardType="numeric" placeholder={'\u041F\u0440\u043E\u0431\u0435\u0433, \u043A\u043C'} placeholderTextColor={colors.gray[400]} />
          </View>

          {/* Services */}
          <View style={styles.linesSection}>
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View style={[styles.sectionIcon, { backgroundColor: colors.orange[50] }]}>
                  <Ionicons name="build-outline" size={14} color={colors.orange[500]} />
                </View>
                <Text style={styles.linesSectionTitle}>{'\u0423\u0441\u043B\u0443\u0433\u0438'}</Text>
                {serviceLines.length > 0 && (
                  <View style={styles.lineBadge}>
                    <Text style={styles.lineBadgeText}>{serviceLines.length}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => { setServiceSearch(''); setShowServicePicker(true); }}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>
            {serviceLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeServiceLine(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.lineMasterRow} onPress={() => setShowMasterPicker(idx)}>
                  <Ionicons name="person-outline" size={12} color={colors.primary[500]} />
                  <Text style={styles.lineMasterText}>{getMasterName(line.lineMasterId || line.masterId)}</Text>
                  <Ionicons name="chevron-down" size={10} color={colors.gray[400]} />
                </TouchableOpacity>
                <View style={styles.lineInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>{'\u0426\u0435\u043D\u0430'}</Text>
                    <TextInput value={String(line.price)} onChangeText={(v) => updateServiceLine(idx, 'price', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ width: 60 }}>
                    <Text style={styles.lineInputLabel}>{'\u041A\u043E\u043B.'}</Text>
                    <TextInput value={String(line.quantity)} onChangeText={(v) => updateServiceLine(idx, 'quantity', Number(v) || 1)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.price * line.quantity)}</Text>
                </View>
              </View>
            ))}
            {serviceLines.length === 0 && (
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => { setServiceSearch(''); setShowServicePicker(true); }}>
                <Ionicons name="add-circle-outline" size={18} color={colors.gray[400]} />
                <Text style={styles.emptyAddText}>{'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Products */}
          <View style={styles.linesSection}>
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View style={[styles.sectionIcon, { backgroundColor: colors.blue[50] }]}>
                  <Ionicons name="cube-outline" size={14} color={colors.blue[600]} />
                </View>
                <Text style={styles.linesSectionTitle}>{'\u0422\u043E\u0432\u0430\u0440\u044B'}</Text>
                {productLines.length > 0 && (
                  <View style={styles.lineBadge}>
                    <Text style={styles.lineBadgeText}>{productLines.length}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity style={styles.addLineBtn} onPress={() => { setProductPath([]); setProductSearch(''); setShowProductPicker(true); }}>
                <Ionicons name="add" size={16} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>
            {productLines.map((line, idx) => (
              <View key={idx} style={styles.lineItem}>
                <View style={styles.lineTop}>
                  <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
                  <TouchableOpacity onPress={() => removeProductLine(idx)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
                <View style={styles.lineInputs}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineInputLabel}>{'\u0426\u0435\u043D\u0430'}</Text>
                    <TextInput value={String(line.sellPrice)} onChangeText={(v) => updateProductLine(idx, 'sellPrice', Number(v) || 0)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <View style={{ width: 60 }}>
                    <Text style={styles.lineInputLabel}>{'\u041A\u043E\u043B.'}</Text>
                    <TextInput value={String(line.quantity)} onChangeText={(v) => updateProductLine(idx, 'quantity', Number(v) || 1)} style={styles.lineInput} keyboardType="numeric" />
                  </View>
                  <Text style={styles.lineTotal}>{formatMoney(line.sellPrice * line.quantity)}</Text>
                </View>
              </View>
            ))}
            {productLines.length === 0 && (
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => { setProductPath([]); setProductSearch(''); setShowProductPicker(true); }}>
                <Ionicons name="add-circle-outline" size={18} color={colors.gray[400]} />
                <Text style={styles.emptyAddText}>{'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u0432\u0430\u0440'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Discount */}
          <View style={styles.discountRow}>
            <Ionicons name="pricetag-outline" size={16} color={colors.gray[400]} />
            <Text style={styles.discountLabel}>{'\u0421\u043A\u0438\u0434\u043A\u0430'}</Text>
            <TextInput
              value={discount}
              onChangeText={setDiscount}
              style={styles.discountInput}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.gray[400]}
            />
            <Text style={styles.discountCurrency}>{'\u20BD'}</Text>
          </View>

          {/* Comment */}
          <View style={styles.commentSection}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[2] }}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.gray[400]} />
              <Text style={styles.commentLabel}>{'\u041A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0439'}</Text>
            </View>
            <TextInput
              value={comment}
              onChangeText={setComment}
              style={styles.commentInput}
              multiline
              placeholder={'\u041D\u0435\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E'}
              placeholderTextColor={colors.gray[400]}
            />
          </View>

          {/* Order Summary */}
          {(serviceLines.length > 0 || productLines.length > 0) && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>{'\u0418\u0422\u041E\u0413\u041E'}</Text>

              {serviceLines.length > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="build-outline" size={14} color={colors.gray[400]} />
                    <Text style={styles.summaryLabel}>{'\u0423\u0441\u043B\u0443\u0433\u0438'} ({serviceLines.length})</Text>
                  </View>
                  <Text style={styles.summaryValue}>{formatMoney(serviceTotal)}</Text>
                </View>
              )}

              {productLines.length > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="cube-outline" size={14} color={colors.gray[400]} />
                    <Text style={styles.summaryLabel}>{'\u0422\u043E\u0432\u0430\u0440\u044B'} ({productLines.length})</Text>
                  </View>
                  <Text style={styles.summaryValue}>{formatMoney(productTotal)}</Text>
                </View>
              )}

              {(serviceLines.length > 0 && productLines.length > 0) && (
                <>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>{'\u041F\u043E\u0434\u0438\u0442\u043E\u0433'}</Text>
                    <Text style={styles.summaryValue}>{formatMoney(subtotal)}</Text>
                  </View>
                </>
              )}

              {discountNum > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="pricetag-outline" size={14} color={colors.orange[500]} />
                    <Text style={[styles.summaryLabel, { color: colors.orange[600] }]}>{'\u0421\u043A\u0438\u0434\u043A\u0430'}</Text>
                  </View>
                  <Text style={[styles.summaryValue, { color: colors.orange[600] }]}>-{formatMoney(discountNum)}</Text>
                </View>
              )}

              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryTotalLabel}>{'\u041A \u043E\u043F\u043B\u0430\u0442\u0435'}</Text>
                <Text style={styles.summaryTotalValue}>{formatMoney(total)}</Text>
              </View>
            </View>
          )}

          {/* Payment method */}
          <View style={styles.paymentSection}>
            <Text style={styles.paymentTitle}>{'\u0421\u043F\u043E\u0441\u043E\u0431 \u043E\u043F\u043B\u0430\u0442\u044B'}</Text>
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

            {paymentMethod === ('cash_card' as PaymentMethod) && (
              <View style={styles.splitWrap}>
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
                    <Text style={styles.splitLabel}>{'\u041D\u0430\u043B\u0438\u0447\u043D\u044B\u0435'}</Text>
                  </View>
                  <TextInput value={cashAmount} onChangeText={setCashAmount} style={styles.splitInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
                </View>
                <View style={styles.splitDivider} />
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="card-outline" size={16} color={colors.blue[600]} />
                    <Text style={styles.splitLabel}>{'\u041A\u0430\u0440\u0442\u0430'}</Text>
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
            <Ionicons name={isDeferred ? 'checkbox' : 'square-outline'} size={20} color={isDeferred ? colors.amber[600] : colors.gray[400]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.deferLabel, isDeferred && { color: colors.amber[600] }]}>{'\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C \u0447\u0435\u043A'}</Text>
              <Text style={styles.deferHint}>{'\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043A\u0430\u043A \u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A'}</Text>
            </View>
          </TouchableOpacity>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, isDeferred && styles.submitBtnDeferred, createMutation.isPending && { opacity: 0.5 }]}
            onPress={() => handleSubmit()}
            disabled={createMutation.isPending}
            activeOpacity={0.8}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <LinearGradient
                colors={isDeferred ? [colors.amber[600], '#b45309'] : [colors.primary[600], colors.primary[700]]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.submitGradient}
              >
                <Ionicons name={isDeferred ? 'pause-circle-outline' : 'checkmark-circle-outline'} size={20} color={colors.white} />
                <Text style={styles.submitBtnText}>
                  {isDeferred ? '\u041E\u0442\u043B\u043E\u0436\u0438\u0442\u044C' : editId ? '\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C' : `\u041F\u0440\u043E\u0431\u0438\u0442\u044C \u2014 ${formatMoney(total)}`}
                </Text>
              </LinearGradient>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Plate / Client Picker */}
      <Modal visible={showPlatePicker} onClose={() => setShowPlatePicker(false)} title={'\u041F\u043E\u0438\u0441\u043A \u043A\u043B\u0438\u0435\u043D\u0442\u0430'}>
        <TextInput
          value={plateSearch}
          onChangeText={setPlateSearch}
          style={styles.formInput}
          placeholder={'\u0413\u043E\u0441\u043D\u043E\u043C\u0435\u0440, \u0438\u043C\u044F \u0438\u043B\u0438 \u0442\u0435\u043B\u0435\u0444\u043E\u043D...'}
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
              <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
            </TouchableOpacity>
          ))}
          {plateSearch.length >= 1 && plateResults.length === 0 && (
            <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] }}>{'\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E'}</Text>
          )}
        </ScrollView>
      </Modal>

      {/* Master Picker */}
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
                  <View style={[styles.masterCircle, isSelected && { backgroundColor: colors.primary[100] }]}>
                    <Ionicons name="person" size={14} color={isSelected ? colors.primary[600] : colors.gray[400]} />
                  </View>
                  <Text style={[styles.pickerName, isSelected && { color: colors.primary[700] }]}>{m.fullName}</Text>
                </View>
                {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Modal>

      {/* Service Picker */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title={'\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0441\u043B\u0443\u0433\u0443'}>
        <TextInput
          value={serviceSearch}
          onChangeText={setServiceSearch}
          style={[styles.formInput, { marginBottom: spacing[3] }]}
          placeholder={'\u041F\u043E\u0438\u0441\u043A \u0443\u0441\u043B\u0443\u0433\u0438...'}
          placeholderTextColor={colors.gray[400]}
          autoFocus
        />
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }}>
          {filteredServices.map(service => (
            <TouchableOpacity key={service.id} style={styles.pickerItem} onPress={() => addServiceLine(service)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerName}>{service.name}</Text>
              </View>
              <Text style={styles.pickerPrice}>{formatMoney(service.defaultPrice)}</Text>
            </TouchableOpacity>
          ))}
          {serviceSearch && filteredServices.length === 0 && (
            <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] }}>{'\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E'}</Text>
          )}
        </ScrollView>
      </Modal>

      {/* Fullscreen Product Picker */}
      <RNModal visible={showProductPicker} animationType="slide" onRequestClose={() => setShowProductPicker(false)}>
        <SafeAreaView style={styles.productPickerSafe} edges={['top']}>
          {/* Product picker header */}
          <View style={styles.productPickerHeader}>
            <TouchableOpacity onPress={() => setShowProductPicker(false)} style={styles.productPickerClose}>
              <Ionicons name="close" size={22} color={colors.gray[600]} />
            </TouchableOpacity>
            <Text style={styles.productPickerTitle}>{'\u0422\u043E\u0432\u0430\u0440\u044B'}</Text>
            {productLines.length > 0 && (
              <TouchableOpacity onPress={() => setShowProductPicker(false)} style={styles.productPickerDone}>
                <Text style={styles.productPickerDoneText}>{'\u0413\u043E\u0442\u043E\u0432\u043E'} ({productLines.length})</Text>
              </TouchableOpacity>
            )}
            {productLines.length === 0 && <View style={{ width: 70 }} />}
          </View>

          {/* Search */}
          <View style={styles.productSearchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TextInput
              value={productSearch}
              onChangeText={setProductSearch}
              style={styles.productSearchInput}
              placeholder={'\u041F\u043E\u0438\u0441\u043A \u0442\u043E\u0432\u0430\u0440\u0430...'}
              placeholderTextColor={colors.gray[400]}
            />
            {productSearch ? (
              <TouchableOpacity onPress={() => setProductSearch('')}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Breadcrumbs */}
          {!productSearch && productPath.length > 0 && (
            <View style={styles.breadcrumbRow}>
              <TouchableOpacity onPress={() => setProductPath([])} style={styles.breadcrumbItem}>
                <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
              {productPath.map((seg, i) => (
                <React.Fragment key={i}>
                  <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
                  <TouchableOpacity onPress={() => setProductPath(prev => prev.slice(0, i + 1))} style={styles.breadcrumbItem}>
                    <Text style={[styles.breadcrumbText, i === productPath.length - 1 && { color: colors.gray[900], fontWeight: fontWeight.bold }]}>{seg}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          )}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[12] }}>
            {/* Folders */}
            {!productSearch && sortedProductFolders.length > 0 && (
              <View style={styles.productFoldersGrid}>
                {sortedProductFolders.map(([name, count]) => (
                  <TouchableOpacity key={name} style={styles.productFolderCard} onPress={() => setProductPath(prev => [...prev, name])}>
                    <Ionicons name="folder-open" size={22} color={colors.primary[500]} />
                    <Text style={styles.productFolderName} numberOfLines={2}>{name}</Text>
                    <Text style={styles.productFolderCount}>{count} {'\u0442\u043E\u0432.'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Products */}
            {visibleProducts.map(product => {
              const cartQty = getProductCartQty(product.id);
              const photoUrl = getImageUrl((product as any).photo);
              return (
                <TouchableOpacity key={product.id} style={styles.productItem} onPress={() => addProductLine(product)} activeOpacity={0.6}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.productPhoto} />
                  ) : (
                    <View style={[styles.productPhoto, styles.productPhotoPlaceholder]}>
                      <Ionicons name="cube-outline" size={20} color={colors.gray[300]} />
                    </View>
                  )}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 }}>
                      <Text style={styles.productPrice}>{formatMoney(product.sellPrice)}</Text>
                      <Text style={styles.productStock}>{'\u041E\u0441\u0442: '}{product.stock} {'\u0448\u0442'}</Text>
                    </View>
                  </View>
                  {cartQty > 0 ? (
                    <View style={styles.productCartBadge}>
                      <Text style={styles.productCartBadgeText}>{cartQty}</Text>
                    </View>
                  ) : (
                    <Ionicons name="add-circle" size={28} color={colors.primary[500]} />
                  )}
                </TouchableOpacity>
              );
            })}

            {!productSearch && sortedProductFolders.length === 0 && visibleProducts.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
                <Ionicons name="cube-outline" size={40} color={colors.gray[300]} />
                <Text style={{ color: colors.gray[400], marginTop: spacing[2] }}>{'\u041D\u0435\u0442 \u0442\u043E\u0432\u0430\u0440\u043E\u0432'}</Text>
              </View>
            )}
            {productSearch && visibleProducts.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
                <Ionicons name="search-outline" size={40} color={colors.gray[300]} />
                <Text style={{ color: colors.gray[400], marginTop: spacing[2] }}>{'\u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E'}</Text>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </RNModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[12] },
  // Date/Time
  dateTimeCard: { flexDirection: 'row', gap: spacing[2] },
  dateBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingVertical: spacing[3] },
  dateBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  timeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingVertical: spacing[3], paddingHorizontal: spacing[4] },
  timeBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  // Plate search
  plateSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[3] },
  plateSearchText: { flex: 1, fontSize: fontSize.sm, color: colors.gray[400] },
  // Car
  carChip: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: colors.white },
  carChipActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  carChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  carChipTextActive: { color: colors.primary[700] },
  carPlate: { fontSize: 10, color: colors.gray[400], backgroundColor: colors.gray[100], paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  // Mileage
  mileageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[100], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[1] },
  mileageInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: spacing[2] },
  // Lines sections
  linesSection: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  linesSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  linesSectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  sectionIcon: { width: 28, height: 28, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  lineBadge: { backgroundColor: colors.primary[50], paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full },
  lineBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.primary[600] },
  addLineBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  lineItem: { backgroundColor: colors.gray[50], borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[2] },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], flex: 1, marginRight: spacing[2] },
  lineMasterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: 3, marginBottom: spacing[2], alignSelf: 'flex-start' },
  lineMasterText: { fontSize: 11, color: colors.primary[700], fontWeight: fontWeight.medium },
  lineInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  lineInputLabel: { fontSize: 10, color: colors.gray[500], marginBottom: 2 },
  lineInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: spacing[1.5], fontSize: fontSize.sm, color: colors.gray[900] },
  lineTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], minWidth: 70, textAlign: 'right' },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[3], borderWidth: 1, borderStyle: 'dashed', borderColor: colors.gray[200], borderRadius: borderRadius.lg },
  emptyAddText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Discount
  discountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[100], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5] },
  discountLabel: { fontSize: fontSize.sm, color: colors.gray[500], flex: 1 },
  discountInput: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], textAlign: 'right', minWidth: 60, paddingVertical: spacing[1] },
  discountCurrency: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Comment
  commentSection: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[100], borderRadius: borderRadius.xl, padding: spacing[3.5] },
  commentLabel: { fontSize: fontSize.xs, color: colors.gray[500], fontWeight: fontWeight.medium },
  commentInput: { fontSize: fontSize.sm, color: colors.gray[900], minHeight: 44, textAlignVertical: 'top' },
  // Order Summary
  summaryCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 2, borderColor: colors.primary[100], padding: spacing[4] },
  summaryTitle: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[400], letterSpacing: 1, marginBottom: spacing[3] },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1.5] },
  summaryLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  summaryDivider: { height: 1, backgroundColor: colors.gray[100], marginVertical: spacing[1.5] },
  summaryTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  summaryTotalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary[600] },
  // Payment
  paymentSection: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  paymentTitle: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[400], letterSpacing: 1, marginBottom: spacing[3] },
  paymentRow: { flexDirection: 'row', gap: spacing[2] },
  paymentBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing[3], borderRadius: borderRadius.xl, borderWidth: 1.5, borderColor: colors.gray[200], backgroundColor: colors.white, gap: spacing[1] },
  paymentBtnText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[500] },
  // Split
  splitWrap: { marginTop: spacing[3], backgroundColor: colors.purple[50], borderRadius: borderRadius.xl, padding: spacing[3], borderWidth: 1, borderColor: colors.purple[200] },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitIconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  splitLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  splitInput: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.purple[300], borderRadius: borderRadius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], width: 100, textAlign: 'right' },
  splitDivider: { height: 1, backgroundColor: colors.purple[200], marginVertical: spacing[2] },
  splitCardAmount: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.blue[600] },
  // Defer
  deferToggle: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3.5] },
  deferToggleActive: { borderColor: colors.amber[200], backgroundColor: colors.amber[50] },
  deferLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deferHint: { fontSize: 11, color: colors.gray[400] },
  // Submit
  submitBtn: { borderRadius: borderRadius.xl, overflow: 'hidden' },
  submitBtnDeferred: {},
  submitGradient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[4] },
  submitBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  // Form
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  // Picker
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  pickerName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  pickerSub: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  pickerPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] },
  plateChip: { backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: 2, borderWidth: 1, borderColor: colors.primary[200] },
  plateChipText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.primary[700] },
  masterCircle: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  // Fullscreen Product Picker
  productPickerSafe: { flex: 1, backgroundColor: colors.white },
  productPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  productPickerClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center' },
  productPickerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productPickerDone: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: colors.primary[50], borderRadius: borderRadius.lg },
  productPickerDoneText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] },
  productSearchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginHorizontal: spacing[4], marginVertical: spacing[3], backgroundColor: colors.gray[50], borderRadius: borderRadius.xl, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  productSearchInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: 0 },
  // Breadcrumbs
  breadcrumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[1.5], paddingHorizontal: spacing[4], marginBottom: spacing[1] },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: spacing[1] },
  breadcrumbText: { fontSize: 13, color: colors.primary[600], fontWeight: fontWeight.medium },
  // Product folders
  productFoldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[4] },
  productFolderCard: { width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3] * 2) / 3, backgroundColor: colors.gray[50], borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3], alignItems: 'center', gap: spacing[1] },
  productFolderName: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.gray[900], textAlign: 'center', lineHeight: 16 },
  productFolderCount: { fontSize: 10, color: colors.gray[400] },
  // Product items
  productItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[50] },
  productPhoto: { width: 52, height: 52, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: { backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gray[100] },
  productInfo: { flex: 1 },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  productPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] },
  productStock: { fontSize: 11, color: colors.gray[400] },
  productCartBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' },
  productCartBadgeText: { fontSize: 13, fontWeight: fontWeight.bold, color: colors.white },
});
