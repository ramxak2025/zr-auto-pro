/**
 * AdminShellNavigator — the dedicated superadmin platform-operator shell.
 *
 * A SEPARATE bottom-tab navigator (NOT the car-service MainTabs) with its own
 * floating glass bar (AdminTabBar) and no central Касса FAB. Rendered by
 * AppNavigator ONLY when `user.role === 'superadmin'`. Normal users never see
 * this; their navigator + native tab bar are untouched.
 *
 * Each admin tab is its own native-stack so detail screens (e.g.
 * AdminTenantDetail) push while the bar stays visible — the Apple-Mail pattern
 * the rest of the app uses.
 */
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AdminTabBar from './AdminTabBar';
import AdminOverviewScreen from '../screens/admin/AdminOverviewScreen';
import AdminTenantsScreen from '../screens/admin/AdminTenantsScreen';
import AdminTenantDetailScreen from '../screens/admin/AdminTenantDetailScreen';
import AdminPlansScreen from '../screens/admin/AdminPlansScreen';
import AdminBroadcastScreen from '../screens/admin/AdminBroadcastScreen';
import AdminMoreScreen from '../screens/admin/AdminMoreScreen';
import { screenErrorBoundaryLayout } from '../components/ErrorBoundary';

const AdminTab = createBottomTabNavigator();
const TenantsStack = createNativeStackNavigator();

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
    </TenantsStack.Navigator>
  );
}

// Overview also navigates into a tenant detail (from the expiring board /
// recent list). Give it its own stack so those pushes keep the bar.
const OverviewStack = createNativeStackNavigator();
function AdminOverviewStackNavigator() {
  return (
    <OverviewStack.Navigator screenOptions={TRANSPARENT_STACK_OPTIONS} screenLayout={screenErrorBoundaryLayout}>
      <OverviewStack.Screen name="AdminOverviewHome" component={AdminOverviewScreen} />
      <OverviewStack.Screen name="AdminTenantDetail" component={AdminTenantDetailScreen} />
    </OverviewStack.Navigator>
  );
}

export default function AdminShellNavigator() {
  return (
    <AdminTab.Navigator
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
      tabBar={(props) => <AdminTabBar {...props} />}
      // NOTE: screenLayout (screenErrorBoundaryLayout) is INTENTIONALLY NOT set
      // on the AdminTab.Navigator — same reasoning as the car-service
      // TabNavigator: a per-tab boundary keyed by route.key forces the tab
      // navigator to re-evaluate children on every tab-event, remounting the
      // nested stacks mid-navigation. Per-tab boundaries stay on the nested
      // stacks (TenantsStack/OverviewStack); tab-level crashes fall through to
      // the root Stack + App.tsx boundary.
    >
      <AdminTab.Screen name="AdminOverview" component={AdminOverviewStackNavigator} />
      <AdminTab.Screen name="AdminTenants" component={AdminTenantsStackNavigator} />
      <AdminTab.Screen name="AdminPlans" component={AdminPlansScreen} />
      <AdminTab.Screen name="AdminBroadcast" component={AdminBroadcastScreen} />
      <AdminTab.Screen name="AdminMore" component={AdminMoreScreen} />
    </AdminTab.Navigator>
  );
}
