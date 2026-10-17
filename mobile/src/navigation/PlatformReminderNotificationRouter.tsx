import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { createManagerCabinetApi } from '../../../shared/api/createServices';
import { captureAuthSession, createSessionBoundClient } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { captureDataSession } from '../contexts/dataSession';
import { showToast } from '../components/Toast';
import { createPlatformReminderPushHandler } from './platformReminderPush';

const handled = new Set<string>();

export default function PlatformReminderNotificationRouter({
  ready,
  openTenant,
}: {
  ready: boolean;
  openTenant: (id: string) => void;
}) {
  const { user, token, loading, recoveringSession } = useAuth();
  useEffect(() => {
    if (
      !ready ||
      loading ||
      recoveringSession ||
      !token ||
      !user ||
      (user.role !== 'superadmin' && user.role !== 'manager')
    )
      return;
    let active = true;
    const auth = captureAuthSession();
    const dataSession = captureDataSession();
    const api = createManagerCabinetApi(createSessionBoundClient(auth.token));
    const handle = createPlatformReminderPushHandler({
      user,
      isCurrent: () => active && auth.isCurrent() && dataSession.isCurrent(),
      canOpenTenant: async (id) => (await api.tenant(id)).data.id === id,
      openTenant,
      unavailable: () =>
        showToast('Не удалось открыть автосервис. Проверьте доступ и повторите из списка клиентов.', 'error'),
      handled,
      consumed: (responseId) => {
        // Do not reopen an already handled reminder on every later cold start.
        // Never clear a different feature's newer notification response.
        void Notifications.getLastNotificationResponseAsync()
          .then((last) => {
            if (
              active &&
              auth.isCurrent() &&
              dataSession.isCurrent() &&
              last?.notification.request.identifier === responseId
            ) {
              return Notifications.clearLastNotificationResponseAsync();
            }
          })
          .catch(() => {
            // Clearing OS receipt metadata is best-effort; the in-memory guard
            // still deduplicates this response during the current launch.
          });
      },
    });
    const receive = (response: Notifications.NotificationResponse) => {
      void handle(response.notification.request.identifier, response.notification.request.content.data);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(receive);
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) receive(response);
      })
      .catch(() => {
        // The inbox remains available when the OS has no readable last response.
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [ready, loading, recoveringSession, token, user, openTenant]);
  return null;
}
