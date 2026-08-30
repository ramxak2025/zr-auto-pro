import React, { useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Animated, Alert, Platform, Linking } from 'react-native';
import CachedImage from '../components/CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { subscriptionApi, knowledgeApi, bookingsApi, pointsApi } from '../api/services';
import { countUpcoming } from './bookings/bookingHelpers';
import type { Booking } from '../../../shared/types';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, softTint } from '../theme';
import { iosCard, iosSectionLabel, useShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { UserPermissions, SubscriptionInfo, PointsListResponse } from '../../../shared/types';

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

// LIGHT-mode role badge — pale `[50]` fill + saturated text (unchanged look).
const roleBadgeColors: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[600] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

// Role → named badge hue. In DARK mode we resolve the badge through
// `getBadgeColors('dark')` (translucent glow + light-300 text) so the role
// chip reads cleanly on the dark card instead of as a washed pastel sticker.
const roleBadgeHue: Record<string, string> = {
  superadmin: 'red',
  director: 'purple',
  admin: 'blue',
  master: 'green',
};

// Legal documents — required for App Store / Google Play review. Hosted by the
// owner at autexa.pw; opened in the system browser via Linking.openURL.
const PRIVACY_URL = 'https://autexa.pw/privacy';
const TERMS_URL = 'https://autexa.pw/terms';

interface MenuItem {
  label: string;
  description: string;
  screen: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission?: keyof UserPermissions;
  roles?: string[];
  featureKey?: string;
  iconBg: string;
  iconColor: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

// ROLE-ONLY menu-hide (консолидация 2026-07): раздел без доступа СКРЫТ целиком
// (не «показан с замком»). Бэкенд теперь возвращает 403 и costPrice:0 — UI обязан
// это зеркалить: никаких мёртвых кнопок и «0 ₽ себестоимости».
// «Права как в Битрикс24» (2026-07): admin СНЯТ из owner-class на сервере —
// /auth/me отдаёт эффективные права из матрицы роли, поэтому здесь единый гейт
// hasPermission(key); строковый байпас остаётся ТОЛЬКО у superadmin/director
// (внутри самого hasPermission) и у пунктов вне матрицы («Подписка»).

// ─────────────────────────────────────────────────────────────────────────────
// Menu structure — owner-requested 5-group taxonomy (#17), iOS Settings-style.
//
//   • РАБОТА      — daily work: Schedule, Clients, Knowledge base (NEW stub).
//   • ФИНАНСЫ     — owner-facing money: CashFlow ("Движение денег"),
//                   Salary, Expenses, Reports ("Финансовые отчёты").
//   • СКЛАД       — warehouse-side ops: Suppliers, Equipment, Analytics.
//   • МАРКЕТИНГ   — outreach: Marketing (reviews), Calls, Mailings, Integrations.
//   • ОСТАЛЬНОЕ   — everything else: Employees, Users, Company, Subscription.
//   • АДМИН       — superadmin-only platform tools.
//
// "Корзина" (Trash) is intentionally NOT here — it already lives on the
// Склад (Products) screen; the Trash route stays registered in the
// navigator so in-app navigation from Products keeps working.
//
// Items keep their existing screen / icon / roles / permissions /
// featureKey gates so subscription paywalls and role visibility are
// unchanged. Order within each group is the order the owner asked for.
// ─────────────────────────────────────────────────────────────────────────────
const menuSections: MenuSection[] = [
  {
    title: 'Работа',
    items: [
      {
        // Записи — внутренний инструмент персонала: запись клиента на дату/
        // время → «приход» открывает кассу. Гейт: право bookings_access
        // (мастер/админ). Сервер закрывает API.
        label: 'Записи',
        description: 'Запись клиентов на дату и время',
        screen: 'Bookings',
        permission: 'bookings_access',
        icon: 'time-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        label: 'Расписание',
        description: 'График работы и смены',
        screen: 'Schedule',
        permission: 'schedule_view',
        featureKey: 'schedule_view',
        icon: 'calendar-outline',
        iconBg: colors.indigo[50],
        iconColor: colors.indigo[600],
      },
      {
        label: 'Клиенты',
        // Owner requested clients + cars in ONE section. The combined
        // Clients screen now hosts a "Клиенты / Авто" tab switcher, so
        // a separate "Авто" menu entry is intentionally gone.
        description: 'Клиенты, авто и история',
        screen: 'Clients',
        permission: 'clients_view',
        featureKey: 'clients_view',
        icon: 'people-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        // «База знаний» — единый раздел с тремя направлениями внутри: База
        // знаний (статьи + папки), Регламенты и Учебный центр. Имя совпадает с
        // заголовком экрана (владелец попросил убрать «Обучение и …»).
        label: 'База знаний',
        description: 'Статьи, регламенты и учебный центр',
        screen: 'KnowledgeBase',
        // Round 12: строка гейтится ключом матрицы knowledge_view (мигр. 137;
        // у системных ролей seed=true — поведение «видно всем» сохранено, но
        // владелец теперь может закрыть раздел через роль).
        permission: 'knowledge_view',
        icon: 'book-outline',
        iconBg: colors.cyan[50],
        iconColor: colors.cyan[600],
      },
      {
        // Шаблоны чеков (round 8 #3) — личные шаблоны с папками «под себя» +
        // общие (общие правит только owner-class, это гейтится внутри экрана И
        // на сервере). Round 12: гейт knowledge_view — шаблоны, как и база
        // знаний, «рабочие заготовки». Даже если роль прячет эту строку,
        // шаблоны в пикере Кассы остаются доступны.
        label: 'Шаблоны',
        description: 'Шаблоны чеков: услуги и товары',
        screen: 'Templates',
        permission: 'knowledge_view',
        icon: 'copy-outline',
        iconBg: colors.violet[50],
        iconColor: colors.violet[600],
      },
    ],
  },
  {
    title: 'Финансы',
    items: [
      {
        label: 'Движение денег',
        description: 'Поступления и выдачи по дням',
        screen: 'CashFlow',
        permission: 'cashflow_view',
        featureKey: 'cashflow_view',
        icon: 'swap-horizontal-outline',
        iconBg: colors.teal[50],
        iconColor: colors.teal[600],
      },
      {
        // Рассрочка — продажи в кредит и платежи по ним (backend installments/,
        // 093). Заменяет прежний пункт «Должники / дебиторка». Round 12: гейт
        // cashflow_view — финансовый раздел, видимость решает та же ячейка
        // матрицы роли, что и «Движение денег» (раньше строка была видна всем);
        // приём платежей / погашение / напоминания — owner-class и закрыты на
        // сервере.
        label: 'Рассрочка',
        description: 'Продажи в рассрочку и платежи',
        screen: 'Installments',
        permission: 'cashflow_view',
        icon: 'card-outline',
        iconBg: colors.amber[50],
        iconColor: colors.amber[600],
      },
      {
        // Кассовая смена / Z-отчёт / Инкассация. Owner-class tool (open/close/
        // collect role-gated to director/admin/superadmin AND server-enforced);
        // viewing the live Z-report is open to any tenant user who reaches it.
        label: 'Кассовая смена',
        description: 'Z-отчёт, инкассация, сверка кассы',
        screen: 'CashShift',
        permission: 'cash_shifts_manage',
        // Z-отчёт / сверка кассы → calculator (cash-register feel). Was
        // `file-tray-full-outline`, which had no Lucide twin and rendered a
        // meaningless Circle placeholder.
        icon: 'calculator-outline',
        iconBg: colors.green[50],
        iconColor: colors.green[600],
      },
      {
        label: 'Зарплата',
        description: 'Заработок мастеров',
        screen: 'Salary',
        permission: 'salary_view',
        featureKey: 'salary_view',
        icon: 'wallet-outline',
        iconBg: colors.green[50],
        iconColor: colors.green[600],
      },
      {
        // «Мотивация сотрудников» v1 — акционные товары (backend motivation/, 095).
        // Своя отдельная точка входа (НЕ внутри «Маркетинга»). Owner-class: roles
        // ограничены владельцем/директором; setPromo/clearPromo закрыты на сервере.
        label: 'Мотивация сотрудников',
        description: 'Акционные товары и бонусы за продажи',
        screen: 'Motivation',
        permission: 'motivation_manage',
        icon: 'gift-outline',
        iconBg: colors.emerald[50],
        iconColor: colors.green[600],
      },
      {
        label: 'Расходы',
        description: 'Аренда, маркетинг и др.',
        screen: 'Expenses',
        permission: 'can_add_expenses',
        icon: 'trending-down-outline',
        iconBg: colors.rose[50],
        iconColor: colors.rose[600],
      },
      {
        // «Постоянные расходы и мотивация» (v3.0.1 ФИЧА 1) — владельческий
        // конфиг: постоянные месячные расходы + мотивация не-сдельных
        // сотрудников. Питает НАЧИСЛЕННУЮ чистую прибыль на дашборде. Owner-only
        // (director/superadmin), API owner-class + financial_reports на сервере.
        label: 'Постоянные расходы',
        description: 'Аренда, оклады и мотивация — для прибыли',
        screen: 'Planning',
        permission: 'financial_reports',
        icon: 'repeat-outline',
        iconBg: colors.indigo[50],
        iconColor: colors.indigo[600],
      },
      {
        label: 'Финансовые отчёты',
        description: 'Прибыль, маржа, средний чек',
        screen: 'Reports',
        permission: 'financial_reports',
        featureKey: 'reports_view',
        icon: 'bar-chart-outline',
        iconBg: colors.purple[50],
        iconColor: colors.purple[700],
      },
    ],
  },
  {
    title: 'Склад',
    items: [
      {
        // Re-added after the menu regroup dropped it (#bugD). The route
        // `Services` stays registered & gated in AppNavigator; here we
        // restore its catalog-adjacent entry so it's reachable again on
        // iOS + Android. Keeps its `services_view` feature gate, matching
        // the route's `gated('services_view', ServicesScreen)`.
        label: 'Услуги',
        description: 'Каталог услуг и цены',
        screen: 'Services',
        permission: 'services_view',
        featureKey: 'services_view',
        icon: 'pricetags-outline',
        iconBg: colors.orange[50],
        iconColor: colors.orange[600],
      },
      {
        // Заказы поставщикам встроены ВНУТРЬ раздела «Поставщики» (сегмент-
        // переключатель «Поставщики | Заказы» в SuppliersScreen), поэтому
        // отдельного пункта меню «Заказы поставщикам» больше нет — он только
        // дублировал вход. Маршруты PurchaseOrders* остаются в MoreStack и
        // открываются из SuppliersScreen / SupplierDetailScreen.
        label: 'Поставщики',
        description: 'Поставщики, закупки и расчёты',
        screen: 'Suppliers',
        permission: 'suppliers_access',
        featureKey: 'suppliers_view',
        icon: 'cube-outline',
        iconBg: colors.amber[50],
        iconColor: colors.amber[600],
      },
      {
        label: 'Имущество',
        description: 'Инструменты и оборудование',
        screen: 'Equipment',
        permission: 'equipment_view',
        icon: 'construct-outline',
        iconBg: colors.emerald[50],
        iconColor: colors.emerald[700],
      },
      {
        label: 'Складская аналитика',
        description: 'Остатки, оборот, движение',
        screen: 'WarehouseAnalytics',
        permission: 'warehouse_analytics_view',
        icon: 'analytics-outline',
        iconBg: colors.teal[50],
        iconColor: colors.teal[600],
      },
    ],
  },
  {
    title: 'Маркетинг',
    items: [
      {
        // «Маркетинг» hub — one entry that opens a clean 4-direction screen
        // (Маркетинговые отчёты · Отзывы и репутация · Интеграции · Рассылки),
        // replacing the old jumble of four sibling rows. The owner-class
        // sub-sections (Интеграции / Рассылки) self-filter inside the hub by
        // role, so this row stays open exactly like the «Отзывы и репутация»
        // entry it supersedes. PaymentIntegrations (касса/эквайринг) now lives
        // INSIDE «Интеграции», so its old «Остальное» row was removed.
        label: 'Маркетинг',
        description: 'Отчёты, отзывы, интеграции и рассылки',
        screen: 'Marketing',
        permission: 'marketing_access',
        icon: 'megaphone-outline',
        iconBg: colors.violet[50],
        iconColor: colors.violet[600],
      },
      {
        // Звонки stay a direct row — a daily-use call journal (and a Dashboard
        // shortcut target), not a marketing setting that belongs in the hub.
        label: 'Звонки',
        description: 'Журнал звонков и записи',
        screen: 'Calls',
        permission: 'calls_view',
        icon: 'call-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
    ],
  },
  {
    title: 'Остальное',
    items: [
      {
        label: 'Сотрудники',
        description: 'Карточки персонала, статус, рейтинги',
        screen: 'Employees',
        permission: 'user_management',
        icon: 'people-circle-outline',
        iconBg: colors.cyan[50],
        iconColor: colors.cyan[600],
      },
      {
        label: 'Пользователи',
        description: 'Управление доступом',
        screen: 'Users',
        permission: 'user_management',
        featureKey: 'users_manage',
        icon: 'shield-outline',
        iconBg: colors.indigo[50],
        iconColor: colors.indigo[600],
      },
      {
        // Точки (156, мульти-точки) — назначение сотрудников на филиалы.
        // Дополнительно к permission-гейту скрыта при 0–1 живой точке (см.
        // filterItem — точка не входит в статичную роль-only модель выше).
        label: 'Точки',
        description: 'Автосервисы-филиалы и сотрудники',
        screen: 'Points',
        permission: 'user_management',
        icon: 'location-outline',
        iconBg: colors.orange[50],
        iconColor: colors.orange[600],
      },
      {
        // Notifications moved to the bell button in the profile header
        // (top-right of MoreScreen) — every user manages their own
        // notifications, so it's a primary header action rather than a
        // buried menu row. Route stays registered in MoreStack.
        label: 'Настройки компании',
        description: 'Реквизиты и данные для чеков',
        screen: 'CompanySettings',
        // GET/PATCH /my-company — сид «Администратора» company_manage=false
        // (сегодня admin исключён и на сервере) → пункт остаётся d/sa, пока
        // владелец не выдаст право явно.
        permission: 'company_manage',
        icon: 'business-outline',
        iconBg: colors.slate[100],
        iconColor: colors.slate[600],
      },
      {
        label: 'Подписка',
        description: 'Тариф и оплата',
        screen: 'Subscription',
        roles: ['director', 'superadmin'],
        icon: 'card-outline',
        iconBg: colors.primary[50],
        iconColor: colors.primary[600],
      },
    ],
  },
  // The «Админ» group was removed: superadmins now run a dedicated
  // platform-operator shell (AdminShellNavigator) and never reach the
  // car-service «Ещё» menu. Directors / masters never had the superadmin role,
  // so this entry was unreachable for them. See AppNavigator → MainShell.
];

interface MenuRowProps {
  item: MenuItem;
  onPress: () => void;
  locked: boolean;
  showDivider: boolean;
  /** Theme-resolved icon-tile background — pale `[50]` in light, translucent
   * accent glow in dark. Keeps the icon itself vivid (`item.iconColor`). */
  tileBg: string;
  labelColor: string;
  descColor: string;
  separatorColor: string;
  /** Tertiary tone for chevron / lock — theme-aware. */
  iconMutedColor: string;
  /** Card colour behind the badge — used as the cut-out ring so the dot
   * reads against the current surface (white in light, dark card in dark). */
  badgeRingColor: string;
  /** Optional attention count — renders a red dot/badge on the icon. */
  badgeCount?: number;
}

const MenuRow = React.memo(function MenuRow({
  item,
  onPress,
  locked,
  showDivider,
  tileBg,
  labelColor,
  descColor,
  separatorColor,
  iconMutedColor,
  badgeRingColor,
  badgeCount = 0,
}: MenuRowProps) {
  return (
    <>
      <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.55}>
        <View style={[styles.menuIcon, { backgroundColor: tileBg }]}>
          <Ionicons name={item.icon} size={20} color={locked ? iconMutedColor : item.iconColor} />
          {badgeCount > 0 && (
            <View style={[styles.menuBadge, { borderColor: badgeRingColor }]}>
              <Text style={styles.menuBadgeText}>{badgeCount > 9 ? '9+' : String(badgeCount)}</Text>
            </View>
          )}
        </View>
        <View style={styles.menuTextWrap}>
          <Text style={[styles.menuLabel, { color: locked ? iconMutedColor : labelColor }]} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={[styles.menuDesc, { color: descColor }]} numberOfLines={1}>
            {item.description}
          </Text>
        </View>
        {locked ? (
          <Ionicons name="lock-closed" size={14} color={iconMutedColor} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color={iconMutedColor} />
        )}
      </TouchableOpacity>
      {showDivider && <View style={[styles.separator, { backgroundColor: separatorColor }]} />}
    </>
  );
});

export default function MoreScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, hasPermission } = useAuth();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const roleLabel = user?.role ? roleLabels[user.role] || user.role : '';
  const userInitial = user?.fullName?.charAt(0) || 'U';
  // Role badge — byte-identical pale chip in light, translucent accent glow in
  // dark (resolved via the shared dark badge map).
  const roleKey = user?.role && roleBadgeColors[user.role] ? user.role : 'master';
  const badgeColor =
    palette.mode === 'dark'
      ? (getBadgeColors('dark')[roleBadgeHue[roleKey] ?? 'green'] ?? roleBadgeColors.master)
      : roleBadgeColors[roleKey];
  const avatarUrl = getImageUrl(user?.avatar);

  // Fetch subscription for feature gating
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Pending regulations → red-dot badge on «База знаний». Cheap, cached,
  // background-revalidated. Failure is silent (badge just won't show).
  const { data: pendingRegs } = useQuery<{ count: number }>({
    queryKey: ['knowledge-regulations-pending'],
    queryFn: async () => (await knowledgeApi.regulationsPendingCount()).data,
    staleTime: 60 * 1000,
  });
  const pendingRegsCount = pendingRegs?.count ?? 0;

  // Записи → бейдж предстоящих на пункте меню. Считаем по scope=upcoming
  // (то же, что показывает список). Только если есть право — иначе лишний
  // запрос. Ключ ['bookings','upcoming'] совпадает со списком (persistent
  // cache, мгновенно). Падение — тихое (бейдж просто не покажется).
  const canSeeBookings = hasPermission('bookings_access');
  const { data: upcomingBookings } = useQuery<Booking[]>({
    queryKey: ['bookings', 'upcoming'],
    queryFn: async () => (await bookingsApi.list({ scope: 'upcoming' })).data,
    enabled: canSeeBookings,
    staleTime: 60 * 1000,
  });
  const upcomingBookingsCount = countUpcoming(upcomingBookings);

  // 156 — мульти-точки: строка «Точки» видна только когда живых точек > 1
  // (0–1 = одноточечный режим, ничего нового не показываем). Дешёвый запрос,
  // тот же ключ ['points'], что и переключатель точки на дашборде.
  const canSeePoints = hasPermission('user_management');
  const { data: pointsData } = useQuery<PointsListResponse>({
    queryKey: ['points'],
    queryFn: async () => (await pointsApi.list()).data,
    enabled: canSeePoints,
    staleTime: 60 * 1000,
  });
  const pointsCount = pointsData?.points.length ?? 0;

  // Lock badges mirror FeatureGate exactly: gate on the server-resolved
  // `sub.features` (authoritative, keyed by planId) — NOT the fragile
  // plan-NAME match against sub.plans. Superadmin bypasses everything;
  // while the subscription is loading nothing is shown locked
  // (optimistic, same as FeatureGate never flashing a paywall).
  const isBypass = user?.role === 'superadmin';

  const isFeatureLocked = (featureKey?: string) => {
    if (!featureKey || isBypass || !sub) return false;
    return !(Array.isArray(sub.features) && sub.features.includes(featureKey));
  };

  const filterItem = (item: MenuItem): boolean => {
    // App Store Guideline 3.1.1/3.1.3(c): на iOS приложение — чисто внутренний
    // инструмент организации, никакой «покупаемой» подписки/тарифа в интерфейсе.
    // Пункт «Подписка» (Subscription) скрыт на iOS целиком; на Android остаётся.
    if (Platform.OS === 'ios' && item.screen === 'Subscription') return false;
    // ROLE-ONLY menu-hide: раздел без права СКРЫТ целиком (не «с замком»).
    // Матрица роли АВТОРИТЕТНА: /auth/me отдаёт эффективные права, admin живёт
    // по ним; superadmin/director байпасятся внутри самого hasPermission.
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.roles && user?.role && !item.roles.includes(user.role)) return false;
    // 156 — «Точки» дополнительно скрыта при 0–1 живой точке.
    if (item.screen === 'Points' && pointsCount <= 1) return false;
    return true;
  };

  // Open a legal document (privacy / terms) in the system browser. Failure is
  // surfaced gently — the link just couldn't be opened.
  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Не удалось открыть ссылку', url);
    }
  };

  // Entrance animation for user card
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardTranslate = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardFade, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(cardTranslate, { toValue: 0, friction: 9, tension: 50, useNativeDriver: true }),
    ]).start();
  }, [cardFade, cardTranslate]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas, paddingTop: insets.top + spacing[2] }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            // Android: contentInset is ignored; reserve bar space here.
            paddingBottom: Platform.OS === 'ios' ? spacing[4] : tabBarHeight + spacing[4],
          },
        ]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
      >
        {/* Identity card — iOS Settings-style profile cell. The avatar + name
            region is a tap target that opens «Мой профиль» (edit ФИО / телефон /
            аватар, смена пароля, owner approval queue, удалить аккаунт). The
            notifications bell stays a separate trailing action. */}
        <Animated.View
          style={[
            styles.userCard,
            shadow,
            {
              backgroundColor: palette.bg.card,
              borderColor: palette.border.subtle,
              opacity: cardFade,
              transform: [{ translateY: cardTranslate }],
            },
          ]}
        >
          <View style={styles.userRow}>
            <TouchableOpacity
              style={styles.identityPress}
              activeOpacity={0.6}
              onPress={() => {
                haptic('tap');
                navigation.navigate('Profile');
              }}
              accessibilityRole="button"
              accessibilityLabel="Мой профиль"
            >
              <View style={styles.avatarWrap}>
                {avatarUrl ? (
                  <CachedImage
                    source={{ uri: avatarUrl }}
                    style={[styles.avatarImage, { borderColor: palette.border.subtle }]}
                  />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: palette.accent.primarySoft }]}>
                    <Text style={[styles.avatarText, { color: palette.accent.primaryText }]}>{userInitial}</Text>
                  </View>
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.userName, { color: palette.text.primary }]} numberOfLines={1}>
                  {user?.fullName || 'User'}
                </Text>
                <View style={[styles.roleBadge, { backgroundColor: badgeColor.bg }]}>
                  <Text style={[styles.roleText, { color: badgeColor.text }]}>{roleLabel}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
            </TouchableOpacity>
            {/* Notifications — every user picks their own categories. */}
            <TouchableOpacity
              style={[styles.bellBtn, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}
              onPress={() => navigation.navigate('NotificationSettings')}
              activeOpacity={0.6}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Настройки уведомлений"
            >
              <Ionicons name="notifications-outline" size={20} color={palette.text.secondary} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Grouped sections — iOS Settings pattern */}
        {menuSections.map((section) => {
          // Round 12: видимость строк решает ТОЛЬКО матрица роли (hasPermission
          // в filterItem). Пустая группа схлопывается целиком.
          const visibleItems = section.items.filter(filterItem);
          if (visibleItems.length === 0) return null;

          return (
            <View key={section.title} style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                {section.title}
              </Text>
              <View
                style={[
                  styles.menuCard,
                  shadow,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                ]}
              >
                {visibleItems.map((item, idx) => (
                  <MenuRow
                    key={item.screen}
                    item={item}
                    locked={isFeatureLocked(item.featureKey)}
                    showDivider={idx < visibleItems.length - 1}
                    onPress={() => navigation.navigate(item.screen)}
                    tileBg={palette.mode === 'dark' ? softTint(item.iconColor, 'dark') : item.iconBg}
                    labelColor={palette.text.primary}
                    descColor={palette.text.secondary}
                    separatorColor={palette.border.subtle}
                    iconMutedColor={palette.text.tertiary}
                    badgeRingColor={palette.bg.card}
                    badgeCount={
                      item.screen === 'KnowledgeBase'
                        ? pendingRegsCount
                        : item.screen === 'Bookings'
                          ? upcomingBookingsCount
                          : 0
                    }
                  />
                ))}
              </View>
            </View>
          );
        })}

        {/* О приложении — legal documents (App Store / Google Play review). */}
        <View style={styles.section}>
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>О приложении</Text>
          <View
            style={[styles.menuCard, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <TouchableOpacity style={styles.legalRow} onPress={() => openLink(PRIVACY_URL)} activeOpacity={0.55}>
              <View
                style={[
                  styles.menuIcon,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.slate[500], 'dark') : colors.slate[100],
                  },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.slate[600]} />
              </View>
              <Text style={[styles.legalText, { color: palette.text.primary }]}>Политика конфиденциальности</Text>
              <Ionicons name="open-outline" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
            <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />
            <TouchableOpacity style={styles.legalRow} onPress={() => openLink(TERMS_URL)} activeOpacity={0.55}>
              <View
                style={[
                  styles.menuIcon,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.slate[500], 'dark') : colors.slate[100],
                  },
                ]}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.slate[600]} />
              </View>
              <Text style={[styles.legalText, { color: palette.text.primary }]}>Условия использования</Text>
              <Ionicons name="open-outline" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          onPress={() =>
            Alert.alert('Выйти из аккаунта?', 'Вы сможете снова войти по логину и паролю.', [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Выйти', style: 'destructive', onPress: () => logout() },
            ])
          }
          activeOpacity={0.7}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.red[600]} />
          <Text style={styles.logoutText}>Выйти из аккаунта</Text>
        </TouchableOpacity>

        {/* «Удалить аккаунт» moved to «Мой профиль» (the destructive action lives
            at the bottom of the profile screen, reached via the header above). */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[4] },

  // Identity card
  userCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  // Tap target spanning avatar + name + chevron → opens «Мой профиль».
  identityPress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3.5] },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: borderRadius['2xl'],
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
  },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.primary[700] },
  userName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900], letterSpacing: -0.2 },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  roleText: { fontSize: 11, fontWeight: fontWeight.semibold },

  // Notifications bell — premium iOS header action (≥44pt tappable).
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Section
  section: { gap: spacing[1.5] },
  sectionTitle: {
    marginLeft: spacing[3],
    marginBottom: spacing[1.5],
  },

  // Menu card — grouped cell container
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 56,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.gray[200],
    marginLeft: spacing[4] + 40 + spacing[3.5], // align under text (skip icon + gap)
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.red[500],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  menuBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
  menuTextWrap: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: 16, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.2 },
  menuDesc: { fontSize: 12, color: colors.gray[500], marginTop: 1 },

  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.gray[200],
    paddingVertical: spacing[3.5],
    minHeight: 52,
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  logoutText: { fontSize: 15, fontWeight: fontWeight.semibold, color: colors.red[600] },

  // Legal rows (Политика конфиденциальности / Условия использования)
  // (Удалить аккаунт moved to «Мой профиль».)
  legalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 56,
  },
  legalText: { flex: 1, fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
});
