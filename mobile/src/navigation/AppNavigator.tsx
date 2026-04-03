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
import CallsScreen from '../screens/CallsScreen';
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
//  Касса — plasma glow branded center button
// ═══════════════════════════════════════════════════════════════════════════════

const KASSA_SIZE = 68;

function KassaButton({ focused }: { focused?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const magma1 = useRef(new Animated.Value(0)).current;
  const magma2 = useRef(new Animated.Value(0)).current;
  const magma3 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const rotate2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(magma1, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(magma1, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(magma2, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(magma2, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(magma3, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(magma3, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.timing(rotate2, { toValue: 1, duration: 5000, easing: Easing.linear, useNativeDriver: true })).start();
  }, []);

  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  const rotateVal = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateVal2 = rotate2.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <View style={kassa.outer}>
      <Animated.View style={[kassa.glowRing, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      <Animated.View style={[kassa.glowInner, {
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.3] }) }],
      }]} />

      <View style={kassa.body}>
        <LinearGradient colors={['#ff6b35', '#e63946', '#d62828', '#6a040f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

        {/* Rotating magma layer 1 */}
        <Animated.View style={[kassa.magmaContainer, { transform: [{ rotate: rotateVal }] }]}>
          <Animated.View style={[kassa.magmaOrb, { top: 2, left: 4, width: 34, height: 34, borderRadius: 17, backgroundColor: '#ff9500' }, {
            opacity: magma1.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.6] }),
            transform: [{ scale: magma1.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.3] }) }],
          }]} />
          <Animated.View style={[kassa.magmaOrb, { bottom: 4, right: 2, width: 28, height: 28, borderRadius: 14, backgroundColor: '#ffb347' }, {
            opacity: magma2.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] }),
            transform: [{ scale: magma2.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.6] }) }],
          }]} />
        </Animated.View>

        {/* Counter-rotating magma layer 2 */}
        <Animated.View style={[kassa.magmaContainer, { transform: [{ rotate: rotateVal2 }] }]}>
          <Animated.View style={[kassa.magmaOrb, { top: 14, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: '#ff6b35' }, {
            opacity: magma3.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
            transform: [{ scale: magma3.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.4] }) }],
          }]} />
          <Animated.View style={[kassa.magmaOrb, { bottom: 10, left: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffd166' }, {
            opacity: magma1.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.35] }),
            transform: [{ scale: magma2.interpolate({ inputRange: [0, 1], outputRange: [1.2, 0.7] }) }],
          }]} />
        </Animated.View>

        {/* Hot center glow */}
        <Animated.View style={{
          position: 'absolute', width: KASSA_SIZE * 0.5, height: KASSA_SIZE * 0.5,
          borderRadius: KASSA_SIZE * 0.25, backgroundColor: '#ffb347', zIndex: 2,
          opacity: magma2.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.35] }) as any,
          transform: [{ scale: magma1.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.15] }) as any }],
        }} />

        <View style={kassa.shine} />
        <Ionicons name="receipt-outline" size={26} color={colors.white} style={{ zIndex: 5 }} />
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
    backgroundColor: '#ff6b35',
  },
  glowInner: {
    position: 'absolute',
    width: KASSA_SIZE + 14,
    height: KASSA_SIZE + 14,
    borderRadius: (KASSA_SIZE + 14) / 2,
    backgroundColor: '#e63946',
  },
  body: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: KASSA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 16,
    shadowColor: '#d62828',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255, 183, 77, 0.4)',
  },
  magmaContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  magmaOrb: {
    position: 'absolute',
  },
  shine: {
    position: 'absolute',
    top: -KASSA_SIZE * 0.1,
    left: -KASSA_SIZE * 0.1,
    width: KASSA_SIZE * 0.5,
    height: KASSA_SIZE * 0.5,
    borderRadius: KASSA_SIZE * 0.25,
    backgroundColor: 'rgba(255,255,255,0.18)',
    zIndex: 3,
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
      <MoreStack.Screen name="Calls" component={CallsScreen} />
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
    height: Platform.OS === 'ios' ? 88 : 72,
    paddingTop: spacing[1.5],
    paddingBottom: Platform.OS === 'ios' ? spacing[6] : spacing[3],
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
