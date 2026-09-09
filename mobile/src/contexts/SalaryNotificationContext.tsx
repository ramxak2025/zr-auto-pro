/**
 * SalaryNotificationContext — surfaces money the owner sent to the currently
 * logged-in EMPLOYEE and drives the global <SalaryReceivedModal />.
 *
 * Two flows coexist:
 *
 *   1. ВЫПЛАТЫ (salary_payouts) — `createPayout`. Round 17 (158): решения
 *      сотрудника БОЛЬШЕ НЕТ — выплата фиксируется в момент выдачи (расход
 *      пишется там же), сотруднику показывается уведомление «выплата выдана»,
 *      а закрытие («Понятно») помечает её ПРОСМОТРЕННОЙ для владельца
 *      (`salaryApi.markPayoutViewed`). Детект —
 *      `salaryApi.listPayouts({ status: 'accepted', unviewed: true })` (сервер
 *      сам ограничивает сотрудника его собственными строками).
 *
 *   2. LEGACY salary_payments — `createPayment` → `confirmPayment`. A single
 *      «Подтвердить получение» acknowledgement. Detected by walking the
 *      current-month `salaryApi.getAll(...)` for an unconfirmed payment whose
 *      `userId` is the current user. Kept intact for already-issued payments.
 *
 * Выплата имеет приоритет: сначала проверяем её и только потом легаси. После
 * закрытия/подтверждения перепроверяем — следующая непросмотренная всплывает
 * сразу.
 *
 * Re-checks fire after login, on app foreground, and on a salary/payout push.
 * Owners (superadmin / director) never see the modal — they're the SENDERS.
 */
import React from 'react';
import { Alert, AppState, type AppStateStatus } from 'react-native';
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

/**
 * 158 — первая НЕ ПРОСМОТРЕННАЯ зафиксированная выплата сотрудника. Статус и
 * viewed_at сервер уже отфильтровал, но проверяем ещё раз: ответ может прийти
 * из кэша старой версии клиента/прокси, а показывать чужую или отменённую
 * выплату нельзя.
 */
function findUnviewedPayout(rows: SalaryPayout[] | undefined, userId: string): SalaryPayout | null {
  if (!rows || rows.length === 0) return null;
  for (const p of rows) {
    if (p.status === 'accepted' && !p.viewedAt && p.userId === userId) return p;
  }
  return null;
}

/**
 * Round 15 review-fix (п.2а) — текст ошибки сервера для алерта. Nest отдаёт
 * message строкой или массивом (ValidationPipe); падение сети текста не имеет.
 */
function serverMessage(err: unknown): string {
  const msg = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join('\n');
  if (typeof msg === 'string' && msg.trim()) return msg;
  return 'Выплата больше не актуальна';
}

/** 4xx = состояние выплаты изменилось (отменена/сторнирована/уже обработана) — повтор не поможет. */
function isClientError(err: unknown): boolean {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
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
  // Любая mutation в полёте (просмотр выплаты / подтверждение легаси-платежа).
  const [busy, setBusy] = React.useState(false);

  // Owners / directors never see the modal — they're the senders, not the
  // recipients. «Сотрудник» = admin + master.
  const isRecipientRole = !!user && (user.role === 'master' || user.role === 'admin');

  const checkOnce = React.useCallback(async () => {
    if (!user || !isRecipientRole) return;
    // Round 15 review-fix (п.2б): раньше ветки очистки не было вовсе — модал,
    // однажды показанный, жил до перезапуска, даже когда владелец уже отменил
    // выплату (сервер её больше не отдаёт). «Ничего pending не найдено» — это
    // тоже данные: они сбрасывают pendingPayout/pendingPayment/modalVisible.
    // Чистим только то, что ПОДТВЕРЖДЕНО успешным ответом сервера: упавшая
    // сеть не закрывает валидный модал вслепую.
    let payoutsKnownEmpty = false;
    // 1) ВЫПЛАТЫ — зафиксированные, но ещё не просмотренные сотрудником.
    try {
      const res = await salaryApi.listPayouts({ status: 'accepted', unviewed: true });
      const payout = findUnviewedPayout(res.data, user.id);
      if (payout) {
        setPendingPayout(payout);
        setPendingPayment(null);
        setModalVisible(true);
        return;
      }
      payoutsKnownEmpty = true;
      setPendingPayout(null);
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
        return;
      }
      setPendingPayment(null);
      // Оба источника ответили «пусто» — закрываем модал. Если payouts-чек
      // упал, а показан payout, модал не трогаем (не по чему судить); модал
      // с обнулённым item и так ничего не рендерит.
      if (payoutsKnownEmpty) setModalVisible(false);
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
      // Round 15 (п.2в): backend шлёт type 'payout-cancelled' / 'payment-reversed'
      // при отмене/сторно владельцем — пересинхронизируем открытый модал
      // (checkOnce теперь умеет и ЗАКРЫВАТЬ его, ветка очистки выше).
      if (t.includes('salary') || t.includes('payout') || t.includes('payment')) {
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
    } catch (err) {
      // Round 15 review-fix (п.2а): 4xx = выплату сторнировали, пока модал был
      // открыт — держать его «до победного» нельзя (сервер будет отвечать 400
      // вечно). Закрываем, честно показываем причину сервера и
      // пересинхронизируемся. Сеть/5xx — остаёмся: повтор может пройти.
      if (isClientError(err)) {
        setModalVisible(false);
        setTimeout(() => setPendingPayment(null), 220);
        Alert.alert('Выплата недоступна', serverMessage(err));
        setTimeout(() => checkOnce(), 500);
      }
      // Otherwise stay on the modal so the employee can retry.
    } finally {
      setBusy(false);
    }
  }, [pendingPayment, busy, queryClient, checkOnce]);

  // 158 — сотрудник закрыл уведомление о выплате: помечаем «просмотрено».
  // Денег не двигает — только снимает у владельца отметку «не просмотрено».
  const onAcknowledge = React.useCallback(async () => {
    if (!pendingPayout || busy) return;
    setBusy(true);
    try {
      await salaryApi.markPayoutViewed(pendingPayout.id);
      setModalVisible(false);
      setTimeout(() => setPendingPayout(null), 240);
      haptic('success');
      // Отметка видна владельцу в списке выплат и в карточке месяца.
      queryClient.invalidateQueries({ queryKey: ['salary'] });
      queryClient.invalidateQueries({ queryKey: ['salary-employee-month'] });
      setTimeout(() => checkOnce(), 500);
    } catch (err) {
      // 4xx — выплату отменили, пока модал был открыт: держать его «до
      // победного» нельзя (сервер будет отвечать так же). Закрываем, честно
      // показываем причину и пересинхронизируемся. Сеть/5xx — остаёмся,
      // повтор может пройти.
      if (isClientError(err)) {
        setModalVisible(false);
        setTimeout(() => setPendingPayout(null), 240);
        Alert.alert('Выплата недоступна', serverMessage(err));
        setTimeout(() => checkOnce(), 500);
      }
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
        onConfirm={onConfirm}
        onAcknowledge={onAcknowledge}
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
