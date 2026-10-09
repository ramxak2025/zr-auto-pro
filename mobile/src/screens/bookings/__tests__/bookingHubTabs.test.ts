import { bookingsHubMenuEntry, bookingsHubTabs, canShowBookingsHubEntry } from '../bookingHubTabs';

it('More exposes one Записи hub to either authorized role and the hub selects permitted sections', () => {
  expect(bookingsHubMenuEntry).toMatchObject({ label: 'Записи', screen: 'BookingsHub' });
  expect(canShowBookingsHubEntry(true, false)).toBe(true);
  expect(canShowBookingsHubEntry(false, true)).toBe(true);
  expect(canShowBookingsHubEntry(false, false)).toBe(false);

  expect(bookingsHubTabs(true, false)).toEqual([
    { key: 'calendar', label: 'Календарь' },
    { key: 'requests', label: 'Заявки' },
  ]);
  expect(bookingsHubTabs(false, true)).toEqual([{ key: 'settings', label: 'Онлайн-запись' }]);
  expect(bookingsHubTabs(true, true).map((tab) => tab.key)).toEqual(['calendar', 'requests', 'settings']);
  expect(bookingsHubTabs(false, false)).toEqual([]);
});
