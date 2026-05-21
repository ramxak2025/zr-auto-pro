import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
  ClientDetail: { id: string };
  SupplierDetail: { id: string };
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
      <MoreStack.Screen name="Employees" component={EmployeesScreen} />
      <MoreStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} />
      <MoreStack.Screen name="Trash" component={TrashScreen} />
      <MoreStack.Screen name="Subscription" component={SubscriptionScreen} />
      <MoreStack.Screen name="Schedule" component={gated('schedule_view', ScheduleScreen)} />
      <MoreStack.Screen name="Clients" component={gated('clients_view', ClientsScreen)} />
      <MoreStack.Screen name="Cars" component={gated('clients_view', CarsScreen)} />
      <MoreStack.Screen name="Services" component={gated('services_view', ServicesScreen)} />
      <MoreStack.Screen name="Suppliers" component={gated('suppliers_view', SuppliersScreen)} />
      <MoreStack.Screen name="CashFlow" component={gated('cashflow_view', CashFlowScreen)} />
      <MoreStack.Screen name="Salary" component={gated('salary_view', SalaryScreen)} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} />
      <MoreStack.Screen name="Reports" component={gated('reports_view', ReportsScreen)} />
      <MoreStack.Screen name="Marketing" component={MarketingScreen} />
      <MoreStack.Screen name="Calls" component={CallsScreen} />
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
        MoreTab — fires `popToTop` on the embedded MoreStack whenever
        the tab LOSES focus.

        Why: previously, if the user navigated Dashboard → MoreTab
        → Звонки (push) → Dashboard tab → MoreTab again, the MoreStack
        was still parked on `Calls`, so re-entering "Ещё" landed on
        Calls instead of the menu list. Owner-reported bug.

        Resetting on blur means:
          • Going AWAY from MoreTab pops the inner stack to MoreHome,
          • Coming BACK lands cleanly on MoreHome.
        That matches the iOS Settings-app convention.

        We use `blur` rather than `tabPress` because tabPress fires on
        the tab the user IS pressing — using it here would only catch
        users tapping MoreTab itself, not the case where they tap any
        OTHER tab while inside MoreStack/Calls.
      */}
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        listeners={({ navigation }) => ({
          blur: () => {
            // Pop nested MoreStack back to its first screen (MoreHome).
            // `navigation` here is the BottomTab navigation; we drill into
            // the focused MoreTab route's nested state.
            const parentState = navigation.getState();
            const moreTabRoute = parentState.routes.find((r) => r.name === 'MoreTab');
            const innerIndex = moreTabRoute?.state?.index ?? 0;
            if (innerIndex > 0) {
              navigation.navigate('MoreTab', {
                screen: 'MoreHome',
              } as never);
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
