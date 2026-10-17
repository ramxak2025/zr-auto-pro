import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminTabBar, { type AdminShellMode } from './AdminTabBar';
import AdminOverviewScreen from '../screens/admin/AdminOverviewScreen';
import AdminTenantsScreen from '../screens/admin/AdminTenantsScreen';
import AdminTenantDetailScreen from '../screens/admin/AdminTenantDetailScreen';
import AdminTenantAuditScreen from '../screens/admin/AdminTenantAuditScreen';
import AdminRegistrationRequestsScreen from '../screens/admin/AdminRegistrationRequestsScreen';
import AdminPlansScreen from '../screens/admin/AdminPlansScreen';
import AdminBroadcastScreen from '../screens/admin/AdminBroadcastScreen';
import AdminMoreScreen from '../screens/admin/AdminMoreScreen';
import AdminManagersScreen from '../screens/admin/AdminManagersScreen';
import AdminManagerDetailScreen from '../screens/admin/AdminManagerDetailScreen';
import ManagerLedgerScreen from '../screens/admin/ManagerLedgerScreen';
import AdminAnalyticsScreen from '../screens/admin/AdminAnalyticsScreen';
import AdminIncomeScreen from '../screens/admin/AdminIncomeScreen';
import AdminRemindersScreen from '../screens/admin/AdminRemindersScreen';
import AdminReminderSettingsScreen from '../screens/admin/AdminReminderSettingsScreen';
import AdminActivityScreen from '../screens/admin/AdminActivityScreen';
import { AdminModeProvider, useAdminMode } from '../screens/admin/adminShared';
import { screenErrorBoundaryLayout } from '../components/ErrorBoundary';
const Tab = createBottomTabNavigator(),
  Stack = createNativeStackNavigator();
const options = { headerShown: false, contentStyle: { backgroundColor: 'transparent' } } as const;
function OperatorStack({ home, component }: { home: string; component: React.ComponentType }) {
  const mode = useAdminMode();
  return (
    <Stack.Navigator screenOptions={options} screenLayout={screenErrorBoundaryLayout}>
      <Stack.Screen name={home} component={component} />
      <Stack.Screen name="AdminTenantDetail" component={AdminTenantDetailScreen} />
      <Stack.Screen name="AdminTenantAudit" component={AdminTenantAuditScreen} />
      <Stack.Screen name="AdminReminders" component={AdminRemindersScreen} />
      <Stack.Screen name="AdminReminderSettings" component={AdminReminderSettingsScreen} />
      <Stack.Screen name="AdminActivity" component={AdminActivityScreen} />
      {mode === 'superadmin' ? (
        <>
          <Stack.Screen name="AdminRegistrationRequests" component={AdminRegistrationRequestsScreen} />
          <Stack.Screen name="AdminPlans" component={AdminPlansScreen} />
          <Stack.Screen name="AdminBroadcast" component={AdminBroadcastScreen} />
          <Stack.Screen name="AdminManagers" component={AdminManagersScreen} />
          <Stack.Screen name="AdminManagerDetail" component={AdminManagerDetailScreen} />
        </>
      ) : (
        <Stack.Screen name="ManagerLedger" component={ManagerLedgerScreen} />
      )}
    </Stack.Navigator>
  );
}
function Overview() {
  return <OperatorStack home="AdminOverviewHome" component={AdminOverviewScreen} />;
}
function Tenants() {
  return <OperatorStack home="AdminTenantsHome" component={AdminTenantsScreen} />;
}
function Team() {
  return <OperatorStack home="AdminTeamHome" component={AdminManagersScreen} />;
}
function More() {
  return <OperatorStack home="AdminMoreHome" component={AdminMoreScreen} />;
}
function Income() {
  return <OperatorStack home="AdminIncomeHome" component={AdminIncomeScreen} />;
}
export default function AdminShellNavigator({ mode }: { mode: AdminShellMode }) {
  return (
    <AdminModeProvider value={mode}>
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        <Tab.Navigator
          key={mode}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: 'transparent' },
            tabBarStyle: { position: 'absolute', backgroundColor: 'transparent', borderTopWidth: 0 },
          }}
          tabBar={(props) => <AdminTabBar {...props} mode={mode} />}
        >
          <Tab.Screen name="AdminOverview" component={Overview} />
          <Tab.Screen name="AdminTenants" component={Tenants} />
          {mode === 'superadmin' ? (
            <>
              <Tab.Screen name="AdminAnalytics" component={AdminAnalyticsScreen} />
              <Tab.Screen name="AdminTeam" component={Team} />
            </>
          ) : (
            <Tab.Screen name="AdminIncome" component={Income} />
          )}
          <Tab.Screen name="AdminMore" component={More} />
        </Tab.Navigator>
      </SafeAreaView>
    </AdminModeProvider>
  );
}
