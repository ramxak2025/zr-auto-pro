export type BookingsHubTab = 'calendar' | 'requests' | 'settings';

export const bookingsHubMenuEntry = {
  label: 'Записи',
  screen: 'BookingsHub',
};

export function bookingsHubTabs(canAccessBookings: boolean, canManageCompany: boolean) {
  return [
    ...(canAccessBookings
      ? [
          { key: 'calendar' as const, label: 'Календарь' },
          { key: 'requests' as const, label: 'Заявки' },
        ]
      : []),
    ...(canManageCompany ? [{ key: 'settings' as const, label: 'Онлайн-запись' }] : []),
  ];
}

/** The More menu uses this selector so bookings owners can reach settings-only access. */
export function canShowBookingsHubEntry(canAccessBookings: boolean, canManageCompany: boolean) {
  return canAccessBookings || canManageCompany;
}
