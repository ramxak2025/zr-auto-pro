/**
 * SalaryNotificationContext — surfaces money the owner sent to the currently
 * logged-in EMPLOYEE and drives the global <SalaryReceivedModal />.
 *
 * Two flows coexist:
 *
 *   1. NEW payouts (100_salary_payouts_and_fines) — `createPayout` →
 *      `decidePayout`. The владелец issues a ЗП / АВАНС; it starts `pending`
 *      and the employee must ACCEPT or REJECT. On accept the backend records
 *      the expense (category «Зарплата»); on reject it's voided and the owner
 *      sees the «Отклонено» status. Detected via
 *      `salaryApi.listPayouts({ status: 'pending' })` (the server scopes an
 *      employee to their own rows).
 *
 *   2. LEGACY salary_payments — `createPayment` → `confirmPayment`. A single
 *      «Подтвердить получение» acknowledgement. Detected by walking the
 *      current-month `salaryApi.getAll(...)` for an unconfirmed payment whose
 *      `userId` is the current user. Kept intact for already-issued payments.
 *
 * The NEW payout takes precedence: we check payouts first and only fall back to
 * legacy detection when there's no pending payout. After a decision/confirm we
 * re-check so a second pending item surfaces immediately.
 *
 * Re-checks fire after login, on app foreground, and on a salary/payout push.
 * Owners (superadmin / director) never see the modal — they're the SENDERS.
 */
import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { salaryApi } from '../api/services';
import { useAuth } from './AuthContext';
import { haptic } from '../platform/haptics';
import SalaryReceivedModal from '../components/SalaryReceivedModal';
import type { MasterSalary, SalaryPayment, SalaryPayout } from '../../../shared/types';

interface SalaryNotificationContextValue {
  /** Re-fetches the salary endpoints to look for a fresh unconfirmed payout/payment. */
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
      // 153 — сторнированная владельцем выплата подтверждения не требует
      // (сервер и так вернёт 400 на confirm; не дёргаем сотрудника модалом).
      if (!p.confirmedAt && !p.reversedAt && p.userId === userId) {
        return p;
      }
    }
  }
  return null;
}

function findPendingPayout(rows: SalaryPayout[] | undefined, userId: string): SalaryPayout | null {
  if (!rows || rows.length === 0) return null;
  // Oldest first so the employee clears the queue in the order it arrived.
  for (const p of rows) {
    if (p.status === 'pending' && p.userId === userId) return p;
  }
  return null;
}

interface ProviderProps {
  children: React.ReactNode;
}

export function SalaryNotificationProvider({ children }: ProviderProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [pendingPayout, setPendingPayout] = React.useState<SalaryPayout | null>(null);
  const [pendingPayment, setPendingPayment] = React.useState<SalaryPayment | null>(null);
  const [modalVisible, setModalVisible] = React.useState(false);
  // Any decide/confirm mutation in flight. `decision` says which payout button
  // is busy so only that one spins.
  const [busy, setBusy] = React.useState(false);
  const [decision, setDecision] = React.useState<'accept' | 'reject' | null>(null);

  // Owners / directors never see the modal — they're the senders, not the
  // recipients. «Сотрудник» = admin + master.
  const isRecipientRole = !!user && (user.role === 'master' || user.role === 'admin');

  const checkOnce = React.useCallback(async () => {
    if (!user || !isRecipientRole) return;
    // 1) NEW payouts first — these need an accept/reject decision.
    try {
      const res = await salaryApi.listPayouts({ status: 'pending' });
      const payout = findPendingPayout(res.data, user.id);
      if (payout) {
        setPendingPayout(payout);
        setPendingPayment(null);
        setModalVisible(true);
        return;
      }
    } catch {
      // Endpoint unavailable / transient — fall through to legacy detection.
    }
    // 2) LEGACY salary_payments — single «Подтвердить получение».
    try {
      const { dateFrom, dateTo } = currentMonthRange();
      const res = await salaryApi.getAll({ dateFrom, dateTo });
      const found = findPendingPayment(res.data, user.id);
      if (found) {
        setPendingPayment(found);
        setPendingPayout(null);
        setModalVisible(true);
      }
    } catch {
      // Silent — push will re-trigger us, or AppState change on next foreground.
    }
  }, [user, isRecipientRole]);

  // Initial check after login. Also re-checks every time `user` changes.
  React.useEffect(() => {
    if (!user) {
      // Reset on logout so a stale modal doesn't show on the login screen.
      setPendingPayout(null);
      setPendingPayment(null);
      setModalVisible(false);
      return;
    }
    checkOnce();
  }, [user, checkOnce]);

  // Foreground events — the owner often issues the payout while the employee's
  // app is backgrounded. Re-check when it returns so the modal pops immediately.
  React.useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') checkOnce();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [checkOnce]);

  // Push trigger. The backend pushes when a payout/payment is issued; re-check
  // so the modal can mount even if the push arrived in the foreground.
  React.useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const t = typeof data?.type === 'string' ? data.type : '';
      if (t.includes('salary') || t.includes('payout')) {
        checkOnce();
      }
    });
    return () => sub.remove();
  }, [checkOnce]);

  // Legacy confirm (salary_payments).
  const onConfirm = React.useCallback(async () => {
    if (!pendingPayment || busy) return;
    setBusy(true);
    try {
      await salaryApi.confirmPayment(pendingPayment.id);
      setModalVisible(false);
      setTimeout(() => setPendingPayment(null), 220);
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      // Surface the next pending item (payout or payment), if any.
      setTimeout(() => checkOnce(), 500);
    } catch {
      // Stay on the modal so the employee can retry.
    } finally {
      setBusy(false);
    }
  }, [pendingPayment, busy, queryClient, checkOnce]);

  // NEW payout — accept.
  const onAccept = React.useCallback(async () => {
    if (!pendingPayout || busy) return;
    setBusy(true);
    setDecision('accept');
    try {
      await salaryApi.decidePayout(pendingPayout.id, 'accept');
      setModalVisible(false);
      setTimeout(() => {
        setPendingPayout(null);
        setDecision(null);
      }, 240);
      haptic('success');
      // Accept records an expense (category «Зарплата») — cash leaves the till,
      // so the dashboard/cashflow + the employee's month card must refresh.
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      setTimeout(() => checkOnce(), 500);
    } catch {
      // Stay on the modal so the employee can retry.
      setDecision(null);
    } finally {
      setBusy(false);
    }
  }, [pendingPayout, busy, queryClient, checkOnce]);

  // NEW payout — reject.
  const onReject = React.useCallback(async () => {
    if (!pendingPayout || busy) return;
    setBusy(true);
    setDecision('reject');
    try {
      await salaryApi.decidePayout(pendingPayout.id, 'reject');
      setModalVisible(false);
      setTimeout(() => {
        setPendingPayout(null);
        setDecision(null);
      }, 240);
      haptic('warning');
      // Reject voids the payout — no expense recorded; refresh the owner list +
      // the employee's month card so the «Отклонено» status shows.
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
      setTimeout(() => checkOnce(), 500);
    } catch {
      setDecision(null);
    } finally {
      setBusy(false);
    }
  }, [pendingPayout, busy, queryClient, checkOnce]);

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
        payout={pendingPayout}
        confirming={busy}
        decision={decision}
        onConfirm={onConfirm}
        onAccept={onAccept}
        onReject={onReject}
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
