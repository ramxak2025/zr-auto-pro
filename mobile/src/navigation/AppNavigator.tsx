import React, { useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
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
import LoadingSpinner from '../components/LoadingSpinner';

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
//  Plasma Energy Ball — animated center button
// ═══════════════════════════════════════════════════════════════════════════════

const PLASMA_SIZE = 64;

interface BlobConfig {
  color: string;
  size: number;
  /** x-axis frequency multiplier (integer for seamless loop) */
  ax: number;
  /** y-axis frequency multiplier */
  ay: number;
  /** x orbit radius */
  rx: number;
  /** y orbit radius */
  ry: number;
  /** x phase offset */
  px: number;
  /** y phase offset */
  py: number;
}

const PLASMA_BLOBS: BlobConfig[] = [
  { color: 'rgba(34, 211, 238, 0.6)',  size: 28, ax: 1, ay: 2, rx: 13, ry: 10, px: 0,               py: 0 },
  { color: 'rgba(96, 165, 250, 0.55)', size: 24, ax: 2, ay: 3, rx: 10, ry: 8,  px: Math.PI / 4,     py: Math.PI / 3 },
  { color: 'rgba(167, 139, 250, 0.5)', size: 26, ax: 3, ay: 1, rx: 8,  ry: 13, px: Math.PI / 2,     py: Math.PI / 6 },
  { color: 'rgba(192, 132, 252, 0.45)',size: 22, ax: 2, ay: 1, rx: 11, ry: 9,  px: Math.PI,         py: Math.PI / 2 },
  { color: 'rgba(165, 243, 252, 0.5)', size: 30, ax: 1, ay: 3, rx: 9,  ry: 11, px: Math.PI * 2 / 3, py: Math.PI / 4 },
  { color: 'rgba(129, 140, 248, 0.4)', size: 20, ax: 3, ay: 2, rx: 7,  ry: 12, px: Math.PI * 5 / 6, py: Math.PI * 2 / 3 },
];

function PlasmaBlob({ time, cfg }: { time: SharedValue<number>; cfg: BlobConfig }) {
  const style = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [
        { translateX: Math.sin(time.value * cfg.ax + cfg.px) * cfg.rx },
        { translateY: Math.cos(time.value * cfg.ay + cfg.py) * cfg.ry },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute' as const,
          width: cfg.size,
          height: cfg.size,
          borderRadius: cfg.size / 2,
          backgroundColor: cfg.color,
        },
        style,
      ]}
    />
  );
}

function PlasmaButton({ focused }: { focused?: boolean }) {
  const time = useSharedValue(0);
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    time.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 8000, easing: Easing.linear }),
      -1,
      false,
    );
  }, []);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: 300 });
  }, [focused]);

  // Outer glow — brighter when focused
  const glowStyle = useAnimatedStyle(() => {
    'worklet';
    const base = 0.1 + focus.value * 0.3;
    const amp = 0.06 + focus.value * 0.1;
    return { opacity: base + Math.sin(time.value * 2) * amp };
  });

  // Energy ring — subtle pulsing border
  const ringStyle = useAnimatedStyle(() => {
    'worklet';
    return { opacity: 0.2 + Math.sin(time.value * 3) * 0.2 + focus.value * 0.2 };
  });

  // Core glow — breathes slowly
  const coreStyle = useAnimatedStyle(() => {
    'worklet';
    const scale = 1 + Math.sin(time.value * 1.5) * 0.15;
    return {
      opacity: 0.2 + focus.value * 0.1 + Math.sin(time.value * 1.5) * 0.08,
      transform: [{ scale }],
    };
  });

  return (
    <View style={plasma.outer}>
      {/* Soft outer glow */}
      <Animated.View style={[plasma.glow, glowStyle]} />

      {/* Energy ring */}
      <Animated.View style={[plasma.ring, ringStyle]} />

      {/* Button body */}
      <View style={plasma.body}>
        {/* Deep space base gradient */}
        <LinearGradient
          colors={['#1a0a3e', '#0d1b4f', '#0a1628']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Animated plasma blobs */}
        <View style={plasma.blobBox}>
          {PLASMA_BLOBS.map((cfg, i) => (
            <PlasmaBlob key={i} time={time} cfg={cfg} />
          ))}
        </View>

        {/* Vignette — darkens edges for glass-sphere depth */}
        <Svg width={PLASMA_SIZE} height={PLASMA_SIZE} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="vig" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0%" stopColor="transparent" />
              <Stop offset="55%" stopColor="transparent" />
              <Stop offset="100%" stopColor="rgba(8,8,28,0.6)" />
            </RadialGradient>
          </Defs>
          <Circle cx={PLASMA_SIZE / 2} cy={PLASMA_SIZE / 2} r={PLASMA_SIZE / 2} fill="url(#vig)" />
        </Svg>

        {/* Hot core glow */}
        <Animated.View style={[plasma.core, coreStyle]} />

        {/* Icon */}
        <Ionicons name="calculator" size={26} color={colors.white} style={{ zIndex: 10 }} />
      </View>
    </View>
  );
}

const plasma = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: PLASMA_SIZE + 24,
    height: PLASMA_SIZE + 24,
    marginTop: -28,
  },
  glow: {
    position: 'absolute',
    width: PLASMA_SIZE + 22,
    height: PLASMA_SIZE + 22,
    borderRadius: (PLASMA_SIZE + 22) / 2,
    backgroundColor: '#6366f1',
  },
  ring: {
    position: 'absolute',
    width: PLASMA_SIZE + 10,
    height: PLASMA_SIZE + 10,
    borderRadius: (PLASMA_SIZE + 10) / 2,
    borderWidth: 1.5,
    borderColor: '#818cf8',
  },
  body: {
    width: PLASMA_SIZE,
    height: PLASMA_SIZE,
    borderRadius: PLASMA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Navigation
// ═══════════════════════════════════════════════════════════════════════════════

function MoreStackNavigator() {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false }}>
      <MoreStack.Screen name="MoreHome" component={MoreScreen} />
      <MoreStack.Screen name="Schedule" component={ScheduleScreen} />
      <MoreStack.Screen name="Clients" component={ClientsScreen} />
      <MoreStack.Screen name="Cars" component={CarsScreen} />
      <MoreStack.Screen name="Services" component={ServicesScreen} />
      <MoreStack.Screen name="Suppliers" component={SuppliersScreen} />
      <MoreStack.Screen name="CashFlow" component={CashFlowScreen} />
      <MoreStack.Screen name="Salary" component={SalaryScreen} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} />
      <MoreStack.Screen name="Reports" component={ReportsScreen} />
      <MoreStack.Screen name="Marketing" component={MarketingScreen} />
      <MoreStack.Screen name="Users" component={UsersScreen} />
      <MoreStack.Screen name="CompanySettings" component={CompanySettingsScreen} />
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
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="home" size={22} color={color} />
              {focused && <View style={styles.activeDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="Products"
        component={ProductsScreen}
        options={{
          tabBarLabel: 'Склад',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="package" size={22} color={color} />
              {focused && <View style={styles.activeDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="NewCheck"
        component={CheckCreateScreen}
        options={{
          tabBarLabel: 'Касса',
          tabBarIcon: ({ focused }) => <PlasmaButton focused={focused} />,
          tabBarLabelStyle: [styles.tabLabel, { color: colors.primary[600], fontWeight: fontWeight.bold }],
        }}
      />
      <Tab.Screen
        name="Checks"
        component={ChecksScreen}
        options={{
          tabBarLabel: 'Журнал',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="file-text" size={22} color={color} />
              {focused && <View style={styles.activeDot} />}
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          tabBarLabel: 'Ещё',
          tabBarIcon: ({ color, focused }) => (
            <View style={styles.tabIconWrap}>
              <Feather name="menu" size={22} color={color} />
              {focused && <View style={styles.activeDot} />}
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
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingTop: spacing[1],
    paddingBottom: Platform.OS === 'ios' ? spacing[7] : spacing[2],
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
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary[600],
    marginTop: 3,
  },
});
