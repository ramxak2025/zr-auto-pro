import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
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
import LoadingSpinner from '../components/LoadingSpinner';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  CheckCreate: { id?: string } | undefined;
  CheckDetail: { id: string };
  ClientDetail: { id: string };
  SupplierDetail: { id: string };
  Clients: undefined;
  Services: undefined;
  Suppliers: undefined;
  Salary: undefined;
  Reports: undefined;
  CashFlow: undefined;
  Expenses: undefined;
  Users: undefined;
  Schedule: undefined;
  Marketing: undefined;
  Cars: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Products: undefined;
  NewCheck: undefined;
  Checks: undefined;
  More: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function CenterTabButton() {
  return (
    <View style={styles.centerBtnOuter}>
      <LinearGradient
        colors={[colors.primary[500], colors.primary[700]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.centerBtn}
      >
        <Feather name="file-plus" size={22} color={colors.white} />
      </LinearGradient>
    </View>
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
            <View style={[styles.iconBox, focused && styles.iconBoxActive]}>
              <Ionicons name={focused ? 'grid' : 'grid-outline'} size={21} color={color} />
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
            <View style={[styles.iconBox, focused && styles.iconBoxActive]}>
              <Ionicons name={focused ? 'cube' : 'cube-outline'} size={21} color={color} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="NewCheck"
        component={CheckCreateScreen}
        options={{
          tabBarLabel: 'Касса',
          tabBarIcon: () => <CenterTabButton />,
          tabBarLabelStyle: [styles.tabLabel, { color: colors.primary[600], fontWeight: fontWeight.bold }],
        }}
        listeners={({ navigation }) => ({
          tabPress: (e: any) => {
            e.preventDefault();
            (navigation as any).navigate('CheckCreate');
          },
        })}
      />
      <Tab.Screen
        name="Checks"
        component={ChecksScreen}
        options={{
          tabBarLabel: 'Журнал',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconBox, focused && styles.iconBoxActive]}>
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={21} color={color} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarLabel: 'Ещё',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconBox, focused && styles.iconBoxActive]}>
              <Ionicons name={focused ? 'menu' : 'menu-outline'} size={22} color={color} />
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
          <Stack.Screen name="Clients" component={ClientsScreen} />
          <Stack.Screen name="Services" component={ServicesScreen} />
          <Stack.Screen name="Suppliers" component={SuppliersScreen} />
          <Stack.Screen name="Salary" component={SalaryScreen} />
          <Stack.Screen name="Reports" component={ReportsScreen} />
          <Stack.Screen name="CashFlow" component={CashFlowScreen} />
          <Stack.Screen name="Expenses" component={ExpensesScreen} />
          <Stack.Screen name="Users" component={UsersScreen} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} />
          <Stack.Screen name="Marketing" component={MarketingScreen} />
          <Stack.Screen name="Cars" component={CarsScreen} />
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
    elevation: 20,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxActive: {
    backgroundColor: colors.primary[50],
  },
  centerBtnOuter: {
    marginTop: -16,
  },
  centerBtn: {
    width: 52,
    height: 44,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
  },
});
