import { useState, useEffect, useRef, useCallback, useMemo, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { loadProductCatalog } from '../../../shared/api/productCatalog';
import { loadAllPages } from '../../../shared/utils/loadAllPages';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Search,
  Package,
  X,
  Receipt,
  CreditCard,
  Banknote,
  Minus,
  UserRound,
  UserCheck,
  CalendarDays,
  Gauge,
  Pencil,
  ShieldCheck,
  ChevronDown as ChevronDownIcon,
  LayoutTemplate,
  BookmarkPlus,
  Tag,
  Check as CheckIcon,
  Wrench,
  MessageSquare,
  MapPin,
  Loader2,
  ScanLine,
  UserPlus,
  Car as CarIcon,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru as ruLocale } from 'date-fns/locale';
import toast from 'react-hot-toast';
import {
  checksApi,
  clientsApi,
  carsApi,
  usersApi,
  servicesApi,
  productsApi,
  warrantyApi,
  warehousesApi,
  type CheckTemplateServiceInput,
  type CreateCheckRequest,
} from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTenantCalendar } from '../hooks/useTenantTimezone';
import { usePointsQuery } from '../hooks/usePoints';
import { useVinEnabled } from '../hooks/useVinEnabled';
import type {
  Client,
  Car,
  CarLookupResult,
  User,
  Service,
  Product,
  CheckServiceLine,
  CheckProductLine,
  CheckTag,
  CheckTemplate,
  WarrantyClaim,
  Warehouse,
  PosSettings,
  TenantLocation,
  CheckAssignee,
} from '../types';

import { formatPhone } from '../../../shared/validation/phone';
import { formatMoney } from '../../../shared/utils/formatters';
import { isServicePriceSelectionValid } from '../../../shared/utils/servicePrices';
import {
  expandServiceQuantities,
  hydrateServiceLineForCheckEdit,
  serviceLineTotal,
  toCheckTemplateServiceInput,
} from '../../../shared/utils/checkLines';
import { formatVin, isValidVin, normalizeVin } from '../../../shared/utils/vin';
import { looksLikeRussianPlate } from '../../../shared/utils/plate';
import { DEFAULT_UNIT, MIN_QTY, formatQty, parseQtyInput, roundQty, unitLabel } from '../utils/units';
import LastVisitBadge from '../components/LastVisitBadge';
import Modal from '../components/Modal';
import PageHeader from '../components/PageHeader';
import QueryState from '../components/QueryState';
import ConfirmDialog from '../components/ConfirmDialog';
import ClientSearchAutocomplete from '../components/ClientSearchAutocomplete';
import { TemplatePickerModal, SaveTemplateModal } from '../components/CheckTemplatesModals';
import ProductPickerDrawer from '../components/checks/ProductPickerDrawer';
import ClientCarQuickDrawer, { type QuickDrawerMode } from '../components/checks/ClientCarQuickDrawer';
import ServiceCombobox from '../components/checks/ServiceCombobox';
import MoneyInput from '../components/checks/MoneyInput';
import { VinText, carVin } from '../components/vin';
import { PlateBadge } from '../components/checks/checkBadges';

import { Card, CardBody, CardHeader } from '../ui/Card';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Input, controlBase, controlSize } from '../ui/Input';
import { Select } from '../ui/Select';
import { Field } from '../ui/Field';
import { Textarea } from '../ui/Textarea';
import { Checkbox } from '../ui/Checkbox';
import { RadioGroup } from '../ui/RadioGroup';
import { Badge } from '../ui/Badge';
import { Money } from '../ui/Money';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import { newUuid } from '../utils/uuid';

/**
 * clientRequestId — ключ идемпотентности создания чека (бэкенд, миграция 111:
 * максимум один чек на (tenant, clientRequestId)). Генерируется ОДИН раз на
 * логический сабмит и повторяется при ретрае того же сабмита (ручной повтор
 * после ошибки, replay из SW-офлайн-очереди) — повторный POST вернёт УЖЕ
 * созданный чек вместо дубля. Бэкенд требует hex-UUID форму (иначе 400).
 */
function generateClientRequestId(): string {
  return newUuid();
}

/** Мерные единицы — только они получают дробный шаг 0.5 при добавлении. */
const METERED_UNITS = new Set(['м', 'кг', 'л']);

/**
 * Чек двигает деньги И склад — единый список зависимых query-ключей для
 * инвалидации после create/update (staleTime 2 мин иначе прячет изменение).
 * ['dashboard-v2'] — реальный ключ дашборда (['dashboard'] — исторический,
 * оставлен для совместимости); ['salary'] покрывает ['salary','my-summary'].
 * Зеркальный список — в ChecksPage/CheckDetailPage (delete/restore/finalize).
 */
const MONEY_STOCK_QUERY_KEYS: readonly string[][] = [
  ['checks'],
  ['dashboard'],
  ['dashboard-v2'],
  ['dashboard-chart'],
  ['financial-report'],
  ['employee-ranking'],
  ['cashflow'],
  ['cash-shift'],
  ['salary-all'],
  ['salary-my'],
  ['salary'],
  ['employee-salary'],
  ['products'],
  ['products-all'],
  ['low-stock'],
  ['installments'],
  // Метки (Round 12 #9): чек с меткой двигает отчёт «По меткам».
  ['tag-analytics'],
];

/** SW-офлайн-очередь отвечает 202 {queued:true} — сервер запрос ещё НЕ видел. */
const isQueuedOffline = (res: { status?: number; data?: { queued?: boolean } } | undefined): boolean =>
  res?.status === 202 && res?.data?.queued === true;

interface ServiceLineForm {
  /** Persisted line identity is retained only while editing this same check. */
  id?: string;
  serviceId: string;
  masterId: string;
  name: string;
  price: number;
  priceConfirmed?: boolean;
  /**
   * Только у legacy-строки старого чека («Мойка ×3», quantity > 1): значение уходит на сервер как есть,
   * чтобы сумма чека не менялась. У новых строк поля нет — строка услуги = одна услуга.
   */
  quantity?: number;
}

/** Количество legacy-строки услуги (> 1) или undefined, если это обычная строка «одна услуга». */
const legacyQuantity = (line: { quantity?: number | null }): number | undefined => {
  const q = Number(line.quantity);
  return Number.isFinite(q) && q > 1 ? q : undefined;
};

interface ProductLineForm {
  productId: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
  unit?: string;
}

type PaymentMethodKey = 'cash' | 'card' | 'cash_card' | 'warranty' | 'installment';

/** Строка выдачи поиска клиента: клиент (+ его машина) или результат по VIN. */
interface SearchRow {
  key: string;
  client: Client | null;
  car: Car | null;
  vinHit?: CarLookupResult;
}

/**
 * QtyInput — поле количества строки товара (120, дробные количества).
 * Зеркало QtyInput из mobile/CheckCreateScreen.
 *
 * Черновик текста живёт локально: наверх коммитим каждое валидное значение
 * ≥ MIN_QTY (0.001), а на blur нормализуем отображение («2,» → «2», пусто/0 →
 * откат к последнему валидному). Запятая = точка, глубже 3 знаков не уходит
 * (parseQtyInput округляет — ровно NUMERIC(12,3)). Степперы ± снаружи
 * продолжают работать: пока поле не в фокусе, внешние изменения значения
 * синхронизируются в черновик.
 */
function QtyInput({ value, onCommit, label }: { value: number; onCommit: (n: number) => void; label: string }) {
  const [text, setText] = useState(() => formatQty(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(formatQty(value));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      aria-label={label}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const n = parseQtyInput(v);
        if (n !== null && n >= MIN_QTY) onCommit(n);
      }}
      onFocus={(e) => {
        focusedRef.current = true;
        e.target.select();
      }}
      onBlur={() => {
        focusedRef.current = false;
        const n = parseQtyInput(text);
        if (n === null || n < MIN_QTY) {
          setText(formatQty(value));
        } else {
          setText(formatQty(n));
          onCommit(n);
        }
      }}
      className={cn(controlBase, controlSize.sm, 'w-16 text-center font-medium tabular-nums shadow-none')}
    />
  );
}

/** Подпись-ключ + значение в строке итога. */
function SummaryRow({
  label,
  value,
  strong,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <span className={cn('text-sm', strong ? 'font-semibold text-ink' : 'text-ink-3')}>{label}</span>
      <span
        className={cn('tabular-nums', strong ? 'text-lg font-semibold text-ink' : 'text-sm font-medium text-ink-2')}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function CheckCreatePage() {
  const navigate = useNavigate();
  const { id: editCheckId } = useParams<{ id: string }>();
  const isEditMode = !!editCheckId;
  const queryClient = useQueryClient();
  const { user, hasPermission } = useAuth();
  // 171 — VIN: пока опция выключена, ни одного упоминания VIN на экране.
  const vinEnabled = useVinEnabled();
  // Смена даты чека — ключ checks_change_datetime (сервер проверяет его же в
  // ChecksService; волна Битрикс24 — вместо строкового @Roles d/a/sa).
  const canEditDate = hasPermission('checks_change_datetime');
  // «Сменить владельца» (feature #9) — gated by clients_edit (backend
  // POST /cars/:id/transfer-owner). Тот же ключ гейтит PATCH /cars/:id —
  // «Изменить авто» из Кассы. Байпас superadmin/director — внутри hasPermission.
  const canReassignOwner = hasPermission('clients_edit');
  const canSellInstallment = hasPermission('sell_installment');
  // Рассрочка — только на НОВОМ чеке (parity с mobile: canOfferInstallment).
  // План создаётся сервером в create(); правка чека план создать не умеет,
  // бэк смену способа на 'installment' отклоняет — иначе остаток чека навсегда
  // повис бы в корзине «Рассрочка (долг)» без возможности погашения.
  // Правка СУЩЕСТВУЮЩЕГО чека-рассрочки (Round 13 #9) при этом разрешена:
  // строки/скидка меняются, сервер пересчитает план сам; взнос — read-only.
  const canOfferInstallment = canSellInstallment && !isEditMode;

  // Поиск клиента: госномер / телефон / имя / VIN (одна строка, сервер ищет по всему).
  const [plateSearch, setPlateSearch] = useState('');
  const [showPlateDropdown, setShowPlateDropdown] = useState(false);
  const [activeRow, setActiveRow] = useState(0);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedCarId, setSelectedCarId] = useState('');
  const [pickingVin, setPickingVin] = useState(false);
  const plateInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // Быстрое создание клиента/авто из Кассы (паритет с мобильным QuickClientCreateSheet).
  const [quickDrawer, setQuickDrawer] = useState<QuickDrawerMode | null>(null);
  // key панели меняется на каждое открытие — форма монтируется с нужными
  // начальными значениями (VIN/телефон из поиска) уже при первом рендере.
  const [quickDrawerSeq, setQuickDrawerSeq] = useState(0);
  const openQuickDrawer = (mode: QuickDrawerMode) => {
    setQuickDrawerSeq((s) => s + 1);
    setQuickDrawer(mode);
  };

  // Ключ идемпотентности текущего логического сабмита (create-режим).
  // Живёт от первой попытки до успеха: ретрай после ошибки шлёт ТОТ ЖЕ id,
  // и сервер не создаст дубль чека. Сбрасывается в onSuccess.
  const clientRequestIdRef = useRef<string | null>(null);

  // «Сегодня» — по календарю АВТОСЕРВИСА (157), а не браузера: дату чека в
  // шапке кассир сверяет глазами, а ставит её сервер своими сутками.
  const { today: tenantToday } = useTenantCalendar();
  // Тот же день, но через ref: эффект гидратации формы правки не имеет права
  // перезапускаться в полночь — он затёр бы уже набранный заказ-наряд.
  const tenantTodayRef = useRef(tenantToday);
  tenantTodayRef.current = tenantToday;

  // Form fields (no top-level master — current user is the default)
  const [date, setDate] = useState(tenantToday);
  // true только после РУЧНОЙ правки даты. Если пользователь дату не трогал,
  // поле date в payload не уходит вовсе: create получает серверный now()
  // (полный timestamp, а не yyyy-MM-dd → 00:00), edit не переписывает
  // оригинальный timestamp чека.
  const [dateTouched, setDateTouched] = useState(false);
  const [mileage, setMileage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [comment, setComment] = useState('');
  const [discount, setDiscount] = useState(0);
  const [isDeferred, setIsDeferred] = useState(false);

  // ── Метки чека (Round 12 #9) ────────────────────────────────────────────
  const [selectedTags, setSelectedTags] = useState<CheckTag[]>([]);
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  // Payment calculation
  const [cashGiven, setCashGiven] = useState<number>(0);
  const [cashAmount, setCashAmount] = useState<number>(0);
  const [cardAmount, setCardAmount] = useState<number>(0);

  // Рассрочка (installment): первый взнос (нал + карта) + дата следующего платежа.
  const [installmentCash, setInstallmentCash] = useState<number>(0);
  const [installmentCard, setInstallmentCard] = useState<number>(0);
  const [installmentNextDate, setInstallmentNextDate] = useState('');
  const [installmentComment, setInstallmentComment] = useState('');

  const [serviceLines, setServiceLines] = useState<ServiceLineForm[]>([]);
  const [showAllCatalogServices, setShowAllCatalogServices] = useState(false);
  const isCatalogOwner = user?.role === 'director' || user?.role === 'superadmin';
  const [productLines, setProductLines] = useState<ProductLineForm[]>([]);

  const [showProductPicker, setShowProductPicker] = useState(false);

  // Шаблоны чеков (parity с mobile): пикер + «Сохранить как шаблон»
  const [showTemplatesPicker, setShowTemplatesPicker] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Warehouse filter for product picker (defaults to main warehouse)
  const [pickerWarehouseId, setPickerWarehouseId] = useState<string>('');
  const [warrantyExpanded, setWarrantyExpanded] = useState(false);

  // «Сменить владельца» modal (feature #9)
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTarget, setReassignTarget] = useState<Client | null>(null);

  // Round 12 #7: подтверждение «забыли клиента».
  const [showRetailPrompt, setShowRetailPrompt] = useState(false);
  // Уход со страницы с набранными строками — явное подтверждение (аудит 2.3).
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const hasLines = serviceLines.length > 0 || productLines.length > 0;

  // Prevent accidental page leave
  useEffect(() => {
    window.history.pushState({ checkGuard: true }, '');
    const handler = () => {
      if (serviceLines.length > 0 || productLines.length > 0) {
        window.history.pushState({ checkGuard: true }, '');
      }
    };
    window.addEventListener('popstate', handler);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (serviceLines.length > 0 || productLines.length > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [serviceLines.length, productLines.length]);

  // 156/161 — мульти-точки: список автосервисов тенанта решает, скоупить ли
  // пикер мастера филиалом.
  const { data: pointsData } = usePointsQuery();
  // Пикер мастера — ЕДИНСТВЕННОЕ место, где список обязан быть по ТЕКУЩЕМУ
  // филиалу (`?scope=point`): чужой мастер в чеке уводит его зарплату и рейтинг
  // в другой филиал. У одноточечного тенанта параметр не ставим: ответ тот же,
  // но ушёл бы мимо общего прогретого слота ['masters'].
  const scopeMastersToPoint = (pointsData?.points.length ?? 0) > 1;
  const { data: masters } = useQuery<User[]>({
    queryKey: scopeMastersToPoint ? ['masters', 'point'] : ['masters'],
    queryFn: async () => {
      const res = await usersApi.getMasters(scopeMastersToPoint ? { scope: 'point' } : undefined);
      return res.data;
    },
    staleTime: 60_000,
  });

  // Поиск клиентов: сервер сам матчит имя / телефон / госномер / VIN (171).
  const {
    data: clientsData,
    isLoading: clientsLoading,
    isError: clientsError,
    refetch: refetchClients,
  } = useQuery<Client[]>({
    queryKey: ['clients', plateSearch],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: plateSearch, limit: 20 });
      return res.data?.data ?? res.data;
    },
    enabled: plateSearch.length >= 1,
  });

  // 171 — точное совпадение по VIN: когда введённая строка — валидный VIN,
  // спрашиваем сервер напрямую (у поиска по search подстрока может дать
  // соседей). Запроса нет ни при выключенной опции, ни при неполном VIN.
  const searchVin = vinEnabled ? normalizeVin(plateSearch) : '';
  const searchIsVin = isValidVin(searchVin);
  const { data: vinHit, isLoading: vinLoading } = useQuery<CarLookupResult | null>({
    queryKey: ['cars', 'lookup-by-vin', searchVin],
    queryFn: async () => (await carsApi.lookupByVin(searchVin)).data,
    enabled: searchIsVin && !selectedClient,
    staleTime: 30_000,
  });

  // Fetch all services (cached 60s — catalog data)
  const allServicesQuery = useQuery<Service[]>({
    queryKey: ['services-all', { preferredOnly: false }],
    queryFn: () => loadAllPages(async (page, limit) => (await servicesApi.getAll({ page, limit })).data, 1000),
    enabled: isCatalogOwner || showAllCatalogServices,
    staleTime: 60_000,
  });
  const allServices = allServicesQuery.data;
  const preferredServicesQuery = useQuery<Service[]>({
    queryKey: ['services-all', { preferredOnly: true }],
    queryFn: () =>
      loadAllPages(async (page, limit) => (await servicesApi.getAll({ page, limit, preferredOnly: true })).data, 1000),
    enabled: !isCatalogOwner && !showAllCatalogServices,
    staleTime: 60_000,
  });
  const activeServicesLoading =
    !isCatalogOwner && !showAllCatalogServices ? preferredServicesQuery.isLoading : allServicesQuery.isLoading;
  const activeServicesError =
    !isCatalogOwner && !showAllCatalogServices ? preferredServicesQuery.isError : allServicesQuery.isError;
  const refetchActiveServices =
    !isCatalogOwner && !showAllCatalogServices ? preferredServicesQuery.refetch : allServicesQuery.refetch;
  const selectableCatalogServices =
    !isCatalogOwner && !showAllCatalogServices ? (preferredServicesQuery.data ?? []) : (allServices ?? []);
  const visibleServiceIds = new Set(
    [...selectableCatalogServices, ...(allServices ?? [])].map((service) => service.id),
  );
  const missingReferencedServiceIds = [
    ...new Set(serviceLines.map((line) => line.serviceId).filter((id): id is string => !!id)),
  ].filter((id) => !visibleServiceIds.has(id));
  const referencedServicesQuery = useQuery<Service[]>({
    queryKey: ['check-referenced-service-prices', missingReferencedServiceIds],
    queryFn: async () =>
      Promise.all(missingReferencedServiceIds.map(async (id) => (await servicesApi.getById(id)).data)),
    enabled: missingReferencedServiceIds.length > 0,
    staleTime: 60_000,
  });

  // Fetch all products (cached 60s — catalog data). Полный каталог; пикер
  // фильтруется по складу на клиенте, поэтому переключение складов мгновенное.
  const {
    data: allProducts,
    isLoading: productsLoading,
    isError: productsError,
    refetch: refetchProducts,
  } = useQuery<Product[]>({
    queryKey: ['products-all'],
    queryFn: async () => {
      return loadProductCatalog(productsApi.getAll, { warehouseId: 'all' });
    },
    staleTime: 60_000,
  });

  // Warehouses for the picker switcher. Main / defect / used.
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    staleTime: 5 * 60_000,
  });
  // POS «Кассовая смена + роли» (092). Mode OFF (default) → no change.
  // When shift-mode is ON and the current user is NOT a cashier, the server
  // forces this order to be deferred and rejects payment. We mirror that here:
  // hide the payment UI and force the deferred flag (server is source of truth).
  const { data: posSettings } = useQuery<PosSettings>({
    queryKey: ['checks', 'pos-settings'],
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
  });
  const cashierLocked = !!posSettings?.shiftModeEnabled && !posSettings?.isCashier;
  useEffect(() => {
    if (cashierLocked) setIsDeferred(true);
  }, [cashierLocked]);

  // ── Конвейер (Round 14, режим «Кассир»): исполнители + место ────────────
  const conveyorMode = !!posSettings?.shiftModeEnabled;
  const canManageLocations = hasPermission('settings_manage');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [creatingLocation, setCreatingLocation] = useState(false);

  const { data: locations } = useQuery<TenantLocation[]>({
    queryKey: ['checks', 'locations'],
    queryFn: async () => (await checksApi.locations.list()).data,
    enabled: conveyorMode,
    staleTime: 60_000,
  });
  const activeLocations = useMemo(
    () => (locations ?? []).filter((l) => l.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [locations],
  );

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Новое место инлайн из пикера (POST /checks/locations, settings_manage) —
  // создали → сразу выбрали. 400/403 — текст сервера дословно.
  const handleCreateLocation = async () => {
    const name = newLocationName.trim();
    if (!name || creatingLocation) return;
    setCreatingLocation(true);
    try {
      const res = await checksApi.locations.create({ name });
      setLocationId(res.data.id);
      setNewLocationName('');
      queryClient.invalidateQueries({ queryKey: ['checks', 'locations'] });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Не удалось создать место');
    } finally {
      setCreatingLocation(false);
    }
  };

  // Default the picker to the main warehouse once the list arrives.
  useEffect(() => {
    if (!pickerWarehouseId && warehouses && warehouses.length > 0) {
      const main = warehouses.find((w) => w.kind === 'main') || warehouses[0];
      setPickerWarehouseId(main.id);
    }
  }, [warehouses, pickerWarehouseId]);

  // Active warranties for the currently-selected client+car combo.
  const warrantyEnabled = !!(selectedClient?.id || selectedCarId);
  const { data: activeWarranties } = useQuery<WarrantyClaim[]>({
    queryKey: ['active-warranties', selectedClient?.id, selectedCarId],
    queryFn: async () => {
      const res = await warrantyApi.activeForClient({
        clientId: selectedClient?.id,
        carId: selectedCarId || undefined,
      });
      return res.data;
    },
    enabled: warrantyEnabled,
    staleTime: 30_000,
  });

  // Filter the catalogue by chosen warehouse for the picker. Legacy products
  // without warehouseId stay visible only in the main warehouse.
  const pickerProducts = useMemo<Product[]>(() => {
    const list = allProducts ?? [];
    if (!pickerWarehouseId) return list;
    const isMain = warehouses?.find((w) => w.id === pickerWarehouseId)?.kind === 'main';
    return list.filter((p) => p.warehouseId === pickerWarehouseId || (isMain && !p.warehouseId));
  }, [allProducts, warehouses, pickerWarehouseId]);

  // Load existing check for edit mode
  const {
    data: existingCheck,
    isLoading: existingLoading,
    isError: existingError,
    isFetching: existingFetching,
    refetch: refetchExisting,
  } = useQuery({
    queryKey: ['check', editCheckId],
    queryFn: async () => {
      const res = await checksApi.getById(editCheckId!);
      return res.data;
    },
    enabled: isEditMode,
  });

  // Pre-fill form when editing
  const [editLoaded, setEditLoaded] = useState(false);
  useEffect(() => {
    if (!existingCheck || editLoaded) return;
    setEditLoaded(true);

    if (existingCheck.client) {
      setSelectedClient(existingCheck.client);
      setSelectedCarId(existingCheck.carId || '');
      const car = existingCheck.client.cars?.find((c: Car) => c.id === existingCheck.carId);
      if (car) setPlateSearch(car.plateNumber || existingCheck.client.fullName);
      else setPlateSearch(existingCheck.client.fullName);
    }
    setDate(existingCheck.date ? format(new Date(existingCheck.date), 'yyyy-MM-dd') : tenantTodayRef.current);
    setMileage(existingCheck.mileage ? String(existingCheck.mileage) : '');
    setPaymentMethod(existingCheck.paymentMethod || 'cash');
    // «Сплит»: восстановить РЕАЛЬНУЮ разбивку нал/карта. Авто-sync эффект
    // трогает суммы только для 'cash'/'card', так что гидрированные значения
    // не затираются.
    if (existingCheck.paymentMethod === 'cash_card') {
      setCashAmount(existingCheck.cashAmount ?? 0);
      setCardAmount(existingCheck.cardAmount ?? 0);
    }
    // Рассрочка (Round 13 #9): гидрируем реальный первый взнос из строки чека —
    // read-only плашка показывает правду.
    if (existingCheck.paymentMethod === 'installment') {
      setInstallmentCash(existingCheck.cashAmount ?? 0);
      setInstallmentCard(existingCheck.cardAmount ?? 0);
    }
    setComment(existingCheck.comment || '');
    // Метки (Round 12 #9): гидрируем существующие — payload в edit-режиме шлёт
    // tagIds всегда, без гидрации сохранение стёрло бы метки чека.
    setSelectedTags(existingCheck.tags || []);
    setDiscount(existingCheck.discount || 0);
    setIsDeferred(existingCheck.isDeferred || false);
    // Round 14: исполнители + место — гидрируем, иначе сохранение в режиме
    // конвейера перезаписало бы набор пустым (assigneeIds шлётся при edit).
    setAssigneeIds((existingCheck.assignees ?? []).map((a: CheckAssignee) => a.id));
    setLocationId(existingCheck.locationId ?? existingCheck.location?.id ?? '');

    if (existingCheck.services?.length) {
      setServiceLines(
        existingCheck.services.map((s: CheckServiceLine) => ({
          ...hydrateServiceLineForCheckEdit(s, user?.id || ''),
          priceConfirmed: true,
        })),
      );
    }
    if (existingCheck.products?.length) {
      setProductLines(
        existingCheck.products.map((p: CheckProductLine) => ({
          productId: p.productId || '',
          name: p.name,
          sellPrice: p.sellPrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          // 120: backend отдаёт единицу строки (LEFT JOIN products). Старый
          // backend поля не шлёт → undefined → UI покажет дефолт 'шт'.
          unit: p.unit,
        })),
      );
    }
  }, [existingCheck, editLoaded, user?.id]);

  // ── Метки чека (Round 12 #9): справочник + инлайн-создание ──────────────
  const { data: allTags } = useQuery({
    queryKey: ['check-tags'],
    queryFn: async () => (await checksApi.tags.list()).data,
    enabled: showTagPopover,
    staleTime: 60_000,
  });

  const toggleTag = (tag: CheckTag) => {
    setSelectedTags((prev) =>
      prev.some((t) => t.id === tag.id) ? prev.filter((t) => t.id !== tag.id) : [...prev, tag],
    );
  };

  const TAG_COLOR_POOL = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0d9488', '#e11d48', '#4f46e5', '#ea580c'];

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name || creatingTag) return;
    if (name.length > 30) {
      toast.error('Название метки — максимум 30 символов');
      return;
    }
    setCreatingTag(true);
    try {
      const color = TAG_COLOR_POOL[(allTags?.length ?? 0) % TAG_COLOR_POOL.length];
      const res = await checksApi.tags.create({ name, color });
      const created = res.data;
      setSelectedTags((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
      setNewTagName('');
      queryClient.invalidateQueries({ queryKey: ['check-tags'] });
    } catch (err: any) {
      const existing: CheckTag | undefined = err?.response?.status === 409 ? err?.response?.data?.tag : undefined;
      if (existing) {
        setSelectedTags((prev) => (prev.some((t) => t.id === existing.id) ? prev : [...prev, existing]));
        setNewTagName('');
      } else {
        toast.error(err?.response?.data?.message || 'Не удалось создать метку');
      }
    } finally {
      setCreatingTag(false);
    }
  };

  // Mutation
  const createMutation = useMutation({
    mutationFn: (data: any) => checksApi.create(data),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        // SW-офлайн: сервер чек ещё НЕ создал. clientRequestIdRef НЕ сбрасываем —
        // replay из очереди и любой ручной повтор уходят с ТЕМ ЖЕ ключом
        // идемпотентности, дубль невозможен. Никакой навигации на detail.
        toast('Нет сети — чек поставлен в очередь и отправится автоматически', { icon: '📡', duration: 5000 });
        navigate('/checks');
        return;
      }
      // Чек создан — следующий сабмит это уже НОВЫЙ логический чек.
      clientRequestIdRef.current = null;
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast.success('Чек успешно создан');
      navigate(`/checks/${res.data.id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      if (err?.code === 'ERR_NETWORK' || !err?.response) {
        toast.error('Сервер недоступен. Проверьте подключение.');
      } else if (err?.response?.status === 403) {
        toast.error(msg || 'Нет прав для создания чека');
      } else {
        toast.error(msg || 'Ошибка при создании чека');
      }
    },
  });

  // Update mutation (edit mode)
  const updateMutation = useMutation({
    mutationFn: (data: any) => checksApi.update(editCheckId!, data),
    onSuccess: (res: any) => {
      if (isQueuedOffline(res)) {
        toast('Нет сети — изменения поставлены в очередь и отправятся автоматически', { icon: '📡', duration: 5000 });
        navigate(`/checks/${editCheckId}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['check', editCheckId] });
      MONEY_STOCK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      toast.success('Чек обновлён');
      navigate(`/checks/${editCheckId}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      if (err?.code === 'ERR_NETWORK' || !err?.response) {
        toast.error('Сервер недоступен. Проверьте подключение.');
      } else if (err?.response?.status === 403) {
        toast.error(msg || 'Нет прав для редактирования чека');
      } else {
        toast.error(msg || 'Ошибка при обновлении чека');
      }
    },
  });

  // «Сменить владельца» (feature #9): reassign the currently-selected car AND
  // its full history to another client via transferOwner, then re-point this
  // (unsaved) check's client to the new owner in local state.
  const reassignMutation = useMutation({
    mutationFn: async (target: Client) => {
      const prevOwnerId = selectedClient?.id;
      const res = await carsApi.transferOwner(selectedCarId, { clientId: target.id });
      const fresh = await clientsApi.getById(target.id);
      return { freshOwner: fresh.data as Client, prevOwnerId, movedChecks: res.data?.movedChecks ?? 0 };
    },
    onSuccess: ({ freshOwner, prevOwnerId, movedChecks }) => {
      setSelectedClient(freshOwner);
      if (prevOwnerId) queryClient.invalidateQueries({ queryKey: ['clients', prevOwnerId] });
      queryClient.invalidateQueries({ queryKey: ['clients', freshOwner.id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['active-warranties'] });
      toast.success(
        movedChecks > 0 ? `Владелец изменён — перенесено чеков: ${movedChecks}` : 'Владелец автомобиля изменён',
      );
      closeReassignModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg || 'Не удалось сменить владельца');
    },
  });

  const openReassignModal = () => {
    setReassignTarget(null);
    setReassignOpen(true);
  };

  const closeReassignModal = () => {
    setReassignOpen(false);
    setReassignTarget(null);
  };

  const confirmReassign = () => {
    if (!reassignTarget) return;
    reassignMutation.mutate(reassignTarget);
  };

  // Computed totals
  const serviceTotal = useMemo(
    () => serviceLines.reduce((sum, line) => sum + serviceLineTotal(line), 0),
    [serviceLines],
  );
  const productTotal = useMemo(
    () => productLines.reduce((sum, line) => sum + line.sellPrice * line.quantity, 0),
    [productLines],
  );
  const totalRevenue = useMemo(() => {
    const discountedProducts = Math.max(productTotal - discount, 0);
    return serviceTotal + discountedProducts;
  }, [serviceTotal, productTotal, discount]);

  // Round 13 #1: применённая часть скидки (семантика «только на товары» —
  // решение владельца, НЕ меняем).
  const appliedDiscount = Math.min(discount, productTotal);

  // Change calculation for cash payment
  const changeAmount = useMemo(() => {
    if (paymentMethod === 'cash') return Math.max(cashGiven - totalRevenue, 0);
    return 0;
  }, [cashGiven, totalRevenue, paymentMethod]);

  // Auto-sync cash/card amounts for mixed payment
  useEffect(() => {
    if (paymentMethod === 'cash') {
      setCashAmount(totalRevenue);
      setCardAmount(0);
    } else if (paymentMethod === 'card') {
      setCashAmount(0);
      setCardAmount(totalRevenue);
    }
  }, [paymentMethod, totalRevenue]);

  // ── Строки выдачи поиска ───────────────────────────────────────────────
  // Клиент с машинами → строка на каждую машину (совпавшие по номеру —
  // первыми); клиент без машин → одна строка (чек без авто). Сверху — точное
  // совпадение по VIN (171).
  const searchRows = useMemo<SearchRow[]>(() => {
    const rows: SearchRow[] = [];
    if (vinHit) rows.push({ key: `vin-${vinHit.id}`, client: null, car: null, vinHit });
    if (!clientsData) return rows;
    const q = plateSearch.replace(/\s+/g, '').toLowerCase();
    const matched: SearchRow[] = [];
    const rest: SearchRow[] = [];
    for (const client of clientsData) {
      if (client.cars && client.cars.length > 0) {
        for (const car of client.cars) {
          if (vinHit && car.id === vinHit.id) continue;
          const row = { key: `${client.id}-${car.id}`, client, car };
          const plate = (car.plateNumber || '').replace(/\s+/g, '').toLowerCase();
          if (q && plate && plate.includes(q)) matched.push(row);
          else rest.push(row);
        }
      } else {
        rest.push({ key: `${client.id}-nocar`, client, car: null });
      }
    }
    return [...rows, ...matched, ...rest];
  }, [clientsData, plateSearch, vinHit]);

  useEffect(() => {
    setActiveRow(0);
  }, [plateSearch, searchRows.length]);

  // Закрытие выдачи по клику вне.
  useEffect(() => {
    if (!showPlateDropdown) return;
    const onDown = (e: PointerEvent) => {
      if (!searchWrapRef.current?.contains(e.target as Node)) setShowPlateDropdown(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showPlateDropdown]);

  // Client/Car selection via search
  const handleSelectPlateResult = (client: Client, car: Car | null) => {
    setSelectedClient(client);
    setSelectedCarId(car?.id ?? '');
    setPlateSearch(car?.plateNumber || client.fullName);
    setShowPlateDropdown(false);
  };

  // 171 — выбор результата по VIN: lookup отдаёт компактного клиента, а
  // карточке нужен полный (с cars[]) — дотягиваем как при смене владельца.
  const handleSelectVinHit = async (hit: CarLookupResult) => {
    if (!hit.clientId) {
      toast.error('У этого автомобиля нет владельца — привяжите его к клиенту в разделе «Автомобили»');
      return;
    }
    setPickingVin(true);
    try {
      const fresh = (await clientsApi.getById(hit.clientId)).data as Client;
      handleSelectPlateResult(fresh, fresh.cars?.find((c) => c.id === hit.id) ?? null);
      if (!fresh.cars?.some((c) => c.id === hit.id)) setSelectedCarId(hit.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Не удалось открыть клиента');
    } finally {
      setPickingVin(false);
    }
  };

  const selectRow = (row: SearchRow) => {
    if (row.vinHit) void handleSelectVinHit(row.vinHit);
    else if (row.client) handleSelectPlateResult(row.client, row.car);
  };

  const clearClient = () => {
    setPlateSearch('');
    setSelectedClient(null);
    setSelectedCarId('');
    plateInputRef.current?.focus();
  };

  // «Создать клиента» из пустой выдачи: что набрали — то и подставляем.
  const openCreateClientFromSearch = () => {
    const raw = plateSearch.trim();
    const digits = raw.replace(/\D/g, '');
    const mode: QuickDrawerMode = { kind: 'new-client' };
    if (searchIsVin) mode.initialVin = searchVin;
    else if (digits.length >= 10 && /^[\d\s()+-]+$/.test(raw)) mode.initialPhone = raw;
    else if (raw && looksLikeRussianPlate(raw)) mode.initialPlate = raw;
    setShowPlateDropdown(false);
    openQuickDrawer(mode);
  };

  const handleQuickDone = (client: Client, carId: string | null) => {
    setQuickDrawer(null);
    const car = client.cars?.find((c) => c.id === carId) ?? null;
    setSelectedClient(client);
    setSelectedCarId(car?.id ?? carId ?? '');
    setPlateSearch(car?.plateNumber || client.fullName);
    setShowPlateDropdown(false);
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showPlateDropdown || selectedClient) return;
    const total = searchRows.length + (plateSearch.trim() ? 1 : 0); // + «Создать клиента»
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveRow((a) => Math.min(a + 1, Math.max(total - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveRow((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeRow < searchRows.length && searchRows[activeRow]) {
        e.preventDefault();
        selectRow(searchRows[activeRow]);
      } else if (plateSearch.trim() && !clientsLoading) {
        e.preventDefault();
        openCreateClientFromSearch();
      }
    } else if (e.key === 'Escape') {
      setShowPlateDropdown(false);
    }
  };

  // Service line handlers — default masterId = current user
  const addServiceLine = () => {
    setServiceLines((prev) => [...prev, { serviceId: '', masterId: user?.id || '', name: '', price: 0 }]);
  };

  const updateServiceLine = (index: number, field: keyof ServiceLineForm, value: any) => {
    setServiceLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const updated = { ...line, [field]: value };
        if (field === 'serviceId') {
          const svc =
            selectableCatalogServices.find((service) => service.id === value) ??
            allServices?.find((service) => service.id === value);
          if (svc) {
            updated.name = svc.name;
            updated.price = svc.priceType === 'range' ? 0 : svc.defaultPrice;
            updated.priceConfirmed = svc.priceType !== 'range';
          }
        }
        return updated;
      }),
    );
  };

  const removeServiceLine = (index: number) => {
    setServiceLines((prev) => prev.filter((_, i) => i !== index));
  };

  // Product line handlers
  const handleProductSelected = useCallback(
    (product: Product) => {
      // If it's a bundle, add each component product
      if (product.isBundle && product.bundleItems && product.bundleItems.length > 0) {
        setProductLines((prev) => {
          let updated = [...prev];
          for (const bi of product.bundleItems!) {
            const matchProduct = (allProducts ?? []).find((p) => p.id === bi.productId);
            const existing = updated.findIndex((l) => l.productId === bi.productId);
            if (existing !== -1) {
              updated = updated.map((line, i) =>
                i === existing ? { ...line, quantity: roundQty(line.quantity + bi.quantity) } : line,
              );
            } else {
              updated.push({
                productId: bi.productId,
                name: bi.name,
                sellPrice: matchProduct?.sellPrice ?? 0,
                costPrice: matchProduct?.costPrice ?? 0,
                quantity: bi.quantity,
              });
            }
          }
          return updated;
        });
        toast.success(`Комплект «${product.name}» добавлен`);
        return;
      }

      setProductLines((prev) => {
        // 120: русские метки единиц ('шт'…) + legacy-коды ('pcs') — сравниваем
        // через unitLabel. Дробный шаг 0.5 — только у МЕРНЫХ единиц (м/кг/л).
        const step = METERED_UNITS.has(unitLabel(product.unit)) ? 0.5 : 1;
        const existing = prev.findIndex((l) => l.productId === product.id);
        if (existing !== -1) {
          return prev.map((line, i) => (i === existing ? { ...line, quantity: roundQty(line.quantity + step) } : line));
        }
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            sellPrice: product.sellPrice,
            costPrice: product.costPrice,
            quantity: step,
            unit: product.unit || DEFAULT_UNIT,
          },
        ];
      });
    },
    [allProducts],
  );

  const updateProductLine = (index: number, field: keyof ProductLineForm, value: any) => {
    setProductLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  };

  const removeProductLine = (index: number) => {
    setProductLines((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Шаблоны чеков ─────────────────────────────────────────────────────
  // Применение ЗАМЕЩАЕТ строки формы (semantics mobile applyTemplate).
  const applyTemplate = (template: CheckTemplate) => {
    setServiceLines(
      // Старый шаблон с «×2» раскладываем в две строки; неразвёрнутые (дробное количество, > 100) остаются legacy «×N».
      expandServiceQuantities(template.services).map((s) => ({
        ...toCheckTemplateServiceInput(s),
        serviceId: s.serviceId || '',
        masterId: user?.id || '',
        priceConfirmed: true,
        quantity: legacyQuantity(s),
      })),
    );
    setProductLines(
      template.products.map((p) => {
        const catalogProduct = (allProducts ?? []).find((ap) => ap.id === p.productId);
        return {
          productId: p.productId || '',
          name: p.name,
          sellPrice: p.sellPrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          unit: catalogProduct?.unit || DEFAULT_UNIT,
        };
      }),
    );
    setShowTemplatesPicker(false);
    toast.success(`Шаблон «${template.name}» применён`);
  };

  // В шаблон уходят только строки с catalog-id (как на mobile). Количества у услуг нет: legacy «×3»
  // из открытого старого чека раскладываем в три строки, иначе сервер сохранил бы её как одну.
  const templateServices = useMemo<CheckTemplateServiceInput[]>(
    () => expandServiceQuantities(serviceLines.filter((l) => !!l.serviceId)).map(toCheckTemplateServiceInput),
    [serviceLines],
  );
  const templateProducts = useMemo(
    () =>
      productLines
        .filter((l) => !!l.productId)
        .map((l) => ({
          productId: l.productId,
          name: l.name,
          sellPrice: Number(l.sellPrice),
          costPrice: Number(l.costPrice),
          quantity: Number(l.quantity),
        })),
    [productLines],
  );
  const canSaveTemplate = templateServices.length + templateProducts.length > 0;

  // Submit
  // doSubmit — фактическое проведение чека. handleSubmit (ниже) может
  // перехватить сабмит наджимом «забыли клиента» (Round 12 #7).
  const doSubmit = () => {
    if (
      missingReferencedServiceIds.length > 0 &&
      (referencedServicesQuery.isLoading || referencedServicesQuery.isError)
    ) {
      if (referencedServicesQuery.isError) void referencedServicesQuery.refetch();
      toast.error('Не удалось проверить цену сохранённых услуг. Повторите загрузку прайса.');
      return;
    }
    if (
      serviceLines.some((line) => {
        const service =
          selectableCatalogServices.find((candidate) => candidate.id === line.serviceId) ??
          allServices?.find((candidate) => candidate.id === line.serviceId) ??
          referencedServicesQuery.data?.find((candidate) => candidate.id === line.serviceId);
        return service
          ? !isServicePriceSelectionValid(service.priceType ?? 'fixed', line.price, !!line.priceConfirmed)
          : false;
      })
    ) {
      toast.error('Для услуги с диапазоном укажите цену в строке');
      return;
    }
    // Строка услуги = одна услуга: `quantity` не шлём. Исключение — legacy-строка старого чека (> 1):
    // её количество уходит как есть, иначе правка тихо пересчитала бы сумму чека.
    const services: CreateCheckRequest['services'] = serviceLines.map((l) => {
      const legacyQty = legacyQuantity(l);
      return {
        ...(l.id ? { id: l.id } : {}),
        serviceId: l.serviceId || undefined,
        masterId: l.masterId || undefined,
        name: l.name,
        price: Number(l.price),
        ...(legacyQty ? { quantity: legacyQty } : {}),
      };
    });

    const products: CheckProductLine[] = productLines.map((l) => ({
      productId: l.productId || undefined,
      name: l.name,
      sellPrice: Number(l.sellPrice),
      costPrice: Number(l.costPrice),
      quantity: Number(l.quantity),
      totalSell: Number(l.sellPrice) * Number(l.quantity),
      totalCost: Number(l.costPrice) * Number(l.quantity),
    }));

    let finalCash = 0;
    let finalCard = 0;
    if (paymentMethod === 'cash') {
      finalCash = totalRevenue;
    } else if (paymentMethod === 'card') {
      finalCard = totalRevenue;
    } else if (paymentMethod === 'cash_card') {
      // Кламп к «К оплате» (parity с mobile).
      finalCash = Math.min(cashAmount, totalRevenue);
      finalCard = Math.max(totalRevenue - finalCash, 0);
    } else if (paymentMethod === 'installment') {
      // Первый взнос (down payment) — наличными + картой; остаток уйдёт в план.
      finalCash = Math.min(installmentCash, totalRevenue);
      finalCard = Math.min(installmentCard, Math.max(totalRevenue - finalCash, 0));
    }

    const isInstallment = paymentMethod === 'installment';

    // Дата: шлём ТОЛЬКО когда пользователь её менял (dateTouched) и имеет право.
    let dateIso: string | undefined;
    if (dateTouched && canEditDate && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d] = date.split('-').map(Number);
      const timeSource = isEditMode && existingCheck?.date ? new Date(existingCheck.date) : new Date();
      dateIso = new Date(
        y,
        m - 1,
        d,
        timeSource.getHours(),
        timeSource.getMinutes(),
        timeSource.getSeconds(),
      ).toISOString();
    }

    const payload = {
      clientId: selectedClient?.id || '',
      carId: selectedCarId || '',
      // В edit-режиме top-level masterId = владелец чека, НЕ редактор: иначе
      // серверная защита от «кражи чека» (Round-7) принимает редактора за
      // самозванца и переписывает его строки услуг обратно на мастера чека.
      masterId: (isEditMode && existingCheck?.masterId) || user?.id || '',
      ...(dateIso ? { date: dateIso } : {}),
      mileage: mileage ? Number(mileage) : undefined,
      services,
      products,
      // Скидка действует только на товары — кламп выравнивает сохранённое с применённым.
      discount: Math.min(discount, productTotal),
      paymentMethod,
      cashAmount: finalCash,
      cardAmount: finalCard,
      comment: comment || undefined,
      // Метки (Round 12 #9). Create: поле уходит только при непустом выборе.
      // Edit: ВСЕГДА — снятие последней метки должно перезаписать связки пустым набором.
      ...(isEditMode
        ? { tagIds: selectedTags.map((t) => t.id) }
        : selectedTags.length > 0
          ? { tagIds: selectedTags.map((t) => t.id) }
          : {}),
      // Round 14 (конвейер): исполнители и место уходят ТОЛЬКО при включённом
      // режиме кассовой смены. Вне режима payload байт-в-байт прежний.
      ...(conveyorMode
        ? {
            ...(isEditMode || assigneeIds.length > 0 ? { assigneeIds } : {}),
            locationId: locationId || null,
          }
        : {}),
      // Рассрочка — всегда реальная продажа, отложить нельзя.
      isDeferred: isInstallment ? false : isDeferred,
      ...(isInstallment
        ? {
            installmentNextPaymentDate: installmentNextDate || undefined,
            installmentComment: installmentComment.trim() || undefined,
          }
        : {}),
    };

    if (isEditMode) {
      updateMutation.mutate(payload);
    } else {
      // Один id на логический сабмит: генерируется до первого POST и
      // переиспользуется при ретрае (в т.ч. при replay из SW-офлайн-очереди).
      if (!clientRequestIdRef.current) {
        clientRequestIdRef.current = generateClientRequestId();
      }
      createMutation.mutate({ ...payload, clientRequestId: clientRequestIdRef.current });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Round 12 #7: новый ЖИВОЙ чек без клиента (не правка, не отложенный) —
    // мягкое подтверждение перед пробитием, чтобы кассир не забыл привязку.
    if (!isEditMode && !isDeferred && !selectedClient) {
      setShowRetailPrompt(true);
      return;
    }
    doSubmit();
  };

  const itemCount = serviceLines.length + productLines.length;

  // Дата в шапке чека. Пока её не трогали руками и это НЕ правка — показываем
  // «сегодня» на момент рендера, а не значение, зафиксированное при
  // монтировании формы.
  const displayDate = dateTouched || isEditMode ? date : tenantToday;

  const requestLeave = () => {
    if (hasLines) setLeaveConfirmOpen(true);
    else navigate(-1);
  };

  const submitting = createMutation.isPending || updateMutation.isPending;
  const selectedCar = selectedClient?.cars?.find((c) => c.id === selectedCarId) ?? null;
  const selectedVin = vinEnabled ? carVin(selectedCar) : null;
  const clientsList = clientsData ?? [];
  const dropdownOpen = showPlateDropdown && plateSearch.trim().length > 0 && !selectedClient;
  const showCreateRow =
    dropdownOpen && !clientsLoading && !clientsError && (searchIsVin ? !vinLoading && !vinHit : true);
  const createRowIndex = searchRows.length;

  const paymentOptions = useMemo(() => {
    const opts: { value: PaymentMethodKey; label: string }[] = [
      { value: 'cash', label: 'Наличные' },
      { value: 'card', label: 'Карта' },
      { value: 'cash_card', label: 'Смешанная' },
      { value: 'warranty', label: 'Гарантия' },
    ];
    if (canOfferInstallment) opts.push({ value: 'installment', label: 'Рассрочка' });
    return opts;
  }, [canOfferInstallment]);

  const pageTitle = isEditMode ? (existingCheck ? `Правка чека №${existingCheck.number}` : 'Правка чека') : 'Касса';

  // Режим правки: до прихода чека — скелет, при 404/500 — ошибка с «Повторить»,
  // а не пустая форма (аудит 2.3: строки, добавленные во время загрузки,
  // затирались гидрацией).
  if (isEditMode && (existingLoading || existingError || !existingCheck)) {
    return (
      <div className="space-y-5">
        <PageHeader title="Правка чека" backTo={`/checks/${editCheckId}`} />
        <QueryState
          isLoading={existingLoading}
          isError={existingError || !existingCheck}
          onRetry={() => refetchExisting()}
          isFetching={existingFetching}
          errorTitle="Не удалось загрузить чек"
          loader={
            <div
              className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px]"
              aria-busy="true"
              aria-label="Загрузка чека"
            >
              <div className="space-y-5">
                <Skeleton className="h-40" />
                <Skeleton className="h-56" />
              </div>
              <Skeleton className="h-72" />
            </div>
          }
        >
          <></>
        </QueryState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={pageTitle}
        icon={Receipt}
        backTo={requestLeave}
        subtitle={`Заказ-наряд от ${format(new Date(displayDate + 'T00:00:00'), 'd MMMM yyyy', { locale: ruLocale })}${
          isDeferred && !cashierLocked ? ' · черновик' : ''
        }`}
        actions={
          <Button variant="secondary" icon={LayoutTemplate} onClick={() => setShowTemplatesPicker(true)}>
            Шаблоны
          </Button>
        }
      />

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start"
      >
        {/* ═══════════ Левая колонка: клиент, строки, детали ═══════════ */}
        <div className="min-w-0 space-y-5">
          {/* ── Клиент и автомобиль ── */}
          <Card padding="none">
            <CardHeader
              icon={UserRound}
              title="Клиент и автомобиль"
              subtitle={selectedClient ? undefined : 'Без клиента чек проводится как розничный'}
              dense
              divider={false}
              actions={
                selectedClient ? (
                  <IconButton label="Сбросить клиента" icon={X} size="sm" onClick={clearClient} />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={UserPlus}
                    onClick={() => openQuickDrawer({ kind: 'new-client' })}
                  >
                    Новый клиент
                  </Button>
                )
              }
            />
            <CardBody className="space-y-3 pt-0">
              {!selectedClient && (
                <div ref={searchWrapRef} className="relative">
                  <Input
                    ref={plateInputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={dropdownOpen}
                    aria-controls="client-search-list"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      dropdownOpen
                        ? activeRow < searchRows.length
                          ? `client-opt-${searchRows[activeRow]?.key}`
                          : showCreateRow
                            ? 'client-opt-create'
                            : undefined
                        : undefined
                    }
                    aria-label="Поиск клиента"
                    value={plateSearch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPlateSearch(val);
                      setShowPlateDropdown(true);
                      if (!val) {
                        setSelectedClient(null);
                        setSelectedCarId('');
                      }
                    }}
                    onFocus={() => setShowPlateDropdown(true)}
                    onKeyDown={onSearchKeyDown}
                    placeholder={vinEnabled ? 'Госномер, телефон, имя или VIN…' : 'Госномер, телефон или имя…'}
                    autoComplete="off"
                    spellCheck={false}
                    leftIcon={Search}
                    className="h-11 text-base"
                    rightSlot={
                      plateSearch ? (
                        <IconButton
                          label="Очистить поиск"
                          icon={X}
                          size="sm"
                          onClick={clearClient}
                          className="h-7 w-7"
                        />
                      ) : undefined
                    }
                  />

                  {dropdownOpen && (
                    <ul
                      id="client-search-list"
                      role="listbox"
                      aria-label="Найденные клиенты"
                      className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop motion-safe:animate-pop-in"
                    >
                      {searchIsVin && vinLoading && (
                        <li className="flex items-center gap-2 px-3 py-2 text-xs text-ink-3" role="presentation">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
                          Ищем автомобиль по VIN…
                        </li>
                      )}
                      {clientsLoading && searchRows.length === 0 ? (
                        <li
                          className="flex items-center justify-center gap-2 py-4 text-sm text-ink-3"
                          role="presentation"
                        >
                          <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                          Поиск…
                        </li>
                      ) : clientsError ? (
                        <li
                          className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-bad-text"
                          role="presentation"
                        >
                          Не удалось выполнить поиск
                          <Button variant="secondary" size="sm" onClick={() => refetchClients()}>
                            Повторить
                          </Button>
                        </li>
                      ) : (
                        <>
                          {searchRows.map((row, i) => {
                            const active = i === activeRow;
                            const hit = row.vinHit;
                            const name = hit ? hit.client?.fullName || 'Без владельца' : row.client?.fullName;
                            const phone = hit ? hit.client?.phone : row.client?.phone;
                            const plate = hit ? hit.plateNumber : row.car?.plateNumber;
                            const makeModel = hit ? hit.makeModel : row.car?.makeModel;
                            const rowVin = vinEnabled ? (hit ? hit.vin : carVin(row.car)) : null;
                            return (
                              // Мышь: клик выбирает; клавиатура ведётся из поля (aria-activedescendant).
                              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                              <li
                                key={row.key}
                                id={`client-opt-${row.key}`}
                                role="option"
                                aria-selected={active}
                                onMouseEnter={() => setActiveRow(i)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => selectRow(row)}
                                className={cn(
                                  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                                  active ? 'bg-surface-3' : 'hover:bg-surface-3',
                                )}
                              >
                                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-3 text-ink-3">
                                  {hit ? (
                                    <ScanLine className="h-4 w-4" aria-hidden="true" />
                                  ) : row.car ? (
                                    <CarIcon className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <UserRound className="h-4 w-4" aria-hidden="true" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className="truncate text-sm font-medium text-ink">{name}</span>
                                    {hit && (
                                      <Badge tone="accent" size="sm">
                                        Найдено по VIN
                                      </Badge>
                                    )}
                                  </span>
                                  <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3">
                                    {phone && <span>{formatPhone(phone)}</span>}
                                    {plate && <PlateBadge plate={plate} />}
                                    {makeModel && <span className="truncate">{makeModel}</span>}
                                    {!row.car && !hit && <span>без автомобиля</span>}
                                    {rowVin && <span className="font-mono">{formatVin(rowVin)}</span>}
                                  </span>
                                </span>
                                {pickingVin && hit && (
                                  <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
                                )}
                              </li>
                            );
                          })}
                          {searchRows.length === 0 && !clientsLoading && (
                            <li className="px-3 py-2 text-center text-sm text-ink-3" role="presentation">
                              {searchIsVin && !vinLoading ? 'Автомобиль с таким VIN не найден' : 'Ничего не найдено'}
                            </li>
                          )}
                          {showCreateRow && (
                            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                            <li
                              id="client-opt-create"
                              role="option"
                              aria-selected={activeRow === createRowIndex}
                              onMouseEnter={() => setActiveRow(createRowIndex)}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={openCreateClientFromSearch}
                              className={cn(
                                'mt-1 flex cursor-pointer items-center gap-3 rounded-lg border-t border-line px-3 py-2.5 text-sm font-medium text-accent-text transition-colors',
                                activeRow === createRowIndex ? 'bg-accent-soft' : 'hover:bg-accent-soft',
                              )}
                            >
                              <UserPlus className="h-4 w-4" aria-hidden="true" />
                              {searchIsVin ? 'Создать клиента с этим VIN' : 'Создать нового клиента'}
                            </li>
                          )}
                        </>
                      )}
                    </ul>
                  )}
                </div>
              )}

              {!selectedClient && !plateSearch && (
                <p className="text-xs text-ink-3">
                  Начните вводить госномер, телефон или имя — подставим клиента и его автомобиль
                  {clientsList.length > 0 ? '' : ''}.
                </p>
              )}

              {selectedClient && (
                <div className="rounded-lg border border-line bg-surface-2 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-ink">{selectedClient.fullName}</p>
                      {selectedClient.phone && (
                        <p className="mt-0.5 text-sm text-ink-3">{formatPhone(selectedClient.phone)}</p>
                      )}
                      <div className="mt-2">
                        <LastVisitBadge clientId={selectedClient.id} carId={selectedCarId || undefined} />
                      </div>
                    </div>
                    <div className="min-w-0 sm:w-64 sm:flex-shrink-0">
                      {selectedClient.cars && selectedClient.cars.length > 1 ? (
                        <Field label="Автомобиль" htmlFor="check-car">
                          <Select
                            id="check-car"
                            value={selectedCarId}
                            onChange={(e) => setSelectedCarId(e.target.value)}
                            options={selectedClient.cars.map((car) => ({
                              value: car.id,
                              label: `${car.plateNumber || 'Без номера'} — ${car.makeModel}`,
                            }))}
                          />
                        </Field>
                      ) : (
                        <p className="text-xs font-medium text-ink-3">Автомобиль</p>
                      )}
                      {selectedCar ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {selectedCar.plateNumber ? (
                            <PlateBadge plate={selectedCar.plateNumber} size="md" />
                          ) : (
                            <Badge>Без номера</Badge>
                          )}
                          <span className="truncate text-sm text-ink-2">{selectedCar.makeModel}</span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-sm text-ink-3">Не указан</p>
                      )}
                      {selectedVin && (
                        <div className="mt-1.5">
                          <VinText vin={selectedVin} withLabel copy size="sm" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Plus}
                      onClick={() => openQuickDrawer({ kind: 'add-car', client: selectedClient })}
                    >
                      Добавить авто
                    </Button>
                    {selectedCar && canReassignOwner && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Pencil}
                        onClick={() => openQuickDrawer({ kind: 'edit-car', client: selectedClient, car: selectedCar })}
                      >
                        Изменить авто
                      </Button>
                    )}
                    {canReassignOwner && selectedCarId && (
                      <Button variant="ghost" size="sm" icon={UserCheck} onClick={openReassignModal}>
                        Сменить владельца
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Действующие гарантии клиента/авто */}
              {warrantyEnabled && activeWarranties && activeWarranties.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-warn/30 bg-warn-soft">
                  <button
                    type="button"
                    onClick={() => setWarrantyExpanded((v) => !v)}
                    aria-expanded={warrantyExpanded}
                    className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left', focusRing)}
                  >
                    <ShieldCheck className="h-4 w-4 flex-shrink-0 text-warn" aria-hidden="true" />
                    <span className="flex-1 text-sm font-semibold text-warn-text">
                      Действующая гарантия — {activeWarranties.length}
                    </span>
                    <ChevronDownIcon
                      className={cn(
                        'h-4 w-4 text-warn transition-transform duration-150',
                        warrantyExpanded && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {warrantyExpanded && (
                    <ul className="divide-y divide-warn/20 border-t border-warn/30">
                      {activeWarranties.map((w) => (
                        <li key={w.id} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <Badge tone={w.kind === 'product' ? 'accent' : 'info'} size="sm">
                                {w.kind === 'product' ? 'Товар' : 'Услуга'}
                              </Badge>
                              <p className="truncate text-xs font-medium text-ink">{w.itemName || '—'}</p>
                            </div>
                            <p className="mt-0.5 text-2xs text-warn-text">
                              до {format(new Date(w.expiresAt), 'd MMM yyyy', { locale: ruLocale })}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {/* ── Услуги ── */}
          <Card padding="none">
            <CardHeader
              icon={Wrench}
              title="Услуги"
              dense
              actions={
                <>
                  {serviceLines.length > 0 && <Money value={serviceTotal} className="text-sm font-semibold text-ink" />}
                  {!isCatalogOwner && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={showAllCatalogServices ? EyeOff : Eye}
                      aria-pressed={showAllCatalogServices}
                      onClick={() => setShowAllCatalogServices((value) => !value)}
                    >
                      {showAllCatalogServices ? 'По роли' : 'Все услуги'}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Plus}
                    onClick={addServiceLine}
                    disabled={activeServicesLoading}
                  >
                    Добавить
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-2" padding="sm">
              {activeServicesError && (
                <p
                  role="alert"
                  className="flex items-center justify-between gap-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-text"
                >
                  Не удалось загрузить справочник услуг
                  <Button variant="secondary" size="sm" onClick={() => refetchActiveServices()}>
                    Повторить
                  </Button>
                </p>
              )}
              {serviceLines.length === 0 && !activeServicesLoading && !activeServicesError ? (
                <div className="py-4 text-center text-sm text-ink-3">
                  <p>
                    {!isCatalogOwner &&
                    !showAllCatalogServices &&
                    preferredServicesQuery.data &&
                    selectableCatalogServices.length === 0
                      ? 'Для вашей роли пока нет предпочтительных услуг'
                      : 'Услуг нет — добавьте первую'}
                  </p>
                  {!isCatalogOwner &&
                    !showAllCatalogServices &&
                    preferredServicesQuery.data &&
                    selectableCatalogServices.length === 0 && (
                      <Button
                        className="mt-2"
                        variant="secondary"
                        size="sm"
                        icon={Eye}
                        onClick={() => setShowAllCatalogServices(true)}
                      >
                        Показать все услуги
                      </Button>
                    )}
                </div>
              ) : (
                serviceLines.map((line, index) => {
                  // Количество есть только у legacy-строки старого чека («Мойка ×3»): чип рядом с названием
                  // и сумма строки справа. У обычной строки цена в поле и есть её сумма.
                  const legacyQty = legacyQuantity(line);
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-1 gap-2 rounded-lg border border-line bg-surface-2/60 p-2.5 sm:grid-cols-[minmax(0,1fr)_11rem_8.5rem_auto] sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <ServiceCombobox
                          className="min-w-0 flex-1"
                          services={selectableCatalogServices}
                          value={line.serviceId}
                          fallbackName={line.name}
                          onChange={(id) => updateServiceLine(index, 'serviceId', id)}
                          placeholder={activeServicesLoading ? 'Загружаем услуги…' : 'Найти услугу…'}
                        />
                        {legacyQty && (
                          <Badge
                            tone="neutral"
                            size="sm"
                            className="flex-shrink-0"
                            title="Старая строка чека с количеством: сумма строки не меняется"
                          >
                            ×{formatQty(legacyQty)}
                          </Badge>
                        )}
                      </div>
                      <Select
                        aria-label="Мастер"
                        placeholder="Мастер…"
                        value={line.masterId}
                        onChange={(e) => updateServiceLine(index, 'masterId', e.target.value)}
                        options={(masters ?? []).map((m) => ({ value: m.id, label: m.fullName }))}
                      />
                      <MoneyInput
                        aria-label="Цена услуги"
                        value={line.price}
                        onCommit={(n) => updateServiceLine(index, 'price', n)}
                        onEmpty={() => updateServiceLine(index, 'priceConfirmed', false)}
                        placeholder={(() => {
                          const service =
                            selectableCatalogServices.find((candidate) => candidate.id === line.serviceId) ??
                            allServices?.find((candidate) => candidate.id === line.serviceId);
                          return service?.priceType === 'range' && !line.priceConfirmed ? 'Укажите цену' : '0';
                        })()}
                      />
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        {legacyQty && (
                          <span className="text-xs tabular-nums text-ink-3">
                            = {formatMoney(serviceLineTotal(line))}
                          </span>
                        )}
                        <IconButton
                          label={`Удалить услугу${line.name ? ` «${line.name}»` : ''}`}
                          icon={Trash2}
                          size="sm"
                          variant="danger"
                          onClick={() => removeServiceLine(index)}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>

          {/* ── Товары ── */}
          <Card padding="none">
            <CardHeader
              icon={Package}
              title="Товары"
              dense
              actions={
                <>
                  {productLines.length > 0 && <Money value={productTotal} className="text-sm font-semibold text-ink" />}
                  <Button variant="secondary" size="sm" icon={Plus} onClick={() => setShowProductPicker(true)}>
                    Добавить
                  </Button>
                </>
              }
            />
            <CardBody className="space-y-2" padding="sm">
              {productLines.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-3">Товаров нет — выберите со склада</p>
              ) : (
                productLines.map((line, index) => (
                  <div
                    key={index}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2 sm:flex-nowrap"
                  >
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-sm font-medium text-ink">{line.name}</p>
                      <p className="text-xs tabular-nums text-ink-3">
                        {formatMoney(line.sellPrice)} / {unitLabel(line.unit)}
                      </p>
                    </div>
                    {/* 120: дробный ввод количества разрешён ВСЕГДА (0.5 м шланга), степперы ±1 рядом. */}
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <IconButton
                        label="Уменьшить количество"
                        icon={Minus}
                        size="sm"
                        variant="secondary"
                        disabled={line.quantity <= 1}
                        onClick={() => {
                          if (line.quantity > 1) updateProductLine(index, 'quantity', roundQty(line.quantity - 1));
                        }}
                      />
                      <QtyInput
                        value={line.quantity}
                        onCommit={(n) => updateProductLine(index, 'quantity', n)}
                        label={`Количество: ${line.name}`}
                      />
                      <IconButton
                        label="Увеличить количество"
                        icon={Plus}
                        size="sm"
                        variant="secondary"
                        onClick={() => updateProductLine(index, 'quantity', roundQty(line.quantity + 1))}
                      />
                    </div>
                    <Money
                      value={line.sellPrice * line.quantity}
                      className="w-24 flex-shrink-0 text-right text-sm font-semibold text-ink"
                    />
                    <IconButton
                      label={`Удалить товар «${line.name}»`}
                      icon={Trash2}
                      size="sm"
                      variant="danger"
                      onClick={() => removeProductLine(index)}
                    />
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          {/* ── Конвейер (Round 14): исполнители + место ── */}
          {conveyorMode && (
            <Card padding="none">
              <CardHeader
                icon={MapPin}
                title="Исполнители и место"
                subtitle="Заказ появится на доске каждого выбранного исполнителя"
                dense
              />
              <CardBody className="space-y-4" padding="sm">
                {(masters ?? []).length === 0 ? (
                  <p className="text-sm text-ink-3">Нет сотрудников для назначения</p>
                ) : (
                  <fieldset className="min-w-0 border-0 p-0">
                    <legend className="mb-2 text-sm font-medium text-ink-2">Исполнители</legend>
                    <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                      {(masters ?? []).map((m) => (
                        <Checkbox
                          key={m.id}
                          label={m.fullName}
                          checked={assigneeIds.includes(m.id)}
                          onChange={() => toggleAssignee(m.id)}
                          className="rounded-lg border border-line px-3 py-2"
                        />
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-ink-3">Без выбора — исполнители из строк услуг.</p>
                  </fieldset>
                )}

                <Field label="Место" htmlFor="check-location" hint="Например, «Бокс 2» или «возле задних ворот»">
                  <Select id="check-location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                    <option value="">Без места</option>
                    {activeLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                    {/* Выбранное, но архивное место (edit-гидрация) — не терять */}
                    {locationId && !activeLocations.some((l) => l.id === locationId) && (
                      <option value={locationId}>
                        {(locations ?? []).find((l) => l.id === locationId)?.name ?? 'Выбранное место'}
                      </option>
                    )}
                  </Select>
                </Field>
                {canManageLocations && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={newLocationName}
                      onChange={(e) => setNewLocationName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateLocation();
                        }
                      }}
                      maxLength={100}
                      size="sm"
                      aria-label="Новое место"
                      placeholder="Новое место…"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleCreateLocation}
                      disabled={!newLocationName.trim()}
                      loading={creatingLocation}
                    >
                      Добавить
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* ── Комментарий и метки ── */}
          <Card padding="none">
            <CardHeader icon={MessageSquare} title="Комментарий" dense divider={false} />
            <CardBody className="space-y-3 pt-0" padding="sm">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                aria-label="Комментарий к чеку"
                placeholder="Что важно помнить об этом заказе…"
              />

              {/* Метки (Round 12 #9): чипы выбранных + «Метка» → поповер. Цвет метки задаёт владелец. */}
              <div className="relative flex flex-wrap items-center gap-1.5">
                {selectedTags.map((tag) => {
                  const accent = tag.color || '#64748b';
                  return (
                    <span
                      key={tag.id}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium"
                      style={{ borderColor: accent, color: accent, backgroundColor: `${accent}14` }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: accent }}
                        aria-hidden="true"
                      />
                      {tag.name}
                      <button
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={cn(
                          '-mr-1 flex h-5 w-5 items-center justify-center rounded opacity-70 hover:opacity-100',
                          focusRing,
                        )}
                        aria-label={`Убрать метку ${tag.name}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Tag}
                  aria-expanded={showTagPopover}
                  onClick={() => setShowTagPopover((v) => !v)}
                  className="border border-dashed border-line-strong"
                >
                  Метка
                </Button>

                {showTagPopover && (
                  <>
                    <button
                      type="button"
                      aria-label="Закрыть выбор меток"
                      className="fixed inset-0 z-30 cursor-default"
                      onClick={() => setShowTagPopover(false)}
                    />
                    {/* Escape закрывает поповер из любого его контрола (chips, поле). */}
                    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
                    <div
                      role="dialog"
                      aria-label="Метки чека"
                      className="absolute left-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-pop motion-safe:animate-pop-in"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setShowTagPopover(false);
                      }}
                    >
                      {(allTags ?? []).length === 0 && (
                        <p className="mb-2 text-xs text-ink-3">
                          Меток пока нет. Создайте первую — в отчётах появится прибыль по ней.
                        </p>
                      )}
                      {(allTags ?? []).length > 0 && (
                        <div className="mb-2 flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                          {(allTags ?? []).map((tag) => {
                            const accent = tag.color || '#64748b';
                            const active = selectedTags.some((t) => t.id === tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => toggleTag(tag)}
                                className={cn(
                                  'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                                  focusRing,
                                  active ? '' : 'border-line bg-surface-2 text-ink-2 hover:bg-surface-3',
                                )}
                                style={
                                  active
                                    ? { borderColor: accent, color: accent, backgroundColor: `${accent}14` }
                                    : undefined
                                }
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: accent, opacity: active ? 1 : 0.55 }}
                                  aria-hidden="true"
                                />
                                {tag.name}
                                {active && <CheckIcon className="h-3 w-3" aria-hidden="true" />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCreateTag();
                            }
                          }}
                          maxLength={30}
                          size="sm"
                          aria-label="Новая метка"
                          placeholder="Новая метка…"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleCreateTag}
                          disabled={!newTagName.trim()}
                          loading={creatingTag}
                        >
                          Создать
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ═══════════ Правая колонка: параметры, итог, оплата, пробить ═══════════ */}
        <div className="min-w-0 space-y-5 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pb-1 xl:pr-0.5">
          {/* ── Дата и пробег ── */}
          <Card padding="sm">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Дата чека" htmlFor="check-date">
                {canEditDate ? (
                  <Input
                    id="check-date"
                    type="date"
                    value={displayDate}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setDateTouched(true);
                    }}
                  />
                ) : (
                  <p id="check-date" className="flex h-9 items-center gap-2 text-sm tabular-nums text-ink">
                    <CalendarDays className="h-4 w-4 text-ink-4" aria-hidden="true" />
                    {format(new Date(displayDate + 'T00:00:00'), 'dd.MM.yyyy')}
                  </p>
                )}
              </Field>
              <Field label="Пробег" htmlFor="check-mileage">
                <MoneyInput
                  id="check-mileage"
                  integer
                  suffix="км"
                  placeholder="0"
                  value={Number(mileage) || 0}
                  onCommit={(n) => setMileage(n > 0 ? String(n) : '')}
                  leftIcon={Gauge}
                />
              </Field>
            </div>
          </Card>

          {/* ── Итог ── */}
          <Card padding="none">
            <CardHeader
              title="Итог"
              dense
              divider={false}
              actions={isDeferred && !cashierLocked ? <Badge tone="warn">Черновик</Badge> : undefined}
            />
            <CardBody className="space-y-2.5 pt-0" padding="sm">
              <SummaryRow label={`Услуги (${serviceLines.length})`} value={formatMoney(serviceTotal)} />
              <SummaryRow label={`Товары (${productLines.length})`} value={formatMoney(productTotal)} />
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="check-discount" className="text-sm text-ink-3">
                  Скидка на товары
                </label>
                <MoneyInput
                  id="check-discount"
                  size="sm"
                  value={discount}
                  max={productTotal}
                  disabled={productTotal <= 0 && discount <= 0}
                  onCommit={(n) => setDiscount(Math.min(Math.max(n, 0), productTotal))}
                  className="w-32"
                />
              </div>
              {/* Round 13 #1: скидка больше суммы товаров молча резалась расчётом — предупреждаем явно. */}
              {discount > 0 && appliedDiscount < discount && (
                <p
                  role="status"
                  className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-text"
                >
                  {productTotal <= 0
                    ? 'Скидка не применена: в чеке нет товаров (скидка действует только на товары)'
                    : `Скидка применена частично: ${formatMoney(appliedDiscount)} из ${formatMoney(discount)} (товаров на ${formatMoney(productTotal)})`}
                </p>
              )}
              <SummaryRow
                label="Итого"
                value={formatMoney(totalRevenue)}
                strong
                className="border-t border-line pt-2.5"
              />
            </CardBody>
          </Card>

          {/* ── Оплата ── */}
          {cashierLocked ? (
            <Card padding="sm">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-warn-soft text-warn">
                  <Banknote className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Режим кассовой смены</p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    Оплату проводит кассир. Заказ-наряд будет создан как отложенный — оплату закроет сотрудник с правом
                    «Приём оплаты».
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <Card padding="none">
              <CardHeader title="Оплата" dense divider={false} />
              <CardBody className="space-y-4 pt-0" padding="sm">
                {/* Правка чека-рассрочки (Round 13 #9): способ оплаты менять нельзя (сервер вернёт 400). */}
                {!(isEditMode && paymentMethod === 'installment') && (
                  <RadioGroup<PaymentMethodKey>
                    aria-label="Способ оплаты"
                    orientation="horizontal"
                    value={paymentMethod as PaymentMethodKey}
                    onChange={setPaymentMethod}
                    options={paymentOptions}
                  />
                )}

                {paymentMethod === 'cash' && (
                  <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                    <Field
                      label="Получено от клиента"
                      htmlFor="check-cash-given"
                      hint="Необязательно — для подсчёта сдачи"
                    >
                      <MoneyInput id="check-cash-given" value={cashGiven} onCommit={setCashGiven} />
                    </Field>
                    {cashGiven > 0 && (
                      <div className="flex items-center justify-between border-t border-line pt-2">
                        <span className="text-sm font-medium text-ink-2">Сдача</span>
                        <Money
                          value={changeAmount}
                          className={cn('text-lg font-semibold', changeAmount > 0 ? 'text-ok-text' : 'text-ink')}
                        />
                      </div>
                    )}
                  </div>
                )}

                {paymentMethod === 'cash_card' && (
                  <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                    <Field label="Наличными" htmlFor="check-cash-part">
                      <MoneyInput id="check-cash-part" value={cashAmount} onCommit={setCashAmount} max={totalRevenue} />
                    </Field>
                    <div className="flex items-center justify-between border-t border-line pt-2">
                      <span className="flex items-center gap-2 text-sm font-medium text-ink-2">
                        <CreditCard className="h-4 w-4 text-ink-4" aria-hidden="true" />
                        Картой
                      </span>
                      <Money
                        value={Math.max(totalRevenue - cashAmount, 0)}
                        className="text-lg font-semibold text-ink"
                      />
                    </div>
                  </div>
                )}

                {/* Правка чека-рассрочки: взнос и график здесь не редактируются. */}
                {paymentMethod === 'installment' && isEditMode && (
                  <div className="space-y-2 rounded-lg border border-info/30 bg-info-soft p-3">
                    <p className="flex items-start gap-2 text-sm font-medium text-info-text">
                      <CalendarDays className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      Заказ-наряд оформлен в рассрочку. Платежи и график — в разделе «Рассрочка».
                    </p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink-2">Первый взнос</span>
                      <Money value={installmentCash + installmentCard} className="font-semibold text-ink" />
                    </div>
                    <p className="text-xs text-info-text">
                      Долг пересчитается автоматически: новый итог − уже внесённые платежи.
                    </p>
                  </div>
                )}

                {paymentMethod === 'installment' && !isEditMode && (
                  <div className="space-y-3 rounded-lg bg-surface-2 p-3">
                    <p className="text-sm font-medium text-ink">Первый взнос</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Наличными" htmlFor="inst-cash">
                        <MoneyInput
                          id="inst-cash"
                          value={installmentCash}
                          onCommit={setInstallmentCash}
                          max={totalRevenue}
                        />
                      </Field>
                      <Field label="Картой" htmlFor="inst-card">
                        <MoneyInput
                          id="inst-card"
                          value={installmentCard}
                          onCommit={setInstallmentCard}
                          max={totalRevenue}
                        />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between border-t border-line pt-2">
                      <span className="text-sm font-medium text-ink-2">Остаток в рассрочку</span>
                      <Money
                        value={Math.max(totalRevenue - installmentCash - installmentCard, 0)}
                        className="text-lg font-semibold text-info-text"
                      />
                    </div>
                    <Field label="Дата следующего платежа" htmlFor="inst-date">
                      <Input
                        id="inst-date"
                        type="date"
                        value={installmentNextDate}
                        onChange={(e) => setInstallmentNextDate(e.target.value)}
                      />
                    </Field>
                    <Field label="Комментарий" htmlFor="inst-comment" hint="Условия рассрочки, необязательно">
                      <Input
                        id="inst-comment"
                        value={installmentComment}
                        onChange={(e) => setInstallmentComment(e.target.value)}
                      />
                    </Field>
                  </div>
                )}

                {paymentMethod !== 'installment' && (
                  <Checkbox
                    label="Отложить чек"
                    description="Сохранить как черновик и продолжить позже. Смену нельзя закрыть с отложенными чеками."
                    checked={isDeferred}
                    onChange={(e) => setIsDeferred(e.target.checked)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5',
                      isDeferred ? 'border-warn/40 bg-warn-soft' : 'border-line',
                    )}
                  />
                )}
              </CardBody>
            </Card>
          )}

          {/* ── Пробить ── липнет к низу правой колонки на десктопе: главная
              кнопка видна и на 1280×800, пока оплата прокручивается под ней. */}
          <div className="space-y-2 xl:sticky xl:bottom-0 xl:bg-canvas xl:pb-1 xl:pt-3">
            <Button
              type="submit"
              size="lg"
              fullWidth
              icon={Receipt}
              loading={submitting}
              disabled={!isDeferred && itemCount === 0}
            >
              {isEditMode ? (
                isDeferred ? (
                  'Сохранить чек'
                ) : (
                  <>
                    Сохранить — <Money value={totalRevenue} />
                  </>
                )
              ) : isDeferred ? (
                'Отложить чек'
              ) : (
                <>
                  Пробить чек — <Money value={totalRevenue} />
                </>
              )}
            </Button>
            {!isDeferred && itemCount === 0 && (
              <p className="text-center text-xs text-ink-3">Добавьте хотя бы одну услугу или товар</p>
            )}
            <div className="flex items-center justify-between gap-2">
              {canSaveTemplate ? (
                <Button variant="ghost" size="sm" icon={BookmarkPlus} onClick={() => setShowSaveTemplate(true)}>
                  Сохранить как шаблон
                </Button>
              ) : (
                <span />
              )}
              <Button variant="ghost" size="sm" onClick={requestLeave}>
                Отмена
              </Button>
            </div>
          </div>
        </div>
      </form>

      {/* Пикер товаров — боковая панель (Escape, возврат фокуса, поиск, папки) */}
      <ProductPickerDrawer
        open={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        products={pickerProducts}
        isLoading={productsLoading}
        isError={productsError && !allProducts}
        onRetry={() => refetchProducts()}
        onSelectProduct={handleProductSelected}
        warehouses={warehouses}
        selectedWarehouseId={pickerWarehouseId}
        onSelectWarehouse={setPickerWarehouseId}
      />

      {/* Быстрое создание клиента / авто */}
      <ClientCarQuickDrawer
        key={quickDrawerSeq}
        open={!!quickDrawer}
        mode={quickDrawer}
        vinEnabled={vinEnabled}
        onClose={() => setQuickDrawer(null)}
        onDone={handleQuickDone}
      />

      {/* Шаблоны чеков: выбор + управление и «Сохранить как шаблон» */}
      <TemplatePickerModal
        isOpen={showTemplatesPicker}
        onClose={() => setShowTemplatesPicker(false)}
        onApply={applyTemplate}
      />
      <SaveTemplateModal
        isOpen={showSaveTemplate}
        onClose={() => setShowSaveTemplate(false)}
        services={templateServices}
        products={templateProducts}
      />

      {/* «Сменить владельца» (feature #9) */}
      <Modal
        isOpen={reassignOpen}
        onClose={closeReassignModal}
        title="Сменить владельца"
        description="Авто и вся его история (чеки, долги, бонусы) перейдут новому владельцу. Текущий несохранённый чек будет переоформлен на него."
        footer={
          <>
            <Button variant="secondary" onClick={closeReassignModal} disabled={reassignMutation.isPending}>
              Отмена
            </Button>
            <Button onClick={confirmReassign} disabled={!reassignTarget} loading={reassignMutation.isPending}>
              Сменить владельца
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {selectedCar && (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
              {selectedCar.plateNumber ? (
                <PlateBadge plate={selectedCar.plateNumber} size="md" />
              ) : (
                <Badge>Без номера</Badge>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{selectedCar.makeModel}</p>
                {selectedClient && <p className="text-xs text-ink-3">Владелец: {selectedClient.fullName}</p>}
              </div>
            </div>
          )}
          <Field label="Новый владелец">
            <ClientSearchAutocomplete
              selectedClient={reassignTarget}
              onSelect={setReassignTarget}
              excludeClientId={selectedClient?.id}
            />
          </Field>
        </div>
      </Modal>

      {/* Round 12 #7: подтверждение пробития без клиента */}
      <Modal
        isOpen={showRetailPrompt}
        onClose={() => setShowRetailPrompt(false)}
        title="Возможно, вы забыли добавить клиента"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowRetailPrompt(false)}>
              Вернуться
            </Button>
            <Button
              onClick={() => {
                setShowRetailPrompt(false);
                doSubmit();
              }}
            >
              Пробить как розничный
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          Чек будет проведён как розничный, без привязки к клиенту — история визитов и гарантия не сохранятся.
        </p>
      </Modal>

      <ConfirmDialog
        isOpen={leaveConfirmOpen}
        onClose={() => setLeaveConfirmOpen(false)}
        onConfirm={() => navigate(-1)}
        title="Уйти без сохранения?"
        message="В чеке уже есть строки. Если уйти сейчас, они пропадут."
        confirmText="Уйти"
        variant="danger"
      />
    </div>
  );
}
