import React, { useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../theme';

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

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const MoreStack = createNativeStackNavigator();

// ═══════════════════════════════════════════════════════════════════════════════
//  Касса — branded blue gradient center button
// ═══════════════════════════════════════════════════════════════════════════════

const KASSA_SIZE = 68;

function KassaButton({ focused }: { focused?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const plasma = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Outer glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
    // Inner plasma breathing
    Animated.loop(
      Animated.sequence([
        Animated.timing(plasma, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(plasma, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
    // Slow rotation for plasma orbs
    Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, []);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] });
  const plasmaScale = plasma.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.2] });
  const plasmaOpacity = plasma.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.35] });
  const rotateVal = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={kassa.outer}>
      {/* Outer pulsing glow ring */}
      <Animated.View
        style={[
          kassa.glowRing,
          { opacity: glowOpacity, transform: [{ scale: glowScale }] },
        ]}
      />

      {/* Secondary glow layer */}
      <Animated.View
        style={[
          kassa.glowInner,
          { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.45] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.25] }) }] },
        ]}
      />

      {/* Main button body */}
      <View style={kassa.body}>
        <LinearGradient
          colors={[colors.primary[300], colors.primary[500], colors.primary[700], colors.primary[900]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Rotating plasma orbs */}
        <Animated.View style={[kassa.plasmaContainer, { transform: [{ rotate: rotateVal }] }]}>
          <Animated.View style={[kassa.plasmaOrb1, { opacity: plasmaOpacity, transform: [{ scale: plasmaScale }] }]} />
          <Animated.View style={[kassa.plasmaOrb2, { opacity: plasmaOpacity, transform: [{ scale: plasma.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.7] }) }] }]} />
          <Animated.View style={[kassa.plasmaOrb3, { opacity: plasma.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.25] }), transform: [{ scale: plasma.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.3] }) }] }]} />
        </Animated.View>

        {/* Top-left shine highlight */}
        <View style={kassa.shine} />

        {/* Bottom-right subtle highlight */}
        <View style={kassa.shineBottom} />

        {/* Icon */}
        <Ionicons name="calculator-outline" size={28} color={colors.white} style={{ zIndex: 5 }} />
      </View>
    </View>
  );
}

const kassa = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: KASSA_SIZE + 28,
    height: KASSA_SIZE + 28,
    marginTop: -32,
  },
  glowRing: {
    position: 'absolute',
    width: KASSA_SIZE + 26,
    height: KASSA_SIZE + 26,
    borderRadius: (KASSA_SIZE + 26) / 2,
    backgroundColor: colors.primary[400],
  },
  glowInner: {
    position: 'absolute',
    width: KASSA_SIZE + 14,
    height: KASSA_SIZE + 14,
    borderRadius: (KASSA_SIZE + 14) / 2,
    backgroundColor: colors.primary[300],
  },
  body: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: KASSA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 14,
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(147, 197, 253, 0.3)',
  },
  plasmaContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plasmaOrb1: {
    position: 'absolute',
    top: 4,
    left: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary[300],
  },
  plasmaOrb2: {
    position: 'absolute',
    bottom: 6,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.blue[300],
  },
  plasmaOrb3: {
    position: 'absolute',
    top: 18,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.cyan[400],
  },
  shine: {
    position: 'absolute',
    top: -KASSA_SIZE * 0.1,
    left: -KASSA_SIZE * 0.1,
    width: KASSA_SIZE * 0.55,
    height: KASSA_SIZE * 0.55,
    borderRadius: KASSA_SIZE * 0.275,
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 3,
  },
  shineBottom: {
    position: 'absolute',
    bottom: -KASSA_SIZE * 0.08,
    right: -KASSA_SIZE * 0.08,
    width: KASSA_SIZE * 0.4,
    height: KASSA_SIZE * 0.4,
    borderRadius: KASSA_SIZE * 0.2,
    backgroundColor: 'rgba(96, 165, 250, 0.1)',
    zIndex: 2,
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════════════════════════

function MoreStackNavigator() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false }}>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} />
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
      <MoreStack.Screen name="Users" component={gated('users_manage', UsersScreen)} />
      <MoreStack.Screen name="CompanySettings" component={CompanySettingsScreen} />
      <MoreStack.Screen name="Admin" component={AdminScreen} />
    </MoreStack.Navigator>
  );
}

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.gray[400],
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Главная',
          tabBarIcon: ({ color }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="home" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Products"
        component={ProductsScreen}
        options={{
          tabBarLabel: 'Склад',
          tabBarIcon: ({ color }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="package" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="NewCheck"
        component={CheckCreateScreen}
        options={{
          tabBarLabel: () => null,
          tabBarIcon: ({ focused }) => <KassaButton focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Checks"
        component={ChecksScreen}
        options={{
          tabBarLabel: 'Журнал',
          tabBarIcon: ({ color }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="file-text" size={22} color={color} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          tabBarLabel: 'Ещё',
          tabBarIcon: ({ color }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="menu" size={22} color={color} />
            </View>
          ),
        }}
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={TabNavigator} />
          <Stack.Screen
            name="CheckCreate"
            component={CheckCreateScreen}
            options={{ animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="CheckDetail" component={CheckDetailScreen} />
          <Stack.Screen name="ClientDetail" component={ClientDetailScreen} />
          <Stack.Screen name="SupplierDetail" component={SupplierDetailScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.white,
    borderTopWidth: 0,
    height: Platform.OS === 'ios' ? 78 : 62,
    paddingTop: spacing[1],
    paddingBottom: Platform.OS === 'ios' ? spacing[4] : spacing[1.5],
    elevation: 24,
    shadowColor: '#1e293b',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 34,
  },
});
