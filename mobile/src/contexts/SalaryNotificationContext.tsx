/** Recipient inbox for payouts, fines and legacy payment confirmations.
 * A push wakes the inbox; it never supplies the displayed amount or reason.
 * One native modal prevents competing presentations on iOS.
 */
import React from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { createSalaryApi } from '../../../shared/api/createServices';
import { createSessionBoundClient, isCurrentAuthToken } from '../api/axios';
import { useAuth } from './AuthContext';
import SalaryReceivedModal from '../components/SalaryReceivedModal';
import { getSalaryAckQueue, type SalaryAckKind } from '../utils/salaryAckQueue';
import { isSalaryNoticePush, loadSalaryNotice, type SalaryNotice } from '../utils/salaryNotices';

interface SalaryNotificationContextValue {
  refresh: () => void;
}
const SalaryNotificationContext = React.createContext<SalaryNotificationContextValue | null>(null);

function sendAck(salaryApi: ReturnType<typeof createSalaryApi>, kind: SalaryAckKind, id: string): Promise<unknown> {
  if (kind === 'fineViewed') return salaryApi.markFineViewed(id);
  return kind === 'payoutViewed' ? salaryApi.markPayoutViewed(id) : salaryApi.confirmPayment(id);
}

export function SalaryNotificationProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const queryClient = useQueryClient();
  const recipient = !!user && (user.role === 'master' || user.role === 'admin');
  const ownerKey = user?.tenantId && recipient ? JSON.stringify([user.tenantId, user.id]) : null;
  // Token belongs in the in-memory generation only, never in an AsyncStorage key.
  const session = React.useMemo(() => ({ ownerKey, token }), [ownerKey, token]);
  const salaryApi = React.useMemo(() => createSalaryApi(createSessionBoundClient(token)), [session]);
  const send = React.useCallback((kind: SalaryAckKind, id: string) => sendAck(salaryApi, kind, id), [salaryApi]);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const queue = React.useMemo(
    () => (ownerKey && user?.tenantId ? getSalaryAckQueue({ tenantId: user.tenantId, userId: user.id }) : null),
    [ownerKey],
  );
  const [current, setCurrent] = React.useState<{ session: typeof session; notice: SalaryNotice } | null>(null);
  const suppressed = React.useRef(new Set<string>());
  const requestId = React.useRef(0);
  const busy = React.useRef(false);
  const closingUntil = React.useRef(0);
  const nextTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = React.useCallback(() => sessionRef.current === session && isCurrentAuthToken(token), [session, token]);

  const checkOnce = React.useCallback(async () => {
    if (!queue || !user || !active() || busy.current || Date.now() < closingUntil.current) return;
    const checkId = ++requestId.current;
    const isCurrent = () => active() && requestId.current === checkId && !busy.current;
    await queue.flush(send, isCurrent).catch(() => {});
    if (!isCurrent()) return;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const result = await loadSalaryNotice({
      userId: user.id,
      fines: async () => (await salaryApi.listUnviewedFines()).data,
      payouts: async () => (await salaryApi.listPayouts({ status: 'accepted', unviewed: true })).data,
      // /salary requires salary_view_all; the month detail permits self-read.
      payments: async () => (await salaryApi.getEmployeeMonth(user.id, month)).data.payments ?? [],
      suppressed: (kind, id) => queue.has(kind, id) || suppressed.current.has(`${kind}:${id}`),
      isCurrent,
    });
    if (result.stale || !isCurrent()) return;
    setCurrent((previous) => {
      if (result.notice) return { session, notice: result.notice };
      // A transient network error cannot erase an already displayed notice.
      return previous?.session === session && result.failed.includes(previous.notice.kind) ? previous : null;
    });
  }, [queue, user?.id, session, active, salaryApi, send]);

  React.useEffect(() => {
    requestId.current += 1;
    suppressed.current.clear();
    busy.current = false;
    closingUntil.current = 0;
    setCurrent(null);
    void checkOnce();
    return () => {
      requestId.current += 1;
      if (nextTimer.current) clearTimeout(nextTimer.current);
    };
  }, [session, checkOnce]);

  React.useEffect(() => {
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkOnce();
    });
    const push = Notifications.addNotificationReceivedListener((notification) => {
      if (isSalaryNoticePush(notification.request.content.data)) void checkOnce();
    });
    return () => {
      foreground.remove();
      push.remove();
    };
  }, [checkOnce]);

  const closeNotice = React.useCallback(() => {
    requestId.current += 1;
    setCurrent(null);
    // Give the native dialog time to dismiss before presenting the next
    // item. In particular, do not unmount/remount two iOS modals in one turn.
    closingUntil.current = Date.now() + 500;
    if (nextTimer.current) clearTimeout(nextTimer.current);
    nextTimer.current = setTimeout(() => {
      if (!active()) return;
      closingUntil.current = 0;
      void checkOnce();
    }, 500);
  }, [active, checkOnce]);

  const acknowledge = React.useCallback(async () => {
    if (!current || current.session !== session || !queue || !active() || busy.current) return;
    const { kind, item } = current.notice;
    busy.current = true;
    // Hide even offline. The queue is scoped by tenant + recipient.
    suppressed.current.add(`${kind}:${item.id}`);
    closeNotice();
    await queue.add(kind, item.id);
    if (!active()) return;
    await queue.flush(send, active).catch(() => {});
    if (!active()) return;
    busy.current = false;
    void queryClient.invalidateQueries({ queryKey: ['salary'] });
    void queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
    void checkOnce();
  }, [current, session, queue, active, queryClient, checkOnce, send, closeNotice]);

  const snooze = React.useCallback(() => {
    if (!current || current.session !== session) return;
    suppressed.current.add(`${current.notice.kind}:${current.notice.item.id}`);
    closeNotice();
    // No acknowledgement: the item returns on the next login/app session.
  }, [current, session, closeNotice]);

  const notice = current?.session === session && recipient ? current.notice : null;
  const value = React.useMemo(
    () => ({
      refresh: () => {
        void checkOnce();
      },
    }),
    [checkOnce],
  );
  return (
    <SalaryNotificationContext.Provider value={value}>
      {children}
      <SalaryReceivedModal
        visible={!!notice}
        fine={notice?.kind === 'fineViewed' ? notice.item : null}
        payout={notice?.kind === 'payoutViewed' ? notice.item : null}
        payment={notice?.kind === 'paymentConfirmed' ? notice.item : null}
        confirming={false}
        onConfirm={acknowledge}
        onAcknowledge={acknowledge}
        onSnooze={snooze}
      />
    </SalaryNotificationContext.Provider>
  );
}

export function useSalaryNotification(): SalaryNotificationContextValue {
  const ctx = React.useContext(SalaryNotificationContext);
  if (!ctx) throw new Error('useSalaryNotification must be used within <SalaryNotificationProvider>');
  return ctx;
}
