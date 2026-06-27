import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { uploadsApi, authApi, subscriptionApi, knowledgeApi, bookingsApi } from '../api/services';
import { countUpcoming } from './bookings/bookingHelpers';
import type { Booking } from '../../../shared/types';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, softTint } from '../theme';
import { iosCard, iosSectionLabel, useShadow } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { UserPermissions, SubscriptionInfo, SectionVisibility } from '../../../shared/types';
import { ALL_ITEM_KEYS } from '../../../shared/types';

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

interface MenuItem {
  label: string;
  description: string;
  screen: string;
  /**
   * 073 — granular per-employee visibility key. Matches one entry in
   * `ITEM_KEYS` (shared/types) and the owner's per-item toggle in UsersScreen.
   * A hidden item ({ isVisible: false }) drops THIS row from the user's menu,
   * even when its parent group stays visible.
   */
  itemKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission?: keyof UserPermissions;
  roles?: string[];
  featureKey?: string;
  iconBg: string;
  iconColor: string;
}

interface MenuSection {
  title: string;
  /**
   * 071 — logical section bucket. The owner toggles visibility per employee by
   * this key (work|finance|warehouse|marketing|other); a hidden section drops
   * the whole group AND its items from this user's «Ещё» menu.
   */
  sectionKey: SectionVisibility['sectionKey'];
  items: MenuItem[];
}

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
    sectionKey: 'work',
    items: [
      {
        // Записи — внутренний инструмент персонала: запись клиента на дату/
        // время → «приход» открывает кассу. Гейт: право bookings_access
        // (мастер/админ) + section/item-visibility. Сервер закрывает API.
        label: 'Записи',
        description: 'Запись клиентов на дату и время',
        screen: 'Bookings',
        itemKey: 'bookings',
        permission: 'bookings_access',
        icon: 'time-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        label: 'Расписание',
        description: 'График работы и смены',
        screen: 'Schedule',
        itemKey: 'schedule',
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
        itemKey: 'clients',
        permission: 'clients_view',
        featureKey: 'clients_view',
        icon: 'people-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        // Родительский пункт назван шире, чем внутренняя группа «База знаний»,
        // чтобы имя не дублировалось: экран содержит три группы — Учебный
        // центр, Регламенты и База знаний (статьи).
        label: 'Обучение и база знаний',
        description: 'Курсы, регламенты и статьи',
        screen: 'KnowledgeBase',
        itemKey: 'knowledge-base',
        icon: 'book-outline',
        iconBg: colors.cyan[50],
        iconColor: colors.cyan[600],
      },
    ],
  },
  {
    title: 'Финансы',
    sectionKey: 'finance',
    items: [
      {
        label: 'Движение денег',
        description: 'Поступления и выдачи по дням',
        screen: 'CashFlow',
        itemKey: 'cashflow',
        featureKey: 'cashflow_view',
        icon: 'swap-horizontal-outline',
        iconBg: colors.teal[50],
        iconColor: colors.teal[600],
      },
      {
        // Рассрочка — продажи в кредит и платежи по ним (backend installments/,
        // 093). Заменяет прежний пункт «Должники / дебиторка». Просмотр списка
        // открыт любому сотруднику; приём платежей / погашение / напоминания —
        // owner-class и закрыты на сервере. Переиспользуем item-key 'cashflow'
        // — той же финансовой видимостью владелец управляет и «Движением денег»
        // (новый ключ сломал бы ITEM_KEYS drift-guard).
        label: 'Рассрочка',
        description: 'Продажи в рассрочку и платежи',
        screen: 'Installments',
        itemKey: 'cashflow',
        icon: 'card-outline',
        iconBg: colors.amber[50],
        iconColor: colors.amber[600],
      },
      {
        // Кассовая смена / Z-отчёт / Инкассация. Owner-class tool (open/close/
        // collect role-gated to director/admin/superadmin AND server-enforced);
        // viewing the live Z-report is open to any tenant user who reaches it.
        // Reuses the 'cashflow' item-key so the owner's per-employee finance
        // visibility toggle governs it consistently with «Движение денег».
        label: 'Кассовая смена',
        description: 'Z-отчёт, инкассация, сверка кассы',
        screen: 'CashShift',
        itemKey: 'cashflow',
        roles: ['director', 'admin', 'superadmin'],
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
        itemKey: 'salary',
        featureKey: 'salary_view',
        icon: 'wallet-outline',
        iconBg: colors.green[50],
        iconColor: colors.green[600],
      },
      {
        label: 'Расходы',
        description: 'Аренда, маркетинг и др.',
        screen: 'Expenses',
        itemKey: 'expenses',
        roles: ['director', 'superadmin'],
        icon: 'trending-down-outline',
        iconBg: colors.rose[50],
        iconColor: colors.rose[600],
      },
      {
        label: 'Финансовые отчёты',
        description: 'Прибыль, маржа, средний чек',
        screen: 'Reports',
        itemKey: 'reports',
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
    sectionKey: 'warehouse',
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
        itemKey: 'services',
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
        itemKey: 'suppliers',
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
        itemKey: 'equipment',
        icon: 'construct-outline',
        iconBg: colors.emerald[50],
        iconColor: colors.emerald[700],
      },
      {
        label: 'Складская аналитика',
        description: 'Остатки, оборот, движение',
        screen: 'WarehouseAnalytics',
        itemKey: 'warehouse-analytics',
        icon: 'analytics-outline',
        iconBg: colors.teal[50],
        iconColor: colors.teal[600],
      },
    ],
  },
  {
    title: 'Маркетинг',
    sectionKey: 'marketing',
    items: [
      {
        label: 'Отзывы и репутация',
        description: 'Сбор и публикация отзывов',
        screen: 'Marketing',
        itemKey: 'marketing',
        icon: 'star-outline',
        iconBg: colors.violet[50],
        iconColor: colors.violet[600],
      },
      {
        label: 'Звонки',
        description: 'Журнал звонков и записи',
        screen: 'Calls',
        itemKey: 'calls',
        roles: ['director', 'superadmin'],
        icon: 'call-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        label: 'Рассылки',
        description: 'SMS и push клиентам',
        screen: 'Mailings',
        itemKey: 'mailings',
        roles: ['director', 'superadmin'],
        icon: 'paper-plane-outline',
        iconBg: colors.purple[50],
        iconColor: colors.purple[600],
      },
      {
        label: 'Интеграции',
        description: 'Телефония, мессенджеры, CRM',
        screen: 'Integrations',
        itemKey: 'integrations',
        roles: ['director', 'superadmin'],
        // `git-network-outline` resolved to Circle in our Lucide shim
        // (owner saw a blank dot). `extension-puzzle-outline` maps to
        // Lucide's Puzzle which renders properly.
        icon: 'extension-puzzle-outline',
        iconBg: colors.slate[100],
        iconColor: colors.slate[600],
      },
    ],
  },
  {
    title: 'Остальное',
    sectionKey: 'other',
    items: [
      {
        label: 'Сотрудники',
        description: 'Карточки персонала, статус, рейтинги',
        screen: 'Employees',
        itemKey: 'employees',
        icon: 'people-circle-outline',
        iconBg: colors.cyan[50],
        iconColor: colors.cyan[600],
      },
      {
        label: 'Пользователи',
        description: 'Управление доступом',
        screen: 'Users',
        itemKey: 'users',
        permission: 'user_management',
        featureKey: 'users_manage',
        roles: ['director', 'superadmin'],
        icon: 'shield-outline',
        iconBg: colors.indigo[50],
        iconColor: colors.indigo[600],
      },
      {
        // Notifications moved to the bell button in the profile header
        // (top-right of MoreScreen) — every user manages their own
        // notifications, so it's a primary header action rather than a
        // buried menu row. Route stays registered in MoreStack.
        label: 'Настройки компании',
        description: 'Реквизиты и данные для чеков',
        screen: 'CompanySettings',
        itemKey: 'company-settings',
        roles: ['director', 'superadmin'],
        icon: 'business-outline',
        iconBg: colors.slate[100],
        iconColor: colors.slate[600],
      },
      {
        // Приём оплат (эквайринг ЮKassa/Тинькофф) + онлайн-касса 54-ФЗ (АТОЛ).
        // Company-level financial config — concept-adjacent to «Настройки
        // компании», so we reuse its item-key 'company-settings' (a new shared
        // item-key would break the ITEM_KEYS drift-guard). Distinct title so it
        // doesn't duplicate the marketing «Интеграции» row above. Owner-class:
        // role-filtered here AND the screen + backend self-gate.
        label: 'Приём оплат и касса',
        description: 'Эквайринг (карта/СБП) и онлайн-касса 54-ФЗ',
        screen: 'PaymentIntegrations',
        itemKey: 'company-settings',
        roles: ['director', 'admin', 'superadmin'],
        icon: 'receipt-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
      },
      {
        label: 'Подписка',
        description: 'Тариф и оплата',
        screen: 'Subscription',
        itemKey: 'subscription',
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

// Dev-time guard (#073): every menu row's `itemKey` must exist in the shared
// `ITEM_KEYS` contract, otherwise the owner's per-item toggle in UsersScreen
// and this row would silently drift apart (a toggle nobody reads, or a row no
// toggle controls). Stripped in production by the __DEV__ gate.
if (__DEV__) {
  const known = new Set(ALL_ITEM_KEYS);
  for (const section of menuSections) {
    for (const item of section.items) {
      if (!known.has(item.itemKey)) {
        console.warn(`[MoreScreen] itemKey "${item.itemKey}" (${item.screen}) is not in shared ITEM_KEYS`);
      }
    }
  }
}

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
  const { user, logout, hasPermission, refreshUser, isSectionVisible, isItemVisible } = useAuth();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const [uploading, setUploading] = useState(false);
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
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.roles && user?.role && !item.roles.includes(user.role)) return false;
    // 073 — granular per-item visibility override (additive to the group-level
    // isSectionVisible check the caller already applied). Owners keep their
    // protected items via isItemVisible's own guard.
    if (!isItemVisible(item.itemKey)) return false;
    return true;
  };

  const handleAvatarUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      setUploading(true);
      const uploadRes = await uploadsApi.upload(asset.uri, asset.fileName || 'avatar.jpg');
      await authApi.updateAvatar(uploadRes.data.url);
      await refreshUser();
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить аватарку');
    } finally {
      setUploading(false);
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
        {/* Identity card — compact iOS Settings-style profile cell */}
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
              <TouchableOpacity
                style={[
                  styles.avatarEditBtn,
                  shadow,
                  { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle },
                ]}
                onPress={handleAvatarUpload}
                disabled={uploading}
                hitSlop={6}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={palette.text.secondary} />
                ) : (
                  <Ionicons name="camera-outline" size={14} color={palette.text.secondary} />
                )}
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.userName, { color: palette.text.primary }]} numberOfLines={1}>
                {user?.fullName || 'User'}
              </Text>
              <View style={[styles.roleBadge, { backgroundColor: badgeColor.bg }]}>
                <Text style={[styles.roleText, { color: badgeColor.text }]}>{roleLabel}</Text>
              </View>
            </View>
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
          // 071 — owner-controlled per-employee section visibility. A hidden
          // section drops the entire group (and its items) for this user. Runs
          // BEFORE the per-item role/permission filter so the cheap check
          // short-circuits a wholly-hidden group.
          if (!isSectionVisible(section.sectionKey)) return null;
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
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3.5] },
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
  avatarEditBtn: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
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
});
