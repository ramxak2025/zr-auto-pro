export type PublicBookingsTab = 'settings' | 'requests';

export function publicBookingsTabs(canManage: boolean, canReview: boolean) {
  return [
    ...(canManage ? [{ key: 'settings' as const, label: 'Страница' }] : []),
    ...(canReview ? [{ key: 'requests' as const, label: 'Заявки' }] : []),
  ];
}
