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
  Platform,
  Dimensions,
  LayoutAnimation,
  AccessibilityInfo,
  Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient, onlineManager } from '@tanstack/react-query';
import { useNavigation, useRoute, usePreventRemove } from '@react-navigation/native';
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
  voiceApi,
} from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { formatQty, roundQty, unitLabel } from '../utils/units';
import Modal from '../components/Modal';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import QtyInput from '../components/QtyInput';
import RussianPlateInput from '../components/RussianPlateInput';
import PlateModeSwitcher, { type PlateMode } from '../components/PlateModeSwitcher';
import DateTimePickerModal from '../components/DateTimePickerModal';
import QuickClientCreateSheet from '../components/QuickClientCreateSheet';
import ClientPhonePickerSheet from '../components/ClientPhonePickerSheet';
import ClientCarPickerSheet from '../components/ClientCarPickerSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import CheckTagSheet from '../components/CheckTagSheet';
import PaymentMethodModal, { paymentMethodLabel, paymentMethodVisual } from '../components/PaymentMethodModal';
import SbpPaymentModal from '../components/SbpPaymentModal';
import InstallmentSaleFields from '../components/installments/InstallmentSaleFields';
import { toYmd, formatYmdHuman } from '../components/installments/installmentUi';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, softTint } from '../theme';
import { buildShadow } from '../platform/iosSurface';
import { normalizePlateForSearch, splitPlate, formatMain, isRussianInput } from '../utils/plateMask';
import { haptic } from '../platform/haptics';
import { PressableScale } from '../platform/PressableScale';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { usePosSettings } from '../hooks/usePosSettings';
import {
  claimProductPickerSession,
  notifyProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../utils/productPickerSession';
import { enqueueOfflineCheck, generateClientRequestId, isNetworkClassCheckError } from '../utils/offlineCheckQueue';
import { buildCheckFormFingerprint, findStrayMaster } from './checkCreate/formGuards';
import type {
  Client,
  Car,
  User,
  Service,
  Product,
  Check,
  CheckServiceLine,
  CheckProductLine,
  CheckTag,
  PaymentMethod,
  Warehouse,
  CheckTemplate,
  CheckTemplateFolder,
  CheckPhoto,
  SubscriptionInfo,
  ActiveWarranty,
  ChecksBoard,
  VoiceUsage,
  TenantLocation,
} from '../../../shared/types';
// Домен шаблонов (round 8 #3): помощники и инлайн-пикер папок живут в
// TemplatesScreen — единый источник правил «что общий / как строить дерево»
// для этого пикера, редактора и раздела «Ещё → Шаблоны».
import { FolderPickerList, isSharedTemplate, templateSummary, pluralRu } from './TemplatesScreen';
import { formatPhone, phoneSearchKey, phoneSearchVariants } from '../../../shared/validation/phone';
import LastVisitBadge from '../components/LastVisitBadge';
import ActiveWarrantiesSection from '../components/ActiveWarrantiesSection';
import VoiceCommentSheet from '../components/VoiceCommentSheet';
import PointIndicator from '../components/PointIndicator';
import { usePointAccess } from '../hooks/usePoints';
import { isVoiceNativeReady } from '../utils/voiceRecorder';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Full-warehouse limit for the shared ['all-products-check', { warehouseId }]
 * cache slot. MUST mirror `PICKER_PRODUCT_LIMIT` in `ProductPickerScreen.tsx`
 * (module-private there): both observers share one query key, so a smaller
 * limit here would re-introduce the "bundle component beyond position 500 is
 * silently dropped" bug the Round 7 audit closed. Effectively "no limit" —
 * the backend caps the response by tenant size, not by this number.
 */
const PICKER_CACHE_PRODUCT_LIMIT = 100000;

/**
 * Псевдо-индекс строки для пикера мастера: выбирается мастер ВСЕГО
 * заказ-наряда, а не конкретной услуги. Отдельного состояния не заводим —
 * список мастеров и модалка те же, различается только присвоение.
 */
const CHECK_MASTER_PICKER_INDEX = -1;

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/** «Марка/Модель · Госномер» для сообщения подтверждения переноса (#9). */
function reassignCarLabel(car: Car): string {
  const makeModel = (car.makeModel || '').trim();
  const plate = (car.plateNumber || '').trim().toUpperCase();
  if (makeModel && plate) return `${makeModel} · ${plate}`;
  return makeModel || plate || 'без номера';
}

/** Русское склонение слова «чек» для счётчика перенесённых чеков (#9). */
function reassignChecksWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'чек';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'чека';
  return 'чеков';
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
  // Dark-mode flag — gates accent-tile fills (avatars, icon chips, plate /
  // line badges, master/template chips) onto the muted `softTint` dark formula
  // while keeping the light branch on the exact legacy `[50]` token so LIGHT
  // mode stays pixel-identical.
  const isDark = palette.mode === 'dark';
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
  // When opened from the bottom tab (route name 'NewCheck'), the floating
  // tab bar covers the bottom of the screen → reserve extra padding.
  const openedFromTab = route.name === 'NewCheck';
  // A check opened from a booking is a pushed (root-stack) screen that must
  // pop back to the booking on save — treat it like a stack screen for nav,
  // even though there's no editId. The order-mode «+» on the доска also pushes
  // the ROOT 'CheckCreate' route (no params): route.name === 'CheckCreate' (i.e.
  // anything that isn't the NewCheck tab) is likewise a pushed screen, so it
  // gets the back chevron and pops back to the доска on save. The NewCheck tab
  // (openedFromTab) stays a tab — byte-for-byte unchanged.
  const isStackScreen = !!editId || isFromBooking || !openedFromTab;

  // ── Cash-shift-mode order-mode (092) ────────────────────────────────────
  // orderMode = shift-mode ON && caller is a master без права «Приём оплаты».
  // OFF/loading → false → FULL касса байт-в-байт (оплата видна, CTA «Пробить»).
  // В order-режиме: прячем секцию оплаты, переименовываем CTA в «Создать
  // заказ-наряд» и после создания паркуем заказ в ПЕРВУЮ колонку доски (бэк сам
  // коэрсит чек в отложенный заказ-наряд без оплаты — мы лишь адаптируем UI и
  // ставим work_status, иначе чек с work_status=NULL не попадёт на доску).
  const { orderMode, shiftModeEnabled } = usePosSettings();
  const { data: boardForOrder } = useQuery<ChecksBoard>({
    queryKey: ['checks', 'board'],
    queryFn: async () => (await checksApi.board()).data,
    enabled: orderMode && !editId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  // Первая активная колонка (board.columns уже отсортированы по sortOrder и
  // только активные). undefined, если колонок нет → setWorkStatus пропускаем.
  const firstBoardColumnKey = boardForOrder?.columns?.[0]?.key;

  // ── Места автосервиса (Round 14, tenant_locations) ───────────────────────
  // Справочник для пикера «Место» конвейерной приёмки. Грузится ТОЛЬКО при
  // включённом режиме кассовой смены — вне режима касса не шлёт ни одного
  // лишнего запроса (byte-for-byte OFF guarantee).
  const { data: orderLocations } = useQuery<TenantLocation[]>({
    queryKey: ['check-locations'],
    queryFn: async () => (await checksApi.locations.list()).data,
    enabled: shiftModeEnabled,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  const activeLocations = useMemo(
    () => (orderLocations ?? []).filter((l) => l.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [orderLocations],
  );

  // ── Дата и время чека: «ручная дата или ничего» ──────────────────────────
  // Касса — центральный таб: экран смонтирован всё время работы приложения,
  // поэтому фиксировать `new Date()` на монтаже нельзя (мастер пробивал чек
  // вечером, а чек уезжал обеденным временем — время МОНТАЖА кассы).
  // manualDate !== null ТОЛЬКО после явного выбора в пикере — тогда дата
  // уходит в payload. null = пользователь дату не трогал → поле `date` не
  // отправляем вовсе, и сервер штампует момент ПРОБИТИЯ (ChecksService:
  // create → now(), активация черновика → момент активации).
  const [manualDate, setManualDate] = useState<Date | null>(null);
  // Персистентная дата открытого чека/черновика — нужна ТОЛЬКО для показа и
  // как стартовое значение пикера. «Ручной» она НЕ считается: при активации
  // черновика без правки даты чек датируется моментом пробития, а не тем
  // временем, когда черновик когда-то завели.
  const [loadedCheckDate, setLoadedCheckDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Client/Car selection
  const [clientId, setClientId] = useState('');
  const [carId, setCarId] = useState('');
  // Check-level master (кому принадлежит чек: на него пишется выручка и ЗП).
  // Пусто при обычном создании → падает на currentUser (см. defaultMasterId).
  // В режиме редактирования гидрируется из загруженного чека, чтобы правка
  // чужого заказ-наряда админом/владельцем НЕ переназначала чек (и зарплату)
  // на редактирующего.
  const [masterId, setMasterId] = useState('');
  const [mileage, setMileage] = useState('');
  const [comment, setComment] = useState('');
  // ── Метки чека (Round 12 #9) ─────────────────────────────────────────────
  // Ненавязчивый мультивыбор: обычный чек их не встречает вовсе — ghost-строка
  // «Метка» рядом с комментарием просто стоит; тап открывает CheckTagSheet.
  // Храним ОБЪЕКТЫ (не id): выбранные чипы рендерятся без запроса справочника.
  const [selectedTags, setSelectedTags] = useState<CheckTag[]>([]);
  const [showTagSheet, setShowTagSheet] = useState(false);
  const [discount, setDiscount] = useState('');
  // Тап в ЛЮБОЕ место поля «Скидка» (иконка/надпись/₽) фокусирует ввод —
  // владелец: «даже на саму надпись активировала ввод размера скидки».
  const discountInputRef = useRef<TextInput>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash' as PaymentMethod);
  const [cashAmount, setCashAmount] = useState('');
  const [cashGiven, setCashGiven] = useState('');
  const [isDeferred, setIsDeferred] = useState(false);

  // ── Режим «Кассир» (Round 14): исполнители + место приёмки ───────────────
  // НЕСКОЛЬКО исполнителей (check_assignees) — заказ падает на доску каждого;
  // место (tenant_locations) — «возле задних ворот». Dirty-флаги отделяют
  // «тронул поле» от гидрации edit-режима: PATCH шлёт набор ТОЛЬКО при явной
  // правке (присутствие поля = перезапись), иначе сервер ничего не трогает.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [assigneesDirty, setAssigneesDirty] = useState(false);
  const [orderLocationId, setOrderLocationId] = useState<string | null>(null);
  const [locationDirty, setLocationDirty] = useState(false);
  const [showAssigneeSheet, setShowAssigneeSheet] = useState(false);
  const [showLocationSheet, setShowLocationSheet] = useState(false);
  const [newLocationName, setNewLocationName] = useState('');
  const [creatingLocation, setCreatingLocation] = useState(false);

  // ── Рассрочка (installment sale) ──────────────────────────────────────────
  // Активна, когда paymentMethod === 'installment'. Первый платёж уходит в чек
  // как cashAmount (down_payment), остаток (total − первый платёж) становится
  // долгом по рассрочке — сам план создаётся на сервере внутри транзакции чека.
  const [installmentFirst, setInstallmentFirst] = useState('');
  const [installmentNextDate, setInstallmentNextDate] = useState<Date>(() => new Date(Date.now() + 30 * 86400000));
  const [showInstallmentDatePicker, setShowInstallmentDatePicker] = useState(false);

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
  // ── Явный режим поиска: госномер ⇄ телефон (Round 7 #8, TASK B) ─────────
  // 'plate' — прежний путь (RU/INT маска), байт-в-байт. 'phone' — отдельный
  // числовой TextInput мимо маски: результаты — КЛИЕНТЫ, тап подставляет
  // клиента (+ авто: 0 авто — без машины, 1 — сразу, ≥2 — ClientCarPickerSheet).
  const [searchMode, setSearchMode] = useState<'plate' | 'phone'>('plate');
  const [phoneSearch, setPhoneSearch] = useState('');
  // Клиент с ≥2 авто, ожидающий выбора машины (phone-режим). null = закрыт.
  const [carPickerClient, setCarPickerClient] = useState<Client | null>(null);

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
  // Пикер товаров — теперь ПОЛНОЭКРАННЫЙ роут `ProductPicker` на корневом
  // стеке (Round 8 #2, Склад-паттерн с папками), а не модалка: локального
  // show-state больше нет, открытие — openProductPicker() ниже.
  // showMasterPicker — индекс СТРОКИ УСЛУГИ, чьего мастера выбирают, либо
  // CHECK_MASTER_PICKER_INDEX для мастера ВСЕГО заказ-наряда (тот же список,
  // другое присвоение). Второй режим появился вместе с проверкой «мастер из
  // этого филиала»: до неё мастером чека молча становился вошедший, и сменить
  // его было нечем.
  const [showMasterPicker, setShowMasterPicker] = useState<number | null>(null);
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);
  // Пикер шаблонов с папками (round 8 #3): текущий уровень личного дерева
  // (null = корень). Сбрасывается на корень при каждом открытии пикера.
  const [templatesPickerFolderId, setTemplatesPickerFolderId] = useState<string | null>(null);
  // «Сохранить как шаблон» — свой шит вместо Alert.prompt (на Android prompt
  // отсутствовал и имя подставлялось датой): имя + папка + «общий» для
  // owner-class.
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [saveTplName, setSaveTplName] = useState('');
  const [saveTplFolderId, setSaveTplFolderId] = useState<string | null>(null);
  const [saveTplShared, setSaveTplShared] = useState(false);
  const [saveTplFolderOpen, setSaveTplFolderOpen] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
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
  // Feature #9 — «Сменить владельца» из карточки выбранного клиента: ПОЛНЫЙ
  // перенос авто и его истории новому владельцу (carsApi.transferOwner) с
  // перенацеливанием ТЕКУЩЕГО (несохранённого) чека на него. Выбор нового
  // владельца — отдельный `ClientPhonePickerSheet` (по телефону, без госномера),
  // не QuickClientCreateSheet. `reassignConfirm` — выбранный новый владелец,
  // ждёт подтверждения.
  const [showReassignPicker, setShowReassignPicker] = useState(false);
  const [reassignConfirm, setReassignConfirm] = useState<{ clientId: string; clientName: string } | null>(null);
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
  const isPhoneMode = searchMode === 'phone';
  // ── Phone-aware client search (#57 progressive + Round 7 #8 explicit) ─────
  // Digit-bearing raw input: the EXPLICIT phone mode (TASK B) has its own
  // TextInput that bypasses the plate mask entirely; the plate tabs keep the
  // implicit #57 path (pure-digit INT input = phone) byte-for-byte.
  const rawPhoneInput = isPhoneMode ? phoneSearch : plateSearch;
  const phoneKey = useMemo(() => phoneSearchKey(rawPhoneInput), [rawPhoneInput]);
  // TASK C: trunk-prefix-tolerant variants («8988», «8(988)», «7-988», «+7 988»
  // all mean the national «988…»). Display filters match when ANY variant is
  // contained in the stored last-10 key; the LAST element is the most-national
  // form (see phoneSearchVariants contract in shared/validation/phone.ts).
  const phoneVariants = useMemo(() => phoneSearchVariants(rawPhoneInput), [rawPhoneInput]);
  // A RU/foreign plate ALWAYS contains letters, so pure-digit input is a PHONE.
  // We treat digit-only input of ≥3 as a PROGRESSIVE phone search (narrow the
  // client list live from the first digits) — while ANY letter keeps the input
  // on the untouched plate/name path, byte-for-byte as before. Threshold lowered
  // 7→3 (#57 follow-up: owners want live narrowing, not a match only after the
  // full 10-digit number). The old 7-digit gate had no letter guard, but a plate
  // holds ≤6 digits so it never fired on a plate — the `!hasLetters` guard makes
  // that invariant explicit now that 3-digit plates would otherwise collide.
  // In the EXPLICIT phone mode the letter guard is moot (phone-pad, no letters).
  const hasLetters = useMemo(() => /[A-Za-zА-Яа-яЁё]/.test(plateSearch), [plateSearch]);
  const isPhoneSearch = isPhoneMode ? phoneKey.length >= 3 : !hasLetters && phoneKey.length >= 3;
  const currentSearch = isPhoneSearch ? phoneVariants[phoneVariants.length - 1] || '' : normalizedSearch;

  const debouncedPlate = useDebouncedValue(plateSearch, 300);
  const debouncedPhoneInput = useDebouncedValue(rawPhoneInput, 300);
  const debouncedNormalized = useMemo(
    () => normalizePlateForSearch(debouncedPlate, plateMode),
    [debouncedPlate, plateMode],
  );
  const debouncedPhoneKey = useMemo(() => phoneSearchKey(debouncedPhoneInput), [debouncedPhoneInput]);
  const debouncedPhoneVariants = useMemo(() => phoneSearchVariants(debouncedPhoneInput), [debouncedPhoneInput]);
  const debouncedHasLetters = useMemo(() => /[A-Za-zА-Яа-яЁё]/.test(debouncedPlate), [debouncedPlate]);
  const debouncedIsPhone = isPhoneMode
    ? debouncedPhoneKey.length >= 3
    : !debouncedHasLetters && debouncedPhoneKey.length >= 3;
  // Value actually sent to the backend `?search=` — for phone input the
  // TRUNK-STRIPPED (most-national) variant, otherwise the plate-normalized
  // string. WHY the stripped variant (TASK C): the backend matches by
  // SUBSTRING of the stored last-10 national key, and `'9884444485'` does NOT
  // contain `'8988'` — a trunk-prefixed query would return zero rows. Any key
  // containing a trunk-prefixed form also contains its national suffix, so
  // sending the stripped variant is a SUPERSET fetch; the display filter then
  // narrows with ALL variants. Mirrors the display `isPhoneSearch` logic so
  // the `networkSearch === currentSearch` settled-gate below stays consistent.
  // NB: in RU mode the plate normaliser drops a leading digit → for phone
  // input we MUST send the phone variant, not the empty normalized plate. In
  // the explicit phone mode a sub-threshold input sends NOTHING (never the
  // stale debounced plate from before the mode switch).
  const networkSearch = debouncedIsPhone
    ? debouncedPhoneVariants[debouncedPhoneVariants.length - 1] || ''
    : isPhoneMode
      ? ''
      : debouncedNormalized;

  const {
    data: plateClients,
    isFetching: isFetchingPlate,
    isError: isErrorPlate,
    fetchStatus: fetchStatusPlate,
    refetch: refetchPlate,
  } = useQuery<Client[]>({
    queryKey: ['clients-plate', networkSearch, plateMode],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: networkSearch, limit: 20 });
      return res.data.data || [];
    },
    enabled: networkSearch.length >= 2,
    placeholderData: (prev) => prev,
  });

  // ── Round 7 #8 TASK A: подсказки с ПЕРВЫХ символов номера («Х8» → Х807…) ──
  // Root cause: /clients?search= строит OR-группу, и для смешанного
  // буквы+цифры запроса ветка телефона (`PHONE_KEY LIKE '%8%'` для «Х8»)
  // матчит почти всех клиентов живого тенанта; страница LIMIT 20 (новые
  // первыми) заполняется телефонным шумом, реальный клиент с номером Х807…
  // в неё не попадает, и локальный фильтр честно отбрасывает все 20 строк —
  // до тех пор, пока запрос не станет почти полным номером. /cars?search=
  // матчит ТОЛЬКО `REPLACE(plate_number,' ','') ILIKE %q%` (+make_model), без
  // телефонной ветки, и отдаёт клиента вложенным в машину — поэтому прямой
  // поиск по машинам возвращает префиксные совпадения с первых двух символов.
  // Результаты вливаются в plateResults ниже (dedup по клиент+авто).
  const {
    data: plateCars,
    isFetching: isFetchingCars,
    isError: isErrorCars,
    fetchStatus: fetchStatusCars,
    refetch: refetchCars,
  } = useQuery<Car[]>({
    queryKey: ['cars-plate', networkSearch, plateMode],
    queryFn: async () => {
      const res = await carsApi.getAll({ search: networkSearch, limit: 20 });
      return res.data.data || [];
    },
    // Только «номерные» запросы (есть буквы → это не телефонный путь).
    enabled: !isPhoneMode && debouncedHasLetters && networkSearch.length >= 2,
    placeholderData: (prev) => prev,
  });

  // ── Сетевой сбой поиска клиента (баг владельца) ───────────────────────
  // Если поисковый запрос УПАЛ по сети (нет ответа / 5xx после failover)
  // или ПРИОСТАНОВЛЕН офлайном (onlineManager / fetchStatus==='paused'),
  // список результатов пуст НЕ потому, что клиента нет, а потому что до
  // сервера не достучались. Показывать «Клиент не найден» + «Создать
  // клиента» в этом случае — ложь и риск дубля (создание тоже упадёт).
  // Вместо этого — «Нет связи» + «Повторить». Флаг потребляется ТОЛЬКО
  // внутри гейта «поиск активен и результатов нет» ниже, поэтому здесь не
  // проверяем длину запроса. cars-запрос в телефонном режиме выключен →
  // его isError/paused не даёт ложных срабатываний.
  const searchNetworkError =
    isErrorPlate ||
    isErrorCars ||
    fetchStatusPlate === 'paused' ||
    fetchStatusCars === 'paused' ||
    !onlineManager.isOnline();

  const { data: clientData } = useQuery<Client>({
    queryKey: ['client-detail', clientId],
    queryFn: async () => {
      const res = await clientsApi.getById(clientId);
      return res.data;
    },
    enabled: !!clientId,
  });
  const clientCars = clientData?.cars;

  // Пикер мастера в Кассе — ЕДИНСТВЕННОЕ место, где список сотрудников обязан
  // быть по ТЕКУЩЕМУ филиалу (161, `?scope=point`): чужой мастер в чеке = его
  // зарплата и рейтинг уезжают не в тот филиал. Везде остальное (имена в
  // журнале, расходах, зарплате, назначение людей на точки) по-прежнему читает
  // весь тенант.
  //
  // У одноточечного тенанта параметр не ставим намеренно: ответ был бы тот же,
  // но ушёл бы в отдельный слот кеша мимо прогретого логином ['all-users'] —
  // лишний запрос на самом частом экране. Список точек к этому моменту почти
  // всегда уже в кеше (персистится и греется «Ещё»/дашбордом).
  const { points: tenantPoints } = usePointAccess();
  const scopeMastersToPoint = tenantPoints.length > 1;
  const { data: allUsers } = useQuery<User[]>({
    queryKey: scopeMastersToPoint ? ['all-users', 'point'] : ['all-users'],
    queryFn: async () => {
      const res = await usersApi.getAll(scopeMastersToPoint ? { scope: 'point' } : undefined);
      return res.data;
    },
  });

  const masters = useMemo(() => (allUsers || []).filter((u) => u.isActive && !u.hiddenEverywhere), [allUsers]);

  // ── Кто РЕАЛЬНО работает в этом филиале ────────────────────────────────
  // Список выше уже приходит по текущему филиалу (?scope=point), но ВЫБРАННЫЙ
  // мастер до сих пор ни с чем не сверялся. Дефолтом мастером чека становится
  // сам вошедший, а он запросто не числится в филиале, в который только что
  // вошёл (администратор, скрытый сотрудник, мастер, которого сняли с точки),
  // — и заказ-наряд вместе с зарплатой и рейтингом уезжал в ЧУЖОЙ филиал
  // молча. Пустое множество = список ещё не приехал ИЛИ филиал у тенанта один:
  // в обоих случаях сверять не с чем и проверка не применяется.
  const pointMasterIds = useMemo(
    () => (scopeMastersToPoint ? new Set(masters.map((m) => m.id)) : new Set<string>()),
    [scopeMastersToPoint, masters],
  );
  const worksAtThisPoint = React.useCallback(
    (id: string | undefined | null): boolean => (pointMasterIds.size === 0 ? true : !!id && pointMasterIds.has(id)),
    [pointMasterIds],
  );

  const {
    data: allServices,
    isError: isErrorServices,
    fetchStatus: fetchStatusServices,
    refetch: refetchServices,
  } = useQuery<Service[]>({
    queryKey: ['all-services'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 500 });
      return res.data.data || res.data;
    },
    enabled: showServicePicker,
  });

  // Тот же сетевой сбой, что и в поиске клиента: список услуг не загрузился
  // из-за сети (упал / приостановлен офлайном) → показываем «Нет связи» +
  // «Повторить», а не пустоту / ложное «Ничего не найдено».
  const servicePickerNetworkError =
    (isErrorServices || fetchStatusServices === 'paused' || !onlineManager.isOnline()) &&
    (allServices?.length ?? 0) === 0;

  // Products cache for bundle expansion + the oversell guard — CRITICAL
  // screen. Stock numbers must NEVER be stale here: picking a product is
  // the moment the user commits to "this is in the warehouse".
  //
  // Round 7 audit #1: this used to be a SEPARATE legacy query on the
  // un-scoped ['all-products-check'] key with `limit: 500` (main warehouse
  // only, first 500 by name). On tenants with >500 products a bundle
  // component beyond position 500 was SILENTLY dropped from the check and
  // the oversell guard went blind for those products. Now we observe the
  // exact scoped key the picker populates (['all-products-check',
  // { warehouseId }], FULL list — same PICKER_CACHE_PRODUCT_LIMIT, no 500
  // cap), so both consumers read the same complete list the user sees in
  // the picker. While `warehouses` is still resolving the key falls back to
  // the legacy un-scoped slot warmed by the login prefetch.
  //
  // Round 8 #2: пикер стал полноэкранным роутом `ProductPicker`
  // (ProductPickerScreen) и САМ владеет fetch-дисциплиной — ревалидация при
  // каждом открытии + pull-to-refresh; mount-prefetch ниже греет слот заранее.
  // Этот observer — ПАССИВНЫЙ читатель кеша (`enabled: false` никогда не
  // фетчит, но продолжает получать все обновления слота), ровно для комплектов
  // и oversell-guard'а.
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: pickerWarehouseId ? ['all-products-check', { warehouseId: pickerWarehouseId }] : ['all-products-check'],
    queryFn: async () => {
      const params: { limit: number; warehouseId?: string } = { limit: PICKER_CACHE_PRODUCT_LIMIT };
      if (pickerWarehouseId) params.warehouseId = pickerWarehouseId;
      const res = await productsApi.getAll(params);
      return res.data.data || res.data;
    },
    enabled: false,
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

  // Активный склад пикера — питает mount-prefetch ниже (лейбл свитчера
  // теперь считает сам ProductPickerScreen из session.warehouses).
  const activeWarehouse = useMemo(
    () =>
      pickerWarehouseId
        ? (warehouses || []).find((w) => w.id === pickerWarehouseId)
        : (warehouses || []).find((w) => w.kind === 'main'),
    [warehouses, pickerWarehouseId],
  );

  // Pre-warm the products + categories cache as soon as the screen
  // mounts (rather than waiting for the picker to open). Net effect on
  // physical iPhone: tap "+" → picker is cache-hit, opens within one
  // frame, no "товаров нет" flash. Categories are scoped by the
  // currently-active warehouse so folders never leak across warehouses.
  useEffect(() => {
    const wid = pickerWarehouseId || activeWarehouse?.id;
    // Warm the SAME scoped slot the picker + bundle expansion + oversell
    // guard read (full list, no 500 cap). Until warehouses resolve, fall
    // back to the legacy un-scoped slot — it stays useful as the picker's
    // placeholder seed (see ProductPickerScreen.placeholderData).
    queryClient.prefetchQuery({
      queryKey: wid ? ['all-products-check', { warehouseId: wid }] : ['all-products-check'],
      queryFn: async () => {
        const params: { limit: number; warehouseId?: string } = { limit: PICKER_CACHE_PRODUCT_LIMIT };
        if (wid) params.warehouseId = wid;
        const res = await productsApi.getAll(params);
        return res.data.data || res.data;
      },
      staleTime: 5 * 60_000,
    });
    queryClient.prefetchQuery({
      queryKey: wid ? ['warehouse-categories', { warehouseId: wid }] : ['warehouse-categories'],
      queryFn: async () => (await warehouseCategoriesApi.getAll(wid || undefined)).data,
      staleTime: 10 * 60_000,
    });
  }, [queryClient, pickerWarehouseId, activeWarehouse?.id]);

  // Client search results. Two paths:
  //   • PHONE (isPhoneSearch): surface the matched client REGARDLESS of car /
  //     plate / name. The previous plate-or-name-only filter silently dropped
  //     phone-matched clients even though the backend returned them — that was
  //     the core of #57. A client with cars yields one row per car (the master
  //     picks the right one); a client with no car yields a single car-less row.
  //   • PLATE / NAME: unchanged from before.
  const plateResults = useMemo(() => {
    const sn = normalizedSearch;
    const fnQuery = plateSearch.toLowerCase();
    const results: { client: Client; car?: Car }[] = [];
    for (const client of plateClients || []) {
      // ── PHONE PATH ──────────────────────────────────────────────────────
      // Surface the phone-matched client REGARDLESS of car/plate/name — the old
      // filter dropped phone-matched clients even though the backend returned
      // them (core of #57). Phone compared via the shared last-10 key against
      // EVERY trunk variant of the query (TASK C): «8988» must find the stored
      // key '9884444485' even though the raw containment fails. Plate matching
      // is kept too, so a foreign INT plate that happens to be all digits still
      // surfaces (no regression). Cars yield one row each (master picks the
      // right one); a car-less client yields one row.
      if (isPhoneSearch) {
        const clientKey = client.phone ? phoneSearchKey(client.phone) : '';
        const matchesPhone = !!clientKey && phoneVariants.some((v) => clientKey.includes(v));
        const cars = client.cars || [];
        let pushed = false;
        for (const car of cars) {
          const carPlateNorm = normalizePlateForSearch(car.plateNumber || '', plateMode);
          if (matchesPhone || (!!sn && carPlateNorm.includes(sn))) {
            results.push({ client, car });
            pushed = true;
          }
        }
        if (!pushed && matchesPhone) results.push({ client });
        continue;
      }
      // ── PLATE / NAME PATH (unchanged) ─────────────────────────────────────
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
    // ── TASK A: префиксные совпадения из /cars ────────────────────────────
    // Дополняем список машинами из прямого поиска по номеру (см. запрос
    // выше): это и есть строки, которые «зашумлённая» страница /clients
    // теряет для короткого запроса. Dedup по паре клиент+авто; машины без
    // клиента пропускаем — в чек подставляется именно пара. Затем точные
    // префиксы (номер НАЧИНАЕТСЯ с запроса) поднимаются над вхождениями в
    // середине; stable sort сохраняет прежний порядок внутри рангов, так что
    // существующие результаты не перетасовываются.
    if (!isPhoneSearch && sn && plateCars && plateCars.length > 0) {
      const seen = new Set(results.map((r) => `${r.client.id}-${r.car?.id ?? ''}`));
      const extras: { client: Client; car: Car }[] = [];
      for (const car of plateCars) {
        const owner = car.client;
        if (!owner?.id) continue;
        const carPlateNorm = normalizePlateForSearch(car.plateNumber || '', plateMode);
        if (!carPlateNorm.includes(sn)) continue;
        const key = `${owner.id}-${car.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        extras.push({ client: owner, car });
      }
      // Внутри добавки — детерминированный алфавитный порядок номеров
      // (бэкенд отдаёт created_at DESC, что для подсказок выглядит случайно).
      extras.sort((a, b) => (a.car.plateNumber || '').localeCompare(b.car.plateNumber || '', 'ru'));
      results.push(...extras);
      const rank = (r: { client: Client; car?: Car }) => {
        const norm = normalizePlateForSearch(r.car?.plateNumber || '', plateMode);
        if (norm.startsWith(sn)) return 0;
        if (norm.includes(sn)) return 1;
        return 2; // совпадения по имени и пр. — ниже номерных
      };
      results.sort((a, b) => rank(a) - rank(b));
    }
    return results;
  }, [plateClients, plateCars, plateSearch, plateMode, normalizedSearch, isPhoneSearch, phoneVariants]);

  // ── Round 7 #8 TASK B: результаты ЯВНОГО поиска по телефону — КЛИЕНТЫ ────
  // В phone-режиме строка результата — клиент (имя + телефон), не пары
  // клиент+авто: машина выбирается на тапе (0 авто — без машины, 1 — сразу,
  // ≥2 — ClientCarPickerSheet). Матч — теми же trunk-вариантами (TASK C).
  const phoneClientResults = useMemo<Client[]>(() => {
    if (!isPhoneMode || !isPhoneSearch) return [];
    return (plateClients || []).filter((client) => {
      if (!client.phone) return false;
      const key = phoneSearchKey(client.phone);
      return !!key && phoneVariants.some((v) => key.includes(v));
    });
  }, [isPhoneMode, isPhoneSearch, plateClients, phoneVariants]);

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
  // Личные папки шаблонов (round 8 #3) — ключ общий с TemplatesScreen и web,
  // поэтому мутации в разделе «Ещё → Шаблоны» мгновенно видны здесь.
  const { data: templateFolders = [] } = useQuery<CheckTemplateFolder[]>({
    queryKey: ['check-template-folders'],
    queryFn: async () => (await checkTemplatesApi.folders.list()).data,
    staleTime: 60_000,
  });

  // Группировка пикера: мои шаблоны по папкам текущего уровня + «Общие»
  // отдельной плоской секцией на корне.
  const myTemplates = useMemo(() => templates.filter((t) => !isSharedTemplate(t)), [templates]);
  const sharedTemplates = useMemo(() => templates.filter((t) => isSharedTemplate(t)), [templates]);
  const pickerFolders = useMemo(
    () =>
      templateFolders
        .filter((f) => (f.parentId ?? null) === templatesPickerFolderId)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru')),
    [templateFolders, templatesPickerFolderId],
  );
  const pickerTemplates = useMemo(
    () => myTemplates.filter((t) => (t.folderId ?? null) === templatesPickerFolderId),
    [myTemplates, templatesPickerFolderId],
  );
  const pickerCurrentFolder = useMemo(
    () => (templatesPickerFolderId ? templateFolders.find((f) => f.id === templatesPickerFolderId) : undefined),
    [templateFolders, templatesPickerFolderId],
  );
  // Счётчик прямых шаблонов в папке — подпись строки папки в пикере.
  const pickerFolderTplCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of myTemplates) {
      if (t.folderId) counts.set(t.folderId, (counts.get(t.folderId) ?? 0) + 1);
    }
    return counts;
  }, [myTemplates]);

  // Owner-class (director/admin/superadmin) — зеркало backend
  // OWNER_CLASS_ROLES: правка/удаление ОБЩИХ шаблонов и публикация общих.
  // Отдельный вызов useAuth(): основной деструктур (`authUser`) объявлен ниже
  // по файлу, ссылаться на него отсюда — temporal dead zone.
  const { user: templatesActor } = useAuth();
  const isOwnerClassRole = !!templatesActor?.role && ['superadmin', 'director', 'admin'].includes(templatesActor.role);

  const openTemplatesPicker = () => {
    setTemplatesPickerFolderId(null);
    setShowTemplatesPicker(true);
  };

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
      template.products.map((p) => {
        // Шаблон unit не хранит — подтягиваем из кэша каталога (как web
        // applyTemplate): иначе строка из шаблона теряла единицу измерения
        // и «Кол. (м)» откатывался к дефолтным «шт».
        const catalogProduct = (allProducts ?? []).find((ap) => ap.id === p.productId);
        return {
          productId: p.productId,
          name: p.name,
          sellPrice: p.sellPrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          totalSell: p.sellPrice * p.quantity,
          totalCost: p.costPrice * p.quantity,
          unit: catalogProduct?.unit,
        };
      }),
    );
    setShowTemplatesPicker(false);
  };

  // «Сохранить как шаблон» — шит с именем + папкой (+ «общий» у owner-class)
  // вместо старого Alert.prompt: на Android prompt отсутствует и имя молча
  // подставлялось датой.
  const openSaveTemplate = () => {
    if (serviceLines.length === 0 && productLines.length === 0) return;
    setSaveTplName('');
    setSaveTplFolderId(null);
    setSaveTplShared(false);
    setSaveTplFolderOpen(false);
    setShowSaveTemplate(true);
  };

  const submitSaveTemplate = async () => {
    const name = saveTplName.trim();
    if (!name || savingTemplate) return;
    setSavingTemplate(true);
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
        // Общий шаблон живёт вне личных папок (сервер вернул бы 400).
        folderId: saveTplShared ? null : saveTplFolderId,
        shared: saveTplShared || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['check-templates'] });
      haptic('success');
      setShowSaveTemplate(false);
      Alert.alert('Готово', 'Шаблон сохранён');
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить шаблон');
    } finally {
      setSavingTemplate(false);
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
  const {
    data: editCheck,
    isError: editCheckError,
    isFetchedAfterMount: editCheckFresh,
  } = useQuery<Check>({
    queryKey: ['check', editId],
    queryFn: async () => {
      const res = await checksApi.getById(editId!);
      return res.data;
    },
    enabled: !!editId,
    // Гидрация формы обязана идти из ПОДТВЕРЖДЁННОЙ правды сервера, а не из
    // первого попавшегося снапшота: ключ 'check' входит в PERSISTED_KEYS
    // (диск, до 7 дней давности), и без 'always' свежий (<2 мин) кеш не
    // рефетчится → isFetchedAfterMount никогда не стал бы true.
    refetchOnMount: 'always',
  });
  // Hydrate the form ONCE per editId — a background refetch of the same
  // cache entry must never clobber the user's in-progress edits.
  // `editCheckFresh` (isFetchedAfterMount) гейтит гидрацию до ответа,
  // полученного ПОСЛЕ mount: cold-start мог восстановить ['check', id] из
  // 7-дневного persisted-снапшота, и гидрация из него (с вечным
  // hydratedEditIdRef-замком) затирала бы при сохранении более новое
  // серверное состояние — тот же класс бага, что «edit переназначал мастера».
  const hydratedEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editId || !editCheck || !editCheckFresh || editCheckError || hydratedEditIdRef.current === editId) return;
    hydratedEditIdRef.current = editId;
    const c = editCheck;
    setClientId(c.clientId || '');
    setCarId(c.carId || '');
    // Сохраняем ОРИГИНАЛЬНОГО мастера чека. Без этого payload на сохранении
    // ушёл бы с masterId редактирующего (defaultMasterId = currentUser), и бэк
    // переназначил бы заказ-наряд и зарплату на того, кто его открыл (#TASK-A).
    setMasterId(c.master?.id || c.masterId || '');
    setMileage(c.mileage ? String(c.mileage) : '');
    setComment(c.comment || '');
    // Метки (Round 12 #9): гидрируем существующие, чтобы правка их сохраняла
    // (payload шлёт tagIds всегда в edit-режиме — пустой массив снял бы их).
    setSelectedTags(c.tags || []);
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
    // Рассрочка (Round 13 #9): первый взнос = нал + карта из строки чека —
    // read-only блок и payload показывают/шлют ПРАВДУ, а не пустой 0. Сервер
    // при правке клиентские ноги всё равно игнорирует (берёт прежние из чека),
    // так что это чисто честность UI.
    if (c.paymentMethod === ('installment' as PaymentMethod)) {
      setInstallmentFirst(String((c.cashAmount || 0) + (c.cardAmount || 0)));
    }
    setIsDeferred(c.isDeferred || false);
    setServiceLines(c.services || []);
    setProductLines(c.products || []);
    // Round 14: гидрируем исполнителей и место БЕЗ dirty-флагов — payload
    // отправит их только после явной правки (см. proceed()).
    setAssigneeIds((c.assignees ?? []).map((a) => a.id));
    setOrderLocationId(c.locationId ?? null);
    // Дата чека — только для показа/старта пикера, ручной её не считаем.
    setLoadedCheckDate(c.date ? new Date(c.date) : null);
  }, [editId, editCheck, editCheckFresh, editCheckError]);
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

  const selectedClient =
    clientData ||
    plateClients?.find((c) => c.id === clientId) ||
    // Строка подсказки могла прийти из /cars (TASK A) — клиент вложен в
    // машину. Без этого fallback'а карточка мигала бы пустым поиском, пока
    // ['client-detail'] не догрузится.
    (plateCars || []).find((c) => c.client?.id === clientId)?.client;
  const selectedCar = clientCars?.find((c) => c.id === carId) ?? clientCars?.[0];

  /** Переключение цели поиска: госномер ⇄ телефон (Round 7 #8). Обе строки
   *  очищаются — чистый старт в новом режиме, ни маска, ни телефонные цифры
   *  не перетекают между полями. */
  const switchSearchMode = React.useCallback(
    (next: 'plate' | 'phone') => {
      if (searchMode === next) return;
      animateClientToggle();
      setSearchMode(next);
      setPlateSearch('');
      setPhoneSearch('');
    },
    [searchMode, animateClientToggle],
  );

  /** Тап по клиенту в phone-режиме: 0 авто → клиент без машины (как
   *  безмашинные строки plate-поиска); 1 авто → клиент + эта машина; ≥2 —
   *  открываем ClientCarPickerSheet. Выбор идёт тем же setClientId/setCarId
   *  путём, что и plate-поиск. */
  const handlePhoneClientTap = React.useCallback(
    (client: Client) => {
      const cars = client.cars || [];
      if (cars.length >= 2) {
        haptic('select');
        setCarPickerClient(client);
        return;
      }
      animateClientToggle();
      setClientId(client.id);
      setCarId(cars[0]?.id ?? '');
      setPlateSearch('');
      setPhoneSearch('');
    },
    [animateClientToggle],
  );

  /** Round 8 #1 — «Сменить» на карточке выбранного авто: осознанная смена
   *  машины через существующий ClientCarPickerSheet (тот же sheet, что и в
   *  phone-режиме; onPick идёт тем же setClientId/setCarId путём). Постоянный
   *  ряд «пилюль» под карточкой владелец убрал — он показывается только пока
   *  машина ЕЩЁ не выбрана (первичный выбор). */
  const openCarSwitch = React.useCallback(() => {
    if (!clientData) return;
    haptic('select');
    setCarPickerClient(clientData);
  }, [clientData]);

  // Feature #9 — «Сменить владельца»: открываем ClientPhonePickerSheet (выбор
  // нового владельца по телефону, без ввода госномера — авто уже выбрано).
  const openReassignOwner = React.useCallback(() => {
    if (!selectedCar) return;
    haptic('tap');
    setShowReassignPicker(true);
  }, [selectedCar]);

  // Пользователь выбрал/создал нового владельца в пикере.
  // Закрываем пикер и показываем подтверждение перед записью.
  const onReassignPicked = React.useCallback(
    (newClientId: string, newClientName: string) => {
      setShowReassignPicker(false);
      if (newClientId === clientId) {
        Alert.alert('Владелец не изменился', 'Это авто уже принадлежит выбранному клиенту.');
        return;
      }
      setReassignConfirm({ clientId: newClientId, clientName: newClientName });
    },
    [clientId],
  );

  // Подтверждено — переносим авто новому владельцу и ПЕРЕНАЦЕЛИВАЕМ текущий
  // (несохранённый) чек на него. Чек ещё не в БД, так что конфликта нет:
  // достаточно поменять car.client_id и переставить clientId в стейте — при
  // сохранении чек уйдёт уже с новым владельцем. selectedClient/selectedCar
  // перечитаются из ['client-detail', newClientId] после инвалидации.
  const handleReassignOwner = React.useCallback(
    async (car: Car, newClientId: string) => {
      try {
        // ПОЛНЫЙ перенос: авто И вся его история (чеки, долги, бонусы,
        // рассрочки) переезжают новому владельцу одной серверной транзакцией.
        const res = await carsApi.transferOwner(car.id, { clientId: newClientId });
        const moved = res.data?.movedChecks ?? 0;
        haptic('success');
        if (moved > 0) {
          Alert.alert('Готово', `Авто и ${moved} ${reassignChecksWord(moved)} перенесены новому владельцу.`);
        }
        // Инвалидируем detail-ключ ЭТОГО экрана (['client-detail', ...] — то,
        // что читает selectedClient/clientCars) и историю чеков для старого и
        // нового владельца, плюс списки авто и историю по авто.
        queryClient.invalidateQueries({ queryKey: ['client-detail', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client-detail', newClientId] });
        queryClient.invalidateQueries({ queryKey: ['client', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client', newClientId] });
        queryClient.invalidateQueries({ queryKey: ['client-checks', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client-checks-full', clientId] });
        queryClient.invalidateQueries({ queryKey: ['client-checks', newClientId] });
        queryClient.invalidateQueries({ queryKey: ['client-checks-full', newClientId] });
        queryClient.invalidateQueries({ queryKey: ['cars'] });
        queryClient.invalidateQueries({ queryKey: ['car-checks'] });
        // Перенацеливаем несохранённый чек на нового владельца. carId оставляем
        // тем же — это та же машина, просто с новым владельцем.
        animateClientToggle();
        setClientId(newClientId);
        setCarId(car.id);
      } catch (err: any) {
        haptic('error');
        const data = err?.response?.data;
        const friendly =
          (data && typeof data.message === 'string' && data.message) ||
          (data && Array.isArray(data.message) && typeof data.message[0] === 'string' && data.message[0]) ||
          (data && typeof data.error === 'string' && data.error) ||
          'Не удалось сменить владельца';
        Alert.alert('Ошибка', String(friendly));
      } finally {
        setReassignConfirm(null);
      }
    },
    [clientId, queryClient],
  );

  // Редактируем отложенный (черновик) чек: пользователь пришёл сюда по
  // «Продолжить» из деталки. Берём флаг из ЗАГРУЖЕННОГО серверного чека, а не
  // из локального тоггла `isDeferred` — хинт должен оставаться видимым, пока
  // открыт этот черновик, даже если пользователь снимет галочку «Отложить»,
  // чтобы провести оплату. Снимая галочку и сохраняя, он переводит draft→active
  // (бэк сам списывает склад/гарантии при этом переходе).
  const isEditingDeferred = !!editId && !!editCheck?.isDeferred;

  // Редактируем ПРОВЕДЁННЫЙ (закрытый) чек (#61): пользователь пришёл сюда по
  // «Редактировать» из деталки закрытого чека. Право (edit_closed_check /
  // owner-class) уже проверено на кнопке в CheckDetailScreen — здесь мы лишь
  // адаптируем UI: показываем хинт о каскадном пересчёте и прячем тоггл
  // «Отложить» (закрытый чек не возвращают в черновик — бэк editClosedCheck
  // не трогает is_deferred, чек остаётся закрытым). Возврат сюда не попадает
  // (кнопка правки на него скрыта), но на всякий случай его исключаем.
  const isEditingClosed = !!editId && !!editCheck && !editCheck.isDeferred && !editCheck.isReturned;

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
  const { user: authUser, hasPermission } = useAuth();
  // «Рассрочка» — способ оплаты доступен только при праве sell_installment
  // (owner-class — implicit, см. AuthContext.hasPermission) и только для НОВОГО
  // чека: план создаётся в момент продажи, не при правке. Способ показывается
  // ОДНИМ пунктом в общей модалке выбора оплаты (PaymentMethodModal), рядом с
  // Наличные/Карта/Смешанная/По гарантии — отдельного тоггла больше нет.
  const canSellInstallment = hasPermission('sell_installment');
  // «Меняет дату и время чека» — checks_change_datetime (тот же ключ проверяет
  // сервер). Без права пикер даты/времени не показываем и поле `date` в
  // payload не отправляем НИКОГДА — сервер всё равно молча заменил бы его.
  const canEditCheckDate = hasPermission('checks_change_datetime');
  const isInstallment = paymentMethod === ('installment' as PaymentMethod);
  const canOfferInstallment = canSellInstallment && !editId;
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

  // ── Голосовой ввод комментария (фича voice_input, backend voice/) ─────────
  // Микрофон показываем по ПРАВДЕ СЕРВЕРА, а не по фиче тарифа: /voice/usage
  // уже учитывает формулу max(минуты тарифа, бесплатный лимит платформы) +
  // надбавка — «всем по 10 бесплатных минут» работает и на тарифах БЕЗ ключа
  // voice_input (иначе кнопка была невидима у живого тенанта — баг 05.07).
  // Гейт: сервер настроен && есть минуты (limit>0; free=0 = kill-switch)
  // && бинарник несёт разрешение микрофона (iOS≥37/Android≥68 — OTA прилетает
  // и на старые сборки, где обращение к микрофону = краш TCC).
  // Last-known state (рваная сеть, 2026-07-05): ['voice','usage'] в whitelist
  // persistentCache — после первого успешного ответа гейт живёт на кеше через
  // рестарты/офлайн, кнопка не «мигает» из-за упавшего/висящего GET. Явный
  // отрицательный ответ (configured:false / limit 0) по-прежнему прячет её.
  // gcTime сутки: дефолтные 30 мин выкидывали слот из памяти посреди смены —
  // экран, открытый оффлайн после часа работы, снова терял кнопку.
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
  const voiceNativeReady = isVoiceNativeReady();
  const { data: voiceUsage } = useQuery<VoiceUsage>({
    queryKey: ['voice', 'usage'],
    queryFn: async () => (await voiceApi.usage()).data,
    enabled: voiceNativeReady && !!authUser,
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });
  const voiceReady = voiceNativeReady && voiceUsage?.configured === true && (voiceUsage?.limitMinutes ?? 0) > 0;

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
    setSelectedTags([]);
    setDiscount('');
    setPaymentMethod('cash' as PaymentMethod);
    setCashAmount('');
    setIsDeferred(false);
    setInstallmentFirst('');
    setInstallmentNextDate(new Date(Date.now() + 30 * 86400000));
    setServiceLines([]);
    setProductLines([]);
    setManualDate(null);
    setLoadedCheckDate(null);
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

  // ── ЗАЩИТА НАБРАННОГО ЗАКАЗ-НАРЯДА ОТ «НАЗАД» И СВАЙПА ─────────────────
  //
  // Касса, открытая ПУШЕМ (правка из Журнала, приход из Записей, «+» с доски),
  // — это экран стека: у неё есть стрелка «назад» и нативный edge-swipe. Оба
  // уносили набранный заказ-наряд молча, без единого вопроса: строки услуг,
  // товары, клиент, фото — всё жило только в памяти экрана. Самая дорогая
  // потеря в приложении: чек набирают руками по 5–10 минут.
  //
  // Отпечаток формы — строкой: сравнение дешёвое и не зависит от ссылок на
  // массивы, которые пересоздаются на каждом рендере.
  const formFingerprint = useMemo(
    () =>
      buildCheckFormFingerprint({
        clientId,
        carId,
        masterId,
        mileage,
        comment,
        discount,
        paymentMethod,
        cashAmount,
        installmentFirst,
        isDeferred,
        tagIds: selectedTags.map((t) => t.id),
        assigneeIds,
        orderLocationId,
        serviceLines: serviceLines.map((l) => ({
          serviceId: l.serviceId,
          name: l.name,
          price: l.price,
          quantity: l.quantity,
          master: l.lineMasterId || l.masterId || '',
        })),
        productLines: productLines.map((l) => ({
          productId: l.productId,
          name: l.name,
          sellPrice: l.sellPrice,
          quantity: l.quantity,
        })),
        pendingPhotos,
        manualDateIso: manualDate ? manualDate.toISOString() : '',
      }),
    [
      clientId,
      carId,
      masterId,
      mileage,
      comment,
      discount,
      paymentMethod,
      cashAmount,
      installmentFirst,
      isDeferred,
      selectedTags,
      assigneeIds,
      orderLocationId,
      serviceLines,
      productLines,
      pendingPhotos,
      manualDate,
    ],
  );
  // Базовая линия «ничего не меняли»: для нового чека — пустая форма, для
  // правки — состояние СРАЗУ ПОСЛЕ гидрации чека (иначе экран правки считался
  // бы грязным всегда и спрашивал при каждом выходе). Гидрация живёт в эффекте,
  // поэтому базовую линию берём на первом рендере ПОСЛЕ неё.
  const baselineFingerprintRef = useRef<string | null>(null);
  if (baselineFingerprintRef.current === null && (!editId || hydratedEditIdRef.current === editId)) {
    baselineFingerprintRef.current = formFingerprint;
  }
  const hasUnsavedContent =
    baselineFingerprintRef.current !== null && baselineFingerprintRef.current !== formFingerprint;

  // Сохранение (в том числе «сохранено на телефоне» офлайн-очередью) снимает
  // гвард: это и есть выход «с сохранением». Ref нужен для навигации, которая
  // случается в том же тике, что и setState, — до того, как гвард пересчитан.
  const [formSaved, setFormSaved] = useState(false);
  const formSavedRef = useRef(false);
  const markFormSaved = React.useCallback(() => {
    formSavedRef.current = true;
    setFormSaved(true);
  }, []);

  usePreventRemove(isStackScreen && hasUnsavedContent && !formSaved, ({ data }) => {
    if (formSavedRef.current) {
      // Чек уже сохранён, а рендер со снятым гвардом ещё не применился.
      // Отпускаем навигацию следующим тиком: к нему setState отработает и
      // повторный dispatch в гвард уже не упрётся (иначе получили бы цикл).
      setTimeout(() => navigation.dispatch(data.action), 0);
      return;
    }
    haptic('warning');
    Alert.alert(
      'Выйти без сохранения?',
      'Набранный заказ-наряд не сохранён. Если выйти сейчас, он пропадёт — услуги, товары и фото придётся набирать заново.',
      [
        { text: 'Остаться', style: 'cancel' },
        {
          text: 'Выйти без сохранения',
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

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
      // Чек записан — гвард «несохранённое» больше не нужен, иначе навигация
      // после сохранения упёрлась бы в вопрос «выйти без сохранения?».
      markFormSaved();
      // Premium confirmation: success haptic fires only once the check is
      // actually persisted (mutation resolved) — a failed submit must never
      // feel successful. Android variant is softened inside the helper.
      haptic('success');
      // After creating / editing a check we have to bust every cache
      // entry that the new revenue / inventory delta touches. The legacy
      // `['dashboard']` invalidation was a no-op (no such key exists).
      // RNPERF-9 + Round 7 audit #2: the Журнал (landing screen after save)
      // and Склад (mounted tab showing the decremented stock) refetch
      // immediately; every other heavy key is invalidated with
      // `refetchType: 'none'` — marked stale, refetched on the next
      // mount/visit. NOTE: the previous `refetchType: 'inactive'` did the
      // OPPOSITE of this intent — in query-core 5.x 'inactive' immediately
      // refetches all UNOBSERVED cache entries (a hidden burst of ~9
      // requests during the save transition) while mounted screens were
      // only marked stale. 'none' refetches nothing now; mounted screens
      // self-heal via their focus-gated 30s polls (Dashboard / CashFlow) /
      // remounts, exactly as they already did under 'inactive'.
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const heavyKeys: string[][] = [
        ['checks'],
        ['checks-dashboard'],
        ['dashboard-v2'],
        ['dashboard-chart'],
        ['cashflow'],
        ['low-stock'],
        // The cash product-picker + the oversell-confirm read stock from
        // ['all-products-check', { warehouseId }] (full list), NOT
        // ['products'] — so without this the NEXT check created in the same
        // session sees pre-decrement stock and a stale oversell threshold.
        // Mirror ProductsScreen, which already busts this key on every stock
        // mutation. 'none' suffices: the picker query re-fetches on every
        // open anyway (staleTime 0 + refetchOnMount 'always').
        ['all-products-check'],
        ['warehouse-analytics'],
        // Деньги чека каскадно меняют зарплату, мотивацию, фин-отчёт, рейтинг
        // сотрудников и историю клиента — backend считает их ИЗ checks
        // (salary.service / reports.service). Без этих ключей Зарплата /
        // Отчёты / карточка клиента показывали старые суммы до ручного
        // pull-to-refresh (mobile-audit C1). refetchType 'none' достаточно:
        // экраны живут в MoreStack и ремоунтятся при следующем открытии.
        ['salary'],
        ['salary-employee-month'],
        ['motivation'],
        ['financial-report'],
        // Метки (Round 12 #9): чек с меткой двигает отчёт «По меткам».
        ['tag-analytics'],
        ['employee-ranking'],
        ['client-checks'],
        ['client-checks-full'],
        ['retail-checks'],
        ['retail-checks-full'],
      ];
      for (const queryKey of heavyKeys) {
        queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
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

      // ── Order-mode: припарковать новый заказ-наряд на доску ───────────────
      // С Round 14 ПАРКОВКУ ГАРАНТИРУЕТ СЕРВЕР: create() при включённом режиме
      // смен сам проставляет отложенному заказу work_status первой активной
      // колонки (в т.ч. при приёмке админом/кассиром, где orderMode=false).
      // Этот клиентский setWorkStatus остаётся безобидным дублем-страховкой
      // для orderMode (та же первая колонка; сервер идемпотентен) — плюс он
      // же инвалидирует кеш доски, на которую мастер вернётся по goBack().
      // Best-effort / fire-and-forget: заказ уже сохранён и уже на доске.
      if (orderMode && !editId && savedCheckId && firstBoardColumnKey) {
        checksApi
          .setWorkStatus(savedCheckId, firstBoardColumnKey)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ['checks', 'board'] });
          })
          .catch(() => {
            /* колонок нет / сеть — заказ всё равно сохранён как отложенный */
          });
      }

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
        navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Bookings', initial: false } });
      } else if (isStackScreen) {
        if (isEditingClosed) {
          // #61: правка ПРОВЕДЁННОГО чека — сервер выполнил каскадный пересчёт
          // (склад/зарплата/касса/прибыль) в одной транзакции, чек остался
          // закрытым. Явно подтверждаем это владельцу, затем возвращаемся в
          // деталку (она перезапросит свежие итоги на mount). Отложенный/
          // обычный edit — тихий goBack, как прежде (draft-поток не трогаем).
          Alert.alert('Чек обновлён', 'Изменения сохранены, всё пересчитано.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
        } else {
          navigation.goBack();
        }
      } else {
        resetForm();
        Alert.alert('Готово', 'Чек успешно создан');
      }
    },
    onError: (err: any, variables: any) => {
      submittingRef.current = false;
      // ── Офлайн-очередь (Round 9): сетевой отказ СОЗДАНИЯ не теряет чек ──
      // Только create (у edit нет идемпотентного ключа) и только сетевой
      // класс: нет ответа вовсе (timeout / DNS / offline) или шлюзовые
      // 502/503/504. Детерминированные 400/401/403/409/422 — НЕ сюда: они
      // всплывают пользователю как раньше (ветка ниже). `variables` — тот
      // самый payload с уже сгенерированным clientRequestId (см. proceed),
      // поэтому досылка «полудоставленного» запроса не задвоит чек.
      if (!editId && isNetworkClassCheckError(err)) {
        void stashCheckOffline(variables, err);
        return;
      }
      showSubmitError(err);
    },
  });

  // Surface the real reason — owners report "ничего не происходит" in
  // production; without the raw payload we can't tell whether it's a
  // missing master, a stock conflict, or a backend 500. Always show
  // SOMETHING, fall back to JSON when the server didn't give a
  // friendly string. Mobile logs (Console.app on Mac, sentry on
  // server) keep the full breadcrumb.
  const showSubmitError = (err: any) => {
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
  };

  /**
   * Сетевой отказ сабмита → чек в офлайн-очередь (AsyncStorage) и мастер
   * продолжает работать, как будто чек проведён: форма сбрасывается /
   * экран закрывается, а очередь дошлёт payload с тем же clientRequestId,
   * когда сеть вернётся (триггеры — foreground / таймер / успех сети).
   * Если даже ЗАПИСЬ НА ТЕЛЕФОН не удалась — честная ошибка, как раньше
   * (притворяться, что чек сохранён, нельзя).
   */
  const stashCheckOffline = async (payload: any, err: any) => {
    // Время чека = момент ПРОБИТИЯ. Живой сабмит поля `date` не несёт и сервер
    // штампует now() при приёме запроса — но офлайн-очередь может пролежать до
    // возврата сети, и тогда now() был бы временем ДОСТАВКИ. Поэтому именно
    // здесь дату проставляем явно: ручную, если её выбирали, иначе — «сейчас»,
    // т.е. момент нажатия «Пробить». Сервер по-прежнему решает сам: у автора
    // без checks_change_datetime дата не сегодняшняя (пролежало через полночь
    // по МСК) молча заменится на время доставки — это штатная деградация.
    const offlinePayload = { ...payload, date: payload.date ?? new Date().toISOString() };
    try {
      await enqueueOfflineCheck(offlinePayload, {
        total,
        clientName: selectedClient?.fullName,
        carInfo: selectedCar
          ? `${selectedCar.makeModel}${selectedCar.plateNumber ? ` · ${selectedCar.plateNumber}` : ''}`
          : undefined,
      });
    } catch {
      showSubmitError(err);
      return;
    }
    // Чек лежит на телефоне и уйдёт сам — это сохранение, а не потеря:
    // гвард «несохранённое» снимаем, чтобы уход с экрана не спрашивал.
    markFormSaved();
    haptic('warning');
    // Навигация «как при успехе» — ДО алерта, чтобы мастер сразу вернулся к
    // работе (алерт глобальный, показывается поверх целевого экрана).
    // Server-side эффекты успеха (фото, лояльность, конверсия записи,
    // work-status) здесь невозможны — чека на сервере ещё нет; запись из
    // «прихода» остаётся в Предстоящих (документированный fallback конверсии).
    if (isFromBooking) {
      navigation.navigate('Main', { screen: 'MoreTab', params: { screen: 'Bookings', initial: false } });
    } else if (isStackScreen) {
      navigation.goBack();
    } else {
      resetForm();
    }
    const photoNote =
      pendingPhotos.length > 0
        ? '\n\nФото не отправятся автоматически — добавьте их в чек после отправки (Журнал → чек).'
        : '';
    Alert.alert(
      'Нет связи — чек сохранён',
      `Чек сохранён на телефоне и отправится автоматически, как только появится сеть. Следить за ним можно в Журнале («Ожидают отправки»).${photoNote}`,
    );
  };

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
  // Cached stock per productId from the same scoped
  // ['all-products-check', { warehouseId }] cache the picker reads
  // (full list, prefetched on mount). Quantities are aggregated per
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
  // Режим редактирования: `masterId` уже гидрирован из чека → сохраняем
  // оригинального мастера, а не редактирующего (#TASK-A). Новые строки в
  // редактируемом чеке тоже дефолтятся на его мастера, а не на open'нувшего.
  const defaultMasterId = masterId || (isFromBooking && route.params?.prefillMasterId) || currentUser?.id || '';
  // Mirror warehouse gating — себестоимость в пикере видит держатель
  // warehouse_manage (сервер стрипает costPrice:0 без него). Same predicate
  // as `ProductsScreen.tsx`'s `canSeeCostPrice`; admin живёт по матрице из
  // /auth/me, superadmin/director байпасятся внутри hasPermission.
  const canSeeCostPrice = hasPermission('warehouse_manage');

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

  const addProductLine = async (product: Product) => {
    // Handle bundle products — expand into individual component products
    if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
      // Round 7 audit #1: resolve EVERY component BEFORE touching state.
      // The scoped cache now covers the whole active warehouse (no 500 cap),
      // but a component can still be missing (живёт на другом складе, свежая
      // позиция ещё не в кеше) — point-fetch it by id instead of SILENTLY
      // dropping the line from the check, which is how комплекты теряли
      // содержимое on tenants with >500 products. Only an unreachable
      // component (deleted / network error) keeps the old skip behavior,
      // and now loudly.
      const productsList = allProducts || [];
      const resolved: { qty: number; component: Product }[] = [];
      for (const bi of product.bundleItems) {
        let component = productsList.find((p) => p.id === bi.productId);
        if (!component) {
          try {
            component = (await productsApi.getById(bi.productId)).data;
          } catch (err) {
            console.warn('[CheckCreate] компонент комплекта недоступен — строка пропущена', bi.productId, err);
            continue;
          }
        }
        if (!component) continue;
        resolved.push({ qty: bi.quantity || 1, component });
      }
      setProductLines((prev) => {
        const updated = [...prev];
        for (const { qty, component: bundleProduct } of resolved) {
          const existIdx = updated.findIndex((l) => l.productId === bundleProduct.id);
          if (existIdx >= 0) {
            const newQty = roundQty(updated[existIdx].quantity + qty);
            updated[existIdx] = {
              ...updated[existIdx],
              quantity: newQty,
              totalSell: updated[existIdx].sellPrice * newQty,
              totalCost: updated[existIdx].costPrice * newQty,
            };
          } else {
            updated.push({
              productId: bundleProduct.id,
              name: bundleProduct.name,
              sellPrice: bundleProduct.sellPrice,
              costPrice: bundleProduct.costPrice,
              quantity: qty,
              totalSell: bundleProduct.sellPrice * qty,
              totalCost: bundleProduct.costPrice * qty,
              unit: bundleProduct.unit,
            });
          }
        }
        return updated;
      });
      return;
    }

    const existing = productLines.findIndex((l) => l.productId === product.id);
    if (existing >= 0) {
      updateProductLine(existing, 'quantity', roundQty(productLines[existing].quantity + 1));
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
          unit: product.unit,
        },
      ]);
    }
  };

  const removeProductLine = (idx: number) => setProductLines((prev) => prev.filter((_, i) => i !== idx));

  /** Round 8 #2 — «кнопка убрать возле количества» в пикере: снять ОДНУ
   *  единицу товара; при quantity → 0 строка удаляется из чека. Функциональный
   *  апдейтер — степпер пикера может тапаться быстро, счёт не должен терять
   *  промежуточные состояния. */
  const decrementProductLine = (productId: string) => {
    setProductLines((prev) => {
      const idx = prev.findIndex((l) => l.productId === productId);
      if (idx < 0) return prev;
      const line = prev[idx];
      if (line.quantity <= 1) return prev.filter((_, i) => i !== idx);
      const nextQty = roundQty(line.quantity - 1);
      return prev.map((l, i) =>
        i === idx ? { ...l, quantity: nextQty, totalSell: l.sellPrice * nextQty, totalCost: l.costPrice * nextQty } : l,
      );
    });
  };

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

  const handleSubmit = (
    deferred?: boolean,
    paymentOverride?: PaymentMethod,
    opts?: { preValidated?: boolean; clientPromptConfirmed?: boolean },
  ) => {
    // Double-fire guard: bail out immediately if a submission is already
    // in-flight, regardless of whether isPending has propagated yet.
    if (submittingRef.current || createMutation.isPending) return;

    // СБП-успех проводит чек как электронную (карточную) оплату через
    // `paymentOverride='card'`. Без override поведение байт-в-байт прежнее —
    // используется выбранный в UI `paymentMethod`.
    const effectiveMethod = paymentOverride ?? paymentMethod;
    // Рассрочку нельзя откладывать — продажа реальна (остаток = долг по ней).
    const shouldDefer =
      effectiveMethod === ('installment' as PaymentMethod) ? false : deferred !== undefined ? deferred : isDeferred;
    if (!shouldDefer && serviceLines.length === 0 && productLines.length === 0) {
      haptic('warning');
      Alert.alert('Ошибка', 'Добавьте хотя бы одну услугу или товар');
      return;
    }

    // Рассрочка требует клиента (кого «должать») — ловим до сервера ради UX.
    if (effectiveMethod === ('installment' as PaymentMethod) && !clientId) {
      haptic('warning');
      Alert.alert('Рассрочка', 'Для рассрочки выберите клиента.');
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

    // ── Мастер обязан работать В ЭТОМ ФИЛИАЛЕ ─────────────────────────────
    // Филиал выдаётся сессии при входе, поэтому «войти в другой филиал» — это
    // обычный сценарий смены рабочего места. Мастер, оставшийся от прежнего
    // филиала (или сам вошедший, который здесь не числится), уводит зарплату и
    // рейтинг в чужой автосервис, а по экрану это НЕ видно. Подставить
    // «первого попавшегося» нельзя — это была бы такая же тихая ложь, только в
    // другую сторону: честно просим выбрать заново. Только СОЗДАНИЕ: у уже
    // существующего чека мастер исторический, и правка комментария не повод
    // переназначать исполнителя.
    // `preValidated` = СБП: деньги уже приняты, и блокирующих отказов здесь
    // быть не может (BUG #1) — ту же проверку openSbpPayment делает ДО оплаты.
    if (!editId && !opts?.preValidated) {
      const stray = findStrayMaster({ pointMasterIds, checkMasterId: resolvedMasterId, lines: serviceLines });
      if (stray) {
        haptic('warning');
        Alert.alert(
          'Мастер не из этого филиала',
          stray.kind === 'check'
            ? 'Выбранный мастер не работает в филиале, в который вы вошли. Выберите мастера заказ-наряда заново.'
            : `В строке «${stray.name}» стоит мастер, который не работает в этом филиале. Выберите мастера заново.`,
          [
            {
              text: 'Выбрать',
              onPress: () => setShowMasterPicker(stray.kind === 'check' ? CHECK_MASTER_PICKER_INDEX : stray.index),
            },
          ],
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
      } else if (effectiveMethod === ('installment' as PaymentMethod)) {
        // Рассрочка: первый платёж (может быть 0) идёт как наличные —
        // сервер суммирует cash+card в down_payment, остаток = долг по плану.
        finalCash = Math.min(parseMoneyInput(installmentFirst), total);
        finalCard = 0;
      }

      const payload = {
        // Идемпотентность офлайн-очереди (Round 9): UUID генерится ОДИН раз
        // ДО первого живого POST и уезжает вместе с ним. Если запрос
        // «полудоставился» (сервер записал чек, ответ потерялся в сети),
        // досылка из очереди с тем же ключом вернёт УЖЕ созданный чек — без
        // повторного списания склада/зарплаты/выручки. Только для create:
        // у PATCH-обновления ключа нет (whitelist DTO его бы не принял).
        ...(editId ? {} : { clientRequestId: generateClientRequestId() }),
        clientId: clientId || undefined,
        carId: carId || undefined,
        masterId: resolvedMasterId,
        // Дата уходит ТОЛЬКО когда пользователь выбрал её руками (см.
        // manualDate). Иначе поля нет вовсе и сервер ставит время ПРОБИТИЯ:
        // create → now(), активация черновика → момент активации.
        ...(manualDate && canEditCheckDate ? { date: manualDate.toISOString() } : {}),
        mileage: mileage ? parseMoneyInput(mileage) || undefined : undefined,
        comment: comment || undefined,
        // Метки (Round 12 #9). Create: поле уходит только при непустом выборе
        // (без меток payload байт-в-байт прежний — офлайн-очередь и старый
        // сервер не встречают ничего нового). Edit: ВСЕГДА — снятие последней
        // метки должно перезаписать связки пустым набором.
        ...(editId
          ? { tagIds: selectedTags.map((t) => t.id) }
          : selectedTags.length > 0
            ? { tagIds: selectedTags.map((t) => t.id) }
            : {}),
        // При РЕДАКТИРОВАНИИ скидка уходит явно числом — 0 тоже значение.
        // Раньше `discountNum || undefined` превращал стёртую скидку в
        // undefined, бэк трактовал это как «не менялось» (`dto.discount ??
        // prior`) и старая скидка выживала в БД, при том что ноги оплаты
        // ниже посчитаны от тотала БЕЗ скидки → cash+card превышали
        // totalRevenue (та же коррупция кассы, что чинили для ног). На
        // создании undefined безвреден (сервер: `dto.discount || 0`).
        discount: editId ? discountNum : discountNum || undefined,
        paymentMethod: effectiveMethod,
        // Ноги оплаты уходят ЯВНО числами — 0 тоже значение. Раньше было
        // `finalCash || undefined`, и при ПРАВКЕ чека со сменой способа оплаты
        // (напр. cash → card) бэк не перезаписывал обнулившуюся ногу
        // (editClosedCheck пишет только dto.* !== undefined) — старая нога
        // выживала в БД и разбивка «Движения денег» превышала оборот.
        // DTO бэка: @IsOptional() + @Min(0) — ноль проходит валидацию.
        cashAmount: finalCash,
        cardAmount: finalCard,
        // Рассрочка: дата следующего платежа уходит в план (бэк создаёт его в
        // той же транзакции). Для остальных способов поле отсутствует.
        ...(effectiveMethod === ('installment' as PaymentMethod)
          ? { installment: { nextPaymentDate: toYmd(installmentNextDate) } }
          : {}),
        isDeferred: shouldDefer,
        // Round 14 (режим «Кассир»): исполнители + место. Create — только при
        // явном выборе (absent → сервер выводит дефолт из строк услуг +
        // главного мастера, старое поведение). Edit — только если поле ТРОГАЛИ
        // (присутствие = перезапись набора; отсутствие = «не трогать»).
        // Вне режима оба стейта пусты → payload байт-в-байт прежний.
        ...(editId
          ? {
              ...(assigneesDirty ? { assigneeIds } : {}),
              ...(locationDirty ? { locationId: orderLocationId } : {}),
            }
          : {
              ...(assigneeIds.length > 0 ? { assigneeIds } : {}),
              ...(orderLocationId ? { locationId: orderLocationId } : {}),
            }),
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

    // ── Филиал заказ-наряда ──────────────────────────────────────────
    // Проверки «выбран ли филиал» здесь больше НЕТ и быть не может: филиал —
    // свойство сессии (163), он выдан при входе и известен серверу из токена.
    // Спрашивать нечего, отказывать не в чем — чек всегда попадает в тот
    // автосервис, который написан на индикаторе над формой.

    // ── Round 12 #7: наджим «забыли клиента» ─────────────────────────
    // Новый ЖИВОЙ чек без клиента (не правка, не отложенный, не
    // заказ-наряд) → мягкое подтверждение перед пробитием. «Пробить»
    // перезапускает handleSubmit с clientPromptConfirmed, чтобы
    // овершелл-confirm ниже отработал своей очередью (прямой proceed()
    // его бы перепрыгнул). СБП-поток (preValidated) сюда не попадает:
    // деньги уже приняты, блокировать запись нельзя (BUG #1) — его
    // наджим живёт в openSbpPayment ДО оплаты.
    if (!editId && !shouldDefer && !orderMode && !opts?.preValidated && !opts?.clientPromptConfirmed && !clientId) {
      haptic('warning');
      Alert.alert('Возможно, вы забыли добавить клиента', 'Чек будет проведён как розничный, без привязки к клиенту.', [
        { text: 'Вернуться', style: 'cancel' },
        {
          text: 'Пробить',
          onPress: () => handleSubmit(deferred, paymentOverride, { ...opts, clientPromptConfirmed: true }),
        },
      ]);
      return;
    }

    // ── M4: oversell confirm ────────────────────────────────────────
    // Confirm (never hard-block — cached stock can be stale) when any
    // product line exceeds the cached stock. Deferred checks skip the
    // confirm entirely: the backend only decrements stock on a live save.
    // order-режим (092) — это тоже отложенный заказ-наряд (бэк коэрсит без
    // списания склада), поэтому овершелл-конфирм для него тоже пропускаем.
    // СБП-поток уже подтвердил овершелл ДО приёма оплаты (openSbpPayment),
    // поэтому при preValidated повтор не показываем — деньги уже приняты на
    // сервере, блокировать запись чека нельзя (BUG #1).
    if (!shouldDefer && !orderMode && !opts?.preValidated && oversoldByProductId.size > 0) {
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
    // 4) Мастер (чека и каждой строки) из ЭТОГО филиала — до оплаты по той же
    //    причине, что и всё остальное здесь: после подтверждения СБП отказать
    //    уже нельзя (деньги приняты), а записать чек на мастера чужого филиала
    //    — увести его зарплату и рейтинг в соседний автосервис.
    const straySbp = findStrayMaster({
      pointMasterIds,
      checkMasterId: defaultMasterId || masters[0]?.id || '',
      lines: serviceLines,
    });
    if (straySbp) {
      haptic('warning');
      Alert.alert(
        'Мастер не из этого филиала',
        straySbp.kind === 'check'
          ? 'Выбранный мастер не работает в филиале, в который вы вошли. Выберите мастера заказ-наряда заново.'
          : `В строке «${straySbp.name}» стоит мастер, который не работает в этом филиале. Выберите мастера заново.`,
        [
          {
            text: 'Выбрать',
            onPress: () => setShowMasterPicker(straySbp.kind === 'check' ? CHECK_MASTER_PICKER_INDEX : straySbp.index),
          },
        ],
      );
      return;
    }
    // Продолжение после наджима «забыли клиента» (по образцу proceed в
    // handleSubmit): овершелл-confirm + открытие СБП-модалки. Вынесено в
    // локальную функцию, чтобы «Пробить» из наджима шёл той же цепочкой и
    // овершелл не перепрыгивался.
    const proceedToSbp = () => {
      // 5) Овершелл склада — подтверждаем ДО оплаты (а не после), потому что
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

    // 4) Round 12 #7: наджим «забыли клиента» — тоже ДО приёма денег (после
    //    успешного СБП никаких блокирующих диалогов быть не может, BUG #1).
    //    Новый чек без клиента → подтверждение; «Пробить» продолжает цепочку
    //    (овершелл → СБП-модалка) через proceedToSbp.
    if (!editId && !clientId) {
      haptic('warning');
      Alert.alert('Возможно, вы забыли добавить клиента', 'Чек будет проведён как розничный, без привязки к клиенту.', [
        { text: 'Вернуться', style: 'cancel' },
        { text: 'Пробить', onPress: proceedToSbp },
      ]);
      return;
    }
    proceedToSbp();
  };

  // Date formatting.
  // Что показываем: выбранное вручную → дата открытого чека → «сейчас» как
  // ПОДСКАЗКА. Последняя нигде не сохраняется и в payload не уходит, поэтому
  // висящий часами экран кассы ничего не «залипает».
  const displayDate = manualDate ?? loadedCheckDate ?? new Date();
  const dateStr = `${displayDate.getDate().toString().padStart(2, '0')}.${String(displayDate.getMonth() + 1).padStart(2, '0')}.${displayDate.getFullYear()}`;
  const timeStr = `${String(displayDate.getHours()).padStart(2, '0')}:${String(displayDate.getMinutes()).padStart(2, '0')}`;

  const getMasterName = (id?: string) => {
    if (!id) return 'Мастер...';
    const m = masters.find((u) => u.id === id);
    return m?.fullName?.split(' ')[0] || 'Мастер';
  };

  // ── Мост Касса ⇄ ProductPickerScreen (Round 8 #2) ─────────────────────────
  // Корзина остаётся здесь (productLines / addProductLine / decrement…), а
  // полноэкранный пикер на корневом стеке читает её через module-level
  // session store — НЕ через route.params (функции в params дают
  // non-serializable warning и ломают state-restoration). Ref обновляется
  // на каждом рендере (нулевая стоимость), notify будит экраны пикера только
  // когда реально изменилась корзина / склад / права.
  const pickerBridgeRef = useRef<ProductPickerBridge>({
    productLines: [],
    addProduct: () => {},
    decrementProduct: () => {},
    showCostPrice: false,
    warrantyNames: new Set<string>(),
    warehouseId: null,
    setWarehouseId: () => {},
    warehouses: [],
  });
  pickerBridgeRef.current = {
    productLines,
    addProduct: addProductLine,
    decrementProduct: decrementProductLine,
    showCostPrice: canSeeCostPrice,
    warrantyNames: warrantyProductNames,
    warehouseId: pickerWarehouseId,
    setWarehouseId: setPickerWarehouseId,
    warehouses: warehouses || [],
  };
  useEffect(() => {
    notifyProductPickerSession(pickerBridgeRef);
  }, [productLines, pickerWarehouseId, warehouses, warrantyProductNames, canSeeCostPrice]);
  useEffect(() => () => releaseProductPickerSession(pickerBridgeRef), []);

  /** Открыть полноэкранный пикер товаров: клеймим сессию за ЭТИМ инстансом
   *  Кассы (таб и пушнутый edit-CheckCreate живут одновременно — владеет тот,
   *  кто открыл) и пушим корневой уровень роута. Пикер ложится ПОВЕРХ Кассы
   *  на корневом стеке; «Готово» разматывает все его уровни назад сюда. */
  const openProductPicker = () => {
    haptic('tap');
    claimProductPickerSession(pickerBridgeRef);
    navigation.navigate('ProductPicker', {});
  };

  // Режим редактирования: пока свежий (после-mount) ответ ['check', editId]
  // не пришёл, форму НЕ показываем — иначе пользователь начал бы править
  // пустую/устаревшую (persisted-снапшот с диска) форму и сохранение
  // затёрло бы реальный чек. Шеврон назад остаётся — с мёртвой сети можно
  // уйти; при ошибке загрузки эффект выше уже алертит и делает goBack.
  if (editId && !editCheckFresh) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      </View>
    );
  }

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

      {/* KeyboardAwareScroll (Round 11 #1): активное поле Кассы (имя/телефон
          клиента, пробег, комментарий) держится над клавиатурой на iOS И
          Android — авто-скролл к фокусу, а не «поднять весь блок». Резерв под
          плавающий tab bar включаем только когда Касса открыта как таб
          (openedFromTab); в edit-режиме (push поверх бара) — reserveTabBar
          false, свой paddingBottom не нужен. */}
      <KeyboardAwareScroll
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insetsTop + spacing[2] },
          openedFromTab && { paddingBottom: tabBarHeight + spacing[4] },
        ]}
        reserveTabBar={openedFromTab}
      >
        {/* ═══ АВТОСЕРВИС ЗАКАЗ-НАРЯДА (156/160/163) ═══
            Главный страх владельца: «чтобы чек не туда случайно не пробил».
            Один и тот же мастер работает в двух автосервисах, поэтому тот, в
            который уйдёт чек, обязан быть виден ДО нажатия «Пробить». Это
            ПОДПИСЬ, а не выбор: филиал выдан сессии при входе, сменить его
            можно только выходом и новым входом (163). Ни выпадающего списка,
            ни перехода — оба были способом промахнуться и увести кассу в
            соседний автосервис. Скрыт, когда автосервис ровно один — там
            показывать нечего. В push-режиме (правка чека из Журнала) слева
            висит плавающая стрелка «назад», поэтому сдвигаем строку правее,
            чтобы она не уезжала под кнопку. */}
        <PointIndicator variant="banner" style={isStackScreen ? styles.pointBannerStacked : undefined} />

        {/* ═══ SECTION 1: CLIENT INFO — blue tint ═══ */}
        <View style={[styles.sectionClient, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-circle-outline" size={18} color={colors.blue[600]} />
            <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Информация о клиенте</Text>
          </View>

          {/* Хинт «Редактируется отложенный чек» — виден только когда мы
                открыли черновик по «Продолжить» из деталки. Подсказывает, что
                снятие галочки «Отложить» внизу + сохранение закроет черновик
                и проведёт его в выручку (бэк спишет склад/гарантии). */}
          {isEditingDeferred && (
            <View
              style={[
                styles.deferredEditHint,
                isDark && {
                  backgroundColor: softTint(colors.amber[600], 'dark'),
                  borderColor: 'rgba(217, 119, 6, 0.32)',
                },
              ]}
            >
              <Ionicons name="pause-circle" size={16} color={colors.amber[600]} />
              <Text style={[styles.deferredEditHintText, isDark && { color: colors.amber[200] }]}>
                Редактируется отложенный чек
              </Text>
            </View>
          )}

          {/* Хинт «Редактируется проведённый чек» (#61) — виден только когда
                открыли ЗАКРЫТЫЙ чек по «Редактировать» из деталки. Предупреждает,
                что при сохранении сервер пересчитает склад, зарплату, кассу и
                прибыль (каскадный editClosedCheck); чек остаётся проведённым.
                Синий info-тон, чтобы не путать с янтарным «отложен». */}
          {isEditingClosed && (
            <View
              style={[
                styles.deferredEditHint,
                {
                  backgroundColor: isDark ? softTint(colors.blue[600], 'dark') : colors.blue[50],
                  borderColor: isDark ? 'rgba(37, 99, 235, 0.32)' : colors.blue[200],
                },
              ]}
            >
              <Ionicons name="sync-circle" size={16} color={colors.blue[600]} />
              <Text style={[styles.deferredEditHintText, { color: isDark ? colors.blue[200] : colors.blue[600] }]}>
                Редактируется проведённый чек — при сохранении всё пересчитается
              </Text>
            </View>
          )}

          {/* Date/Time — only when editing an existing check. For NEW checks
                the timestamp is stamped by the SERVER at the moment «Пробить»
                (the payload carries no `date` field at all), so we hide the
                noisy picker pair and keep the form focused on what really
                matters: the client, the car, the line items, the payment.
                Без права checks_change_datetime (тот же ключ проверяет сервер)
                карточка остаётся, но только как read-only витрина даты чека —
                тапы не открывают пикер, как и карандаш на вебе. */}
          {editId && (
            <View style={styles.dateTimeCard}>
              <TouchableOpacity
                style={[styles.dateBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                onPress={() => setShowDatePicker(true)}
                disabled={!canEditCheckDate}
              >
                <Ionicons name="calendar-outline" size={16} color={colors.blue[600]} />
                <Text style={[styles.dateBtnText, { color: palette.text.primary }]}>{dateStr}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.timeBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                onPress={() => setShowTimePicker(true)}
                disabled={!canEditCheckDate}
              >
                <Ionicons name="time-outline" size={16} color={colors.blue[600]} />
                <Text style={[styles.timeBtnText, { color: palette.text.primary }]}>{timeStr}</Text>
              </TouchableOpacity>
            </View>
          )}

          {editId && canEditCheckDate && (
            <>
              <DateTimePickerModal
                visible={showDatePicker}
                value={displayDate}
                mode="date"
                onConfirm={(d) => {
                  setShowDatePicker(false);
                  // Любое подтверждение пикера = дата стала РУЧНОЙ и поедет
                  // в payload (даже если пользователь выбрал тот же день).
                  const u = new Date(displayDate);
                  u.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  setManualDate(u);
                }}
                onCancel={() => setShowDatePicker(false)}
              />
              <DateTimePickerModal
                visible={showTimePicker}
                value={displayDate}
                mode="time"
                onConfirm={(d) => {
                  setShowTimePicker(false);
                  const u = new Date(displayDate);
                  u.setHours(d.getHours(), d.getMinutes());
                  setManualDate(u);
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
                <View
                  style={[
                    styles.selectedCardAvatar,
                    isDark && {
                      backgroundColor: softTint(colors.primary[600], 'dark'),
                      borderColor: 'rgba(79, 131, 232, 0.35)',
                    },
                  ]}
                >
                  <Ionicons name="person" size={22} color={isDark ? colors.primary[300] : colors.primary[700]} />
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
                    setPhoneSearch('');
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
                  {/* Round 8 #1 — машина выбрана: показываем ТОЛЬКО её, без
                        постоянного ряда «пилюль». Смена — осознанный тап по
                        «Сменить» → ClientCarPickerSheet со всеми авто клиента.
                        Чип «Сменить» виден когда выбор явный (carId) и машин ≥2.
                        Feature #9 — рядом чип «Сменить владельца» (перенос авто
                        другому клиенту), виден при выбранном авто и праве
                        clients_edit (owner-class — implicit). */}
                  {(!!carId && clientCars && clientCars.length > 1) || hasPermission('clients_edit') ? (
                    <View style={styles.selectedCarChipsRow}>
                      {!!carId && clientCars && clientCars.length > 1 && (
                        <TouchableOpacity
                          onPress={openCarSwitch}
                          style={[
                            styles.changeCarChip,
                            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                          ]}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Сменить автомобиль"
                        >
                          <Ionicons name="swap-horizontal" size={13} color={palette.text.secondary} />
                          <Text style={[styles.changeCarChipText, { color: palette.text.secondary }]}>Сменить</Text>
                        </TouchableOpacity>
                      )}
                      {hasPermission('clients_edit') && (
                        <TouchableOpacity
                          onPress={openReassignOwner}
                          style={[
                            styles.changeCarChip,
                            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                          ]}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel="Сменить владельца авто"
                        >
                          <Ionicons name="person-outline" size={13} color={palette.text.secondary} />
                          <Text style={[styles.changeCarChipText, { color: palette.text.secondary }]}>
                            Сменить владельца
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : null}
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
              {/* ═══ ПОИСК ПО ГОСНОМЕРУ / ПО ТЕЛЕФОНУ (Round 7 #8) ═══ */}
              <View style={styles.plateLabelRow}>
                {/* flexShrink + numberOfLines: на узких iPhone (SE/mini)
                      подпись ужимается, а трёхсекционный переключатель
                      (RU|INT|ТЕЛ) остаётся целиком на экране, не уезжая
                      вправо. */}
                <Text
                  style={[styles.sectionSubLabel, styles.plateLabelShrink, { color: palette.text.secondary }]}
                  numberOfLines={1}
                >
                  {isPhoneMode ? 'ПОИСК ПО ТЕЛЕФОНУ' : 'ПОИСК ПО ГОСНОМЕРУ'}
                </Text>
                <PlateModeSwitcher
                  value={plateMode}
                  onChange={(m) => {
                    // Тап по RU/INT из phone-режима возвращает поиск по
                    // номеру (switch no-op'ится, когда режим уже 'plate').
                    switchSearchMode('plate');
                    setPlateMode(m);
                  }}
                  phoneActive={isPhoneMode}
                  onPhoneSelect={() => switchSearchMode('phone')}
                />
              </View>

              {isPhoneMode ? (
                /* Числовой поиск по телефону — отдельный TextInput МИМО
                     маски номера. Форматирование не навязываем: владелец может
                     набрать и «8988…», и хвост номера — trunk-варианты (TASK C)
                     находят клиента в любом виде. */
                <View
                  style={[
                    styles.phoneSearchRow,
                    { backgroundColor: palette.bg.elevated, borderColor: palette.border.strong },
                  ]}
                >
                  <Ionicons name="call-outline" size={18} color={colors.blue[500]} />
                  <TextInput
                    value={phoneSearch}
                    onChangeText={setPhoneSearch}
                    style={[styles.phoneSearchInput, { color: palette.text.primary }]}
                    keyboardType="phone-pad"
                    placeholder="Телефон клиента"
                    placeholderTextColor={palette.text.tertiary}
                    autoCorrect={false}
                    maxLength={18}
                  />
                  {phoneSearch.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setPhoneSearch('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityLabel="Очистить телефон"
                    >
                      <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                /* Realistic license plate input — controlled mode */
                <RussianPlateInput
                  value={plateSearch}
                  onChangeText={setPlateSearch}
                  autoFocus={false}
                  mode={plateMode}
                />
              )}

              {/* Inline search results — appear right below the input.
                    Phone mode: строки-КЛИЕНТЫ (имя + телефон, счётчик авто);
                    plate mode: прежние пары клиент+авто. */}
              {isPhoneMode && phoneClientResults.length > 0 && (
                <View
                  style={[
                    styles.inlineResults,
                    { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                  ]}
                >
                  {phoneClientResults.slice(0, 5).map((client) => {
                    const carCount = client.cars?.length ?? 0;
                    return (
                      <TouchableOpacity
                        key={client.id}
                        style={[styles.inlineResultItem, { borderBottomColor: palette.border.subtle }]}
                        onPress={() => handlePhoneClientTap(client)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.phoneResultAvatar,
                            isDark
                              ? {
                                  backgroundColor: softTint(colors.primary[600], 'dark'),
                                  borderColor: 'rgba(79, 131, 232, 0.35)',
                                }
                              : { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
                          ]}
                        >
                          <Ionicons
                            name="person"
                            size={15}
                            color={isDark ? colors.primary[300] : colors.primary[700]}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.inlineResultName, { color: palette.text.primary }]} numberOfLines={1}>
                            {client.fullName}
                          </Text>
                          <Text style={[styles.inlineResultSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                            {formatPhone(client.phone || '')}
                          </Text>
                        </View>
                        {carCount > 0 && (
                          <View style={[styles.carCountChip, { backgroundColor: palette.bg.muted }]}>
                            <Ionicons name="car-sport-outline" size={12} color={palette.text.secondary} />
                            <Text style={[styles.carCountChipText, { color: palette.text.secondary }]}>{carCount}</Text>
                          </View>
                        )}
                        <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {!isPhoneMode && (normalizedSearch.length >= 2 || isPhoneSearch) && plateResults.length > 0 && (
                <View
                  style={[
                    styles.inlineResults,
                    { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                  ]}
                >
                  {plateResults.slice(0, 5).map(({ client, car }) => (
                    <TouchableOpacity
                      key={`${client.id}-${car?.id ?? 'nocar'}`}
                      style={[styles.inlineResultItem, { borderBottomColor: palette.border.subtle }]}
                      onPress={() => {
                        animateClientToggle();
                        setClientId(client.id);
                        setCarId(car?.id ?? '');
                        setPlateSearch('');
                      }}
                      activeOpacity={0.7}
                    >
                      {car?.plateNumber && (
                        <View
                          style={[
                            styles.plateChip,
                            isDark && {
                              backgroundColor: softTint(colors.primary[600], 'dark'),
                              borderColor: 'rgba(79, 131, 232, 0.35)',
                            },
                          ]}
                        >
                          <Text style={[styles.plateChipText, isDark && { color: colors.primary[300] }]}>
                            {car.plateNumber}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.inlineResultName, { color: palette.text.primary }]} numberOfLines={1}>
                          {car?.makeModel || client.fullName}
                        </Text>
                        <Text style={[styles.inlineResultSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {car ? client.fullName : formatPhone(client.phone || '')}
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
              {(isPhoneMode
                ? isPhoneSearch && phoneClientResults.length === 0
                : (normalizedSearch.length >= 2 || isPhoneSearch) && plateResults.length === 0) &&
                networkSearch === currentSearch &&
                !isFetchingPlate &&
                !isFetchingCars &&
                (searchNetworkError ? (
                  // Приоритетная ветка: проблема в СЕТИ, а не в отсутствии
                  // клиента. Без «Создать клиента» — создание тоже упадёт /
                  // риск дубля. Только «Повторить» (перезапуск обоих запросов).
                  <View style={styles.notFoundBox}>
                    <Ionicons name="cloud-offline-outline" size={22} color={palette.text.tertiary} />
                    <Text style={[styles.inlineNoResults, { color: palette.text.tertiary, paddingVertical: 0 }]}>
                      Нет связи с сервером — проверьте интернет
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.createClientBtn,
                        isDark
                          ? {
                              backgroundColor: softTint(colors.primary[600], 'dark'),
                              borderColor: 'rgba(79, 131, 232, 0.35)',
                            }
                          : { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
                      ]}
                      onPress={() => {
                        haptic('tap');
                        void refetchPlate();
                        if (!isPhoneMode) void refetchCars();
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="refresh-outline" size={15} color={colors.primary[600]} />
                      <Text style={[styles.createClientBtnText, isDark && { color: colors.primary[300] }]}>
                        Повторить
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.notFoundBox}>
                    <Text style={[styles.inlineNoResults, { color: palette.text.tertiary }]}>Клиент не найден</Text>
                    {/* M2: не тупик — создаём клиента с этим номером прямо из кассы. */}
                    <TouchableOpacity
                      style={[
                        styles.createClientBtn,
                        isDark
                          ? {
                              backgroundColor: softTint(colors.primary[600], 'dark'),
                              borderColor: 'rgba(79, 131, 232, 0.35)',
                            }
                          : { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
                      ]}
                      onPress={() => setShowQuickCreate(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="person-add-outline" size={15} color={colors.primary[600]} />
                      <Text style={[styles.createClientBtnText, isDark && { color: colors.primary[300] }]}>
                        Создать клиента
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}

              <View
                style={[
                  styles.retailDefault,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
              >
                <Ionicons name="storefront-outline" size={16} color={colors.blue[500]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.retailDefaultText, { color: palette.text.primary }]}>Розничный покупатель</Text>
                  <Text style={[styles.retailDefaultHint, { color: palette.text.tertiary }]}>
                    {isPhoneMode
                      ? 'Наберите телефон, чтобы привязать клиента'
                      : 'Наберите госномер — или телефон через переключатель ТЕЛ'}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Car picker — ТОЛЬКО пока машина ещё НЕ выбрана (carId пуст) и
                у клиента ≥2 авто: первичный выбор. Round 8 #1 — после выбора
                ряд исчезает (карточка выше показывает только выбранную
                машину), смена — через чип «Сменить» → ClientCarPickerSheet. */}
          {clientId && !carId && clientCars && clientCars.length > 1 && (
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
          <View style={[styles.mileageRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Ionicons name="speedometer-outline" size={16} color={colors.blue[400]} />
            <TextInput
              value={mileage}
              // Только цифры и максимум 7 знаков (< 10 000 000) — сервер
              // отбивает пробег больше 10 млн (DTO @Max), а живой мастер уже
              // напоролся на это, случайно набрав лишние цифры. Клампим на
              // вводе, чтобы до ошибки просто не доходило.
              onChangeText={(v) => setMileage(v.replace(/\D/g, '').slice(0, 7))}
              maxLength={7}
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
        <View style={[styles.sectionComment, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.purple[600]} />
            <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Комментарий</Text>
            {voiceReady && (
              <>
                <View style={{ flex: 1 }} />
                <PressableScale
                  onPress={() => {
                    haptic('tap');
                    setVoiceSheetOpen(true);
                  }}
                  hapticIntent={null}
                  hitSlop={8}
                  scaleTo={0.9}
                  style={[
                    styles.voiceMicBtn,
                    {
                      backgroundColor: softTint(colors.purple[600], palette.mode),
                      borderColor: isDark ? palette.border.subtle : colors.purple[200],
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Голосовой ввод комментария"
                >
                  <Ionicons name="mic" size={17} color={isDark ? colors.purple[300] : colors.purple[600]} />
                </PressableScale>
              </>
            )}
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

          {/* ── Метки (Round 12 #9) — ghost-строка: у обычного чека ноль
                лишних шагов, строка просто стоит и не требует внимания.
                Тап → шторка с чипами; выбранные метки рендерятся тут же
                компактными чипами. */}
          <TouchableOpacity
            onPress={() => {
              haptic('select');
              setShowTagSheet(true);
            }}
            activeOpacity={0.7}
            style={styles.tagGhostRow}
            accessibilityRole="button"
            accessibilityLabel={
              selectedTags.length > 0 ? `Метки: ${selectedTags.map((t) => t.name).join(', ')}` : 'Добавить метку'
            }
          >
            <Ionicons
              name="pricetag-outline"
              size={15}
              color={selectedTags.length > 0 ? colors.purple[600] : palette.text.tertiary}
            />
            {selectedTags.length === 0 ? (
              <Text style={[styles.tagGhostText, { color: palette.text.tertiary }]}>Метка</Text>
            ) : (
              <View style={styles.tagChipWrap}>
                {selectedTags.map((tag) => {
                  const accent = tag.color || colors.slate[500];
                  return (
                    <View
                      key={tag.id}
                      style={[styles.tagChip, { backgroundColor: softTint(accent, palette.mode), borderColor: accent }]}
                    >
                      <View style={[styles.tagChipDot, { backgroundColor: accent }]} />
                      <Text
                        style={[styles.tagChipText, { color: isDark ? palette.text.primary : accent }]}
                        numberOfLines={1}
                      >
                        {tag.name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
          </TouchableOpacity>

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

        {/* ═══ SECTION 1.6: ИСПОЛНИТЕЛИ И МЕСТО (Round 14, режим «Кассир») ═══
              Видна ТОЛЬКО при включённом режиме кассовой смены — и мастеру в
              orderMode, и админу на приёмке (у админа isCashier=true, поэтому
              гейт именно shiftModeEnabled, не orderMode). Несколько
              исполнителей → заказ падает на доску каждого; место — карточное
              поле «где стоит машина». Вне режима секции нет — байт-в-байт. */}
        {shiftModeEnabled && (
          <View
            style={[styles.sectionAssign, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="people-outline" size={16} color={colors.primary[600]} />
              <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Исполнители и место</Text>
            </View>

            {/* Исполнители — мультивыбор через шит с чекбоксами */}
            <TouchableOpacity
              onPress={() => {
                haptic('select');
                setShowAssigneeSheet(true);
              }}
              activeOpacity={0.7}
              style={styles.tagGhostRow}
              accessibilityRole="button"
              accessibilityLabel={
                assigneeIds.length > 0
                  ? `Исполнители: ${assigneeIds
                      .map((aid) => masters.find((m) => m.id === aid)?.fullName?.split(' ')[0] || '—')
                      .join(', ')}`
                  : 'Назначить исполнителей'
              }
            >
              <Ionicons
                name="construct-outline"
                size={15}
                color={assigneeIds.length > 0 ? colors.primary[600] : palette.text.tertiary}
              />
              {assigneeIds.length === 0 ? (
                <Text style={[styles.tagGhostText, { color: palette.text.tertiary }]}>Исполнители</Text>
              ) : (
                <Text style={[styles.tagGhostText, { color: palette.text.primary }]} numberOfLines={2}>
                  {assigneeIds
                    .map((aid) => masters.find((m) => m.id === aid)?.fullName?.split(' ')[0] || '—')
                    .join(', ')}
                </Text>
              )}
              <View style={{ flex: 1 }} />
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>

            {/* Место — из справочника tenant_locations */}
            <TouchableOpacity
              onPress={() => {
                haptic('select');
                setShowLocationSheet(true);
              }}
              activeOpacity={0.7}
              style={styles.tagGhostRow}
              accessibilityRole="button"
              accessibilityLabel={
                orderLocationId
                  ? `Место: ${
                      (orderLocations ?? []).find((l) => l.id === orderLocationId)?.name ||
                      editCheck?.location?.name ||
                      'выбрано'
                    }`
                  : 'Указать место'
              }
            >
              <Ionicons
                name="location-outline"
                size={15}
                color={orderLocationId ? colors.primary[600] : palette.text.tertiary}
              />
              <Text
                style={[styles.tagGhostText, { color: orderLocationId ? palette.text.primary : palette.text.tertiary }]}
                numberOfLines={1}
              >
                {orderLocationId
                  ? (orderLocations ?? []).find((l) => l.id === orderLocationId)?.name ||
                    editCheck?.location?.name ||
                    'Место'
                  : 'Место'}
              </Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
        )}

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
              style={[
                styles.templateChip,
                isDark
                  ? {
                      backgroundColor: softTint(colors.primary[600], 'dark'),
                      borderColor: 'rgba(79, 131, 232, 0.35)',
                    }
                  : { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
              ]}
              onPress={openTemplatesPicker}
              hitSlop={8}
            >
              <Ionicons name="copy-outline" size={13} color={colors.primary[600]} />
              <Text style={[styles.templateChipText, isDark && { color: colors.primary[300] }]}>Шаблоны</Text>
            </TouchableOpacity>
          </View>

          {/* Services */}
          <View
            style={[styles.linesSection, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <View style={styles.linesSectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: isDark ? softTint(colors.orange[500], 'dark') : colors.orange[50] },
                  ]}
                >
                  <Ionicons name="build-outline" size={14} color={colors.orange[500]} />
                </View>
                <Text style={[styles.linesSectionTitle, { color: palette.text.primary }]}>Услуги</Text>
                {serviceLines.length > 0 && (
                  <View
                    style={[styles.lineBadge, isDark && { backgroundColor: softTint(colors.primary[600], 'dark') }]}
                  >
                    <Text style={[styles.lineBadgeText, isDark && { color: colors.primary[300] }]}>
                      {serviceLines.length}
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.addLineBtn, isDark && { backgroundColor: softTint(colors.primary[600], 'dark') }]}
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
                style={[styles.lineItem, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}
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
                <TouchableOpacity
                  style={[styles.lineMasterRow, isDark && { backgroundColor: softTint(colors.primary[600], 'dark') }]}
                  onPress={() => setShowMasterPicker(idx)}
                >
                  <Ionicons name="person-outline" size={12} color={colors.primary[500]} />
                  <Text style={[styles.lineMasterText, isDark && { color: colors.primary[300] }]}>
                    {getMasterName(line.lineMasterId || line.masterId)}
                  </Text>
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
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: isDark ? softTint(colors.blue[600], 'dark') : colors.blue[50] },
                  ]}
                >
                  <Ionicons name="cube-outline" size={14} color={colors.blue[600]} />
                </View>
                <Text style={[styles.linesSectionTitle, { color: palette.text.primary }]}>Товары</Text>
                {productLines.length > 0 && (
                  <View
                    style={[styles.lineBadge, isDark && { backgroundColor: softTint(colors.primary[600], 'dark') }]}
                  >
                    <Text style={[styles.lineBadgeText, isDark && { color: colors.primary[300] }]}>
                      {productLines.length}
                    </Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={[styles.addLineBtn, isDark && { backgroundColor: softTint(colors.primary[600], 'dark') }]}
                onPress={openProductPicker}
              >
                <Ionicons name="add" size={16} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>
            {productLines.map((line, idx) => (
              <View
                key={idx}
                style={[styles.lineItem, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}
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
                    {/* Цена товара берётся со склада и фиксируется сервером —
                        показываем её как read-only значение, а не как поле ввода,
                        чтобы UI не обещал редактирование, которого нет. Редактируется
                        только количество (услуги при этом сохраняют ручную цену). */}
                    <Text style={[styles.lineReadonlyPrice, { color: palette.text.primary }]}>
                      {formatMoney(line.sellPrice)}
                    </Text>
                  </View>
                  <View style={{ width: 60 }}>
                    <Text style={[styles.lineInputLabel, { color: palette.text.secondary }]}>
                      {`Кол. (${unitLabel(line.unit)})`}
                    </Text>
                    {/* 120: дробное количество всегда разрешено — 0.5 м шланга.
                          Черновик текста живёт в QtyInput, чтобы «0.» и «2,» не
                          съедались контролируемым value на каждом символе. */}
                    <QtyInput
                      value={line.quantity}
                      onCommit={(n) => updateProductLine(idx, 'quantity', n)}
                      style={[
                        styles.lineInput,
                        {
                          backgroundColor: palette.bg.muted,
                          borderColor: palette.border.subtle,
                          color: palette.text.primary,
                        },
                      ]}
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
                      На складе только {formatQty(Math.max(oversoldByProductId.get(line.productId)!.stock, 0))}{' '}
                      {unitLabel(line.unit)}
                    </Text>
                  </View>
                )}
              </View>
            ))}
            {productLines.length === 0 && (
              <TouchableOpacity
                style={[styles.emptyAddBtn, { borderColor: palette.border.subtle }]}
                onPress={openProductPicker}
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
              onPress={openSaveTemplate}
            >
              <Ionicons name="bookmark-outline" size={14} color={palette.text.tertiary} />
              <Text style={[styles.saveTemplateBtnText, { color: palette.text.tertiary }]}>Сохранить как шаблон</Text>
            </TouchableOpacity>
          )}

          {/* Discount — вся строка (иконка/надпись/валюта) фокусирует ввод */}
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => discountInputRef.current?.focus()}
            style={[styles.discountRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name="pricetag-outline" size={16} color={colors.orange[500]} />
            <Text style={[styles.discountLabel, { color: palette.text.secondary }]}>Скидка</Text>
            <TextInput
              ref={discountInputRef}
              value={discount}
              onChangeText={setDiscount}
              style={[styles.discountInput, { color: palette.text.primary }]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
            <Text style={[styles.discountCurrency, { color: palette.text.tertiary }]}>₽</Text>
          </TouchableOpacity>
          {/* MOB-02: та же семантика, что на сервере и в вебе. */}
          <Text style={[styles.discountHint, { color: palette.text.tertiary }]}>Скидка применяется к товарам</Text>
          {/* Round 13 #1: скидка больше суммы товаров молча резалась расчётом
                (семантика «только на товары» — решение владельца, НЕ меняем) —
                теперь кассир ВИДИТ, что применится не вся. */}
          {discountNum > 0 && effectiveDiscount < discountNum && (
            <View style={[styles.discountWarnRow, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
              <Ionicons
                name="alert-circle-outline"
                size={15}
                color={isDark ? colors.amber[200] : colors.amber[700]}
                style={{ marginTop: 1 }}
              />
              <Text style={[styles.discountWarnText, { color: isDark ? colors.amber[200] : colors.amber[700] }]}>
                {productTotal <= 0
                  ? 'Скидка не применена: в чеке нет товаров (скидка действует только на товары)'
                  : `Скидка применена частично: ${formatMoney(effectiveDiscount)} из ${formatMoney(discountNum)} (товаров на ${formatMoney(productTotal)})`}
              </Text>
            </View>
          )}
        </View>

        {/* ═══ SECTION 3 (was COMMENT — moved into client section above) ═══ */}

        {/* ═══ SECTION 4: SUMMARY — special card ═══ */}
        {(serviceLines.length > 0 || productLines.length > 0) && (
          <View
            style={[styles.summaryCard, { backgroundColor: palette.bg.card, borderColor: palette.accent.primarySoft }]}
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
                <Text style={[styles.summaryValue, { color: palette.text.primary }]}>{formatMoney(serviceTotal)}</Text>
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
                <Text style={[styles.summaryValue, { color: palette.text.primary }]}>{formatMoney(productTotal)}</Text>
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
            {/* Round 13 #1: в итоге тоже проговариваем, что скидка применилась
                  не целиком (семантика «только на товары» неизменна). */}
            {discountNum > 0 && effectiveDiscount < discountNum && (
              <Text style={[styles.summaryDiscountWarn, { color: isDark ? colors.amber[200] : colors.amber[700] }]}>
                {productTotal <= 0
                  ? 'Скидка не применена — в чеке нет товаров'
                  : `Скидка применена частично: ${formatMoney(effectiveDiscount)} из ${formatMoney(discountNum)}`}
              </Text>
            )}
            <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryTotalLabel, { color: palette.text.primary }]}>К оплате</Text>
              <Text style={styles.summaryTotalValue}>{formatMoney(total)}</Text>
            </View>
          </View>
        )}

        {/* ═══ SECTION 5: PAYMENT — green tint ═══
              В order-режиме (092) оплату принимает кассир, а не мастер: секцию
              оплаты целиком прячем (нал / карта / смешанная / СБП / отложить).
              Бэк коэрсит заказ в отложенный без оплаты. orderMode=false →
              секция видна и работает байт-в-байт как сейчас. */}
        {!orderMode && (
          <View
            style={[styles.sectionPayment, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.sectionHeader}>
              <Ionicons name="wallet-outline" size={18} color={colors.green[600]} />
              <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Оплата</Text>
            </View>

            {/* Способ оплаты — ЕДИНЫЙ селектор: Наличные / Карта / Смешанная /
                  По гарантии и — при праве sell_installment на НОВОМ чеке —
                  «Рассрочка» одним пунктом в ТОЙ ЖЕ модалке, выбирается тем же
                  тапом, что и остальные (отдельного тоггла больше нет). Кнопка
                  открывает центральную модалку; текущий способ показан компактно
                  (цветной тайл-иконка + подпись). Скрыта только при правке уже
                  оформленной рассрочки — там ниже read-only баннер, способ
                  менять нельзя. */}
            {!(isInstallment && !canOfferInstallment) &&
              (() => {
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

            {isInstallment ? (
              <InstallmentSaleFields
                palette={palette}
                total={total}
                firstPayment={installmentFirst}
                onFirstPaymentChange={setInstallmentFirst}
                remaining={Math.max(total - parseMoneyInput(installmentFirst), 0)}
                nextDateLabel={formatYmdHuman(toYmd(installmentNextDate))}
                onOpenDatePicker={() => {
                  haptic('tap');
                  setShowInstallmentDatePicker(true);
                }}
                readOnly={!canOfferInstallment}
              />
            ) : (
              <>
                {paymentMethod === ('cash' as PaymentMethod) && (
                  <View
                    style={[
                      styles.splitWrap,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    ]}
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
                              style={[
                                styles.splitLabel,
                                { color: palette.text.secondary, fontWeight: fontWeight.bold },
                              ]}
                            >
                              Сдача
                            </Text>
                          </View>
                          <Text
                            style={{ fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.green[700] }}
                          >
                            {formatMoney(parseMoneyInput(cashGiven) - total)}
                          </Text>
                        </View>
                      </>
                    )}
                  </View>
                )}

                {paymentMethod === ('cash_card' as PaymentMethod) && (
                  <View
                    style={[
                      styles.splitWrap,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    ]}
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

                {/* Deferred toggle — скрыт при правке ПРОВЕДЁННОГО чека (#61):
                      закрытый чек не возвращают в черновик (бэк editClosedCheck
                      не трогает is_deferred). Для нового/отложенного — как раньше. */}
                {!isEditingClosed && (
                  <TouchableOpacity
                    style={[
                      styles.deferToggle,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      isDeferred &&
                        (isDark
                          ? {
                              backgroundColor: softTint(colors.amber[600], 'dark'),
                              borderColor: 'rgba(217, 119, 6, 0.4)',
                            }
                          : styles.deferToggleActive),
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
                )}
              </>
            )}
          </View>
        )}

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
              colors={
                isDeferred && !orderMode ? [colors.amber[600], '#b45309'] : [colors.primary[600], colors.primary[700]]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.submitGradient}
            >
              <Ionicons
                name={
                  orderMode ? 'clipboard-outline' : isDeferred ? 'pause-circle-outline' : 'checkmark-circle-outline'
                }
                size={20}
                color={colors.white}
              />
              {/* В order-режиме (092) мастер создаёт заказ-наряд — кассир
                    пробьёт оплату позже. CTA и цвет переименованы; бэк коэрсит
                    чек в отложенный. orderMode=false → текст байт-в-байт как был. */}
              <Text style={styles.submitBtnText}>
                {orderMode
                  ? editId
                    ? 'Сохранить заказ-наряд'
                    : 'Отправить на доску'
                  : isDeferred
                    ? 'Отложить'
                    : editId
                      ? 'Сохранить'
                      : `Пробить — ${formatMoney(total)}`}
              </Text>
            </LinearGradient>
          )}
        </PressableScale>
      </KeyboardAwareScroll>

      {/* Master Picker — строка услуги либо весь заказ-наряд (CHECK_MASTER_PICKER_INDEX) */}
      <Modal
        visible={showMasterPicker !== null}
        onClose={() => setShowMasterPicker(null)}
        title={showMasterPicker === CHECK_MASTER_PICKER_INDEX ? 'Мастер заказ-наряда' : 'Выберите мастера'}
      >
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4 }} keyboardShouldPersistTaps="handled">
          {masters.map((m) => {
            const isSelected =
              showMasterPicker === CHECK_MASTER_PICKER_INDEX
                ? defaultMasterId === m.id
                : showMasterPicker !== null &&
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
                  if (showMasterPicker === CHECK_MASTER_PICKER_INDEX) {
                    // Мастер всего заказ-наряда. Строки услуг, которые всё ещё
                    // ссылались на мастера чужого филиала, переезжают вместе с
                    // ним: иначе человек выбрал бы мастера и упёрся в тот же
                    // отказ на следующей же строке.
                    setMasterId(m.id);
                    setServiceLines((prev) =>
                      prev.map((line) =>
                        worksAtThisPoint(line.lineMasterId || line.masterId)
                          ? line
                          : { ...line, lineMasterId: m.id, masterId: m.id },
                      ),
                    );
                  } else if (showMasterPicker !== null) {
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
                      isSelected && {
                        backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[100],
                      },
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
                      isSelected && { color: isDark ? colors.primary[300] : colors.primary[700] },
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

      {/* ── Шит «Исполнители» (Round 14) — чекбоксы, несколько мастеров ──── */}
      <Modal visible={showAssigneeSheet} onClose={() => setShowAssigneeSheet(false)} title="Исполнители">
        <Text style={[styles.assignSheetHint, { color: palette.text.tertiary }]}>
          Заказ появится на доске у каждого выбранного. Зарплата считается по строкам услуг, как раньше.
        </Text>
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4 }} keyboardShouldPersistTaps="handled">
          {masters.map((m) => {
            const isSelected = assigneeIds.includes(m.id);
            return (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.pickerItem,
                  { borderBottomColor: palette.border.subtle },
                  isSelected && { backgroundColor: palette.accent.primarySoft },
                ]}
                onPress={() => {
                  haptic('select');
                  setAssigneesDirty(true);
                  setAssigneeIds((prev) => (isSelected ? prev.filter((x) => x !== m.id) : [...prev, m.id]));
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={isSelected ? colors.primary[600] : palette.text.tertiary}
                  />
                  <Text
                    style={[
                      styles.pickerName,
                      { color: palette.text.primary },
                      isSelected && { color: isDark ? colors.primary[300] : colors.primary[700] },
                    ]}
                  >
                    {m.fullName}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
          {masters.length === 0 && (
            <Text style={[styles.assignSheetHint, { color: palette.text.tertiary }]}>Нет активных сотрудников</Text>
          )}
        </ScrollView>
        <TouchableOpacity
          style={styles.assignDoneBtn}
          onPress={() => setShowAssigneeSheet(false)}
          accessibilityRole="button"
          accessibilityLabel="Готово"
        >
          <Text style={styles.assignDoneBtnText}>Готово{assigneeIds.length > 0 ? ` (${assigneeIds.length})` : ''}</Text>
        </TouchableOpacity>
      </Modal>

      {/* ── Шит «Место» (Round 14) — справочник + создание нового ─────────── */}
      <Modal visible={showLocationSheet} onClose={() => setShowLocationSheet(false)} title="Место">
        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.4 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            style={[styles.pickerItem, { borderBottomColor: palette.border.subtle }]}
            onPress={() => {
              haptic('select');
              setLocationDirty(true);
              setOrderLocationId(null);
              setShowLocationSheet(false);
            }}
          >
            <Text style={[styles.pickerName, { color: palette.text.tertiary }]}>Без места</Text>
            {!orderLocationId && <Ionicons name="checkmark" size={20} color={colors.primary[600]} />}
          </TouchableOpacity>
          {activeLocations.map((loc) => {
            const isSelected = orderLocationId === loc.id;
            return (
              <TouchableOpacity
                key={loc.id}
                style={[
                  styles.pickerItem,
                  { borderBottomColor: palette.border.subtle },
                  isSelected && { backgroundColor: palette.accent.primarySoft },
                ]}
                onPress={() => {
                  haptic('select');
                  setLocationDirty(true);
                  setOrderLocationId(loc.id);
                  setShowLocationSheet(false);
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <Ionicons
                    name="location-outline"
                    size={16}
                    color={isSelected ? colors.primary[600] : palette.text.tertiary}
                  />
                  <Text
                    style={[
                      styles.pickerName,
                      { color: palette.text.primary },
                      isSelected && { color: isDark ? colors.primary[300] : colors.primary[700] },
                    ]}
                  >
                    {loc.name}
                  </Text>
                </View>
                {isSelected && <Ionicons name="checkmark" size={20} color={colors.primary[600]} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* «+ Новое место» — только держателям settings_manage (сервер гейтит
            POST /checks/locations тем же ключом). */}
        {hasPermission('settings_manage') && (
          <View style={[styles.newLocationRow, { borderTopColor: palette.border.subtle }]}>
            <TextInput
              value={newLocationName}
              onChangeText={setNewLocationName}
              style={[
                styles.newLocationInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder="Новое место — напр. «Бокс 2»"
              placeholderTextColor={palette.text.tertiary}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.newLocationBtn, !newLocationName.trim() && { opacity: 0.5 }]}
              disabled={!newLocationName.trim() || creatingLocation}
              onPress={async () => {
                const name = newLocationName.trim();
                if (!name) return;
                setCreatingLocation(true);
                try {
                  const res = await checksApi.locations.create({ name });
                  queryClient.invalidateQueries({ queryKey: ['check-locations'] });
                  setLocationDirty(true);
                  setOrderLocationId(res.data.id);
                  setNewLocationName('');
                  setShowLocationSheet(false);
                  haptic('success');
                } catch (err: any) {
                  haptic('error');
                  Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось создать место');
                } finally {
                  setCreatingLocation(false);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Создать место"
            >
              {creatingLocation ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Ionicons name="add" size={20} color={colors.white} />
              )}
            </TouchableOpacity>
          </View>
        )}
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
          {servicePickerNetworkError ? (
            <View style={{ alignItems: 'center', gap: spacing[2], paddingVertical: spacing[4] }}>
              <Ionicons name="cloud-offline-outline" size={22} color={palette.text.tertiary} />
              <Text style={{ textAlign: 'center', color: palette.text.tertiary }}>
                Нет связи с сервером — проверьте интернет
              </Text>
              <TouchableOpacity
                onPress={() => {
                  haptic('tap');
                  void refetchServices();
                }}
                activeOpacity={0.8}
              >
                <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : serviceSearch && filteredServices.length === 0 ? (
            <Text style={{ textAlign: 'center', color: palette.text.tertiary, paddingVertical: spacing[4] }}>
              Ничего не найдено
            </Text>
          ) : null}
        </ScrollView>
      </Modal>

      {/* Product Picker — Round 8 #2: полноэкранный роут `ProductPicker`
          (ProductPickerScreen) на корневом стеке, Склад-паттерн с папками и
          edge-swipe на уровень выше. Открывается через openProductPicker();
          корзина/склад/права уходят туда через productPickerSession, данные —
          те же ключи ['all-products-check', { warehouseId }] +
          ['warehouse-categories', { warehouseId }], которые этот экран греет
          prefetch'ем на mount. Модалка ProductPickerModal здесь больше не
          используется (жива для Склада/Поставщиков/Заказов/Мотивации). */}

      {/* Templates Picker — round 8 #3: мои шаблоны сгруппированы по личным
          папкам (drill-down внутри модалки, как Склад), «Общие» — отдельной
          плоской секцией на корне. Тап по шаблону применяет как раньше
          (applyTemplate без изменений); «Управлять» уводит в раздел
          «Шаблоны» (корневой стек — Касса и так перекрывает таб-бар). */}
      <Modal visible={showTemplatesPicker} onClose={() => setShowTemplatesPicker(false)} title="Шаблоны чеков">
        {/* Верхняя строка: назад-по-папке слева, «Управлять» справа */}
        <View style={styles.tplPickerTopRow}>
          {templatesPickerFolderId ? (
            <TouchableOpacity
              style={styles.tplPickerBackBtn}
              onPress={() => {
                haptic('tap');
                setTemplatesPickerFolderId(pickerCurrentFolder?.parentId ?? null);
              }}
              hitSlop={8}
            >
              <Ionicons name="chevron-back" size={16} color={isDark ? colors.primary[300] : colors.primary[600]} />
              <Text
                style={[styles.tplPickerBackText, { color: isDark ? colors.primary[300] : colors.primary[600] }]}
                numberOfLines={1}
              >
                {pickerCurrentFolder?.name ?? 'Назад'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <TouchableOpacity
            style={styles.tplManageBtn}
            onPress={() => {
              haptic('tap');
              setShowTemplatesPicker(false);
              navigation.navigate('Templates');
            }}
            hitSlop={8}
          >
            <Ionicons name="options-outline" size={14} color={palette.text.secondary} />
            <Text style={[styles.tplManageText, { color: palette.text.secondary }]}>Управлять</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.5 }} keyboardShouldPersistTaps="handled">
          {/* Папки текущего уровня */}
          {pickerFolders.map((folder) => {
            const count = pickerFolderTplCount.get(folder.id) ?? 0;
            return (
              <TouchableOpacity
                key={folder.id}
                style={[styles.pickerItem, { borderBottomColor: isDark ? palette.border.subtle : colors.gray[100] }]}
                onPress={() => {
                  haptic('tap');
                  setTemplatesPickerFolderId(folder.id);
                }}
                activeOpacity={0.6}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], flex: 1, minWidth: 0 }}>
                  <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.pickerName, { color: palette.text.primary }]} numberOfLines={1}>
                      {folder.name}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.gray[400], marginTop: 2 }}>
                      {count > 0 ? `${count} ${pluralRu(count, 'шаблон', 'шаблона', 'шаблонов')}` : 'Папка'}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
              </TouchableOpacity>
            );
          })}

          {/* Мои шаблоны текущего уровня */}
          {pickerTemplates.map((tpl) => (
            <View
              key={tpl.id}
              style={[styles.pickerItem, { borderBottomColor: isDark ? palette.border.subtle : colors.gray[100] }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.pickerName, { color: palette.text.primary }]} numberOfLines={1}>
                  {tpl.name}
                </Text>
                <Text style={{ fontSize: 11, color: colors.gray[400], marginTop: 2 }}>{templateSummary(tpl)}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <TouchableOpacity
                  onPress={() => applyTemplate(tpl)}
                  style={{
                    backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50],
                    borderRadius: 8,
                    paddingHorizontal: spacing[3],
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      color: isDark ? colors.primary[300] : colors.primary[600],
                      fontWeight: '600',
                    }}
                  >
                    Применить
                  </Text>
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
          ))}

          {/* Пустые состояния уровня */}
          {templatesPickerFolderId !== null && pickerFolders.length === 0 && pickerTemplates.length === 0 && (
            <View style={{ alignItems: 'center', paddingVertical: spacing[5] }}>
              <Ionicons name="folder-open-outline" size={28} color={colors.gray[300]} />
              <Text style={{ color: colors.gray[400], marginTop: spacing[2], fontSize: 13 }}>Папка пуста</Text>
            </View>
          )}
          {templatesPickerFolderId === null &&
            templateFolders.length === 0 &&
            myTemplates.length === 0 &&
            sharedTemplates.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: spacing[6] }}>
                <Ionicons name="copy-outline" size={32} color={colors.gray[300]} />
                <Text style={{ color: colors.gray[400], marginTop: spacing[2], fontSize: 14 }}>
                  Нет сохранённых шаблонов
                </Text>
                <Text style={{ color: colors.gray[400], fontSize: 12, textAlign: 'center', marginTop: spacing[1] }}>
                  Добавьте услуги и товары, затем нажмите «Сохранить как шаблон»
                </Text>
              </View>
            )}

          {/* Общие шаблоны — только на корне, отдельной секцией */}
          {templatesPickerFolderId === null && sharedTemplates.length > 0 && (
            <>
              <Text style={[styles.tplSectionLabel, { color: palette.text.tertiary }]}>Общие</Text>
              {sharedTemplates.map((tpl) => (
                <View
                  key={tpl.id}
                  style={[styles.pickerItem, { borderBottomColor: isDark ? palette.border.subtle : colors.gray[100] }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                      <Text
                        style={[styles.pickerName, { color: palette.text.primary, flexShrink: 1 }]}
                        numberOfLines={1}
                      >
                        {tpl.name}
                      </Text>
                      <View
                        style={{
                          backgroundColor: isDark ? softTint(colors.blue[500], 'dark') : colors.blue[50],
                          borderRadius: borderRadius.full,
                          paddingHorizontal: spacing[1.5],
                          paddingVertical: 1,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            fontWeight: '600',
                            color: isDark ? colors.blue[300] : colors.blue[600],
                          }}
                        >
                          Общий
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.gray[400], marginTop: 2 }}>{templateSummary(tpl)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <TouchableOpacity
                      onPress={() => applyTemplate(tpl)}
                      style={{
                        backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50],
                        borderRadius: 8,
                        paddingHorizontal: spacing[3],
                        paddingVertical: 6,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          color: isDark ? colors.primary[300] : colors.primary[600],
                          fontWeight: '600',
                        }}
                      >
                        Применить
                      </Text>
                    </TouchableOpacity>
                    {/* Удаление общего — только owner-class (сервер всё равно 403). */}
                    {isOwnerClassRole && (
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
                    )}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </Modal>

      {/* «Сохранить как шаблон» — имя + папка (+ «общий» у owner-class). */}
      <Modal visible={showSaveTemplate} onClose={() => setShowSaveTemplate(false)} title="Сохранить как шаблон">
        <View style={{ gap: spacing[3] }}>
          <TextInput
            value={saveTplName}
            onChangeText={setSaveTplName}
            placeholder="Название шаблона"
            placeholderTextColor={palette.text.tertiary}
            style={[
              styles.tplNameInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitSaveTemplate}
          />

          {isOwnerClassRole && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: palette.text.primary }}>Общий шаблон</Text>
                <Text style={{ fontSize: 11, color: palette.text.tertiary }}>
                  Виден всем сотрудникам, живёт вне личных папок
                </Text>
              </View>
              <Switch
                value={saveTplShared}
                onValueChange={(v) => {
                  haptic('select');
                  setSaveTplShared(v);
                }}
                trackColor={{ true: colors.primary[500] }}
              />
            </View>
          )}

          {!saveTplShared && (
            <View>
              <TouchableOpacity
                style={[styles.tplFolderRow, { borderColor: palette.border.subtle }]}
                onPress={() => {
                  haptic('tap');
                  setSaveTplFolderOpen((o) => !o);
                }}
                activeOpacity={0.6}
              >
                <Ionicons name="folder-open-outline" size={16} color={colors.primary[500]} />
                <Text style={{ flex: 1, fontSize: 14, color: palette.text.primary }} numberOfLines={1}>
                  {saveTplFolderId
                    ? (templateFolders.find((f) => f.id === saveTplFolderId)?.name ?? 'Папка')
                    : 'Без папки'}
                </Text>
                <Ionicons
                  name={saveTplFolderOpen ? 'chevron-up' : 'chevron-down'}
                  size={15}
                  color={palette.text.tertiary}
                />
              </TouchableOpacity>
              {/* Инлайн-список вместо второй модалки: вложенные RN Modal на
                  iOS ведут себя непредсказуемо. */}
              {saveTplFolderOpen && (
                <FolderPickerList
                  folders={templateFolders}
                  selectedId={saveTplFolderId}
                  onSelect={(id) => {
                    setSaveTplFolderId(id);
                    setSaveTplFolderOpen(false);
                  }}
                />
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.tplSaveBtn, { opacity: saveTplName.trim() && !savingTemplate ? 1 : 0.5 }]}
            disabled={!saveTplName.trim() || savingTemplate}
            onPress={submitSaveTemplate}
            activeOpacity={0.8}
          >
            {savingTemplate ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.tplSaveBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* M2: быстрый клиент из «Клиент не найден». Создание (или выбор
          найденного дубликата) сразу подставляет клиента и авто в чек —
          без повторного поиска. */}
      <QuickClientCreateSheet
        visible={showQuickCreate}
        onClose={() => setShowQuickCreate(false)}
        initialPlate={isPhoneMode ? '' : plateSearch}
        initialPlateMode={plateMode}
        initialPhone={isPhoneMode ? phoneSearch : ''}
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
          setPhoneSearch('');
        }}
        onSelectExisting={(existingClientId, existingCarId) => {
          setShowQuickCreate(false);
          animateClientToggle();
          setClientId(existingClientId);
          if (existingCarId) setCarId(existingCarId);
          setPlateSearch('');
          setPhoneSearch('');
        }}
      />

      {/* Feature #9 — «Сменить владельца»: выбор нового владельца ПО ТЕЛЕФОНУ
          (без госномера — авто уже выбрано). */}
      <ClientPhonePickerSheet
        visible={showReassignPicker}
        onClose={() => setShowReassignPicker(false)}
        excludeClientId={clientId || undefined}
        onPicked={onReassignPicked}
      />

      {/* Feature #9 — подтверждение «Сменить владельца». Чек не сохранён, так
          что конфликта в БД нет; при подтверждении переносим авто со всей
          историей и перенацеливаем текущий чек на нового владельца. */}
      <ConfirmDialog
        visible={!!reassignConfirm}
        onClose={() => setReassignConfirm(null)}
        onConfirm={() => {
          if (reassignConfirm && selectedCar) void handleReassignOwner(selectedCar, reassignConfirm.clientId);
        }}
        title="Сменить владельца?"
        message={
          reassignConfirm && selectedCar
            ? `Автомобиль ${reassignCarLabel(selectedCar)} будет перенесён клиенту «${reassignConfirm.clientName}». ` +
              'Авто и вся его история (чеки, долги, бонусы) будут перенесены новому владельцу.'
            : ''
        }
        confirmText="Перенести"
        variant="primary"
      />

      {/* Round 7 #8: у телефонного совпадения ≥2 авто — выбор машины. Пара
          клиент+авто уходит в чек тем же setClientId/setCarId путём, что и
          подсказки по госномеру. */}
      <ClientCarPickerSheet
        visible={!!carPickerClient}
        client={carPickerClient}
        onClose={() => setCarPickerClient(null)}
        onPick={(client, car) => {
          setCarPickerClient(null);
          animateClientToggle();
          setClientId(client.id);
          setCarId(car.id);
          setPlateSearch('');
          setPhoneSearch('');
        }}
      />

      {/* Голосовой ввод комментария. Распознанный текст ДОБАВЛЯЕТСЯ в конец поля
          (не затирает уже набранное); дальше правится руками. Рендерится только
          когда открыт — так микрофон гарантированно освобождается при закрытии. */}
      {voiceSheetOpen && (
        <VoiceCommentSheet
          visible={voiceSheetOpen}
          onClose={() => setVoiceSheetOpen(false)}
          remainingSeconds={voiceUsage?.remainingSeconds}
          onInsert={(text) => setComment((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))}
        />
      )}

      {/* Метки чека (Round 12 #9). Рендерится только когда открыта — справочник
          меток не грузится, пока мастер сам не потянулся к строке «Метка». */}
      {showTagSheet && (
        <CheckTagSheet
          visible={showTagSheet}
          onClose={() => setShowTagSheet(false)}
          selected={selectedTags}
          onChange={setSelectedTags}
          canManage={hasPermission('settings_manage')}
        />
      )}

      {/* Центральная модалка выбора способа оплаты. Закрывается сразу после
          выбора; sub-UI для cash / cash_card / рассрочки живёт в секции оплаты
          как прежде. «Рассрочка» — доп. пункт этой же модалки (при праве
          sell_installment на новом чеке), выбирается тем же тапом. */}
      <PaymentMethodModal
        visible={showPaymentPicker}
        value={paymentMethod}
        showInstallment={canOfferInstallment}
        onSelect={(m) => {
          setPaymentMethod(m);
          // Рассрочку нельзя откладывать — выбор «Рассрочки» снимает «Отложить
          // чек», как это делал прежний отдельный переключатель.
          if (m === ('installment' as PaymentMethod)) setIsDeferred(false);
          setShowPaymentPicker(false);
        }}
        onClose={() => setShowPaymentPicker(false)}
      />

      {/* Дата следующего платежа по рассрочке. */}
      <DateTimePickerModal
        visible={showInstallmentDatePicker}
        value={installmentNextDate}
        mode="date"
        onConfirm={(d) => {
          setInstallmentNextDate(d);
          setShowInstallmentDatePicker(false);
        }}
        onCancel={() => setShowInstallmentDatePicker(false)}
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
  // Правка чека из Журнала: плавающая стрелка «назад» занимает левый край,
  // строка филиала обязана начинаться после неё.
  pointBannerStacked: { marginLeft: 40 },

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

  // Пикер шаблонов с папками + шит «Сохранить как шаблон» (round 8 #3)
  tplPickerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  tplPickerBackBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
  },
  tplPickerBackText: { fontSize: 13, fontWeight: fontWeight.semibold, flexShrink: 1 },
  tplManageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
  },
  tplManageText: { fontSize: 12, fontWeight: fontWeight.semibold },
  tplSectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },
  tplNameInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  tplFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  tplSaveBtn: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tplSaveBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },

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
  // Round 8 #1 — сдержанный чип «Сменить» под выбранным авто: вторичная
  // аффорданс-кнопка (muted fill + hairline), не конкурирует с номером.
  changeCarChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  changeCarChipText: { fontSize: 12, fontWeight: '600' as const, letterSpacing: -0.1 },
  // Feature #9 — ряд чипов под выбранным авто: «Сменить» + «Сменить владельца».
  // Wrap, чтобы на узких экранах длинный чип переносился, а не обрезался.
  selectedCarChipsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
    gap: spacing[2],
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
    gap: spacing[2],
  },
  // Подпись секции ужимается первой — переключатель RU|INT|ТЕЛ всегда целиком.
  plateLabelShrink: {
    flexShrink: 1,
  },
  // ── Явный поиск по телефону (Round 7 #8) ──────────────────────────────
  // Отдельная строка-инпут МИМО маски номера: та же «primary» роль, что и
  // плашка (близкая высота), но обычное поле с телефонной клавиатурой.
  phoneSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    height: 56,
    borderWidth: 1.5,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
  },
  phoneSearchInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingVertical: 0,
    ...Platform.select({
      android: { paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' as const },
    }),
  },
  // Строка-клиент в результатах phone-поиска: аватар + имя/телефон + счётчик авто.
  phoneResultAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  carCountChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  carCountChipText: { fontSize: 11, fontWeight: fontWeight.semibold },
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
  // Read-only цена товара: та же вертикальная метрика, что и lineInput
  // (paddingVertical + fontSize), но без рамки/фона — это значение, не поле ввода.
  lineReadonlyPrice: {
    paddingVertical: spacing[1.5],
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
  // Round 13 #1: янтарное предупреждение «скидка применилась не целиком».
  discountWarnRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  discountWarnText: { flex: 1, fontSize: 12.5, fontWeight: fontWeight.medium, lineHeight: 17 },
  summaryDiscountWarn: {
    fontSize: 12,
    fontWeight: fontWeight.medium,
    lineHeight: 16,
    marginTop: -spacing[1],
  },
  // Comment
  voiceMicBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // ── Метки (Round 12 #9): ghost-строка в секции комментария ──────────────
  // Никакого фона/рамки — строка «просто стоит»: иконка + слово «Метка»
  // (tertiary) либо компактные чипы выбранных меток. Вся строка — тап-таргет.
  tagGhostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1],
    minHeight: 32,
  },
  tagGhostText: {
    fontSize: fontSize.sm,
  },
  tagChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1.5],
    flexShrink: 1,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 180,
  },
  tagChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tagChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
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
  // ── Исполнители и место (Round 14, режим «Кассир») ─────────────────────
  sectionAssign: {
    borderRadius: borderRadius['2xl'],
    padding: spacing[3.5],
    gap: spacing[1],
    borderWidth: 1,
  },
  assignSheetHint: { fontSize: 11, lineHeight: 15, marginBottom: spacing[2] },
  assignDoneBtn: {
    marginTop: spacing[3],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
  },
  assignDoneBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  newLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
  },
  newLocationInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  newLocationBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
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
