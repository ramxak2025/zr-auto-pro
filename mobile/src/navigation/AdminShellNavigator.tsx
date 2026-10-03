/**
 * AdminShellNavigator — the dedicated platform-operator shell.
 *
 * A SEPARATE bottom-tab navigator (NOT the car-service MainTabs) with its own
 * floating glass bar (AdminTabBar) and no central Касса FAB. Rendered by
 * AppNavigator ONLY for `superadmin` (5 tabs) and `manager` (Обзор · Автосервисы ·
 * Ещё — a manager is tenant-less and sees only their own car services). Normal
 * users never see this; their navigator + native tab bar are untouched.
 *
 * Each admin tab is its own native-stack so detail screens (e.g.
 * AdminTenantDetail) push while the bar stays visible — the Apple-Mail pattern
 * the rest of the app uses. The shell mode reaches every nested stack and screen
 * through AdminModeProvider (one source of truth, no per-screen role checks).
 */
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
import { AdminModeProvider, useAdminMode } from '../screens/admin/adminShared';
import { screenErrorBoundaryLayout } from '../components/ErrorBoundary';

const AdminTab = createBottomTabNavigator();
const TenantsStack = createNativeStackNavigator();
const OverviewStack = createNativeStackNavigator();
const MoreStack = createNativeStackNavigator();

const TRANSPARENT_STACK_OPTIONS = {
  headerShown: false,
  contentStyle: { backgroundColor: 'transparent' },
} as const;

// Tenants tab is a native-stack: list → detail pushes, admin bar stays.
function AdminTenantsStackNavigator() {
  return (
    <TenantsStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <TenantsStack.Screen name="AdminTenantsHome" component={AdminTenantsScreen} />
      <TenantsStack.Screen name="AdminTenantDetail" component={AdminTenantDetailScreen} />
      <TenantsStack.Screen name="AdminTenantAudit" component={AdminTenantAuditScreen} />
    </TenantsStack.Navigator>
  );
}

// Overview also navigates into a tenant detail (from the expiring board /
// recent list). Give it its own stack so those pushes keep the bar.
// Заявки на регистрацию — только у суперадмина.
function AdminOverviewStackNavigator() {
  const mode = useAdminMode();
  return (
    <OverviewStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <OverviewStack.Screen name="AdminOverviewHome" component={AdminOverviewScreen} />
      {mode === 'superadmin' && (
        <OverviewStack.Screen name="AdminRegistrationRequests" component={AdminRegistrationRequestsScreen} />
      )}
      <OverviewStack.Screen name="AdminTenantDetail" component={AdminTenantDetailScreen} />
      <OverviewStack.Screen name="AdminTenantAudit" component={AdminTenantAuditScreen} />
    </OverviewStack.Navigator>
  );
}

// «Ещё» is a stack too: суперадмин → «Менеджеры» (список → кабинет менеджера → карточка
// клиента), менеджер → «Расчёты». Pushes keep the floating bar visible.
function AdminMoreStackNavigator() {
  const mode = useAdminMode();
  return (
    <MoreStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <MoreStack.Screen name="AdminMoreHome" component={AdminMoreScreen} />
      {mode === 'superadmin' && <MoreStack.Screen name="AdminManagers" component={AdminManagersScreen} />}
      {mode === 'superadmin' && <MoreStack.Screen name="AdminManagerDetail" component={AdminManagerDetailScreen} />}
      {mode === 'superadmin' && <MoreStack.Screen name="AdminTenantDetail" component={AdminTenantDetailScreen} />}
      {mode === 'superadmin' && <MoreStack.Screen name="AdminTenantAudit" component={AdminTenantAuditScreen} />}
      {mode === 'manager' && <MoreStack.Screen name="ManagerLedger" component={ManagerLedgerScreen} />}
    </MoreStack.Navigator>
  );
}

export default function AdminShellNavigator({ mode }: { mode: AdminShellMode }) {
  const isSuperadmin = mode === 'superadmin';
  return (
    <AdminModeProvider value={mode}>
      <SafeAreaView style={{ flex: 1 }} edges={['left', 'right']}>
        <AdminTab.Navigator
          key={mode}
          screenOptions={{
            headerShown: false,
            sceneStyle: { backgroundColor: 'transparent' },
            tabBarStyle: {
              position: 'absolute',
              backgroundColor: 'transparent',
              borderTopWidth: 0,
              elevation: 0,
            },
          }}
          // eslint-disable-next-line react/no-unstable-nested-components
          tabBar={(props) => <AdminTabBar {...props} mode={mode} />}
          // NOTE: screenLayout (screenErrorBoundaryLayout) is INTENTIONALLY NOT set
          // on the AdminTab.Navigator — same reasoning as the car-service
          // TabNavigator: a per-tab boundary keyed by route.key forces the tab
          // navigator to re-evaluate children on every tab-event, remounting the
          // nested stacks mid-navigation. Per-tab boundaries stay on the nested
          // stacks (TenantsStack/OverviewStack/MoreStack); tab-level crashes fall
          // through to the root Stack + App.tsx boundary.
        >
          <AdminTab.Screen name="AdminOverview" component={AdminOverviewStackNavigator} />
          <AdminTab.Screen name="AdminTenants" component={AdminTenantsStackNavigator} />
          {isSuperadmin && <AdminTab.Screen name="AdminPlans" component={AdminPlansScreen} />}
          {isSuperadmin && <AdminTab.Screen name="AdminBroadcast" component={AdminBroadcastScreen} />}
          <AdminTab.Screen name="AdminMore" component={AdminMoreStackNavigator} />
        </AdminTab.Navigator>
      </SafeAreaView>
    </AdminModeProvider>
  );
}
