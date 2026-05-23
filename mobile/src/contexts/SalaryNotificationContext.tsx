/**
 * SalaryNotificationContext — detects unconfirmed salary payments for the
 * currently logged-in user and exposes a single global <SalaryReceivedModal />.
 *
 * Detection strategy (intentionally simple, no new backend endpoint):
 *
 *   1. After login (or any cold-start with an active session), the
 *      provider fires `salaryApi.getAll({ dateFrom, dateTo })` for the
 *      CURRENT month.
 *   2. Walks every `MasterSalary.payments[]` and picks the first row
 *      where `confirmedAt === null` AND `userId === user.id`.
 *   3. That payment becomes `pendingPayment` in state → the modal mounts.
 *   4. After the employee confirms (`salaryApi.confirmPayment`), the
 *      query is invalidated so the same payment won't reappear, and the
 *      modal slides out.
 *
 * Why month-scoped and not a generic endpoint:
 *   The task spec lists "GET /salary/payments/pending-confirmation" as
 *   "OR — simpler — when fetching `salaryApi.getAll(currentMonth)` …".
 *   We pick the simpler path since the salary endpoint already returns
 *   `confirmedAt` and is already cached + prefetched in many places —
 *   no new contract to add.
 *
 * Re-checks:
 *   • After login (push fires `refresh()`).
 *   • When the app comes to foreground (AppState change).
 *   • When a push notification of type `salary_payment` arrives.
 *
 * Owners (superadmin / director) NEVER receive this modal — the modal is
 * "ваши деньги пришли", which is meaningless for the person who SENT them.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { salaryApi } from '../api/services';
import { useAuth } from './AuthContext';
import SalaryReceivedModal from '../components/SalaryReceivedModal';
import type { MasterSalary, SalaryPayment } from '../../../shared/types';

interface SalaryNotificationContextValue {
  /** Re-fetches the salary endpoint to look for a fresh unconfirmed payment. */
  refresh: () => void;
}

const SalaryNotificationContext = React.createContext<SalaryNotificationContextValue | null>(null);

function currentMonthRange(): { dateFrom: string; dateTo: string; monthYear: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateFrom = `${year}-${pad(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const dateTo = `${year}-${pad(month + 1)}-${pad(lastDay)}`;
  const monthYear = `${year}-${pad(month + 1)}`;
  return { dateFrom, dateTo, monthYear };
}

function findPendingPayment(rows: MasterSalary[] | undefined, userId: string): SalaryPayment | null {
  if (!rows || rows.length === 0) return null;
  for (const row of rows) {
    if (row.masterId !== userId) continue;
    for (const p of row.payments || []) {
      if (!p.confirmedAt && p.userId === userId) {
        return p;
      }
    }
  }
  return null;
}

interface ProviderProps {
  children: React.ReactNode;
}

export function SalaryNotificationProvider({ children }: ProviderProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [pendingPayment, setPendingPayment] = React.useState<SalaryPayment | null>(null);
  const [modalVisible, setModalVisible] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  // Owners / directors never see the modal — they're the senders, not
  // the recipients.
  const isRecipientRole = !!user && (user.role === 'master' || user.role === 'admin');

  const checkOnce = React.useCallback(async () => {
    if (!user || !isRecipientRole) return;
    const { dateFrom, dateTo } = currentMonthRange();
    try {
      const res = await salaryApi.getAll({ dateFrom, dateTo });
      const found = findPendingPayment(res.data, user.id);
      if (found) {
        setPendingPayment(found);
        setModalVisible(true);
      }
    } catch {
      // Silent — push will re-trigger us, or AppState change on next foreground.
    }
  }, [user, isRecipientRole]);

  // Initial check after login. Also re-checks every time `user` changes —
  // covers manual logout/login within the same app session.
  React.useEffect(() => {
    if (!user) {
      // Reset on logout so a stale modal doesn't show on the login screen.
      setPendingPayment(null);
      setModalVisible(false);
      return;
    }
    checkOnce();
  }, [user, checkOnce]);

  // Foreground events — owners often send the payment while the
  // employee's app is backgrounded. When the employee brings the app
  // back, we re-check so the modal can pop up immediately.
  React.useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') checkOnce();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [checkOnce]);

  // Push-notification trigger. Backend already sends the push when
  // `createPayment` runs; we listen for it and re-check the salary
  // endpoint so the modal can mount even if the push arrived in the
  // foreground (in which case the OS doesn't surface a banner).
  React.useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const t = typeof data?.type === 'string' ? data.type : '';
      if (t === 'salary_payment' || t === 'salary' || t === 'salary-payment') {
        checkOnce();
      }
    });
    return () => sub.remove();
  }, [checkOnce]);

  const onConfirm = React.useCallback(async () => {
    if (!pendingPayment || confirming) return;
    setConfirming(true);
    try {
      await salaryApi.confirmPayment(pendingPayment.id);
      // Drop the modal first so the employee gets immediate feedback,
      // then invalidate the cache so the owner's screen sees the
      // confirmedAt timestamp on next refetch.
      setModalVisible(false);
      // Defer state cleanup so the close tween can play.
      setTimeout(() => setPendingPayment(null), 220);
      queryClient.invalidateQueries({ queryKey: ['salary'] });
    } catch {
      // Stay on the modal so the employee can retry.
    } finally {
      setConfirming(false);
    }
  }, [pendingPayment, confirming, queryClient]);

  const ctx = React.useMemo<SalaryNotificationContextValue>(
    () => ({
      refresh: checkOnce,
    }),
    [checkOnce],
  );

  return (
    <SalaryNotificationContext.Provider value={ctx}>
      {children}
      <SalaryReceivedModal
        visible={modalVisible}
        payment={pendingPayment}
        confirming={confirming}
        onConfirm={onConfirm}
      />
    </SalaryNotificationContext.Provider>
  );
}

export function useSalaryNotification(): SalaryNotificationContextValue {
  const ctx = React.useContext(SalaryNotificationContext);
  if (!ctx) {
    throw new Error('useSalaryNotification must be used within <SalaryNotificationProvider>');
  }
  return ctx;
}
