import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, StyleSheet, Platform } from 'react-native';
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
import LoadingSpinner from '../components/LoadingSpinner';

// Simple SVG-less icons using Text
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    home: '⌂',
    products: '▦',
    receipt: '✎',
    journal: '☰',
    more: '⋯',
  };
  return (
    <View style={[styles.tabIconWrap, focused && styles.tabIconActive]}>
      <View>
        {/* Use simple text icons */}
      </View>
    </View>
  );
}

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
          tabBarIcon: ({ color, size }) => (
            <View style={[styles.iconBox, color === colors.primary[600] && styles.iconBoxActive]}>
              <IconText text="⌂" color={color} size={22} />
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
            <View style={[styles.iconBox, color === colors.primary[600] && styles.iconBoxActive]}>
              <IconText text="📦" color={color} size={18} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="NewCheck"
        component={CheckCreateScreen}
        options={{
          tabBarLabel: 'Касса',
          tabBarIcon: ({ focused }) => (
            <View style={styles.centerBtn}>
              <IconText text="✎" color={colors.white} size={22} />
            </View>
          ),
          tabBarLabelStyle: [styles.tabLabel, { color: colors.primary[600], fontWeight: fontWeight.bold }],
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('CheckCreate');
          },
        })}
      />
      <Tab.Screen
        name="Checks"
        component={ChecksScreen}
        options={{
          tabBarLabel: 'Журнал',
          tabBarIcon: ({ color }) => (
            <View style={[styles.iconBox, color === colors.primary[600] && styles.iconBoxActive]}>
              <IconText text="📋" color={color} size={18} />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        options={{
          tabBarLabel: 'Ещё',
          tabBarIcon: ({ color }) => (
            <View style={[styles.iconBox, color === colors.primary[600] && styles.iconBoxActive]}>
              <IconText text="⋯" color={color} size={22} />
            </View>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function IconText({ text, color, size }: { text: string; color: string; size: number }) {
  return (
    <View>
      <React.Fragment>
        {/* Using emoji/unicode as simple icons */}
        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <View>
            <React.Fragment />
          </View>
        </View>
      </React.Fragment>
    </View>
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
        </>
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingTop: spacing[1],
    paddingBottom: Platform.OS === 'ios' ? spacing[7] : spacing[2],
    elevation: 0,
    shadowOpacity: 0,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxActive: {
    backgroundColor: colors.primary[50],
  },
  centerBtn: {
    width: 56,
    height: 40,
    borderRadius: borderRadius['2xl'],
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -12,
    shadowColor: colors.primary[400],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  tabIconWrap: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActive: {
    backgroundColor: colors.primary[50],
  },
});
