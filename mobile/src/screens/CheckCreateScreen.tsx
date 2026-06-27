import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  LayoutAnimation,
  AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image as ExpoImage } from 'expo-image';
import {
  checksApi,
  clientsApi,
  carsApi,
  usersApi,
  servicesApi,
  productsApi,
  warehouseCategoriesApi,
  warehousesApi,
  checkTemplatesApi,
  checkPhotosApi,
  subscriptionApi,
  warrantyApi,
  bookingsApi,
  loyaltyApi,
} from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import Modal from '../components/Modal';
import ProductPickerModal from '../components/ProductPickerModal';
import RussianPlateInput from '../components/RussianPlateInput';
import PlateModeSwitcher, { type PlateMode } from '../components/PlateModeSwitcher';
import DateTimePickerModal from '../components/DateTimePickerModal';
import QuickClientCreateSheet from '../components/QuickClientCreateSheet';
import PaymentMethodModal, { paymentMethodLabel, paymentMethodVisual } from '../components/PaymentMethodModal';
import SbpPaymentModal from '../components/SbpPaymentModal';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors } from '../theme';
import { buildShadow } from '../platform/iosSurface';
import { normalizePlateForSearch, splitPlate, formatMain, isRussianInput } from '../utils/plateMask';
import { haptic } from '../platform/haptics';
import { PressableScale } from '../platform/PressableScale';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type {
  Client,
  Car,
  User,
  Service,
  Product,
  Check,
  CheckServiceLine,
  CheckProductLine,
  PaymentMethod,
  Warehouse,
  CheckTemplate,
  CheckPhoto,
  SubscriptionInfo,
  ActiveWarranty,
} from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import LastVisitBadge from '../components/LastVisitBadge';
import ActiveWarrantiesSection from '../components/ActiveWarrantiesSection';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/**
 * parseMoneyInput — RU-дружественный парсер денег/количества.
 *
 * `Number('1499,5')` → NaN, из-за чего запятая (стандартный десятичный
 * разделитель на русской клавиатуре / decimal-pad в RU-локали) молча
 * обнуляла цену или количество. Меняем запятую на точку и парсим;
 * любой мусор → 0, как и раньше.
 */
function parseMoneyInput(v: string): number {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * PlateBadge — visual replica of a Russian state license plate per
 * ГОСТ Р 50557-93. Proportions calibrated against the open-source
 * generate_license_plates SVG template:
 *
 *   • viewBox 1842 × 397   →  aspect ratio 4.64 : 1
 *   • main block (letter+3 digits+2 letters) takes 78% of width
 *   • region block (2-3 digits + flag + RUS) takes 22% of width
 *   • region font size = 75% of main (per SVG: 315 vs 420)
 *   • inner cant: a second hairline black border inset ≈6% of height
 *   • main:region letter-spacing is wide because the source uses the
 *     RoadNumbers GOST font; with system fonts we simulate via tracking
 *
 * Total badge size for the small variant: 40 × 186 pt — fits 2 plates
 * side-by-side in a horizontal scroll inside the client section.
 */
// True ГОСТ Р 50577-93 proportions: 520x112mm = 4.64:1 ratio. Right region
// strip is square (112x112mm). Two render variants: a compact 48pt badge
// for inline list rows, and a 64pt presentation badge for the
// SELECTED-CLIENT card where the plate is the visual anchor of the screen.
// Iter#6 sizing pass — owner reported on physical iPhone the medium
// plate still alternated between "слишком большой" and "слишком сжатый".
// Tightened to 54pt with smaller region digit / flag / RUS so the
// elements reliably fit inside the right strip with visible padding to
// the rim. Compact 48 stays for inline lists; large 76 retained for any
// future hero use; mini 36 unchanged.
const PLATE_BADGE_H_COMPACT = 48;
const PLATE_BADGE_H_MEDIUM = 54;
const PLATE_BADGE_H_LARGE = 76;
const PLATE_BADGE_H_MINI = 36;

interface PlateBadgeProps {
  plate: string;
  active: boolean;
  /** 'compact' (default) — inline list rows.
   *  'medium' — selected-client card hero (new in iter#5).
   *  'large' — full-bleed presentation (legacy).
   *  'mini' — tiny inline pill. */
  size?: 'compact' | 'medium' | 'large' | 'mini';
}

function PlateBadge({ plate, active, size = 'compact' }: PlateBadgeProps) {
  const clean = (plate || '').replace(/\s/g, '').toUpperCase();
  const styles =
    size === 'large'
      ? plateBadgeLargeStyles
      : size === 'medium'
        ? plateBadgeMediumStyles
        : size === 'mini'
          ? plateBadgeMiniStyles
          : plateBadgeStyles;
  if (!clean) {
    return (
      <View style={[styles.frame, styles.frameForeign, !active && { opacity: 0.55 }]}>
        <Text style={styles.foreignTag}>—</Text>
      </View>
    );
  }
  if (!isRussianInput(clean)) {
    return (
      <View style={[styles.frame, styles.frameForeign, !active && { opacity: 0.55 }]}>
        <View style={styles.intStrip}>
          <Text style={styles.intStripText}>INT</Text>
        </View>
        <Text style={styles.foreignText} numberOfLines={1}>
          {plate}
        </Text>
      </View>
    );
  }
  const { main, region } = splitPlate(clean);
  return (
    <View style={[styles.frame, !active && { opacity: 0.55 }]}>
      {/* Inner cant — second hairline frame inside the outer black border. ГОСТ feature. */}
      <View style={styles.cant} pointerEvents="none" />
      <View style={styles.mainBlock}>
        <Text style={styles.mainText} numberOfLines={1}>
          {formatMain(main) || clean}
        </Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.regionBlock}>
        <Text style={styles.regionText} numberOfLines={1}>
          {region || '—'}
        </Text>
        {/* RUS legend + tricolor flag stacked vertically, matching ГОСТ. */}
        <View style={styles.flagBox}>
          <View style={[styles.flagBand, { backgroundColor: '#FFFFFF' }]} />
          <View style={[styles.flagBand, { backgroundColor: '#0039A6' }]} />
          <View style={[styles.flagBand, { backgroundColor: '#D52B1E' }]} />
        </View>
        <Text style={styles.rusLabel}>RUS</Text>
      </View>
    </View>
  );
}

/** Build a styles dict for a given plate height.
 *
 *  Calibrated against ГОСТ Р 50577-93. The compact preset (48pt) is for
 *  inline list rows — proportions stay as before. The large preset (76pt)
 *  is the visual anchor inside the selected-client card and gets a
 *  carefully tuned set of *internal* paddings so the regional digits,
 *  tricolor flag and RUS legend each "breathe" instead of being shoved
 *  against the rim — which was the primary complaint after physical
 *  iPhone testing.
 *
 *  Sizing model (height H):
 *    main letters:      52% of H → big block, room for А 123 АА
 *    region digits:     44% of H, lineHeight = digit
 *    flag block:        40% of W of strip, hairline-bordered, 3 stripes
 *    RUS legend:        18% of H, never < 10pt → readable on iPhone SE
 *    region V-padding:  9% of H — top breathing room above digits
 *    region H-padding:  7% of strip width — keeps content off the rim
 *    inner cant inset:  5% of H — second hairline frame, the ГОСТ tell
 */
function makePlateBadgeStyles(height: number) {
  const width = Math.round(height * 4.64);
  // Region strip slightly wider than ГОСТ-square (1.05×) — buys ~3pt of
  // additional internal width so flag + RUS centre properly without
  // touching the rim, even on the smaller presets.
  const regionW = Math.round(height * 1.05);
  const mainW = width - regionW - 2;
  const mainFont = Math.round(height * 0.5);
  const regionFont = Math.round(height * 0.32);
  const flagW = Math.round(regionW * 0.34);
  const flagBandH = Math.max(1.6, Math.round(height * 0.045));
  const rusFont = Math.max(8, Math.round(height * 0.14));
  const regionPadV = Math.max(5, Math.round(height * 0.12));
  // Iter#8: more horizontal padding (was 13% → 16%) — the user reported
  // the LEFT side of the region strip still felt cramped. With 16% and
  // a 1.05× wider strip, region/flag/RUS now have visible breathing
  // room from BOTH the divider on the left and the rim on the right.
  const regionPadH = Math.max(6, Math.round(regionW * 0.16));
  const cantInset = Math.max(3, Math.round(height * 0.055));
  return StyleSheet.create({
    frame: {
      flexDirection: 'row',
      width,
      height,
      backgroundColor: '#FFFFFF',
      borderWidth: 2,
      borderColor: '#0A0A0A',
      borderRadius: Math.max(6, Math.round(height * 0.13)),
      overflow: 'hidden',
    },
    frameForeign: { borderColor: '#3b82f6' },
    cant: {
      position: 'absolute',
      top: cantInset,
      left: cantInset,
      right: cantInset,
      bottom: cantInset,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#0A0A0A',
      borderRadius: Math.max(3, Math.round(height * 0.08)),
    },
    mainBlock: {
      width: mainW,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Math.max(6, Math.round(mainW * 0.05)),
    },
    mainText: {
      fontSize: mainFont,
      fontWeight: '800',
      // Slightly tighter letter-spacing on the bigger preset so the main
      // block doesn't push text toward the divider.
      letterSpacing: height >= 70 ? 1.2 : 1.6,
      color: '#000000',
    },
    divider: { width: 2, backgroundColor: '#0A0A0A' },
    regionBlock: {
      width: regionW,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: regionPadV,
      paddingHorizontal: regionPadH,
    },
    regionText: {
      fontSize: regionFont,
      fontWeight: '800' as const,
      letterSpacing: 0.6,
      color: '#000000',
      lineHeight: regionFont + 2,
      // Pull the digit visually upward — gives more breathing room above
      // the tricolor flag underneath.
      marginTop: -1,
    },
    rusLabel: {
      fontSize: rusFont,
      fontWeight: '900' as const,
      color: '#000000',
      letterSpacing: 1.2,
      marginTop: 0,
    },
    flagBox: {
      flexDirection: 'column' as const,
      overflow: 'hidden' as const,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: '#0A0A0A',
      marginVertical: Math.max(2, Math.round(height * 0.03)),
    },
    flagBand: { width: flagW, height: flagBandH },
    intStrip: {
      width: Math.round(width * 0.1),
      backgroundColor: '#3b82f6',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    intStripText: { fontSize: rusFont - 1, fontWeight: '900' as const, color: '#fff', letterSpacing: 0.5 },
    foreignText: {
      flex: 1,
      fontSize: Math.round(height * 0.34),
      fontWeight: '700' as const,
      color: '#000000',
      paddingHorizontal: 8,
      alignSelf: 'center' as const,
      letterSpacing: 0.5,
    },
    foreignTag: {
      fontSize: Math.round(height * 0.34),
      fontWeight: '700' as const,
      color: '#999',
      alignSelf: 'center' as const,
      paddingHorizontal: 12,
    },
  });
}

const plateBadgeStyles = makePlateBadgeStyles(PLATE_BADGE_H_COMPACT);
const plateBadgeMediumStyles = makePlateBadgeStyles(PLATE_BADGE_H_MEDIUM);
const plateBadgeLargeStyles = makePlateBadgeStyles(PLATE_BADGE_H_LARGE);
const plateBadgeMiniStyles = makePlateBadgeStyles(PLATE_BADGE_H_MINI);

export default function CheckCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const insetsTop = useSafeAreaInsets().top;
  const palette = useColors();
  const editId = route.params?.id;
  // ── Записи → касса (приход) ────────────────────────────────────────────
  // ADDITIVE, param-gated: when the Записи «Подтвердить приход» flow pushes
  // CheckCreate it passes `bookingId` + prefill fields. On a successful check
  // save we then call bookingsApi.convert(bookingId, checkId) so the booking
  // flips to «проведена». EVERY booking-specific branch below is guarded by
  // these params, so the normal cash flow (no params) is byte-for-byte
  // unchanged. `bookingId` is captured ONCE (ref) so a navigate.setParams or
  // re-render can't lose/duplicate the conversion.
  const bookingIdRef = useRef<string | undefined>(route.params?.bookingId);
  const bookingId = bookingIdRef.current;
  const isFromBooking = !!bookingId;
  // A check opened from a booking is a pushed (root-stack) screen that must
  // pop back to the booking on save — treat it like a stack screen for nav,
  // even though there's no editId.
  const isStackScreen = !!editId || isFromBooking;
  // When opened from the bottom tab (route name 'NewCheck'), the floating
  // tab bar covers the bottom of the screen → reserve extra padding.
  const openedFromTab = route.name === 'NewCheck';

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
  const [cashGiven, setCashGiven] = useState('');
  const [isDeferred, setIsDeferred] = useState(false);

  // Line items
  const [serviceLines, setServiceLines] = useState<(CheckServiceLine & { lineMasterId?: string })[]>([]);
  const [productLines, setProductLines] = useState<CheckProductLine[]>([]);

  // ── Photo attachments ─────────────────────────────────────────────────────
  // Three-state model so the "create" flow (where check id doesn't exist yet)
  // and the "edit" flow (where it does) share the same UI:
  //   • `pendingPhotos` — local URIs picked + compressed BEFORE the check is
  //     saved. Uploaded en masse inside `createMutation.onSuccess` using the
  //     newly-returned check id.
  //   • `existingPhotos` — already-uploaded photos returned by the API in
  //     edit mode. Deletable immediately. New photos in edit mode are also
  //     uploaded immediately (since the check id is known).
  //   • `uploadingUris` — set of local URIs that are currently being POSTed.
  //     The thumbnail shows a small spinner overlay while present.
  const MAX_PHOTOS = 10;
  const [pendingPhotos, setPendingPhotos] = useState<string[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<CheckPhoto[]>([]);
  const [uploadingUris, setUploadingUris] = useState<Set<string>>(new Set());

  // Pickers
  const [plateSearch, setPlateSearch] = useState('');
  const [plateMode, setPlateMode] = useState<PlateMode>('ru');

  // Cache Reduce-Motion preference synchronously so the next LayoutAnimation
  // call can opt out without waiting on an async query.
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) reduceMotionRef.current = v;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotionRef.current = v;
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  /** Fire a soft iOS layout animation when the search ↔ selected-card view
   *  swap happens. Skipped under Reduce Motion. iOS-only — Android keeps
   *  the instant swap which has always worked there. */
  const animateClientToggle = React.useCallback(() => {
    if (Platform.OS !== 'ios') return;
    if (reduceMotionRef.current) return;
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'spring', springDamping: 0.9 },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
  }, []);
  const [showPlatePicker, setShowPlatePicker] = useState(false);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showMasterPicker, setShowMasterPicker] = useState<number | null>(null);
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);
  // Warehouse selection for the in-cash product picker. Null on first
  // mount, resolved to the tenant's "main" warehouse as soon as the
  // warehouses list arrives (see effect below). Owner ask: "не
  // смешиваясь" — the picker must always be scoped to exactly one
  // warehouse, no "Все склады" virtual option. State lives on the
  // screen so it survives a picker close/reopen during the same check.
  const [pickerWarehouseId, setPickerWarehouseId] = useState<string | null>(null);
  const [showWarehouseSheet, setShowWarehouseSheet] = useState(false);
  // M2: быстрый «Создать клиента» из состояния «Клиент не найден».
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  // Центральная модалка выбора способа оплаты (заменила инлайновый ряд кнопок).
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  // ДОБАВОЧНО: модалка приёма оплаты по СБП / QR (эквайринг). Полностью
  // изолирована от нал/карта/смешанная/отложенный — при успехе проводит чек
  // по существующему карточному (электронному) тендеру.
  const [showSbp, setShowSbp] = useState(false);

  // Service search
  const [serviceSearch, setServiceSearch] = useState('');

  // Load data — search by normalized plate (latin→cyrillic, no spaces)
  // so latin "P332PA05" or "р332ра05" finds the same client as "Р332РА05".
  // `normalizedSearch` follows every keystroke (controlled input + local
  // filtering); the NETWORK query keys off a 300ms-debounced snapshot so
  // typing "Р332РА05" fires one request, not eight (RNPERF-5).
  const normalizedSearch = useMemo(() => normalizePlateForSearch(plateSearch, plateMode), [plateSearch, plateMode]);
  const debouncedPlate = useDebouncedValue(plateSearch, 300);
  const debouncedNormalized = useMemo(
    () => normalizePlateForSearch(debouncedPlate, plateMode),
    [debouncedPlate, plateMode],
  );
  const { data: plateClients, isFetching: isFetchingPlate } = useQuery<Client[]>({
    queryKey: ['clients-plate', debouncedNormalized, plateMode],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: debouncedNormalized, limit: 20 });
      return res.data.data || [];
    },
    enabled: debouncedNormalized.length >= 2,
    placeholderData: (prev) => prev,
  });

  const { data: clientData } = useQuery<Client>({
    queryKey: ['client-detail', clientId],
    queryFn: async () => {
      const res = await clientsApi.getById(clientId);
      return res.data;
    },
    enabled: !!clientId,
  });
  const clientCars = clientData?.cars;

  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
  });

  const masters = useMemo(() => (allUsers || []).filter((u) => u.isActive && !u.hiddenEverywhere), [allUsers]);

  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['all-services'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 500 });
      return res.data.data || res.data;
    },
    enabled: showServicePicker,
  });

  // Products picker query — CRITICAL screen. Stock numbers must NEVER
  // be stale here: picking a product is the moment the user commits to
  // "this is in the warehouse". A cached snapshot showing 5 items when
  // we actually have 0 ends with a ring-out that can't be fulfilled.
  // HYBRID-perf plan, part 3: override the global `placeholderData:
  // prev => prev` and force a fresh fetch on every mount.
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['all-products-check'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 500 });
      return res.data.data || res.data;
    },
    enabled: showProductPicker,
    placeholderData: undefined,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  // Warehouses for the in-cash picker switcher. Cached separately —
  // identity-stable list, changes only when the owner edits warehouses.
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await warehousesApi.list();
      return res.data || [];
    },
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });

  // Default the picker to the tenant's "main" warehouse as soon as the
  // warehouses list arrives. We can't seed this in `useState` because
  // the warehouses list is a query that resolves a tick or two later.
  // Once the user explicitly picks brak / used the choice sticks for
  // the rest of the screen's lifetime — we only seed the default when
  // `pickerWarehouseId` is still null.
  useEffect(() => {
    if (pickerWarehouseId || !warehouses || warehouses.length === 0) return;
    const main = warehouses.find((w) => w.kind === 'main') ?? warehouses[0];
    if (main) setPickerWarehouseId(main.id);
  }, [warehouses, pickerWarehouseId]);

  // Build a stable label for the warehouse switcher chip. While the
  // default is still being resolved we show the main name from the
  // list so the pill never collapses to an empty width.
  const activeWarehouse = useMemo(
    () =>
      pickerWarehouseId
        ? (warehouses || []).find((w) => w.id === pickerWarehouseId)
        : (warehouses || []).find((w) => w.kind === 'main'),
    [warehouses, pickerWarehouseId],
  );
  const warehouseChipLabel = activeWarehouse?.name || 'Основной склад';

  // Pre-warm the products + categories cache as soon as the screen
  // mounts (rather than waiting for the picker to open). Net effect on
  // physical iPhone: tap "+" → picker is cache-hit, opens within one
  // frame, no "товаров нет" flash. Categories are scoped by the
  // currently-active warehouse so folders never leak across warehouses.
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: ['all-products-check'],
      queryFn: async () => {
        const res = await productsApi.getAll({ limit: 500 });
        return res.data.data || res.data;
      },
      staleTime: 5 * 60_000,
    });
    const wid = pickerWarehouseId || activeWarehouse?.id;
    queryClient.prefetchQuery({
      queryKey: wid ? ['warehouse-categories', { warehouseId: wid }] : ['warehouse-categories'],
      queryFn: async () => (await warehouseCategoriesApi.getAll(wid || undefined)).data,
      staleTime: 10 * 60_000,
    });
  }, [queryClient, pickerWarehouseId, activeWarehouse?.id]);

  // Plate search results — match normalized plate substring or fullName loose match
  const plateResults = useMemo(() => {
    if (!plateClients) return [];
    const sn = normalizedSearch;
    const fnQuery = plateSearch.toLowerCase();
    const results: { client: Client; car: Car }[] = [];
    for (const client of plateClients) {
      if (!client.cars) continue;
      for (const car of client.cars) {
        const carPlateNorm = normalizePlateForSearch(car.plateNumber || '', plateMode);
        const matchesPlate = sn && carPlateNorm.includes(sn);
        const matchesName = fnQuery.length >= 2 && client.fullName?.toLowerCase().includes(fnQuery);
        if (!sn || matchesPlate || matchesName) {
          results.push({ client, car });
        }
      }
    }
    return results;
  }, [plateClients, plateSearch, plateMode, normalizedSearch]);

  // Filtered services
  const filteredServices = useMemo(() => {
    const services = allServices || [];
    if (!serviceSearch) return services;
    const q = serviceSearch.toLowerCase();
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [allServices, serviceSearch]);

  // ── Check Templates ────────────────────────────────────────────────────────
  const { data: templates = [] } = useQuery<CheckTemplate[]>({
    queryKey: ['check-templates'],
    queryFn: async () => (await checkTemplatesApi.list()).data,
    staleTime: 60_000,
  });

  const applyTemplate = (template: CheckTemplate) => {
    setServiceLines(
      template.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        price: s.price,
        quantity: s.quantity,
        total: s.price * s.quantity,
        masterId: defaultMasterId,
        lineMasterId: defaultMasterId,
      })),
    );
    setProductLines(
      template.products.map((p) => ({
        productId: p.productId,
        name: p.name,
        sellPrice: p.sellPrice,
        costPrice: p.costPrice,
        quantity: p.quantity,
        totalSell: p.sellPrice * p.quantity,
        totalCost: p.costPrice * p.quantity,
      })),
    );
    setShowTemplatesPicker(false);
  };

  const promptTemplateName = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (Platform.OS === 'ios') {
        Alert.prompt(
          'Имя шаблона',
          'Введите название шаблона',
          [
            { text: 'Отмена', onPress: () => resolve(null), style: 'cancel' },
            { text: 'Сохранить', onPress: (text?: string) => resolve(text || null) },
          ],
          'plain-text',
        );
      } else {
        // Android: use a fallback name based on timestamp
        resolve(`Шаблон ${new Date().toLocaleDateString('ru-RU')}`);
      }
    });

  const saveAsTemplate = async () => {
    if (serviceLines.length === 0 && productLines.length === 0) return;
    const name = await promptTemplateName();
    if (!name) return;
    try {
      await checkTemplatesApi.create({
        name,
        services: serviceLines
          .filter((l) => !!l.serviceId)
          .map((l) => ({
            serviceId: l.serviceId!,
            name: l.name,
            price: l.price,
            quantity: l.quantity,
          })),
        products: productLines
          .filter((l) => !!l.productId)
          .map((l) => ({
            productId: l.productId!,
            name: l.name,
            sellPrice: l.sellPrice,
            costPrice: l.costPrice,
            quantity: l.quantity,
          })),
      });
      queryClient.invalidateQueries({ queryKey: ['check-templates'] });
      Alert.alert('Готово', 'Шаблон сохранён');
    } catch {
      Alert.alert('Ошибка', 'Не удалось сохранить шаблон');
    }
  };

  const deleteTemplate = async (templateId: string) => {
    try {
      await checkTemplatesApi.remove(templateId);
      queryClient.invalidateQueries({ queryKey: ['check-templates'] });
    } catch {
      Alert.alert('Ошибка', 'Не удалось удалить шаблон');
    }
  };

  // Load existing check for editing (MOB-13). useQuery instead of a bare
  // promise: retry / error / cancellation handling for free, plus the
  // ['check', id] entry is shared with CheckDetailScreen's cache. The
  // previous fire-and-forget `.then()` left a silent EMPTY form (and an
  // unhandled rejection) when the load failed — the owner would edit a
  // blank чек and overwrite the real one on save.
  const { data: editCheck, isError: editCheckError } = useQuery<Check>({
    queryKey: ['check', editId],
    queryFn: async () => {
      const res = await checksApi.getById(editId!);
      return res.data;
    },
    enabled: !!editId,
  });
  // Hydrate the form ONCE per editId — a background refetch of the same
  // cache entry must never clobber the user's in-progress edits.
  const hydratedEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editId || !editCheck || hydratedEditIdRef.current === editId) return;
    hydratedEditIdRef.current = editId;
    const c = editCheck;
    setClientId(c.clientId || '');
    setCarId(c.carId || '');
    setMileage(c.mileage ? String(c.mileage) : '');
    setComment(c.comment || '');
    setDiscount(c.discount ? String(c.discount) : '');
    setPaymentMethod(c.paymentMethod);
    // Restore the cash portion of a SPLIT (cash_card) payment so editing
    // an existing мешанный чек doesn't silently zero out наличные and push
    // the whole sum to card on save (financial corruption of the cash
    // ledger). For non-split checks the field is irrelevant; older checks
    // may have null/absent cashAmount → fall back to '' (unchanged
    // behaviour for cash/card/warranty checks).
    if (c.paymentMethod === ('cash_card' as PaymentMethod) && c.cashAmount != null) {
      setCashAmount(String(c.cashAmount));
    }
    setIsDeferred(c.isDeferred || false);
    setServiceLines(c.services || []);
    setProductLines(c.products || []);
    if (c.date) setCheckDate(new Date(c.date));
  }, [editId, editCheck]);
  useEffect(() => {
    if (!editCheckError) return;
    Alert.alert('Ошибка', 'Не удалось загрузить чек', [{ text: 'OK', onPress: () => navigation.goBack() }]);
  }, [editCheckError, navigation]);

  // ── Записи → касса: одноразовый префилл клиента/авто/комментария ─────────
  // ADDITIVE + param-gated: только когда CheckCreate открыт из «прихода»
  // (bookingId есть) И это НЕ режим редактирования. Сидируем единожды (ref),
  // чтобы фоновый ре-рендер не перетирал правки пользователя. Услуги/товары
  // НЕ префиллим — мастер добавляет их сам (запись их не содержит).
  const bookingPrefilledRef = useRef(false);
  useEffect(() => {
    if (!isFromBooking || editId || bookingPrefilledRef.current) return;
    bookingPrefilledRef.current = true;
    const p = route.params || {};
    if (p.prefillClientId) setClientId(p.prefillClientId);
    if (p.prefillCarId) setCarId(p.prefillCarId);
    if (p.prefillComment) setComment(p.prefillComment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFromBooking, editId]);

  const selectedClient = clientData || plateClients?.find((c) => c.id === clientId);
  const selectedCar = clientCars?.find((c) => c.id === carId) ?? clientCars?.[0];

  // Редактируем отложенный (черновик) чек: пользователь пришёл сюда по
  // «Продолжить» из деталки. Берём флаг из ЗАГРУЖЕННОГО серверного чека, а не
  // из локального тоггла `isDeferred` — хинт должен оставаться видимым, пока
  // открыт этот черновик, даже если пользователь снимет галочку «Отложить»,
  // чтобы провести оплату. Снимая галочку и сохраняя, он переводит draft→active
  // (бэк сам списывает склад/гарантии при этом переходе).
  const isEditingDeferred = !!editId && !!editCheck?.isDeferred;

  // #12: активные гарантии выбранного клиента — переиспользуем ТОТ ЖЕ ключ
  // и endpoint, что и <ActiveWarrantiesSection/> (['warranty-active-client',
  // clientId, undefined]), так что отдельного сетевого запроса не возникает:
  // оба читателя бьют в один кеш. Из ответа строим set имён ТОВАРНЫХ гарантий
  // (kind === 'product'), нормализованных так же, как в строке пикера
  // (trim + lower-case), чтобы подсветить «На гарантии» на совпавших товарах.
  // У контракта `ActiveWarranty` нет productId — сопоставление возможно
  // только по имени; это аккуратная презентационная подсказка, не логика.
  const warrantyClientId = clientId || undefined;
  const { data: clientWarranties } = useQuery<ActiveWarranty[]>({
    queryKey: ['warranty-active-client', warrantyClientId, undefined],
    queryFn: async () => {
      const res = await warrantyApi.active({ clientId: warrantyClientId });
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!warrantyClientId,
    staleTime: 60_000,
  });
  const warrantyProductNames = useMemo(() => {
    const set = new Set<string>();
    for (const w of clientWarranties || []) {
      if (w.kind === 'product' && w.name) set.add(w.name.trim().toLowerCase());
    }
    return set;
  }, [clientWarranties]);

  // ── Inline feature-gate check for "check_photos" ──────────────────────────
  // FeatureGate is a full-screen paywall (it replaces the screen if the
  // plan lacks the feature) — that would hide the entire cash form. For
  // a small in-form block we mirror the same logic inline: only render
  // the photo strip when the tenant's plan includes "check_photos" OR
  // when the user is superadmin. Subscription query is already cached
  // app-wide via the same query key, so this is essentially free.
  const { user: authUser } = useAuth();
  const { data: subInfo } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60 * 1000,
  });
  const canAttachPhotos = useMemo(() => {
    if (authUser?.role === 'superadmin') return true;
    if (!subInfo) return true; // optimistic — same behaviour as FeatureGate
    // MOB-10: gate on the server-resolved `features` of the CURRENT plan —
    // the previous match-by-plan-NAME broke whenever a plan was renamed.
    return Array.isArray(subInfo.features) && subInfo.features.includes('check_photos');
  }, [authUser?.role, subInfo]);

  // ── Existing photos in edit mode ──────────────────────────────────────────
  // Cached separately from `pendingPhotos` so the edit flow doesn't fight the
  // create flow. Refetched after a successful immediate-upload (edit mode).
  const { data: editPhotos, refetch: refetchEditPhotos } = useQuery<CheckPhoto[]>({
    queryKey: ['check-photos', editId],
    queryFn: async () => (await checkPhotosApi.getByCheck(editId!)).data,
    enabled: !!editId && canAttachPhotos,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (editPhotos) setExistingPhotos(editPhotos);
  }, [editPhotos]);

  // ── Photo helpers ─────────────────────────────────────────────────────────
  // `compressPhoto` runs through expo-image-manipulator: resize to max
  // 1280px on the longest side + JPEG q=0.7. Result is typically
  // 150–300 KB, well below the backend's 10 MB cap and small enough to
  // upload over LTE without stalling the form.
  const compressPhoto = async (uri: string): Promise<string> => {
    try {
      const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return result.uri;
    } catch (err) {
      // If compression fails for any reason (corrupt image, exotic codec)
      // fall back to the original URI — backend will still receive a
      // valid file, just possibly a larger one.
      console.warn('[CheckCreate] photo compression failed, using original', err);
      return uri;
    }
  };

  const buildPhotoFormData = (uri: string): FormData => {
    const filename = uri.split('/').pop() || 'photo.jpg';
    const fd = new FormData();
    fd.append('photo', { uri, name: filename, type: 'image/jpeg' } as any);
    return fd;
  };

  /** Open the system picker. If `replace` is set, the chosen photo
   *  replaces an existing entry rather than appending a new one — used
   *  by the tap-to-replace gesture on a thumbnail. Otherwise (the "+"
   *  tile) the new photo is appended. */
  type ReplaceTarget = { kind: 'pending'; uri: string } | { kind: 'existing'; photo: CheckPhoto };
  const pickAndAddPhoto = async (replace?: ReplaceTarget) => {
    if (!replace) {
      const totalCount = pendingPhotos.length + existingPhotos.length;
      if (totalCount >= MAX_PHOTOS) {
        Alert.alert('Лимит', `Можно прикрепить не более ${MAX_PHOTOS} фото`);
        return;
      }
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Нет доступа', 'Разрешите доступ к фото в настройках iPhone.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1, // we re-compress below — picker quality just controls source decode
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const compressedUri = await compressPhoto(asset.uri);

      // ── Replace flows ──
      if (replace?.kind === 'pending') {
        setPendingPhotos((prev) => prev.map((u) => (u === replace.uri ? compressedUri : u)));
        return;
      }
      if (replace?.kind === 'existing') {
        // For existing (already uploaded) photos: upload the new one, then
        // remove the old one. Order matters — upload first so a failure
        // doesn't leave the user with fewer photos than they started with.
        setUploadingUris((prev) => {
          const next = new Set(prev);
          next.add(compressedUri);
          return next;
        });
        try {
          await checkPhotosApi.upload(replace.photo.checkId, buildPhotoFormData(compressedUri));
          await checkPhotosApi.remove(replace.photo.id);
          await refetchEditPhotos();
        } catch {
          Alert.alert('Ошибка', 'Не удалось заменить фото');
        } finally {
          setUploadingUris((prev) => {
            const next = new Set(prev);
            next.delete(compressedUri);
            return next;
          });
        }
        return;
      }

      // ── Append flow ──
      if (editId) {
        // Edit mode: upload immediately, then refetch the gallery.
        setUploadingUris((prev) => {
          const next = new Set(prev);
          next.add(compressedUri);
          return next;
        });
        try {
          await checkPhotosApi.upload(editId, buildPhotoFormData(compressedUri));
          await refetchEditPhotos();
        } catch {
          Alert.alert('Ошибка', 'Не удалось загрузить фото');
        } finally {
          setUploadingUris((prev) => {
            const next = new Set(prev);
            next.delete(compressedUri);
            return next;
          });
        }
      } else {
        // Create mode: defer the upload until the check is saved.
        setPendingPhotos((prev) => [...prev, compressedUri]);
      }
    } catch (err) {
      console.warn('[CheckCreate] pickAndAddPhoto error', err);
      Alert.alert('Ошибка', 'Не удалось выбрать фото');
    }
  };

  const removePendingPhoto = (uri: string) => {
    Alert.alert('Удалить фото?', 'Это действие необратимо', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => setPendingPhotos((prev) => prev.filter((u) => u !== uri)),
      },
    ]);
  };

  const removeExistingPhoto = (photoId: string) => {
    Alert.alert('Удалить фото?', 'Это действие необратимо', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await checkPhotosApi.remove(photoId);
            setExistingPhotos((prev) => prev.filter((p) => p.id !== photoId));
            if (editId) refetchEditPhotos();
          } catch {
            Alert.alert('Ошибка', 'Не удалось удалить фото');
          }
        },
      },
    ]);
  };

  /** Upload every pending local URI to a freshly-created check. Returns
   *  the URIs that failed so the caller can offer a retry. */
  const uploadPendingForCheck = async (checkId: string, uris: string[]): Promise<string[]> => {
    if (uris.length === 0) return [];
    const failed: string[] = [];
    setUploadingUris(new Set(uris));
    try {
      for (const uri of uris) {
        try {
          await checkPhotosApi.upload(checkId, buildPhotoFormData(uri));
        } catch (err) {
          console.warn('[CheckCreate] photo upload failed', err);
          failed.push(uri);
        } finally {
          setUploadingUris((prev) => {
            const next = new Set(prev);
            next.delete(uri);
            return next;
          });
        }
      }
    } finally {
      setUploadingUris(new Set());
    }
    return failed;
  };

  const resetForm = () => {
    setClientId('');
    setCarId('');
    setMileage('');
    setComment('');
    setDiscount('');
    setPaymentMethod('cash' as PaymentMethod);
    setCashAmount('');
    setIsDeferred(false);
    setServiceLines([]);
    setProductLines([]);
    setCheckDate(new Date());
    setPendingPhotos([]);
    setExistingPhotos([]);
    setUploadingUris(new Set());
  };

  // Guard against double-fire: TouchableOpacity can occasionally deliver
  // two onPress events on some older iPhones when the user taps quickly.
  // isPending alone is not enough because there's a micro-gap between the
  // press and the mutation entering its pending state. The ref closes it.
  const submittingRef = useRef(false);

  // If the previous submit attempt was interrupted (component unmount,
  // navigation pop with mutation still in flight, dev fast-refresh), the
  // ref can stay stuck on `true` and silently no-op every subsequent
  // press. Reset whenever the screen regains focus so the user is never
  // stranded.
  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      submittingRef.current = false;
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [navigation]);

  const createMutation = useMutation({
    mutationFn: (data: any) => (editId ? checksApi.update(editId, data) : checksApi.create(data)),
    // Defensive: if the mutation is cancelled / aborted (e.g. component
    // unmounts while in-flight), TanStack Query will not call onError or
    // onSuccess. Clear the guard so the next mount can submit.
    onSettled: () => {
      submittingRef.current = false;
    },
    onSuccess: async (res: any) => {
      submittingRef.current = false;
      // Premium confirmation: success haptic fires only once the check is
      // actually persisted (mutation resolved) — a failed submit must never
      // feel successful. Android variant is softened inside the helper.
      haptic('success');
      // After creating / editing a check we have to bust every cache
      // entry that the new revenue / inventory delta touches. The legacy
      // `['dashboard']` invalidation was a no-op (no such key exists).
      // RNPERF-9: only the Журнал refetches immediately — it's the screen
      // the user lands on right after a save. Every other (heavy) key is
      // invalidated with `refetchType: 'inactive'`: hidden-but-mounted
      // screens are marked stale and refetch on their next visit instead
      // of firing a 9-request storm during the save transition.
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      const heavyKeys: string[][] = [
        ['checks'],
        ['checks-dashboard'],
        ['dashboard-v2'],
        ['dashboard-chart'],
        ['cashflow'],
        ['low-stock'],
        ['products'],
        // The cash product-picker + the oversell-confirm read stock from
        // ['all-products-check'] (limit 500), NOT ['products'] — so without
        // this the NEXT check created in the same session sees pre-decrement
        // stock and a stale oversell threshold. Mirror ProductsScreen, which
        // already busts this key on every stock mutation.
        ['all-products-check'],
        ['warehouse-analytics'],
      ];
      for (const queryKey of heavyKeys) {
        queryClient.invalidateQueries({ queryKey, refetchType: 'inactive' });
      }

      // #12: гарантии могли измениться этим чеком (гарантийный случай мог
      // быть погашен на сервере, либо новые услуги/товары добавили гарантию).
      // Без сброса кеша карточка клиента до 60с показывала бы устаревший
      // список «На гарантии» — отсюда жалоба «не всегда правильная инфо».
      // Сбрасываем по префиксу — это покрывает любой clientId/carId-ключ.
      queryClient.invalidateQueries({ queryKey: ['warranty-active-client'] });
      queryClient.invalidateQueries({ queryKey: ['last-visit'] });

      // Upload pending local photos (create-mode only — in edit mode they
      // were already uploaded immediately on pick). Snapshot the list
      // BEFORE resetting the form / navigating away.
      const uris = pendingPhotos;
      const savedCheckId: string | undefined = editId || res?.data?.id;

      // ── Лояльность: автоначисление кешбэка на продажу ────────────────────
      // ADDITIVE side-effect, НЕ влияет на оплату/итоги/создание чека. Только
      // для НОВОГО чека (не редактирование — иначе двойное начисление) с
      // НЕ-розничным клиентом. Сумму кешбэка считает СЕРВЕР (итог чека ×
      // accrualPercent) — клиент лишь триггерит начисление. Fire-and-forget:
      // не ждём ответ перед навигацией и глушим любые ошибки, в т.ч. 422,
      // когда лояльность выключена/не настроена в тарифе тенанта.
      if (!editId && savedCheckId && clientId && !selectedClient?.isRetail) {
        const accrueClientId = clientId;
        const accrueCheckId = savedCheckId;
        loyaltyApi
          .accrue({ clientId: accrueClientId, checkId: accrueCheckId })
          .then(() => {
            // Обновляем баланс бонусов клиента, если карточка уже открыта.
            queryClient.invalidateQueries({ queryKey: ['loyalty', 'client', accrueClientId] });
          })
          .catch(() => {
            /* лояльность выключена/не настроена — тихо, продажа уже сохранена */
          });
      }

      if (!editId && savedCheckId && uris.length > 0) {
        try {
          const failed = await uploadPendingForCheck(savedCheckId, uris);
          if (failed.length > 0) {
            Alert.alert(
              'Чек создан, но не все фото загружены',
              `Не удалось загрузить ${failed.length} из ${uris.length} фото. Повторить попытку?`,
              [
                { text: 'Отмена', style: 'cancel' },
                {
                  text: 'Повторить',
                  onPress: async () => {
                    const stillFailed = await uploadPendingForCheck(savedCheckId, failed);
                    if (stillFailed.length > 0) {
                      Alert.alert('Ошибка', 'Не удалось загрузить часть фото. Откройте чек и добавьте их вручную.');
                    }
                  },
                },
              ],
            );
          }
        } catch (err) {
          console.warn('[CheckCreate] pending photo upload sequence failed', err);
        }
      }

      // ── Записи → касса: пометить запись «проведённой» ────────────────────
      // ADDITIVE + param-gated: только когда касса открыта из «прихода»
      // (bookingId есть) и это НОВЫЙ чек. Чек уже сохранён — конверсия лишь
      // линкует его к записи (booking.status=converted, check_id=...). Если
      // convert упадёт (сеть), чек НЕ теряется: запись остаётся в Предстоящих,
      // приход можно повторить. Поэтому — best-effort с тихим логом, без
      // блокировки навигации.
      if (isFromBooking && bookingId && !editId && savedCheckId) {
        try {
          await bookingsApi.convert(bookingId, { checkId: savedCheckId });
          queryClient.invalidateQueries({ queryKey: ['bookings'] });
          queryClient.invalidateQueries({ queryKey: ['booking-detail', bookingId] });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[CheckCreate] booking convert failed (check saved anyway)', err);
        }
      }

      if (isFromBooking) {
        // Приход проведён → возвращаем пользователя на список Записей (запись
        // теперь в «Прошедших» со ссылкой на чек). Явная навигация надёжнее
        // goBack(): root-push кассы сбросил вложенный MoreStack, так что
        // обычный pop приземлил бы на меню «Ещё», а не на список записей.
        navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Bookings' } });
      } else if (isStackScreen) {
        navigation.goBack();
      } else {
        resetForm();
        Alert.alert('Готово', 'Чек успешно создан');
      }
    },
    onError: (err: any) => {
      submittingRef.current = false;
      // Surface the real reason — owners report "ничего не происходит" in
      // production; without the raw payload we can't tell whether it's a
      // missing master, a stock conflict, or a backend 500. Always show
      // SOMETHING, fall back to JSON when the server didn't give a
      // friendly string. Mobile logs (Console.app on Mac, sentry on
      // server) keep the full breadcrumb.
      // eslint-disable-next-line no-console
      console.error('[CheckCreate] submit error', err?.response?.status, err?.response?.data, err?.message);
      const status = err?.response?.status;
      const data = err?.response?.data;
      const friendly =
        data?.message ||
        data?.error ||
        (typeof data === 'string' ? data : null) ||
        err?.message ||
        (data ? JSON.stringify(data) : null) ||
        (status ? `Сервер вернул код ${status}` : 'Не удалось сохранить чек');
      Alert.alert('Ошибка', String(friendly));
    },
  });

  // Calculations (MOB-02) — mirror the backend/web formula EXACTLY:
  // the discount applies to PRODUCTS only and the product part floors at
  // zero, so the total can never go negative. The previous mobile-only
  // `subtotal - discount` quietly discounted services too (and allowed a
  // negative «К оплате»), so the on-screen sum diverged from what the
  // server persisted — corrupting the cash ledger reconciliation.
  const serviceTotal = serviceLines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const productTotal = productLines.reduce((sum, l) => sum + l.sellPrice * l.quantity, 0);
  const discountNum = parseMoneyInput(discount);
  const subtotal = serviceTotal + productTotal;
  const effectiveDiscount = Math.min(discountNum, productTotal);
  const total = serviceTotal + Math.max(productTotal - discountNum, 0);
  const cardAmountCalc = Math.max(total - parseMoneyInput(cashAmount), 0);

  // ── M4: oversell guard ─────────────────────────────────────────────
  // Cached stock per productId from the same ['all-products-check'] cache
  // the picker reads (prefetched on mount). Quantities are aggregated per
  // productId before comparing — addProductLine merges lines, but a
  // template apply can still introduce a second line for the same product.
  // The snapshot can be STALE, so an oversell is a confirm, never a hard
  // block — the backend remains the source of truth.
  const stockByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of allProducts || []) map.set(p.id, p.stock);
    return map;
  }, [allProducts]);

  const oversoldByProductId = useMemo(() => {
    const qtyById = new Map<string, { name: string; qty: number; stock: number }>();
    for (const l of productLines) {
      if (!l.productId) continue;
      const stock = stockByProductId.get(l.productId);
      if (stock === undefined) continue; // stock unknown — nothing to warn about
      const prev = qtyById.get(l.productId);
      if (prev) prev.qty += l.quantity;
      else qtyById.set(l.productId, { name: l.name, qty: l.quantity, stock });
    }
    const oversold = new Map<string, { name: string; qty: number; stock: number }>();
    for (const [id, entry] of qtyById) {
      if (entry.qty > entry.stock) oversold.set(id, entry);
    }
    return oversold;
  }, [productLines, stockByProductId]);

  // Get current user as default master (already resolved above via `authUser`)
  const currentUser = authUser;
  // Записи → касса: если приход открыли с конкретным мастером, услуги/товары
  // по умолчанию вешаем на него (param-gated; обычный поток — текущий юзер).
  const defaultMasterId = (isFromBooking && route.params?.prefillMasterId) || currentUser?.id || '';
  // Mirror warehouse role gating — directors / admins / superadmins see
  // cost price inside the picker, masters don't. Same predicate as
  // `ProductsScreen.tsx`'s `canSeeCostPrice`.
  const canSeeCostPrice =
    currentUser?.role === 'director' || currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  const addServiceLine = (service: Service) => {
    setServiceLines((prev) => [
      ...prev,
      {
        serviceId: service.id,
        name: service.name,
        price: service.defaultPrice,
        quantity: 1,
        total: service.defaultPrice,
        masterId: defaultMasterId,
        lineMasterId: defaultMasterId,
      },
    ]);
    setShowServicePicker(false);
  };

  const removeServiceLine = (idx: number) => setServiceLines((prev) => prev.filter((_, i) => i !== idx));

  const updateServiceLine = (idx: number, field: string, value: any) => {
    setServiceLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        const updated = { ...line, [field]: value };
        updated.total = updated.price * updated.quantity;
        return updated;
      }),
    );
  };

  const addProductLine = (product: Product) => {
    // Handle bundle products — expand into individual component products
    if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
      const productsList = allProducts || [];
      setProductLines((prev) => {
        const updated = [...prev];
        for (const bi of product.bundleItems!) {
          const bundleProduct = productsList.find((p) => p.id === bi.productId);
          if (!bundleProduct) continue;
          const existIdx = updated.findIndex((l) => l.productId === bundleProduct.id);
          if (existIdx >= 0) {
            updated[existIdx] = {
              ...updated[existIdx],
              quantity: updated[existIdx].quantity + (bi.quantity || 1),
              totalSell: updated[existIdx].sellPrice * (updated[existIdx].quantity + (bi.quantity || 1)),
              totalCost: updated[existIdx].costPrice * (updated[existIdx].quantity + (bi.quantity || 1)),
            };
          } else {
            updated.push({
              productId: bundleProduct.id,
              name: bundleProduct.name,
              sellPrice: bundleProduct.sellPrice,
              costPrice: bundleProduct.costPrice,
              quantity: bi.quantity || 1,
              totalSell: bundleProduct.sellPrice * (bi.quantity || 1),
              totalCost: bundleProduct.costPrice * (bi.quantity || 1),
            });
          }
        }
        return updated;
      });
      return;
    }

    const existing = productLines.findIndex((l) => l.productId === product.id);
    if (existing >= 0) {
      updateProductLine(existing, 'quantity', productLines[existing].quantity + 1);
    } else {
      setProductLines((prev) => [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sellPrice: product.sellPrice,
          costPrice: product.costPrice,
          quantity: 1,
          totalSell: product.sellPrice,
          totalCost: product.costPrice,
        },
      ]);
    }
  };

  const removeProductLine = (idx: number) => setProductLines((prev) => prev.filter((_, i) => i !== idx));

  const updateProductLine = (idx: number, field: string, value: any) => {
    setProductLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        const updated = { ...line, [field]: value };
        updated.totalSell = updated.sellPrice * updated.quantity;
        updated.totalCost = updated.costPrice * updated.quantity;
        return updated;
      }),
    );
  };

  const handleSubmit = (deferred?: boolean, paymentOverride?: PaymentMethod, opts?: { preValidated?: boolean }) => {
    // Double-fire guard: bail out immediately if a submission is already
    // in-flight, regardless of whether isPending has propagated yet.
    if (submittingRef.current || createMutation.isPending) return;

    const shouldDefer = deferred !== undefined ? deferred : isDeferred;
    // СБП-успех проводит чек как электронную (карточную) оплату через
    // `paymentOverride='card'`. Без override поведение байт-в-байт прежнее —
    // используется выбранный в UI `paymentMethod`.
    const effectiveMethod = paymentOverride ?? paymentMethod;
    if (!shouldDefer && serviceLines.length === 0 && productLines.length === 0) {
      haptic('warning');
      Alert.alert('Ошибка', 'Добавьте хотя бы одну услугу или товар');
      return;
    }

    // ── Master fallback safety net ─────────────────────────────────────
    // Backend REQUIRES masterId (BadRequestException otherwise). The
    // default is the authenticated user's id, but if for any reason that
    // is empty (auth not yet hydrated, or the user record was cleared in
    // a previous session), pick the first active master from the cached
    // users query. Last-resort: bail with a clear Alert instead of
    // silently no-opping the press.
    let resolvedMasterId = defaultMasterId;
    if (!resolvedMasterId) {
      const fallback = masters[0]?.id;
      if (fallback) {
        // eslint-disable-next-line no-console
        console.warn('[CheckCreate] defaultMasterId empty, falling back to first master', fallback);
        resolvedMasterId = fallback;
      } else {
        haptic('warning');
        Alert.alert(
          'Не выбран мастер',
          'Не удалось определить мастера для чека. Откройте экран «Сотрудники» и убедитесь, что есть хотя бы один активный мастер.',
        );
        return;
      }
    }

    const proceed = () => {
      let finalCash = 0;
      let finalCard = 0;
      if (effectiveMethod === ('cash' as PaymentMethod)) {
        finalCash = total;
      } else if (effectiveMethod === ('card' as PaymentMethod)) {
        finalCard = total;
      } else if (effectiveMethod === ('cash_card' as PaymentMethod)) {
        // Clamp the cash leg to the (floored) total so a fat-fingered
        // «наличные» can never push the ledger above «К оплате».
        finalCash = Math.min(parseMoneyInput(cashAmount), total);
        finalCard = Math.max(total - finalCash, 0);
      }

      const payload = {
        clientId: clientId || undefined,
        carId: carId || undefined,
        masterId: resolvedMasterId,
        date: checkDate.toISOString(),
        mileage: mileage ? parseMoneyInput(mileage) || undefined : undefined,
        comment: comment || undefined,
        discount: discountNum || undefined,
        paymentMethod: effectiveMethod,
        cashAmount: finalCash || undefined,
        cardAmount: finalCard || undefined,
        isDeferred: shouldDefer,
        services: serviceLines.map((l) => ({
          serviceId: l.serviceId,
          masterId: l.lineMasterId || l.masterId || resolvedMasterId,
          name: l.name,
          price: l.price,
          quantity: l.quantity,
        })),
        products: productLines.map((l) => ({
          productId: l.productId,
          name: l.name,
          sellPrice: l.sellPrice,
          costPrice: l.costPrice,
          quantity: l.quantity,
        })),
      };
      submittingRef.current = true;
      createMutation.mutate(payload);
    };

    // ── M4: oversell confirm ────────────────────────────────────────
    // Confirm (never hard-block — cached stock can be stale) when any
    // product line exceeds the cached stock. Deferred checks skip the
    // confirm entirely: the backend only decrements stock on a live save.
    // СБП-поток уже подтвердил овершелл ДО приёма оплаты (openSbpPayment),
    // поэтому при preValidated повтор не показываем — деньги уже приняты на
    // сервере, блокировать запись чека нельзя (BUG #1).
    if (!shouldDefer && !opts?.preValidated && oversoldByProductId.size > 0) {
      const lines = [...oversoldByProductId.values()]
        .map((e) => `• ${e.name}: в чеке ${e.qty}, на складе ${Math.max(e.stock, 0)}`)
        .join('\n');
      haptic('warning');
      Alert.alert('Не хватает на складе', `${lines}\n\nДанные склада могли устареть. Продолжить?`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Продолжить', onPress: proceed },
      ]);
      return;
    }

    proceed();
  };

  // ── СБП-оплата подтверждена ──────────────────────────────────────────────
  // Эквайринг вернул status='succeeded'. СБП — электронные деньги, поэтому
  // проводим чек по СУЩЕСТВУЮЩЕМУ карточному тендеру ('card') через
  // `paymentOverride` (новых способов оплаты/колонок не вводим). Закрываем
  // модалку и синхронизируем UI-метку (на случай, если кассир потом откроет
  // тот же чек на редактирование). Сама запись чека идёт обычным путём
  // createMutation — вся математика итогов/сдачи неизменна.
  const handleSbpSucceeded = () => {
    setShowSbp(false);
    setPaymentMethod('card' as PaymentMethod);
    // Все блокирующие условия (позиции, сумма>0, мастер, овершелл) уже
    // проверены в openSbpPayment ДО открытия СБП-модалки — поэтому проводим
    // чек с preValidated=true: handleSubmit не покажет ни одного блокирующего
    // подтверждения/алерта и ГАРАНТИРОВАННО запишет заказ-наряд (деньги по СБП
    // уже приняты на сервере, см. BUG #1).
    handleSubmit(false, 'card' as PaymentMethod, { preValidated: true });
  };

  // Открыть приём оплаты по СБП.
  //
  // BUG #1 FIX — ПОРЯДОК «pre-validate → pay → commit»: ВСЕ блокирующие
  // условия, которые иначе сделали бы early-return в handleSubmit ПОСЛЕ приёма
  // денег (нет позиций, нулевая сумма, не определён мастер, овершелл склада),
  // проверяем ЗДЕСЬ — ДО открытия СБП-модалки. К моменту, когда оплата
  // подтвердится, заблокировать запись чека уже ничто не может. СБП-чек
  // никогда не откладывается (отложенный = ещё не оплачен).
  const openSbpPayment = () => {
    if (submittingRef.current || createMutation.isPending) return;
    // 1) Есть что проводить.
    if (serviceLines.length === 0 && productLines.length === 0) {
      haptic('warning');
      Alert.alert('Нечего оплачивать', 'Добавьте хотя бы одну услугу или товар.');
      return;
    }
    // 2) Сумма к оплате > 0.
    if (total <= 0) {
      haptic('warning');
      Alert.alert('Сумма к оплате — 0', 'Оплата по СБП недоступна для нулевого чека.');
      return;
    }
    // 3) Мастер назначаем (бэк требует masterId — то же правило, что в
    //    handleSubmit). Если ни defaultMasterId, ни активного мастера нет —
    //    останавливаемся ДО оплаты, иначе приняли бы деньги и не записали чек.
    if (!defaultMasterId && !masters[0]?.id) {
      haptic('warning');
      Alert.alert(
        'Не выбран мастер',
        'Не удалось определить мастера для чека. Откройте экран «Сотрудники» и убедитесь, что есть хотя бы один активный мастер.',
      );
      return;
    }
    // 4) Овершелл склада — подтверждаем ДО оплаты (а не после), потому что
    //    после успешного СБП этот confirm уже нельзя показывать: деньги
    //    приняты, чек обязан записаться. На «Продолжить» открываем модалку.
    if (oversoldByProductId.size > 0) {
      const lines = [...oversoldByProductId.values()]
        .map((e) => `• ${e.name}: в чеке ${e.qty}, на складе ${Math.max(e.stock, 0)}`)
        .join('\n');
      haptic('warning');
      Alert.alert('Не хватает на складе', `${lines}\n\nДанные склада могли устареть. Продолжить?`, [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Продолжить',
          onPress: () => {
            haptic('tap');
            setShowSbp(true);
          },
        },
      ]);
      return;
    }
    haptic('tap');
    setShowSbp(true);
  };

  // Date formatting
  const dateStr = `${checkDate.getDate().toString().padStart(2, '0')}.${String(checkDate.getMonth() + 1).padStart(2, '0')}.${checkDate.getFullYear()}`;
  const timeStr = `${String(checkDate.getHours()).padStart(2, '0')}:${String(checkDate.getMinutes()).padStart(2, '0')}`;

  const getMasterName = (id?: string) => {
    if (!id) return 'Мастер...';
    const m = masters.find((u) => u.id === id);
    return m?.fullName?.split(' ')[0] || 'Мастер';
  };

  const getProductCartQty = (productId: string) => {
    const line = productLines.find((l) => l.productId === productId);
    return line?.quantity || 0;
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Floating back chevron — only when this screen is pushed onto a
          stack (edit-mode from Журнал). When opened from the central tab
          it's the Касса itself and needs no header. Native edge-swipe
          handles back as well. */}
      {isStackScreen && (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[
            styles.floatingBack,
            buildShadow(palette, 'elevated'),
            { backgroundColor: palette.bg.card, top: insetsTop + spacing[1] },
          ]}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={22} color={palette.text.primary} />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insetsTop + spacing[2] },
            openedFromTab && { paddingBottom: tabBarHeight + spacing[4] },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* ═══ SECTION 1: CLIENT INFO — blue tint ═══ */}
          <View
            style={[styles.sectionClient, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="person-circle-outline" size={18} color={colors.blue[600]} />
              <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Информация о клиенте</Text>
            </View>

            {/* Хинт «Редактируется отложенный чек» — виден только когда мы
                открыли черновик по «Продолжить» из деталки. Подсказывает, что
                снятие галочки «Отложить» внизу + сохранение закроет черновик
                и проведёт его в выручку (бэк спишет склад/гарантии). */}
            {isEditingDeferred && (
              <View style={styles.deferredEditHint}>
                <Ionicons name="pause-circle" size={16} color={colors.amber[600]} />
                <Text style={styles.deferredEditHintText}>Редактируется отложенный чек</Text>
              </View>
            )}

            {/* Date/Time — only when editing an existing check.
                For new checks the timestamp is set automatically on save
                (checkDate stays as 'now'), so we hide the noisy picker
                pair to keep the form focused on what really matters:
                the client, the car, the line items, the payment. */}
            {editId && (
              <View style={styles.dateTimeCard}>
                <TouchableOpacity
                  style={[styles.dateBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.blue[600]} />
                  <Text style={[styles.dateBtnText, { color: palette.text.primary }]}>{dateStr}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.timeBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Ionicons name="time-outline" size={16} color={colors.blue[600]} />
                  <Text style={[styles.timeBtnText, { color: palette.text.primary }]}>{timeStr}</Text>
                </TouchableOpacity>
              </View>
            )}

            {editId && (
              <>
                <DateTimePickerModal
                  visible={showDatePicker}
                  value={checkDate}
                  mode="date"
                  onConfirm={(d) => {
                    setShowDatePicker(false);
                    const u = new Date(checkDate);
                    u.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                    setCheckDate(u);
                  }}
                  onCancel={() => setShowDatePicker(false)}
                />
                <DateTimePickerModal
                  visible={showTimePicker}
                  value={checkDate}
                  mode="time"
                  onConfirm={(d) => {
                    setShowTimePicker(false);
                    const u = new Date(checkDate);
                    u.setHours(d.getHours(), d.getMinutes());
                    setCheckDate(u);
                  }}
                  onCancel={() => setShowTimePicker(false)}
                />
              </>
            )}

            {clientId && selectedClient ? (
              /* ═══ SELECTED CLIENT — PREMIUM iOS CARD ═══
                 Three-section composite, modeled after Apple's Wallet
                 card detail screen:
                   1. CLIENT HEADER — avatar + name + phone + X.
                   2. HAIRLINE DIVIDER.
                   3. CAR SECTION — plate badge centered, then a chip-
                      style row with make/model and (optional) comment.
                 The car gets its own labeled section ("АВТОМОБИЛЬ") so
                 it's structurally tied to the card instead of floating
                 as random text under the plate. */
              <View
                style={[
                  styles.selectedCard,
                  buildShadow(palette),
                  { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                ]}
              >
                {/* — Section 1: client header — */}
                <View style={styles.selectedCardTop}>
                  <View style={styles.selectedCardAvatar}>
                    <Ionicons name="person" size={22} color={colors.primary[700]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.selectedCardName, { color: palette.text.primary }]} numberOfLines={1}>
                      {selectedClient.fullName}
                    </Text>
                    {!!selectedClient.phone && (
                      <Text style={[styles.selectedCardPhone, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {formatPhone(selectedClient.phone)}
                      </Text>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      animateClientToggle();
                      setClientId('');
                      setCarId('');
                      setPlateSearch('');
                    }}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    style={[styles.selectedCardClose, { backgroundColor: palette.bg.muted }]}
                    accessibilityLabel="Сбросить клиента"
                  >
                    <Ionicons name="close" size={18} color={palette.text.secondary} />
                  </TouchableOpacity>
                </View>

                {selectedCar && (
                  /* — Compact plate (48pt, proportional ГОСТ preset)
                       centered + label row "Автомобиль: <make/model>"
                       under. */
                  <View style={[styles.selectedCarStack, { borderTopColor: palette.border.subtle }]}>
                    <PlateBadge plate={selectedCar.plateNumber || ''} active={true} size="compact" />
                    <Text style={[styles.selectedCarLabel, { color: palette.text.primary }]} numberOfLines={1}>
                      <Text style={[styles.selectedCarLabelKey, { color: palette.text.tertiary }]}>Автомобиль: </Text>
                      {selectedCar.makeModel || '—'}
                    </Text>
                    {selectedCar.comment && (
                      <Text style={[styles.selectedCarComment, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {selectedCar.comment}
                      </Text>
                    )}
                  </View>
                )}

                {/* ═══ CLIENT-scoped meta — last visit + active warranties ═══
                    Rendered for ANY selected client, regardless of whether a
                    car is selected. Warranties are keyed by CLIENT (across all
                    the client's cars), not by the single default-selected car,
                    so they must surface even when the client has no car on
                    file or the car list is still loading — which is exactly
                    why they used to stay hidden (they were trapped inside the
                    `selectedCar &&` block above).

                    Both components self-hide when empty (`return null`), and
                    the parent `selectedCard` uses flex `gap` — which adds no
                    space for null children — so this never leaves an empty
                    band for first-time / out-of-warranty clients. */}
                <LastVisitBadge clientId={selectedClient.id} />
                <ActiveWarrantiesSection clientId={selectedClient.id} />
              </View>
            ) : (
              <>
                {/* ═══ ПОИСК ПО ГОСНОМЕРУ ═══ */}
                <View style={styles.plateLabelRow}>
                  <Text style={[styles.sectionSubLabel, { color: palette.text.secondary }]}>ПОИСК ПО ГОСНОМЕРУ</Text>
                  <PlateModeSwitcher value={plateMode} onChange={setPlateMode} />
                </View>

                {/* Realistic license plate input — controlled mode */}
                <RussianPlateInput
                  value={plateSearch}
                  onChangeText={setPlateSearch}
                  autoFocus={false}
                  mode={plateMode}
                />

                {/* Inline search results — appear right below the plate */}
                {normalizedSearch.length >= 2 && plateResults.length > 0 && (
                  <View
                    style={[
                      styles.inlineResults,
                      { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                    ]}
                  >
                    {plateResults.slice(0, 5).map(({ client, car }) => (
                      <TouchableOpacity
                        key={`${client.id}-${car.id}`}
                        style={[styles.inlineResultItem, { borderBottomColor: palette.border.subtle }]}
                        onPress={() => {
                          animateClientToggle();
                          setClientId(client.id);
                          setCarId(car.id);
                          setPlateSearch('');
                        }}
                        activeOpacity={0.7}
                      >
                        {car.plateNumber && (
                          <View style={styles.plateChip}>
                            <Text style={styles.plateChipText}>{car.plateNumber}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.inlineResultName, { color: palette.text.primary }]} numberOfLines={1}>
                            {car.makeModel}
                          </Text>
                          <Text style={[styles.inlineResultSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                            {client.fullName}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {/* Show "not found" only after search completed — i.e. the
                    debounced snapshot has caught up with what's typed AND the
                    request settled. During the 300ms debounce window the
                    state must not flash (RNPERF-5). */}
                {normalizedSearch.length >= 2 &&
                  plateResults.length === 0 &&
                  debouncedNormalized === normalizedSearch &&
                  !isFetchingPlate && (
                    <View style={styles.notFoundBox}>
                      <Text style={[styles.inlineNoResults, { color: palette.text.tertiary }]}>Клиент не найден</Text>
                      {/* M2: не тупик — создаём клиента с этим номером прямо из кассы. */}
                      <TouchableOpacity
                        style={[
                          styles.createClientBtn,
                          { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
                        ]}
                        onPress={() => setShowQuickCreate(true)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="person-add-outline" size={15} color={colors.primary[600]} />
                        <Text style={styles.createClientBtnText}>Создать клиента</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                <View
                  style={[
                    styles.retailDefault,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                >
                  <Ionicons name="storefront-outline" size={16} color={colors.blue[500]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.retailDefaultText, { color: palette.text.primary }]}>
                      Розничный покупатель
                    </Text>
                    <Text style={[styles.retailDefaultHint, { color: palette.text.tertiary }]}>
                      Наберите госномер чтобы привязать клиента
                    </Text>
                  </View>
                </View>
              </>
            )}

            {/* Car picker — only when client has more than one car. The big
                card above already shows the active car; here the user can
                switch between siblings. */}
            {clientId && clientCars && clientCars.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing[2], paddingVertical: spacing[1] }}
              >
                {clientCars.map((car) => {
                  const active = carId === car.id;
                  return (
                    <TouchableOpacity
                      key={car.id}
                      onPress={() => setCarId(car.id)}
                      style={{ alignItems: 'center', gap: 4, opacity: active ? 1 : 0.55 }}
                      activeOpacity={0.85}
                    >
                      <PlateBadge plate={car.plateNumber || ''} active={active} />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: active ? '600' : '500',
                          color: active ? palette.text.primary : palette.text.tertiary,
                          maxWidth: 140,
                        }}
                        numberOfLines={1}
                      >
                        {car.makeModel || '—'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* Mileage */}
            <View
              style={[styles.mileageRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Ionicons name="speedometer-outline" size={16} color={colors.blue[400]} />
              <TextInput
                value={mileage}
                onChangeText={setMileage}
                style={[styles.mileageInput, { color: palette.text.primary }]}
                keyboardType="numeric"
                placeholder="Пробег, км"
                placeholderTextColor={palette.text.tertiary}
              />
            </View>
          </View>

          {/* ═══ SECTION 1.5: COMMENT — separate purple block right after
              client info / mileage but BEFORE services & products. The
              comment is about what the masters did / warned the client
              about, so it belongs to the receipt as a whole — not nested
              inside client info.

              The photo strip lives INSIDE this section (below the textarea)
              so the "notes" block stays a single visual unit: text + photos
              describe the same thing — what happened during the work. */}
          <View
            style={[styles.sectionComment, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.purple[600]} />
              <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Комментарий</Text>
            </View>
            <TextInput
              value={comment}
              onChangeText={setComment}
              style={[
                styles.commentInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              multiline
              placeholder="Введите сюда ваш коментарий..."
              placeholderTextColor={palette.text.tertiary}
            />

            {/* ── Photo strip (feature-gated inline) ─────────────────────── */}
            {canAttachPhotos && (
              <View style={styles.photoBlock}>
                <View style={styles.photoBlockHeader}>
                  <Ionicons name="camera-outline" size={14} color={colors.teal[600]} />
                  <Text style={[styles.photoBlockTitle, { color: palette.text.secondary }]}>Фото к заказ-наряду</Text>
                  <Text style={[styles.photoBlockCount, { color: palette.text.tertiary }]}>
                    {pendingPhotos.length + existingPhotos.length}/{MAX_PHOTOS}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.photoStripContent}
                  keyboardShouldPersistTaps="handled"
                >
                  {existingPhotos.map((photo) => (
                    <TouchableOpacity
                      key={photo.id}
                      activeOpacity={0.85}
                      onPress={() => pickAndAddPhoto({ kind: 'existing', photo })}
                      onLongPress={() => removeExistingPhoto(photo.id)}
                      delayLongPress={400}
                      style={[styles.photoThumbWrap, { borderColor: palette.border.subtle }]}
                    >
                      <ExpoImage
                        source={{ uri: photo.photoUrl }}
                        style={styles.photoThumbImg}
                        contentFit="cover"
                        transition={200}
                        placeholder={{ blurhash: 'L4SY{q?b00?b~q?b?b?b?b?b?b?b' }}
                        placeholderContentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    </TouchableOpacity>
                  ))}
                  {pendingPhotos.map((uri) => (
                    <TouchableOpacity
                      key={uri}
                      activeOpacity={0.85}
                      onPress={() => pickAndAddPhoto({ kind: 'pending', uri })}
                      onLongPress={() => removePendingPhoto(uri)}
                      delayLongPress={400}
                      style={[styles.photoThumbWrap, { borderColor: palette.border.subtle }]}
                    >
                      <ExpoImage
                        source={{ uri }}
                        style={styles.photoThumbImg}
                        contentFit="cover"
                        transition={200}
                        placeholder={{ blurhash: 'L4SY{q?b00?b~q?b?b?b?b?b?b?b' }}
                        placeholderContentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      {uploadingUris.has(uri) && (
                        <View style={styles.photoUploadOverlay}>
                          <ActivityIndicator size="small" color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                  {pendingPhotos.length + existingPhotos.length < MAX_PHOTOS && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => pickAndAddPhoto()}
                      style={[
                        styles.photoAddTile,
                        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      ]}
                      accessibilityLabel="Добавить фото"
                    >
                      <Ionicons name="add" size={28} color={colors.primary[600]} />
                    </TouchableOpacity>
                  )}
                </ScrollView>
              </View>
            )}
          </View>

          {/* ═══ SECTION 2: SERVICES & PRODUCTS — white ═══ */}
          <View
            style={[
              styles.sectionItems,
              buildShadow(palette),
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <View style={[styles.sectionHeader, { justifyContent: 'space-between' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <Ionicons name="receipt-outline" size={18} color={colors.orange[600]} />
                <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Товары и услуги</Text>
              </View>
              <TouchableOpacity
                style={[styles.templateChip, { backgroundColor: colors.primary[50], borderColor: colors.primary[100] }]}
                onPress={() => setShowTemplatesPicker(true)}
                hitSlop={8}
              >
                <Ionicons name="copy-outline" size={13} color={colors.primary[600]} />
                <Text style={styles.templateChipText}>Шаблоны</Text>
              </TouchableOpacity>
            </View>

            {/* Services */}
            <View
              style={[styles.linesSection, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <View style={styles.linesSectionHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <View style={[styles.sectionIcon, { backgroundColor: colors.orange[50] }]}>
                    <Ionicons name="build-outline" size={14} color={colors.orange[500]} />
                  </View>
                  <Text style={[styles.linesSectionTitle, { color: palette.text.primary }]}>Услуги</Text>
                  {serviceLines.length > 0 && (
                    <View style={styles.lineBadge}>
                      <Text style={styles.lineBadgeText}>{serviceLines.length}</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.addLineBtn}
                  onPress={() => {
                    setServiceSearch('');
                    setShowServicePicker(true);
                  }}
                >
                  <Ionicons name="add" size={16} color={colors.primary[600]} />
                </TouchableOpacity>
              </View>
              {serviceLines.map((line, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.lineItem,
                    { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                  ]}
                >
                  <View style={styles.lineTop}>
                    <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => removeServiceLine(idx)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle-outline" size={18} color={colors.red[400]} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.lineMasterRow} onPress={() => setShowMasterPicker(idx)}>
                    <Ionicons name="person-outline" size={12} color={colors.primary[500]} />
                    <Text style={styles.lineMasterText}>{getMasterName(line.lineMasterId || line.masterId)}</Text>
                    <Ionicons name="chevron-down" size={10} color={palette.text.tertiary} />
                  </TouchableOpacity>
                  <View style={styles.lineInputs}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lineInputLabel, { color: palette.text.secondary }]}>Цена</Text>
                      <TextInput
                        value={String(line.price)}
                        onChangeText={(v) => updateServiceLine(idx, 'price', parseMoneyInput(v))}
                        style={[
                          styles.lineInput,
                          {
                            backgroundColor: palette.bg.muted,
                            borderColor: palette.border.subtle,
                            color: palette.text.primary,
                          },
                        ]}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                    </View>
                    <View style={{ width: 60 }}>
                      <Text style={[styles.lineInputLabel, { color: palette.text.secondary }]}>Кол.</Text>
                      <TextInput
                        value={String(line.quantity)}
                        onChangeText={(v) => updateServiceLine(idx, 'quantity', parseMoneyInput(v) || 1)}
                        style={[
                          styles.lineInput,
                          {
                            backgroundColor: palette.bg.muted,
                            borderColor: palette.border.subtle,
                            color: palette.text.primary,
                          },
                        ]}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                    </View>
                    <Text style={[styles.lineTotal, { color: palette.text.primary }]}>
                      {formatMoney(line.price * line.quantity)}
                    </Text>
                  </View>
                </View>
              ))}
              {serviceLines.length === 0 && (
                <TouchableOpacity
                  style={[styles.emptyAddBtn, { borderColor: palette.border.subtle }]}
                  onPress={() => {
                    setServiceSearch('');
                    setShowServicePicker(true);
                  }}
                >
                  <Ionicons name="add-circle-outline" size={18} color={palette.text.tertiary} />
                  <Text style={[styles.emptyAddText, { color: palette.text.tertiary }]}>Добавить услугу</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Products */}
            <View
              style={[styles.linesSection, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <View style={styles.linesSectionHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <View style={[styles.sectionIcon, { backgroundColor: colors.blue[50] }]}>
                    <Ionicons name="cube-outline" size={14} color={colors.blue[600]} />
                  </View>
                  <Text style={[styles.linesSectionTitle, { color: palette.text.primary }]}>Товары</Text>
                  {productLines.length > 0 && (
                    <View style={styles.lineBadge}>
                      <Text style={styles.lineBadgeText}>{productLines.length}</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity style={styles.addLineBtn} onPress={() => setShowProductPicker(true)}>
                  <Ionicons name="add" size={16} color={colors.primary[600]} />
                </TouchableOpacity>
              </View>
              {productLines.map((line, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.lineItem,
                    { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                  ]}
                >
                  <View style={styles.lineTop}>
                    <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={1}>
                      {line.name}
                    </Text>
                    <TouchableOpacity
                      onPress={() => removeProductLine(idx)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle-outline" size={18} color={colors.red[400]} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.lineInputs}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lineInputLabel, { color: palette.text.secondary }]}>Цена</Text>
                      <TextInput
                        value={String(line.sellPrice)}
                        onChangeText={(v) => updateProductLine(idx, 'sellPrice', parseMoneyInput(v))}
                        style={[
                          styles.lineInput,
                          {
                            backgroundColor: palette.bg.muted,
                            borderColor: palette.border.subtle,
                            color: palette.text.primary,
                          },
                        ]}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                    </View>
                    <View style={{ width: 60 }}>
                      <Text style={[styles.lineInputLabel, { color: palette.text.secondary }]}>Кол.</Text>
                      <TextInput
                        value={String(line.quantity)}
                        onChangeText={(v) => updateProductLine(idx, 'quantity', parseMoneyInput(v) || 1)}
                        style={[
                          styles.lineInput,
                          {
                            backgroundColor: palette.bg.muted,
                            borderColor: palette.border.subtle,
                            color: palette.text.primary,
                          },
                        ]}
                        keyboardType="numeric"
                        selectTextOnFocus
                      />
                    </View>
                    <Text style={[styles.lineTotal, { color: palette.text.primary }]}>
                      {formatMoney(line.sellPrice * line.quantity)}
                    </Text>
                  </View>
                  {/* M4: мягкое предупреждение об оверселле — по кешу склада. */}
                  {!!line.productId && oversoldByProductId.has(line.productId) && (
                    <View style={styles.stockWarnRow}>
                      <Ionicons name="alert-circle-outline" size={13} color={colors.amber[600]} />
                      <Text style={styles.stockWarnText}>
                        На складе только {Math.max(oversoldByProductId.get(line.productId)!.stock, 0)} шт
                      </Text>
                    </View>
                  )}
                </View>
              ))}
              {productLines.length === 0 && (
                <TouchableOpacity
                  style={[styles.emptyAddBtn, { borderColor: palette.border.subtle }]}
                  onPress={() => setShowProductPicker(true)}
                >
                  <Ionicons name="add-circle-outline" size={18} color={palette.text.tertiary} />
                  <Text style={[styles.emptyAddText, { color: palette.text.tertiary }]}>Добавить товар</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Сохранить как шаблон */}
            {(serviceLines.length > 0 || productLines.length > 0) && (
              <TouchableOpacity
                style={[styles.saveTemplateBtn, { borderColor: palette.border.subtle }]}
                onPress={saveAsTemplate}
              >
                <Ionicons name="bookmark-outline" size={14} color={palette.text.tertiary} />
                <Text style={[styles.saveTemplateBtnText, { color: palette.text.tertiary }]}>Сохранить как шаблон</Text>
              </TouchableOpacity>
            )}

            {/* Discount */}
            <View
              style={[styles.discountRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Ionicons name="pricetag-outline" size={16} color={colors.orange[500]} />
              <Text style={[styles.discountLabel, { color: palette.text.secondary }]}>Скидка</Text>
              <TextInput
                value={discount}
                onChangeText={setDiscount}
                style={[styles.discountInput, { color: palette.text.primary }]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
              <Text style={[styles.discountCurrency, { color: palette.text.tertiary }]}>₽</Text>
            </View>
            {/* MOB-02: та же семантика, что на сервере и в вебе. */}
            <Text style={[styles.discountHint, { color: palette.text.tertiary }]}>Скидка применяется к товарам</Text>
          </View>

          {/* ═══ SECTION 3 (was COMMENT — moved into client section above) ═══ */}

          {/* ═══ SECTION 4: SUMMARY — special card ═══ */}
          {(serviceLines.length > 0 || productLines.length > 0) && (
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: palette.bg.card, borderColor: palette.accent.primarySoft },
              ]}
            >
              <Text style={[styles.summaryTitle, { color: palette.text.tertiary }]}>ИТОГО</Text>
              {serviceLines.length > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="build-outline" size={14} color={palette.text.tertiary} />
                    <Text style={[styles.summaryLabel, { color: palette.text.secondary }]}>
                      Услуги ({serviceLines.length})
                    </Text>
                  </View>
                  <Text style={[styles.summaryValue, { color: palette.text.primary }]}>
                    {formatMoney(serviceTotal)}
                  </Text>
                </View>
              )}
              {productLines.length > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="cube-outline" size={14} color={palette.text.tertiary} />
                    <Text style={[styles.summaryLabel, { color: palette.text.secondary }]}>
                      Товары ({productLines.length})
                    </Text>
                  </View>
                  <Text style={[styles.summaryValue, { color: palette.text.primary }]}>
                    {formatMoney(productTotal)}
                  </Text>
                </View>
              )}
              {serviceLines.length > 0 && productLines.length > 0 && (
                <>
                  <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
                  <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: palette.text.secondary }]}>Подитог</Text>
                    <Text style={[styles.summaryValue, { color: palette.text.primary }]}>{formatMoney(subtotal)}</Text>
                  </View>
                </>
              )}
              {discountNum > 0 && (
                <View style={styles.summaryRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Ionicons name="pricetag-outline" size={14} color={colors.orange[500]} />
                    <Text style={[styles.summaryLabel, { color: colors.orange[600] }]}>Скидка</Text>
                  </View>
                  {/* MOB-02: показываем ПРИМЕНЁННУЮ скидку (≤ суммы товаров),
                      чтобы строки сходились с «К оплате» копейка в копейку. */}
                  <Text style={[styles.summaryValue, { color: colors.orange[600] }]}>
                    -{formatMoney(effectiveDiscount)}
                  </Text>
                </View>
              )}
              <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryTotalLabel, { color: palette.text.primary }]}>К оплате</Text>
                <Text style={styles.summaryTotalValue}>{formatMoney(total)}</Text>
              </View>
            </View>
          )}

          {/* ═══ SECTION 5: PAYMENT — green tint ═══ */}
          <View
            style={[styles.sectionPayment, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet-outline" size={18} color={colors.green[600]} />
              <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Оплата</Text>
            </View>

            {/* Одна кнопка «Оплата» открывает центральную модалку выбора.
                Текущий способ показан компактно: цветной тайл-иконка + подпись.
                Inline-ряд из четырёх кнопок заменён на этот аккуратный селектор. */}
            {(() => {
              const visual = paymentMethodVisual(paymentMethod);
              return (
                <TouchableOpacity
                  style={[styles.paymentSelector, { backgroundColor: palette.bg.muted, borderColor: visual.color }]}
                  onPress={() => {
                    haptic('tap');
                    setShowPaymentPicker(true);
                  }}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`Способ оплаты: ${paymentMethodLabel(paymentMethod)}`}
                >
                  <View style={[styles.paymentSelectorIcon, { backgroundColor: visual.tint }]}>
                    <Ionicons name={visual.icon} size={20} color={visual.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paymentSelectorHint, { color: palette.text.tertiary }]}>Способ оплаты</Text>
                    <Text style={[styles.paymentSelectorValue, { color: palette.text.primary }]} numberOfLines={1}>
                      {paymentMethodLabel(paymentMethod)}
                    </Text>
                  </View>
                  <Ionicons name="chevron-down" size={18} color={palette.text.tertiary} />
                </TouchableOpacity>
              );
            })()}

            {paymentMethod === ('cash' as PaymentMethod) && (
              <View
                style={[styles.splitWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
                    <Text style={[styles.splitLabel, { color: palette.text.secondary }]}>Клиент дал</Text>
                  </View>
                  <TextInput
                    value={cashGiven}
                    onChangeText={setCashGiven}
                    style={[
                      styles.splitInput,
                      {
                        backgroundColor: palette.bg.card,
                        borderColor: palette.border.subtle,
                        color: palette.text.primary,
                      },
                    ]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={palette.text.tertiary}
                  />
                </View>
                {parseMoneyInput(cashGiven) > total && (
                  <>
                    <View style={[styles.splitDivider, { backgroundColor: palette.border.subtle }]} />
                    <View style={styles.splitRow}>
                      <View style={styles.splitIconRow}>
                        <Ionicons name="arrow-undo-outline" size={16} color={colors.green[700]} />
                        <Text
                          style={[styles.splitLabel, { color: palette.text.secondary, fontWeight: fontWeight.bold }]}
                        >
                          Сдача
                        </Text>
                      </View>
                      <Text style={{ fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.green[700] }}>
                        {formatMoney(parseMoneyInput(cashGiven) - total)}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}

            {paymentMethod === ('cash_card' as PaymentMethod) && (
              <View
                style={[styles.splitWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
                    <Text style={[styles.splitLabel, { color: palette.text.secondary }]}>Наличные</Text>
                  </View>
                  <TextInput
                    value={cashAmount}
                    onChangeText={setCashAmount}
                    style={[
                      styles.splitInput,
                      {
                        backgroundColor: palette.bg.card,
                        borderColor: palette.border.subtle,
                        color: palette.text.primary,
                      },
                    ]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={palette.text.tertiary}
                  />
                </View>
                <View style={[styles.splitDivider, { backgroundColor: palette.border.subtle }]} />
                <View style={styles.splitRow}>
                  <View style={styles.splitIconRow}>
                    <Ionicons name="card-outline" size={16} color={colors.blue[600]} />
                    <Text style={[styles.splitLabel, { color: palette.text.secondary }]}>Карта</Text>
                  </View>
                  <Text style={styles.splitCardAmount}>{formatMoney(cardAmountCalc)}</Text>
                </View>
              </View>
            )}

            {/* Оплата по СБП / QR — ДОБАВОЧНЫЙ эквайринг. Виден, когда есть что
                проводить и чек не откладывается. Открывает модалку: создаёт
                онлайн-платёж, показывает ссылку СБП, опрашивает статус; при
                успехе проводит чек по карточному (электронному) тендеру.
                нал/карта/смешанная/отложенный — без изменений. */}
            {!isDeferred && total > 0 && (serviceLines.length > 0 || productLines.length > 0) && (
              <TouchableOpacity
                style={[
                  styles.sbpButton,
                  { backgroundColor: getBadgeColors(palette.mode).purple.bg, borderColor: colors.purple[600] },
                ]}
                onPress={openSbpPayment}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Оплата по СБП или QR-коду"
              >
                <View
                  style={[
                    styles.sbpButtonIcon,
                    { backgroundColor: palette.mode === 'dark' ? palette.bg.card : '#FFFFFF' },
                  ]}
                >
                  <Ionicons name="qr-code-outline" size={20} color={colors.purple[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.sbpButtonTitle, { color: getBadgeColors(palette.mode).purple.text }]}
                    numberOfLines={1}
                  >
                    Оплата по СБП / QR
                  </Text>
                  <Text style={[styles.sbpButtonHint, { color: palette.text.tertiary }]} numberOfLines={1}>
                    Система быстрых платежей — оплата по QR
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.purple[600]} />
              </TouchableOpacity>
            )}

            {/* Deferred toggle */}
            <TouchableOpacity
              style={[
                styles.deferToggle,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                isDeferred && styles.deferToggleActive,
              ]}
              onPress={() => setIsDeferred(!isDeferred)}
            >
              <Ionicons
                name={isDeferred ? 'checkbox' : 'square-outline'}
                size={20}
                color={isDeferred ? colors.amber[600] : palette.text.tertiary}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.deferLabel,
                    { color: palette.text.secondary },
                    isDeferred && { color: colors.amber[600] },
                  ]}
                >
                  Отложить чек
                </Text>
                <Text style={[styles.deferHint, { color: palette.text.tertiary }]}>Сохранить как черновик</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Submit — PressableScale gives the iOS scale-press (Android ripple),
              matching the app's CTA convention (see platform/PressableScale).
              hapticIntent is null on purpose: the meaningful feedback is the
              'success' haptic fired in createMutation.onSuccess (only when the
              check is actually saved) and the 'warning' haptic on a validation
              early-return — a bare tap should not feel like a confirmation. */}
          <PressableScale
            style={[styles.submitBtn, createMutation.isPending && { opacity: 0.5 }]}
            onPress={() => handleSubmit()}
            disabled={createMutation.isPending}
            hapticIntent={null}
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
                <Ionicons
                  name={isDeferred ? 'pause-circle-outline' : 'checkmark-circle-outline'}
                  size={20}
                  color={colors.white}
                />
                <Text style={styles.submitBtnText}>
                  {isDeferred ? 'Отложить' : editId ? 'Сохранить' : `Пробить — ${formatMoney(total)}`}
                </Text>
              </LinearGradient>
            )}
          </PressableScale>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Master Picker */}
      <Modal visible={showMasterPicker !== null} onClose={() => setShowMasterPicker(null)} title="Выберите мастера">
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4 }} keyboardShouldPersistTaps="handled">
          {masters.map((m) => {
            const isSelected =
              showMasterPicker !== null &&
              (serviceLines[showMasterPicker]?.lineMasterId || serviceLines[showMasterPicker]?.masterId) === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.pickerItem,
                  { borderBottomColor: palette.border.subtle },
                  isSelected && { backgroundColor: palette.accent.primarySoft },
                ]}
                onPress={() => {
                  if (showMasterPicker !== null) {
                    updateServiceLine(showMasterPicker, 'lineMasterId', m.id);
                    updateServiceLine(showMasterPicker, 'masterId', m.id);
                  }
                  setShowMasterPicker(null);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <View
                    style={[
                      styles.masterCircle,
                      { backgroundColor: palette.bg.muted },
                      isSelected && { backgroundColor: colors.primary[100] },
                    ]}
                  >
                    <Ionicons
                      name="person"
                      size={14}
                      color={isSelected ? colors.primary[600] : palette.text.tertiary}
                    />
                  </View>
                  <Text
                    style={[
                      styles.pickerName,
                      { color: palette.text.primary },
                      isSelected && { color: colors.primary[700] },
                    ]}
                  >
                    {m.fullName}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={20} color={colors.primary[600]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Modal>

      {/* Service Picker */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title="Добавить услугу">
        <TextInput
          value={serviceSearch}
          onChangeText={setServiceSearch}
          style={[
            styles.formInput,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
              marginBottom: spacing[3],
            },
          ]}
          placeholder="Поиск услуги..."
          placeholderTextColor={palette.text.tertiary}
          autoFocus
        />
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }} keyboardShouldPersistTaps="handled">
          {filteredServices.map((service) => (
            <TouchableOpacity
              key={service.id}
              style={[styles.pickerItem, { borderBottomColor: palette.border.subtle }]}
              onPress={() => addServiceLine(service)}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.pickerName, { color: palette.text.primary }]}>{service.name}</Text>
              </View>
              <Text style={styles.pickerPrice}>{formatMoney(service.defaultPrice)}</Text>
            </TouchableOpacity>
          ))}
          {serviceSearch && filteredServices.length === 0 && (
            <Text style={{ textAlign: 'center', color: palette.text.tertiary, paddingVertical: spacing[4] }}>
              Ничего не найдено
            </Text>
          )}
        </ScrollView>
      </Modal>

      {/* Product Picker — extracted into <ProductPickerModal/>. Visual rows
          mirror the warehouse list (`ProductsScreen.tsx`); the modal is
          virtualised via FlashList and reads from the same
          `['all-products-check']` cache key prefetched on login + on this
          screen mount, so opening the picker is a cache-hit, no flash. */}
      <ProductPickerModal
        visible={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        onSelectProduct={addProductLine}
        getCartQty={getProductCartQty}
        title={'Товары'}
        showCostPrice={canSeeCostPrice}
        warehouseId={pickerWarehouseId}
        warrantyNames={warrantyProductNames}
        warehouseSwitcher={{
          value: pickerWarehouseId,
          label: warehouseChipLabel,
          options: (warehouses || []).map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
          onChange: (id) => setPickerWarehouseId(id),
        }}
      />

      {/* Templates Picker */}
      <Modal visible={showTemplatesPicker} onClose={() => setShowTemplatesPicker(false)} title="Шаблоны чеков">
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }} keyboardShouldPersistTaps="handled">
          {templates.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing[6] }}>
              <Ionicons name="copy-outline" size={32} color={colors.gray[300]} />
              <Text style={{ color: colors.gray[400], marginTop: spacing[2], fontSize: 14 }}>
                Нет сохранённых шаблонов
              </Text>
              <Text style={{ color: colors.gray[400], fontSize: 12, textAlign: 'center', marginTop: spacing[1] }}>
                Добавьте услуги и товары, затем нажмите «Сохранить как шаблон»
              </Text>
            </View>
          ) : (
            templates.map((tpl) => (
              <View key={tpl.id} style={[styles.pickerItem, { borderBottomColor: colors.gray[100] }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerName, { color: colors.gray[900] }]}>{tpl.name}</Text>
                  <Text style={{ fontSize: 11, color: colors.gray[400], marginTop: 2 }}>
                    {tpl.services.length > 0 ? `${tpl.services.length} усл.` : ''}
                    {tpl.services.length > 0 && tpl.products.length > 0 ? ' · ' : ''}
                    {tpl.products.length > 0 ? `${tpl.products.length} тов.` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <TouchableOpacity
                    onPress={() => applyTemplate(tpl)}
                    style={{
                      backgroundColor: colors.primary[50],
                      borderRadius: 8,
                      paddingHorizontal: spacing[3],
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ fontSize: 13, color: colors.primary[600], fontWeight: '600' }}>Применить</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert('Удалить шаблон?', tpl.name, [
                        { text: 'Отмена', style: 'cancel' },
                        { text: 'Удалить', style: 'destructive', onPress: () => deleteTemplate(tpl.id) },
                      ])
                    }
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </Modal>

      {/* M2: быстрый клиент из «Клиент не найден». Создание (или выбор
          найденного дубликата) сразу подставляет клиента и авто в чек —
          без повторного поиска. */}
      <QuickClientCreateSheet
        visible={showQuickCreate}
        onClose={() => setShowQuickCreate(false)}
        initialPlate={plateSearch}
        initialPlateMode={plateMode}
        onCreated={(client, car) => {
          setShowQuickCreate(false);
          // Засеваем кеш карточки клиента, чтобы selected-card появилась
          // мгновенно (selectedClient читает ['client-detail', clientId]).
          queryClient.setQueryData<Client>(['client-detail', client.id], {
            ...client,
            cars: car ? [car] : client.cars || [],
          });
          animateClientToggle();
          setClientId(client.id);
          if (car) setCarId(car.id);
          setPlateSearch('');
        }}
        onSelectExisting={(existingClientId, existingCarId) => {
          setShowQuickCreate(false);
          animateClientToggle();
          setClientId(existingClientId);
          if (existingCarId) setCarId(existingCarId);
          setPlateSearch('');
        }}
      />

      {/* Центральная модалка выбора способа оплаты. Закрывается сразу после
          выбора; sub-UI для cash / cash_card живёт в секции оплаты как прежде. */}
      <PaymentMethodModal
        visible={showPaymentPicker}
        value={paymentMethod}
        onSelect={(m) => {
          setPaymentMethod(m);
          setShowPaymentPicker(false);
        }}
        onClose={() => setShowPaymentPicker(false)}
      />

      {/* Приём оплаты по СБП / QR (эквайринг). Сумма = «К оплате».
          При успехе родитель проводит чек по карточному (электронному) тендеру.

          BUG #6 — ЛИНКОВКА ПЛАТЕЖА К ЧЕКУ (reconciliation gap):
          • Режим РЕДАКТИРОВАНИЯ: чек уже существует → передаём `editId`, и бэк
            проставляет payment.check_id — связь есть.
          • Режим СОЗДАНИЯ: по порядку «pre-validate → pay → commit» (BUG #1)
            чек физически создаётся ТОЛЬКО ПОСЛЕ успешной оплаты, т.е. в момент
            создания платежа checkId ещё не существует — связать нечего.
            Ретроспективно проставить check_id нельзя: в контракте payments
            (createPaymentsApi) есть лишь create/get — эндпоинта обновления /
            линковки платежа нет, а бэкенд/API трогать запрещено. Поэтому для
            НОВОГО чека payment.check_id остаётся null.
            Хэндл для сверки (reconciliation) всё равно есть: платёж
            tenant-scoped, со штампом времени и суммой; созданный следом чек
            имеет ту же сумму, paymentMethod='card' и тот же момент времени —
            пара сводится по (tenant, сумма, время). Полная линковка нового
            чека потребовала бы backend-эндпоинта и здесь сознательно не
            делается. */}
      <SbpPaymentModal
        visible={showSbp}
        amount={total}
        checkId={editId || undefined}
        onClose={() => setShowSbp(false)}
        onSucceeded={handleSbpSucceeded}
      />

      {/* Legacy bottom-sheet kept dormant — replaced by the inline
          dropdown inside ProductPickerModal. iOS would freeze when
          presenting this RNModal on top of the picker RNModal during
          the warehouse switch. */}
      {false && (
        <Modal visible={showWarehouseSheet} onClose={() => setShowWarehouseSheet(false)} title="Выбрать склад">
          {(warehouses || []).map((w) => {
            const iconName: keyof typeof Ionicons.glyphMap =
              w.kind === 'defect' ? 'warning-outline' : w.kind === 'used' ? 'cube-outline' : 'home-outline';
            const sub =
              w.kind === 'defect'
                ? 'Брак — можно продать со склада брака'
                : w.kind === 'used'
                  ? 'Б/У — продажа подержанных деталей'
                  : 'Основной склад';
            const active = pickerWarehouseId === w.id;
            return (
              <TouchableOpacity
                key={w.id}
                style={styles.warehouseOption}
                onPress={() => {
                  setPickerWarehouseId(w.id);
                  setShowWarehouseSheet(false);
                }}
                activeOpacity={0.7}
              >
                <Ionicons name={iconName} size={18} color={colors.primary[600]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warehouseOptionName}>{w.name}</Text>
                  <Text style={styles.warehouseOptionSub}>{sub}</Text>
                </View>
                {active ? <Ionicons name="checkmark" size={20} color={colors.primary[600]} /> : null}
              </TouchableOpacity>
            );
          })}
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[100] },
  // Floating back chevron — shown only when CheckCreate is pushed onto
  // the stack (edit-mode from Журнал). Sits in the top-left safe area.
  floatingBack: {
    position: 'absolute',
    left: spacing[3],
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[3], gap: spacing[2.5], paddingBottom: spacing[12] },

  // ═══ Section containers with distinct backgrounds ═══
  sectionClient: {
    backgroundColor: colors.blue[50],
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.blue[100],
  },
  sectionItems: {
    // Surface comes from the inline `palette.bg.card` override in render —
    // no hardcoded white here so dark mode tints correctly.
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[2.5],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  sectionComment: {
    backgroundColor: colors.purple[50],
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.purple[100],
  },
  sectionPayment: {
    backgroundColor: colors.green[50],
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[2.5],
    borderWidth: 1,
    borderColor: colors.green[100],
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: 0 },
  sectionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[800] },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  templateChipText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  saveTemplateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveTemplateBtnText: { fontSize: 12, fontWeight: fontWeight.medium },

  // Date/Time
  dateTimeCard: { flexDirection: 'row', gap: spacing[2] },
  dateBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[2.5],
  },
  dateBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  timeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[4],
  },
  timeBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  // Selected client row
  selectedClientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[2],
  },
  selectedClientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  selectedClientPhone: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  // Premium selected-client card — three sections: client header,
  // hairline divider with section label, car block (plate + chip).
  selectedCard: {
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3.5],
    paddingBottom: spacing[4],
    marginTop: spacing[1],
    gap: spacing[3],
  },
  selectedCardTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
  },
  selectedCardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary[50],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary[100],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  selectedCardName: { fontSize: 17, fontWeight: '700', color: colors.gray[900], letterSpacing: -0.2 },
  selectedCardPhone: { fontSize: 13, color: colors.gray[500], marginTop: 2 },
  selectedCardClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Vertical stack: compact plate (48pt, "compact" preset — proportional,
  // not stretched) centered + label row "Автомобиль: <make/model>" under.
  selectedCarStack: {
    alignItems: 'center' as const,
    gap: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
    marginTop: spacing[1],
  },
  selectedCarLabel: {
    fontSize: 14,
    color: colors.gray[800],
    textAlign: 'center' as const,
    letterSpacing: -0.1,
  },
  selectedCarLabelKey: {
    color: colors.gray[500],
    fontWeight: '500' as const,
  },
  selectedCarComment: {
    fontSize: 12,
    color: colors.gray[500],
    textAlign: 'center' as const,
  },
  sectionSubLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.gray[500],
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: spacing[1.5],
  },
  retailDefault: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    backgroundColor: colors.blue[50],
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    marginTop: spacing[2],
  },
  retailDefaultText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.blue[700] },
  retailDefaultHint: { fontSize: 11, color: colors.blue[400], marginTop: 1 },
  // Inline search results
  inlineResults: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    marginTop: spacing[1.5],
    overflow: 'hidden' as const,
  },
  inlineResultItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
  },
  inlineResultName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  inlineResultSub: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  inlineNoResults: { fontSize: 12, color: colors.gray[400], textAlign: 'center' as const, paddingVertical: spacing[3] },
  // «Клиент не найден» + CTA «Создать клиента» (M2)
  notFoundBox: { alignItems: 'center' as const, gap: spacing[1] },
  createClientBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[1.5],
    borderWidth: 1,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    marginBottom: spacing[1],
  },
  createClientBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
  plateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[1.5],
  },
  // Car
  carChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.white,
  },
  carChipActive: { borderColor: colors.blue[500], backgroundColor: colors.blue[50] },
  carChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  carChipTextActive: { color: colors.blue[700] },
  carPlate: {
    fontSize: 10,
    color: colors.gray[400],
    backgroundColor: colors.gray[100],
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  // Mileage
  mileageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[1],
  },
  mileageInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: spacing[2] },
  // Lines sections
  linesSection: {
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  linesSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  linesSectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  sectionIcon: { width: 28, height: 28, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  lineBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  lineBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.primary[600] },
  addLineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineItem: {
    // Surface from the inline `palette.bg.elevated` override — no hardcoded
    // white so the row tints in dark mode.
    borderRadius: borderRadius.lg,
    padding: spacing[2.5],
    marginBottom: spacing[1.5],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[0.5] },
  lineName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[900],
    flex: 1,
    marginRight: spacing[2],
  },
  lineMasterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    marginBottom: spacing[1.5],
    alignSelf: 'flex-start',
  },
  lineMasterText: { fontSize: 11, color: colors.primary[700], fontWeight: fontWeight.medium },
  lineInputs: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  lineInputLabel: { fontSize: 10, color: colors.gray[500], marginBottom: 2 },
  lineInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  lineTotal: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    minWidth: 70,
    textAlign: 'right',
  },
  // M4: янтарное предупреждение «На складе только N шт» под строкой товара.
  stockWarnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[1.5],
  },
  stockWarnText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.amber[600] },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
  },
  emptyAddText: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Warehouse picker sheet rows — used by the in-cash product picker.
  warehouseOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[100],
  },
  warehouseOptionName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  warehouseOptionSub: { fontSize: 11, color: colors.gray[500], marginTop: 1 },
  // Discount
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
  },
  discountLabel: { fontSize: fontSize.sm, color: colors.gray[500], flex: 1 },
  discountInput: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    textAlign: 'right',
    minWidth: 60,
    paddingVertical: spacing[1],
  },
  discountCurrency: { fontSize: fontSize.sm, color: colors.gray[400] },
  // MOB-02: подсказка о семантике скидки (товары, не услуги).
  discountHint: {
    fontSize: 11,
    color: colors.gray[400],
    paddingHorizontal: spacing[1],
    marginTop: -spacing[1.5],
  },
  // Comment
  commentInput: {
    fontSize: fontSize.sm,
    color: colors.gray[900],
    minHeight: 40,
    textAlignVertical: 'top',
    // Surface from the inline `palette.bg.muted` override — no hardcoded white.
    borderWidth: 1,
    borderColor: colors.purple[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
  },
  commentInlineWrap: { marginTop: spacing[2] },
  commentInline: {
    fontSize: fontSize.sm,
    color: colors.gray[900],
    minHeight: 40,
    textAlignVertical: 'top' as const,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.blue[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
  },
  // Summary
  summaryCard: {
    // Surface from the inline `palette.bg.card` override — no hardcoded white.
    borderRadius: borderRadius['2xl'],
    borderWidth: 2,
    borderColor: colors.primary[100],
    padding: spacing[3.5],
  },
  summaryTitle: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1],
  },
  summaryLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  summaryValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  summaryDivider: { height: 1, backgroundColor: colors.gray[100], marginVertical: spacing[1] },
  summaryTotalLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  summaryTotalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary[600] },
  // Payment
  // Селектор способа оплаты — одна строка-кнопка, открывает PaymentMethodModal.
  paymentSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
  },
  paymentSelectorIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentSelectorHint: { fontSize: 11, fontWeight: fontWeight.medium, letterSpacing: -0.1 },
  paymentSelectorValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.2, marginTop: 1 },
  // Кнопка «Оплата по СБП / QR» — добавочный эквайринг, визуально отделён от
  // зелёного селектора способа фиолетовым акцентом (бренд СБП).
  sbpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    marginTop: spacing[2.5],
  },
  sbpButtonIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sbpButtonTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  sbpButtonHint: { fontSize: 11, fontWeight: fontWeight.medium, letterSpacing: -0.1, marginTop: 1 },
  splitWrap: {
    // Surface from the inline `palette.bg.muted` override — no hardcoded white.
    borderRadius: borderRadius.xl,
    padding: spacing[2.5],
    borderWidth: 1,
    borderColor: colors.green[200],
  },
  splitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitIconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  splitLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  splitInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.green[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    width: 100,
    textAlign: 'right',
  },
  splitDivider: { height: 1, backgroundColor: colors.green[200], marginVertical: spacing[2] },
  splitCardAmount: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.blue[600] },
  // Defer
  deferToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    // Surface from the inline `palette.bg.muted` override — no hardcoded white.
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.green[200],
    padding: spacing[2.5],
  },
  deferToggleActive: { borderColor: colors.amber[200], backgroundColor: colors.amber[50] },
  deferredEditHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    backgroundColor: colors.amber[50],
    borderWidth: 1,
    borderColor: colors.amber[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  deferredEditHintText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.amber[600] },
  deferLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deferHint: { fontSize: 11, color: colors.gray[400] },
  // Submit
  submitBtn: { borderRadius: borderRadius.xl, overflow: 'hidden' },
  submitGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
  },
  submitBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  // Form / Picker shared
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  pickerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  pickerName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  pickerSub: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  pickerPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] },
  plateChip: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  plateChipText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.primary[700] },
  masterCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // (Product Picker styles moved into <ProductPickerModal/>.)

  // ── Photo strip (lives inside the comment section) ───────────────────────
  // 64×64 thumbnails matches the "compact strip" feel asked for — large
  // enough to recognise the picture, small enough that 5+ fit on screen
  // without scrolling on an iPhone 14.
  photoBlock: { marginTop: spacing[2], gap: spacing[1.5] },
  photoBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[1],
  },
  photoBlockTitle: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  photoBlockCount: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  photoStripContent: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingVertical: spacing[1],
  },
  photoThumbWrap: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    position: 'relative',
  },
  photoThumbImg: { width: '100%', height: '100%' },
  photoUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAddTile: {
    width: 64,
    height: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
