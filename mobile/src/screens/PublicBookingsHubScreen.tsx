import ScreenSectionHeader, { useScreenSectionScroll } from '../components/ScreenSectionHeader';
import { HeaderIsland, HeaderAction } from '../components/ScreenHeaderControls';
import { ScreenSectionScrollView } from '../components/ScreenSectionScrollable';
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
  const section = useScreenSectionScroll();

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

  // Changing tabs unmounts the previous native content scroller.
  React.useEffect(() => {
    section.reset();
  }, [activeTab, section.reset]);
  const renderSectionHeader = (controls: React.ReactNode, actions?: React.ReactNode) => (
    <ScreenSectionHeader scroll={section} title="Записи">
      <HeaderIsland layout="column">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <HeaderAction label="Назад" icon="chevron-back" onPress={() => navigation.goBack()} />
          <View
            style={{
              flex: 1,
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {actions}
          </View>
        </View>
        {tabs.length > 1 && <HubTabs options={tabs} value={activeTab} onChange={setActiveTab} />}
        {controls}
      </HeaderIsland>
    </ScreenSectionHeader>
  );

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      {!tabs.some((tab) => tab.key === activeTab) ? (
        <>
          <IosScreenHeader scroll={section} title="Записи" onBack={() => navigation.goBack()} />
          <ScreenSectionScrollView
            onScroll={section.onScroll}
            scrollEventThrottle={16}
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={{ paddingTop: section.contentTop }}
          />
        </>
      ) : null}

      <View style={styles.content}>
        {activeTab === 'calendar' && canAccessBookings ? (
          <BookingsScreen sectionController={section} sectionHeader={renderSectionHeader} embedded />
        ) : null}
        {activeTab === 'requests' && canAccessBookings ? (
          <PublicBookingRequestsScreen sectionController={section} sectionHeader={renderSectionHeader} embedded />
        ) : null}
        {activeTab === 'settings' && canManage ? (
          <PublicBookingSettingsScreen sectionController={section} sectionHeader={renderSectionHeader} embedded />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1 },
});
