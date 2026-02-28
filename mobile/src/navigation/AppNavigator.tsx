import React, { useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Ionicons, Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
//  Plasma Energy Ball — animated center button (built-in Animated API)
// ═══════════════════════════════════════════════════════════════════════════════

const PLASMA_SIZE = 64;

const PLASMA_BLOB_COLORS = [
  'rgba(34, 211, 238, 0.6)',
  'rgba(96, 165, 250, 0.55)',
  'rgba(167, 139, 250, 0.5)',
  'rgba(192, 132, 252, 0.45)',
  'rgba(165, 243, 252, 0.5)',
  'rgba(129, 140, 248, 0.4)',
];

function PlasmaButton({ focused }: { focused?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    // Pulsing glow
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    // Slow rotation for blobs
    Animated.loop(
      Animated.timing(rotate, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: true }),
    ).start();
  }, []);

  useEffect(() => {
    Animated.timing(glowAnim, { toValue: focused ? 1 : 0, duration: 300, useNativeDriver: true }).start();
  }, [focused]);

  const glowOpacity = Animated.add(
    Animated.add(new Animated.Value(0.15), Animated.multiply(glowAnim, new Animated.Value(0.25))),
    Animated.multiply(pulse, new Animated.Value(0.15)),
  );

  const ringOpacity = Animated.add(
    new Animated.Value(0.25),
    Animated.multiply(pulse, new Animated.Value(0.2)),
  );

  const coreScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  const coreOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.3] });
  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={plasma.outer}>
      {/* Soft outer glow */}
      <Animated.View style={[plasma.glow, { opacity: glowOpacity }]} />

      {/* Energy ring */}
      <Animated.View style={[plasma.ring, { opacity: ringOpacity }]} />

      {/* Button body */}
      <View style={plasma.body}>
        {/* Deep space base gradient */}
        <LinearGradient
          colors={['#1a0a3e', '#0d1b4f', '#0a1628']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Rotating plasma blobs */}
        <Animated.View style={[plasma.blobBox, { transform: [{ rotate: spin }] }]}>
          {PLASMA_BLOB_COLORS.map((color, i) => {
            const angle = (i / PLASMA_BLOB_COLORS.length) * Math.PI * 2;
            const size = 20 + (i % 3) * 5;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: color,
                  transform: [
                    { translateX: Math.cos(angle) * 12 },
                    { translateY: Math.sin(angle) * 12 },
                  ],
                }}
              />
            );
          })}
        </Animated.View>

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
        <Animated.View style={[plasma.core, { opacity: coreOpacity, transform: [{ scale: coreScale }] }]} />

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
