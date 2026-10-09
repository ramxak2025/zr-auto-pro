import { publicBookingsTabs } from '../bookingHubTabs';

it('shows only the online-booking tabs authorized for this role', () => {
  expect(publicBookingsTabs(true, false)).toEqual([{ key: 'settings', label: 'Страница' }]);
  expect(publicBookingsTabs(false, true)).toEqual([{ key: 'requests', label: 'Заявки' }]);
  expect(publicBookingsTabs(true, true).map((tab) => tab.key)).toEqual(['settings', 'requests']);
  expect(publicBookingsTabs(false, false)).toEqual([]);
});
