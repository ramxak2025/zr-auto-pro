import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StackActions, CommonActions } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import PlatformTabBar from './TabBar';

// Screens
import LoginScreen from '../screens/LoginScreen';
import DashboardScreen from '../screens/DashboardScreen';
import ProductsScreen from '../screens/ProductsScreen';
import ProductDetailScreen from '../screens/ProductDetailScreen';
import InventoryScreen from '../screens/InventoryScreen';
import ChecksScreen from '../screens/ChecksScreen';
import CheckCreateScreen from '../screens/CheckCreateScreen';
import CheckDetailScreen from '../screens/CheckDetailScreen';
import WorkBoardScreen from '../screens/WorkBoardScreen';
import WorkBoardSettingsScreen from '../screens/WorkBoardSettingsScreen';
import ClientsScreen from '../screens/ClientsScreen';
import ClientDetailScreen from '../screens/ClientDetailScreen';
import CarDetailScreen from '../screens/CarDetailScreen';
import ServicesScreen from '../screens/ServicesScreen';
import SuppliersScreen from '../screens/SuppliersScreen';
import SupplierDetailScreen from '../screens/SupplierDetailScreen';
import PurchaseOrdersScreen from '../screens/PurchaseOrdersScreen';
import PurchaseOrderCreateScreen from '../screens/PurchaseOrderCreateScreen';
import PurchaseOrderDetailScreen from '../screens/PurchaseOrderDetailScreen';
import SalaryScreen from '../screens/SalaryScreen';
import MotivationScreen from '../screens/MotivationScreen';
import ReportsScreen from '../screens/ReportsScreen';
import CashFlowScreen from '../screens/CashFlowScreen';
import CashShiftScreen from '../screens/CashShiftScreen';
import InstallmentsScreen from '../screens/InstallmentsScreen';
import InstallmentDetailScreen from '../screens/InstallmentDetailScreen';
import InstallmentReminderSettingsScreen from '../screens/InstallmentReminderSettingsScreen';
import ExpensesScreen from '../screens/ExpensesScreen';
import UsersScreen from '../screens/UsersScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import MoreScreen from '../screens/MoreScreen';
import KnowledgeBaseScreen from '../screens/KnowledgeBaseScreen';
import KnowledgeCategoryScreen from '../screens/KnowledgeCategoryScreen';
import KnowledgeArticleScreen from '../screens/KnowledgeArticleScreen';
import KnowledgeEditorScreen from '../screens/KnowledgeEditorScreen';
import KnowledgeCourseListScreen from '../screens/KnowledgeCourseListScreen';
import KnowledgeCourseDetailScreen from '../screens/KnowledgeCourseDetailScreen';
import KnowledgeLessonScreen from '../screens/KnowledgeLessonScreen';
import KnowledgeCourseEditorScreen from '../screens/KnowledgeCourseEditorScreen';
import MarketingScreen from '../screens/MarketingScreen';
import MarketingReportsScreen from '../screens/MarketingReportsScreen';
import ReviewsReputationScreen from '../screens/ReviewsReputationScreen';
import WinbackScreen from '../screens/WinbackScreen';
import CarsScreen from '../screens/CarsScreen';
import CompanySettingsScreen from '../screens/CompanySettingsScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import CallsScreen from '../screens/CallsScreen';
import EquipmentScreen, { EquipmentEmployeeScreen } from '../screens/EquipmentScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import EmployeeDetailScreen from '../screens/EmployeeDetailScreen';
import DismissedEmployeesScreen from '../screens/DismissedEmployeesScreen';
import TrashScreen from '../screens/TrashScreen';
import MailingsScreen from '../screens/MailingsScreen';
import IntegrationsScreen from '../screens/IntegrationsScreen';
import PaymentIntegrationsScreen from '../screens/PaymentIntegrationsScreen';
import WarehouseAnalyticsScreen from '../screens/WarehouseAnalyticsScreen';
import BookingsScreen from '../screens/BookingsScreen';
import BookingDetailScreen from '../screens/BookingDetailScreen';
import BookingCreateScreen from '../screens/BookingCreateScreen';
import BookingSettingsScreen from '../screens/BookingSettingsScreen';
import LoadingSpinner from '../components/LoadingSpinner';
import { screenErrorBoundaryLayout } from '../components/ErrorBoundary';
import FeatureGate from '../components/FeatureGate';
import AdminShellNavigator from './AdminShellNavigator';
import ImpersonationBanner from '../components/ImpersonationBanner';
import { View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { Product } from '../../../shared/types';

// Feature descriptions for lock screens
const FEATURE_GATES: Record<string, { title: string; description: string; benefits: string[] }> = {
  schedule_view: {
    title: 'Расписание',
    description: 'Управляйте графиком работы мастеров и планируйте загрузку автосервиса',
    benefits: ['График работы мастеров', 'Планирование смен', 'Контроль загрузки'],
  },
  clients_view: {
    title: 'Клиенты',
    description: 'Ведите базу клиентов с историей обращений и автомобилей',
    benefits: ['База клиентов', 'История обращений', 'Привязка автомобилей'],
  },
  services_view: {
    title: 'Услуги',
    description: 'Каталог услуг с ценами для быстрого оформления заказ-нарядов',
    benefits: ['Каталог услуг', 'Быстрое добавление в чек', 'Гибкие цены'],
  },
  suppliers_view: {
    title: 'Поставщики',
    description: 'Управляйте закупками, поставками и долгами перед поставщиками',
    benefits: ['Учёт поставок и закупок', 'Контроль долгов', 'История платежей'],
  },
  cashflow_view: {
    title: 'Движение денег',
    description: 'Отслеживайте все денежные потоки по дням и сотрудникам',
    benefits: ['Касса по дням', 'Разбивка по сотрудникам', 'Наличные и безналичные'],
  },
  salary_view: {
    title: 'Зарплата',
    description: 'Автоматический расчёт зарплат мастеров на основе выполненных работ',
    benefits: ['Автоматический расчёт', 'Процент от услуг', 'История выплат'],
  },
  reports_view: {
    title: 'Отчёты',
    description: 'Финансовые отчёты с анализом прибыли, расходов и маржинальности',
    benefits: ['Выручка и прибыль', 'Анализ расходов', 'Средний чек'],
  },
  users_manage: {
    title: 'Пользователи',
    description: 'Управляйте сотрудниками, ролями и правами доступа',
    benefits: ['Роли и права', 'Управление доступом', 'Контроль сотрудников'],
  },
};

// Wrapper that applies feature gate to a screen
function gated(featureKey: string, ScreenComponent: React.ComponentType<any>) {
  const gate = FEATURE_GATES[featureKey];
  if (!gate) return ScreenComponent;
  return function GatedWrapper(props: any) {
    return (
      <FeatureGate featureKey={featureKey} title={gate.title} description={gate.description} benefits={gate.benefits}>
        <ScreenComponent {...props} />
      </FeatureGate>
    );
  };
}

// Gated screens hoisted to MODULE scope — calling gated() inline in
// `component={...}` created a brand-new component identity on every
// MoreStackNavigator render, so React Navigation unmounted and
// remounted the screen mid-push (owner-reported «Расписание
// открывается через раз»). One stable identity per screen for the
// app's lifetime fixes that for all nine gated routes at once.
const GatedSchedule = gated('schedule_view', ScheduleScreen);
const GatedClients = gated('clients_view', ClientsScreen);
const GatedCars = gated('clients_view', CarsScreen);
const GatedServices = gated('services_view', ServicesScreen);
const GatedSuppliers = gated('suppliers_view', SuppliersScreen);
// Заказы поставщикам — same subscription gate as Suppliers (закупки — часть
// раздела «Поставщики»). Module-scope identity so the MoreStack doesn't remount
// the screen mid-push (same rationale as the other gated screens above).
const GatedPurchaseOrders = gated('suppliers_view', PurchaseOrdersScreen);
const GatedCashFlow = gated('cashflow_view', CashFlowScreen);
const GatedSalary = gated('salary_view', SalaryScreen);
const GatedReports = gated('reports_view', ReportsScreen);
const GatedUsers = gated('users_manage', UsersScreen);

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  /**
   * `id` — edit an existing check.
   * Записи → касса (приход): `bookingId` + prefill fields are passed by the
   * BookingDetail «Подтвердить приход» action. CheckCreate seeds client/car/
   * comment/master from them and, on a successful NEW-check save, calls
   * bookingsApi.convert(bookingId, checkId). All booking params are OPTIONAL
   * and param-gated — a normal Касса open (no params) is byte-for-byte
   * unchanged.
   */
  CheckCreate:
    | {
        id?: string;
        bookingId?: string;
        prefillClientId?: string;
        prefillCarId?: string;
        prefillMasterId?: string;
        prefillComment?: string;
      }
    | undefined;
  CheckDetail: { id: string };
  /**
   * `focusCarId` — set when the caller (typically the Clients screen
   * "Авто" tab) wants the detail screen to auto-expand a specific car
   * row and scroll the user to it. Detail screen consumes the flag once
   * via useEffect; if absent or stale, no scrolling happens. We DON'T
   * navigate.setParams() to clear it — re-mounts are rare and the
   * useEffect is gated on the value identity.
   */
  ClientDetail: { id: string; focusCarId?: string };
  /**
   * CarDetail — dedicated drill-down for ONE car (per-car stats + that
   * car's checks). Pushed from ClientDetailScreen's «Гараж» on a car tap.
   * Display fields (makeModel/plateNumber/clientName) are passed so the
   * hero paints instantly; the checks are fetched via carsApi.checks.
   * Registered on BOTH MoreStack and the root Stack (like ClientDetail) so
   * `navigate('CarDetail')` resolves to whichever copy of ClientDetail is
   * currently mounted — keeping the floating tab bar visible when in-section.
   */
  CarDetail: {
    carId: string;
    clientId?: string;
    clientName?: string;
    makeModel?: string;
    plateNumber?: string;
    noPlate?: boolean;
  };
  /**
   * `openDefectReturn` — set when the caller (typically the suppliers
   * list "Возврат брака" header CTA) wants the detail screen to
   * auto-open the defect-return modal once supplier + defect warehouse
   * are loaded. Detail screen consumes the flag once via useEffect and
   * resets navigation state so a re-mount doesn't re-trigger it.
   */
  SupplierDetail: { id: string; openDefectReturn?: boolean };
};

export type TabParamList = {
  Dashboard: undefined;
  Products: undefined;
  NewCheck: undefined;
  Checks: undefined;
  MoreTab: undefined;
};

// ProductsStackParamList — каждый "уровень папки склада" есть отдельный
// instance ProductsScreen, в push() передаётся новый activePath. Это даёт
// нативный iOS edge-swipe назад, потому что pop стека = подъём на уровень
// выше в дереве категорий. Старый внутренний state `activePath` теперь
// читается из route.params.
export type ProductsStackParamList = {
  // `editProduct` is set by ProductDetailScreen's «Изменить» on the route it
  // pops back to — ProductsScreen consumes it once to open its edit modal,
  // reusing the form instead of duplicating it.
  ProductsHome: { activePath?: string[]; editProduct?: Product } | undefined;
  // Dedicated product drill-down. Pushed on row tap; the passed `product`
  // seeds instant paint while the screen revalidates the full shape. `edit:
  // true` lands straight in the on-detail edit mode (from the row long-press
  // action sheet «Редактировать»).
  ProductDetail: { product: Product; edit?: boolean };
  // Инвентаризация (scan-driven recount). Pushed from the warehouse ops sheet;
  // lives in THIS stack so the floating tab bar stays visible and edge-swipe
  // pops back to the warehouse list.
  Inventory: undefined;
};

// EquipmentStackParamList — два экрана, корневой grid и detail на сотрудника.
// Тап по карточке сотрудника пушит детальный экран; iOS edge-swipe pop = назад
// к сетке. Раньше тот же переход делался через локальный `selectedEmp` state,
// без swipe-back.
export type EquipmentStackParamList = {
  EquipmentHome: undefined;
  EquipmentEmployee: { emp: any };
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const MoreStack = createNativeStackNavigator();
const ChecksStack = createNativeStackNavigator();
const ProductsStack = createNativeStackNavigator<ProductsStackParamList>();
const EquipmentStack = createNativeStackNavigator<EquipmentStackParamList>();

// ═══════════════════════════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════════════════════════

// Transparent contentStyle on every native-stack — otherwise React Native
// imposes a white scene background, which combined with each screen's own
// gray-50 wrapper creates a "boxed app" two-tone effect. Making every
// scene transparent lets the screen's own background fill the viewport
// continuously, edge-to-edge, behind the floating glass tab bar.
const TRANSPARENT_STACK_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

function MoreStackNavigator() {
  return (
    <MoreStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} />
      {/*
        Section detail screens live INSIDE the MoreStack so that a tap
        from a section list (Clients → ClientDetail, Suppliers →
        SupplierDetail, CashFlow/Calls → CheckDetail) pushes onto THIS
        stack. React Navigation resolves `navigate('ClientDetail')` to
        the nearest ancestor navigator that owns the route — for a screen
        already inside MoreStack that is MoreStack itself, NOT the root
        Stack copy below. Result back-stack:
          MoreHome → Clients → ClientDetail   (back steps in-section first)
        instead of the old root push that skipped the section list and
        also covered the floating tab bar. The duplicate ClientDetail /
        SupplierDetail / CheckDetail registrations on the root Stack and
        ChecksStack still serve callers OUTSIDE MoreStack (Dashboard
        shortcuts, Checks tab) where covering the tab bar is intentional.
        Note: a Dashboard shortcut into a section routes via
        `MoreTab → <Section>` (see DashboardScreen / entityLinks), so the
        section list is the entry point and its detail still pushes here —
        back goes detail → section list → Ещё, never straight to Главная.
      */}
      <MoreStack.Screen name="ClientDetail" component={ClientDetailScreen} />
      {/* CarDetail — garage drill-down from ClientDetail; lives in MoreStack
          so the tab bar stays visible (back goes car → client → list). */}
      <MoreStack.Screen name="CarDetail" component={CarDetailScreen} />
      <MoreStack.Screen name="SupplierDetail" component={SupplierDetailScreen} />
      <MoreStack.Screen name="CheckDetail" component={CheckDetailScreen} />
      <MoreStack.Screen name="Employees" component={EmployeesScreen} />
      <MoreStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
      {/* «Уволенные» recycle bin — lives in MoreStack so back-nav stays in
          the Сотрудники section (Employees → DismissedEmployees → back). */}
      <MoreStack.Screen name="DismissedEmployees" component={DismissedEmployeesScreen} />
      <MoreStack.Screen name="Trash" component={TrashScreen} />
      <MoreStack.Screen name="Subscription" component={SubscriptionScreen} />
      <MoreStack.Screen name="Schedule" component={GatedSchedule} />
      {/*
        Записи — list / detail / create / settings live in MoreStack so a tap
        from the list (Bookings → BookingDetail) pushes onto THIS stack and the
        floating tab bar stays visible (like Clients → ClientDetail). The
        «Подтвердить приход» action navigates to the ROOT-stack CheckCreate
        (registered below) which intentionally covers the tab bar — that's the
        normal Касса presentation. CheckDetail (already in MoreStack) serves the
        «Чек №…» link from a converted booking, keeping back-nav in-section.
      */}
      <MoreStack.Screen name="Bookings" component={BookingsScreen} />
      <MoreStack.Screen name="BookingDetail" component={BookingDetailScreen} />
      <MoreStack.Screen name="BookingCreate" component={BookingCreateScreen} />
      <MoreStack.Screen name="BookingSettings" component={BookingSettingsScreen} />
      <MoreStack.Screen name="Clients" component={GatedClients} />
      <MoreStack.Screen name="KnowledgeBase" component={KnowledgeBaseScreen} />
      <MoreStack.Screen name="KnowledgeCategory" component={KnowledgeCategoryScreen} />
      <MoreStack.Screen name="KnowledgeArticle" component={KnowledgeArticleScreen} />
      <MoreStack.Screen name="KnowledgeEditor" component={KnowledgeEditorScreen} />
      <MoreStack.Screen name="KnowledgeCourseList" component={KnowledgeCourseListScreen} />
      <MoreStack.Screen name="KnowledgeCourseDetail" component={KnowledgeCourseDetailScreen} />
      <MoreStack.Screen name="KnowledgeLesson" component={KnowledgeLessonScreen} />
      <MoreStack.Screen name="KnowledgeCourseEditor" component={KnowledgeCourseEditorScreen} />
      {/* «Справочник неисправностей» (KnowledgeTroubleshooting*) удалён из
          мобильного приложения по просьбе владельца — на главном экране базы
          знаний остаются три направления: База знаний, Регламенты, Учебный
          центр. Backend и экраны справочника не трогаем; здесь просто нет
          точки входа. */}
      <MoreStack.Screen name="Cars" component={GatedCars} />
      <MoreStack.Screen name="Services" component={GatedServices} />
      <MoreStack.Screen name="Suppliers" component={GatedSuppliers} />
      {/* Заказы поставщикам + приёмка — list / create / detail live in MoreStack
          so the floating tab bar stays visible (back goes detail → list → Ещё,
          like Записи / Поставщики). Create (draft) and Detail (order/receive/
          cancel) push onto THIS stack; receive credits product stock and the
          detail screen invalidates ['products']/['stock-movements'] so Склад is
          fresh. Write actions are role-gated inside the screens AND server-side. */}
      <MoreStack.Screen name="PurchaseOrders" component={GatedPurchaseOrders} />
      <MoreStack.Screen name="PurchaseOrderCreate" component={PurchaseOrderCreateScreen} />
      <MoreStack.Screen name="PurchaseOrderDetail" component={PurchaseOrderDetailScreen} />
      <MoreStack.Screen name="CashFlow" component={GatedCashFlow} />
      {/* Кассовая смена / Z-отчёт / Инкассация — UNGATED by plan-feature
          (no FeatureGate): viewing the current shift / Z-report / history is
          open to any tenant user, while open/close/collect are role-gated
          inside the screen AND enforced server-side. Lives in MoreStack so the
          floating tab bar stays visible (back goes detail → Ещё). */}
      <MoreStack.Screen name="CashShift" component={CashShiftScreen} />
      {/* Рассрочка — backend installments/ (migration 093). REPLACES the old
          «Должники / дебиторка» route. Lives in MoreStack so the floating tab
          bar stays visible (back goes detail → list → Ещё). list/clientLedger
          are open to any tenant user; pay/payoff/reschedule + reminder settings
          are owner-class AND enforced server-side. Plans are created when a
          check is sold with paymentMethod 'installment'. */}
      <MoreStack.Screen name="Installments" component={InstallmentsScreen} />
      <MoreStack.Screen name="InstallmentDetail" component={InstallmentDetailScreen} />
      <MoreStack.Screen name="InstallmentReminderSettings" component={InstallmentReminderSettingsScreen} />
      <MoreStack.Screen name="Salary" component={GatedSalary} />
      {/* «Мотивация сотрудников» v1 — акционные товары (backend motivation/, 095).
          UNGATED by plan-feature: the menu row is roles-filtered to owner/director
          (director/superadmin), and setPromo/clearPromo are owner-class enforced
          server-side. Lives in MoreStack so the floating tab bar stays visible
          (back goes Motivation → Ещё). Reuses the warehouse ProductPickerModal for
          «Добавить акционный товар» and surfaces into SalaryScreen as «Мотивация
          (акции)». */}
      <MoreStack.Screen name="Motivation" component={MotivationScreen} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} />
      <MoreStack.Screen name="Reports" component={GatedReports} />
      {/* «Маркетинг» hub → four direction sub-screens. All live in MoreStack so
          the floating tab bar stays visible and back-nav steps in-section
          (sub-screen → Маркетинг → Ещё). */}
      <MoreStack.Screen name="Marketing" component={MarketingScreen} />
      <MoreStack.Screen name="MarketingReports" component={MarketingReportsScreen} />
      <MoreStack.Screen name="ReviewsReputation" component={ReviewsReputationScreen} />
      {/* «Возвращение клиентов» — win-back broadcast reached from «Рассылки»
          (Mailings → карточка). Lives in MoreStack so the floating tab bar
          stays visible (back goes Winback → Рассылки → Ещё). Owner-class gated
          inside the screen (director/admin/superadmin). */}
      <MoreStack.Screen name="Winback" component={WinbackScreen} />
      <MoreStack.Screen name="Calls" component={CallsScreen} />
      <MoreStack.Screen name="Mailings" component={MailingsScreen} />
      <MoreStack.Screen name="Integrations" component={IntegrationsScreen} />
      <MoreStack.Screen name="WarehouseAnalytics" component={WarehouseAnalyticsScreen} />
      <MoreStack.Screen name="Equipment" component={EquipmentStackNavigator} />
      <MoreStack.Screen name="Users" component={GatedUsers} />
      <MoreStack.Screen name="CompanySettings" component={CompanySettingsScreen} />
      {/* Приём оплат (эквайринг) + онлайн-касса 54-ФЗ. Owner-class; lives in
          MoreStack so the floating tab bar stays visible (like CompanySettings).
          Screen self-gates non-owners; menu row is roles-filtered too. */}
      <MoreStack.Screen name="PaymentIntegrations" component={PaymentIntegrationsScreen} />
      {/* UNGATED — every role manages their own notification preferences. */}
      <MoreStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    </MoreStack.Navigator>
  );
}

/**
 * ChecksStackNavigator — local stack inside the Checks tab. Pushing
 * CheckDetail onto THIS stack (instead of the root) keeps the tab bar
 * visible while the user reads / edits a check, exactly like Mail
 * pushing a message stays inside the Inbox tab.
 */
function ChecksStackNavigator() {
  return (
    <ChecksStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <ChecksStack.Screen name="ChecksHome" component={ChecksScreen} />
      <ChecksStack.Screen name="CheckDetail" component={CheckDetailScreen} />
      {/* «Доска заказ-нарядов» (kanban 082) — lives INSIDE the Checks tab-stack
          so the floating tab bar stays visible (like Checks → CheckDetail) and
          a card's «Открыть заказ-наряд» pushes CheckDetail onto THIS stack.
          Entry point is the «Доска» button in the Журнал (ChecksScreen) header. */}
      <ChecksStack.Screen name="WorkBoard" component={WorkBoardScreen} />
      {/* «Настройка колонок» (091) — owner-class экран, открывается шестерёнкой
          из WorkBoard. Внутри ChecksStack → floating tab bar остаётся виден. */}
      <ChecksStack.Screen name="WorkBoardSettings" component={WorkBoardSettingsScreen} />
    </ChecksStack.Navigator>
  );
}

/**
 * ProductsStackNavigator — local stack inside the Products (Склад) tab.
 * Каждый уровень папки = новый push того же ProductsScreen с другим
 * activePath в route.params. Это даёт нативный iOS edge-swipe назад
 * через дерево категорий: было `[]` → `["Масла"]` → `["Масла","Моторные"]`,
 * swipe слева возвращает на уровень выше как push-pop в стеке.
 *
 * Tab bar остаётся видимым на всех уровнях (как у Checks): транзакция
 * push идёт внутри tab-stack, а не root-stack.
 */
function ProductsStackNavigator() {
  return (
    <ProductsStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <ProductsStack.Screen name="ProductsHome" component={ProductsScreen} />
      {/* Product drill-down — lives INSIDE the Products tab-stack (like
          Checks → CheckDetail) so the floating tab bar stays visible and
          iOS edge-swipe pops back to the warehouse list. */}
      <ProductsStack.Screen name="ProductDetail" component={ProductDetailScreen} />
      {/* Инвентаризация — scan-driven recount; reuses productsApi.updateStock
          (type 'inventory'). In-stack so the tab bar stays visible. */}
      <ProductsStack.Screen name="Inventory" component={InventoryScreen} />
    </ProductsStack.Navigator>
  );
}

/**
 * EquipmentStackNavigator — local stack inside the MoreTab > Equipment.
 * Grid сотрудников (EquipmentHome) → push detail сотрудника
 * (EquipmentEmployee). iOS edge-swipe слева возвращает к сетке —
 * привычное системное поведение, без необходимости целиться в кнопку
 * "Назад".
 */
function EquipmentStackNavigator() {
  return (
    <EquipmentStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <EquipmentStack.Screen name="EquipmentHome" component={EquipmentScreen} />
      <EquipmentStack.Screen name="EquipmentEmployee" component={EquipmentEmployeeScreen} />
    </EquipmentStack.Navigator>
  );
}

/**
 * readMoreStackState — reads the nested MoreStack navigation state out of
 * the outer tab navigator's state. Returns `{ key, index, routes }` or
 * `null` if the inner stack hasn't initialised yet (cold tab). Used by the
 * MoreTab listeners below to reason about where the user is INSIDE the
 * «Ещё» section without holding a ref to the inner navigator.
 */
function readMoreStackState(navigation: any): { key: string; index: number; routes: any[] } | null {
  const moreTabRoute = navigation.getState().routes.find((r: any) => r.name === 'MoreTab');
  const innerState = moreTabRoute?.state;
  if (!innerState?.key || !Array.isArray(innerState.routes)) return null;
  return { key: innerState.key, index: innerState.index ?? innerState.routes.length - 1, routes: innerState.routes };
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
        // NOTE: freezeOnBlur was REMOVED (2026-06-13). On New Arch (Fabric)
        // it suspends+detaches each blurred tab's subtree; the tabs whose
        // content is a nested native-stack (Склад/Products, Журнал/Checks,
        // Ещё/More → Клиенты/Расписание/…) failed to re-commit their native
        // view tree on thaw → the tab switched but the scene stayed blank
        // («не открывается / ошибка»). Dashboard & Касса (plain screens) were
        // unaffected — exactly matching the owner's report. The query-refetch
        // suppression it gave is non-essential: global staleTime +
        // placeholderData prev=>prev + persistentCache already make blurred
        // tabs cheap. Do per-screen focus-gating (useFocusEffect `enabled`)
        // if needed later — never a subtree-wide freeze over native stacks.
        // Floating pill: the absolute position lifts the bar out of the
        // layout flow so screen content scrolls UNDER the glass — that's
        // what makes the bar feel native (visible content blurred through
        // it) rather than sitting on a flat gray backdrop.
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
      // Platform-adaptive bar: Metro resolves TabBar.ios.tsx / TabBar.android.tsx
      // eslint-disable-next-line react/no-unstable-nested-components
      tabBar={(props) => <PlatformTabBar {...props} />}
      // NOTE: screenLayout (screenErrorBoundaryLayout) is INTENTIONALLY NOT set
      // on the Tab.Navigator. Wrapping every tab in an ErrorBoundary keyed by
      // route.key made the tab navigator re-evaluate its children whenever a
      // MoreTab listener fired (state/tabPress/blur) → the nested
      // MoreStackNavigator remounted mid-push → the first navigate was lost and
      // the section «открывалась со второго раза». Tab-level crashes are still
      // caught by the root Stack boundary below and App.tsx's top-level
      // boundary. The per-tab boundaries live on the nested stacks
      // (MoreStack/ChecksStack/ProductsStack/EquipmentStack) instead.
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Products" component={ProductsStackNavigator} />
      <Tab.Screen name="NewCheck" component={CheckCreateScreen} />
      <Tab.Screen name="Checks" component={ChecksStackNavigator} />
      {/*
        MoreTab — three coordinated listeners keep the «Ещё» back-stack
        and tab behaviour native:

        1. `state` (Bug B fix) — guarantees MoreHome ALWAYS sits at the
           bottom of the MoreStack history. Dashboard shortcuts and other
           deep links enter a section via
           `navigate('Main', { screen: 'MoreTab', params: { screen: '<Section>' } })`.
           React Navigation resolves that nested navigate against a
           freshly-focused, empty MoreStack and makes the section the
           ONLY route → `[Section]`. Back then has nothing to pop inside
           MoreStack and falls through to the previous tab (Главная).
           Here we detect `routes[0].name !== 'MoreHome'` and reset the
           inner stack to `[MoreHome, ...routes]`, preserving the focused
           index. Net back path becomes
           detail → section list → Ещё menu, regardless of entry point.
           (Entry from the Ещё menu itself already pushes onto MoreHome,
           so routes[0] is MoreHome and this is a no-op.)

        2. `tabPress` (Bug C fix) — a single tap on «Ещё» always lands on
           the Ещё menu. If MoreTab is already focused and the inner stack
           isn't at MoreHome, prevent the default (which would otherwise
           do nothing) and popToTop the inner stack. A first tap from
           another tab is left untouched → it just switches to MoreTab,
           which the `state` listener / blur-reset already pin to MoreHome.

        3. `blur` — pops the nested MoreStack back to MoreHome when the tab
           loses focus, WITHOUT re-focusing MoreTab (addresses the inner
           stack by key so the outer tab focus is left where the user
           actually tapped).
      */}
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        listeners={({ navigation }) => ({
          state: () => {
            const inner = readMoreStackState(navigation);
            if (!inner) return;
            // MoreHome already at the bottom → nothing to fix.
            if (inner.routes[0]?.name === 'MoreHome') return;
            const moreHomeRoute = { name: 'MoreHome' };
            navigation.dispatch({
              ...CommonActions.reset({
                index: inner.index + 1,
                routes: [moreHomeRoute, ...inner.routes],
              }),
              target: inner.key,
            });
          },
          tabPress: (e) => {
            // Only intercept when «Ещё» is the already-active tab. If the
            // user is arriving from another tab, let the default switch
            // happen (blur on the previous tab already reset MoreStack).
            if (navigation.getState().routes[navigation.getState().index]?.name !== 'MoreTab') return;
            const inner = readMoreStackState(navigation);
            if (inner && inner.index > 0) {
              e.preventDefault();
              navigation.dispatch({ ...StackActions.popToTop(), target: inner.key });
            }
          },
          blur: () => {
            const inner = readMoreStackState(navigation);
            if (inner && inner.index > 0) {
              navigation.dispatch({ ...StackActions.popToTop(), target: inner.key });
            }
          },
        })}
      />
    </Tab.Navigator>
  );
}

/**
 * MainShell — the authenticated root. Branches the navigator by role:
 *
 *   • A real superadmin (role 'superadmin', NOT impersonating) gets the
 *     dedicated platform-operator AdminShellNavigator with its «особое нижнее
 *     меню». No car-service tabs, no Касса FAB.
 *   • Everyone else — directors, masters, AND a superadmin currently
 *     impersonating a tenant owner (role becomes 'director') — gets the normal
 *     car-service TabNavigator, 100% untouched.
 *
 * During impersonation a persistent ImpersonationBanner is pushed above the
 * navigator (and the navigator subtree gets a zeroed top inset so headers
 * don't double-pad). A normal session renders the navigator straight — zero
 * extra wrapping.
 */
function MainShell() {
  const { user, isImpersonating } = useAuth();
  const isPlatformOperator = user?.role === 'superadmin' && !isImpersonating;

  const navigator = isPlatformOperator ? <AdminShellNavigator /> : <TabNavigator />;

  // Fast path — no impersonation banner. Render the navigator straight, so a
  // normal session has ZERO extra wrapping and the top inset stays untouched.
  if (!isImpersonating) {
    return navigator;
  }

  // Impersonating: the banner sits ABOVE the navigator and PUSHES the
  // car-service tree down (instead of overlapping the screen header). The
  // banner itself consumes the real top inset; we then hand the navigator
  // subtree a ZEROED top inset so screen headers don't double-pad below the
  // already-drawn status-bar strip.
  return (
    <View style={{ flex: 1 }}>
      <ImpersonationBanner />
      <SafeAreaInsetsContext.Consumer>
        {(insets) => (
          <SafeAreaInsetsContext.Provider value={{ ...(insets ?? { top: 0, bottom: 0, left: 0, right: 0 }), top: 0 }}>
            <View style={{ flex: 1 }}>{navigator}</View>
          </SafeAreaInsetsContext.Provider>
        )}
      </SafeAreaInsetsContext.Consumer>
    </View>
  );
}

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Stack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainShell} />
          <Stack.Screen name="CheckCreate" component={CheckCreateScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
          <Stack.Screen name="CarDetail" component={CarDetailScreen} />
          <Stack.Screen name="SupplierDetail" component={SupplierDetailScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
