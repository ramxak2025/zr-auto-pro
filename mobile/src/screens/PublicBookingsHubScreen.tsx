import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import HubTabs from '../components/HubTabs';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import BookingsScreen from './BookingsScreen';
import PublicBookingRequestsScreen from './PublicBookingRequestsScreen';
import PublicBookingSettingsScreen from './PublicBookingSettingsScreen';
import { bookingsHubTabs, type BookingsHubTab } from './bookings/bookingHubTabs';

export default function PublicBookingsHubScreen() {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const canAccessBookings = hasPermission('bookings_access');
  const tabs = useMemo(() => bookingsHubTabs(canAccessBookings, canManage), [canAccessBookings, canManage]);
  const [activeTab, setActiveTab] = useState<BookingsHubTab>(canAccessBookings ? 'calendar' : 'settings');

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab) && tabs[0]) setActiveTab(tabs[0].key);
  }, [activeTab, tabs]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Записи" onBack={() => navigation.goBack()} />
      {tabs.length > 1 && <HubTabs options={tabs} value={activeTab} onChange={setActiveTab} />}
      <View style={styles.content}>
        {activeTab === 'calendar' && canAccessBookings ? <BookingsScreen embedded /> : null}
        {activeTab === 'requests' && canAccessBookings ? <PublicBookingRequestsScreen embedded /> : null}
        {activeTab === 'settings' && canManage ? <PublicBookingSettingsScreen embedded /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
