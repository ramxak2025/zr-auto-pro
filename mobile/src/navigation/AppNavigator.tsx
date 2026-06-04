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
import ChecksScreen from '../screens/ChecksScreen';
import CheckCreateScreen from '../screens/CheckCreateScreen';
import CheckDetailScreen from '../screens/CheckDetailScreen';
import ClientsScreen from '../screens/ClientsScreen';
import ClientDetailScreen from '../screens/ClientDetailScreen';
import ServicesScreen from '../screens/ServicesScreen';
import SuppliersScreen from '../screens/SuppliersScreen';
import SupplierDetailScreen from '../screens/SupplierDetailScreen';
import SalaryScreen from '../screens/SalaryScreen';
import ReportsScreen from '../screens/ReportsScreen';
import CashFlowScreen from '../screens/CashFlowScreen';
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
import KnowledgeTroubleshootingScreen from '../screens/KnowledgeTroubleshootingScreen';
import KnowledgeTroubleshootingDetailScreen from '../screens/KnowledgeTroubleshootingDetailScreen';
import KnowledgeTroubleshootingEditorScreen from '../screens/KnowledgeTroubleshootingEditorScreen';
import MarketingScreen from '../screens/MarketingScreen';
import CarsScreen from '../screens/CarsScreen';
import CompanySettingsScreen from '../screens/CompanySettingsScreen';
import SubscriptionScreen from '../screens/SubscriptionScreen';
import AdminScreen from '../screens/AdminScreen';
import CallsScreen from '../screens/CallsScreen';
import EquipmentScreen, { EquipmentEmployeeScreen } from '../screens/EquipmentScreen';
import EmployeesScreen from '../screens/EmployeesScreen';
import EmployeeDetailScreen from '../screens/EmployeeDetailScreen';
import TrashScreen from '../screens/TrashScreen';
import MailingsScreen from '../screens/MailingsScreen';
import IntegrationsScreen from '../screens/IntegrationsScreen';
import WarehouseAnalyticsScreen from '../screens/WarehouseAnalyticsScreen';
import LoadingSpinner from '../components/LoadingSpinner';
import FeatureGate from '../components/FeatureGate';

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

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  CheckCreate: { id?: string } | undefined;
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
  ProductsHome: { activePath?: string[] } | undefined;
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
    <MoreStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS}>
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
      <MoreStack.Screen name="SupplierDetail" component={SupplierDetailScreen} />
      <MoreStack.Screen name="CheckDetail" component={CheckDetailScreen} />
      <MoreStack.Screen name="Employees" component={EmployeesScreen} />
      <MoreStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
      <MoreStack.Screen name="Trash" component={TrashScreen} />
      <MoreStack.Screen name="Subscription" component={SubscriptionScreen} />
      <MoreStack.Screen name="Schedule" component={gated('schedule_view', ScheduleScreen)} />
      <MoreStack.Screen name="Clients" component={gated('clients_view', ClientsScreen)} />
      <MoreStack.Screen name="KnowledgeBase" component={KnowledgeBaseScreen} />
      <MoreStack.Screen name="KnowledgeCategory" component={KnowledgeCategoryScreen} />
      <MoreStack.Screen name="KnowledgeArticle" component={KnowledgeArticleScreen} />
      <MoreStack.Screen name="KnowledgeEditor" component={KnowledgeEditorScreen} />
      <MoreStack.Screen name="KnowledgeCourseList" component={KnowledgeCourseListScreen} />
      <MoreStack.Screen name="KnowledgeCourseDetail" component={KnowledgeCourseDetailScreen} />
      <MoreStack.Screen name="KnowledgeLesson" component={KnowledgeLessonScreen} />
      <MoreStack.Screen name="KnowledgeCourseEditor" component={KnowledgeCourseEditorScreen} />
      <MoreStack.Screen name="KnowledgeTroubleshooting" component={KnowledgeTroubleshootingScreen} />
      <MoreStack.Screen name="KnowledgeTroubleshootingDetail" component={KnowledgeTroubleshootingDetailScreen} />
      <MoreStack.Screen name="KnowledgeTroubleshootingEditor" component={KnowledgeTroubleshootingEditorScreen} />
      <MoreStack.Screen name="Cars" component={gated('clients_view', CarsScreen)} />
      <MoreStack.Screen name="Services" component={gated('services_view', ServicesScreen)} />
      <MoreStack.Screen name="Suppliers" component={gated('suppliers_view', SuppliersScreen)} />
      <MoreStack.Screen name="CashFlow" component={gated('cashflow_view', CashFlowScreen)} />
      <MoreStack.Screen name="Salary" component={gated('salary_view', SalaryScreen)} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} />
      <MoreStack.Screen name="Reports" component={gated('reports_view', ReportsScreen)} />
      <MoreStack.Screen name="Marketing" component={MarketingScreen} />
      <MoreStack.Screen name="Calls" component={CallsScreen} />
      <MoreStack.Screen name="Mailings" component={MailingsScreen} />
      <MoreStack.Screen name="Integrations" component={IntegrationsScreen} />
      <MoreStack.Screen name="WarehouseAnalytics" component={WarehouseAnalyticsScreen} />
      <MoreStack.Screen name="Equipment" component={EquipmentStackNavigator} />
      <MoreStack.Screen name="Users" component={gated('users_manage', UsersScreen)} />
      <MoreStack.Screen name="CompanySettings" component={CompanySettingsScreen} />
      <MoreStack.Screen name="Admin" component={AdminScreen} />
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
    <ChecksStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS}>
      <ChecksStack.Screen name="ChecksHome" component={ChecksScreen} />
      <ChecksStack.Screen name="CheckDetail" component={CheckDetailScreen} />
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
    <ProductsStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS}>
      <ProductsStack.Screen name="ProductsHome" component={ProductsScreen} />
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
    <EquipmentStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS}>
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

export default function AppNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <Stack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen name="CheckCreate" component={CheckCreateScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
          <Stack.Screen name="SupplierDetail" component={SupplierDetailScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
