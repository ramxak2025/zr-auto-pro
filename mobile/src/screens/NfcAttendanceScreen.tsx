import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { useAttendanceNfcSession, NFC_STATUS_QUERY_KEY, nfcStatusQueryKey } from '../hooks/useAttendanceNfcSession';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { nativePendingNfc } from '../utils/nativePendingNfc';
import {
  readAttendanceNfcUri,
  checkAttendanceNfcHardware,
  cancelAttendanceNfcOperation,
  createAttendanceNfcOperation,
} from '../utils/attendanceNfcDevice';
import { takePendingAttendanceLink, subscribePendingAttendanceLink } from '../utils/nfcLinkInbox';
import { parseAttendanceNfcUri } from '../../../shared/utils/attendanceNfcUri';
import { ownsNfcOutcome } from '../../../shared/utils/pendingNfc';
import { createNfcOperationLeaseController } from '../utils/nfcOperationLease';
import { refreshNfcStatusForCurrentSession } from '../utils/nfcStatusRefresh';
import type { AttendanceNfcScanResult } from '../../../shared/types';

type ScreenState = 'idle' | 'loading' | 'pending' | 'confirmed' | 'error';

export default function NfcAttendanceScreen() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const { api, session, token, sessionScope } = useAttendanceNfcSession();
  const [state, setState] = useState<ScreenState>('idle');
  const [message, setMessage] = useState(
    'Приложите рабочую NFC-метку к телефону. Сканирование отметит начало, окончание или подтверждение рабочего времени — кассовую смену оно не меняет.',
  );
  const [hardware, setHardware] = useState<'unknown' | 'ready' | 'disabled' | 'unsupported'>('unknown');
  const [hasPending, setHasPending] = useState(false);
  const [canRetouchPending, setCanRetouchPending] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [result, setResult] = useState<AttendanceNfcScanResult | null>(null);
  const [currentRefreshFailed, setCurrentRefreshFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const focusedRef = useRef(false);
  const operationController = useRef(createNfcOperationLeaseController()).current;
  const nativeOperationRef = useRef<ReturnType<typeof createAttendanceNfcOperation> | null>(null);
  const statusQuery = useQuery({
    queryKey: nfcStatusQueryKey(session),
    queryFn: async () => {
      const response = await api!.nfcStatus();
      if (!session?.isCurrent()) throw new Error('Сессия изменилась');
      return response.data;
    },
    enabled: !!api && !!session,
    retry: 1,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const sessionIdentity = session
    ? `${session.owner.tenantId}:${session.owner.userId}:${session.owner.pointId ?? ''}:${token ?? ''}`
    : '';
  const linkScope = session ? sessionScope : '';

  useFocusEffect(
    useCallback(() => {
      let active = true;
      focusedRef.current = true;
      setLinkToken(null);
      setResult(null);
      setCurrentRefreshFailed(false);
      setCanRetouchPending(false);
      setState('idle');
      setMessage(
        'Приложите рабочую NFC-метку к телефону. Сканирование отметит начало, окончание или подтверждение рабочего времени — кассовую смену оно не меняет.',
      );
      const link = token ? takePendingAttendanceLink(token, linkScope) : null;
      if (link) {
        setLinkToken(link);
        setMessage('Открыта ссылка рабочей NFC-метки. Проверьте аккаунт и точку, затем подтвердите действие вручную.');
      }
      void (async () => {
        if (!session) return;
        try {
          const pending = await nativePendingNfc.pending(session);
          if (active) {
            setHasPending(!!pending);
            if (pending) {
              setState('pending');
              setMessage(
                'Есть незавершённое сканирование. Сначала восстановите его: приложите ту же метку. Новый запрос не создаётся.',
              );
            }
          }
        } catch {
          if (active) {
            setState('error');
            setMessage('Не удалось прочитать локальное состояние NFC. Повторите попытку.');
          }
        }
      })();
      void checkAttendanceNfcHardware()
        .then((value) => {
          if (active) setHardware(value);
        })
        .catch(() => {
          if (active) setHardware('unsupported');
        });
      return () => {
        active = false;
        focusedRef.current = false;
        operationController.invalidate();
        const operation = nativeOperationRef.current;
        nativeOperationRef.current = null;
        if (operation) void cancelAttendanceNfcOperation(operation);
        setWorking(false);
        setLinkToken(null);
      };
    }, [sessionIdentity, linkScope]),
  );

  useEffect(() => {
    if (!focused || !token || !linkScope) return;
    const consume = (pendingToken: string, sessionToken: string, scope: string) => {
      if (focusedRef.current && sessionToken === token && scope === linkScope) {
        const queued = takePendingAttendanceLink(sessionToken, scope);
        if (queued !== pendingToken) return;
        setLinkToken(queued);
        setMessage('Открыта ссылка рабочей NFC-метки. Проверьте аккаунт и точку, затем подтвердите действие вручную.');
      }
    };
    const unsubscribe = subscribePendingAttendanceLink(consume);
    const queued = takePendingAttendanceLink(token, linkScope);
    if (queued) consume(queued, token, linkScope);
    return unsubscribe;
  }, [focused, linkScope, token]);

  const recover = async () => {
    if (!session || !api || working) return;
    const ownedSession = session;
    const operationLease = operationController.begin(() => focusedRef.current && ownedSession.isCurrent());
    const isCurrent = operationLease.isCurrent;
    setWorking(true);
    setState('loading');
    setMessage('Проверяем сохранённый результат…');
    try {
      const outcome = await nativePendingNfc.recover({
        ...ownedSession,
        isCurrent,
        refreshCurrent: async () => {
          if (isCurrent()) await ownedSession.refreshCurrent();
        },
        lookup: async (requestId) => {
          if (!isCurrent()) throw new Error('Операция отменена при смене экрана или сессии.');
          const response = await api.nfcRequestResult(requestId);
          return { status: 200, data: response.data };
        },
      });
      if (!isCurrent()) return;
      if (!ownsNfcOutcome(outcome, ownedSession.lease, ownedSession.isCurrent)) return;
      if (outcome.status === 'idle') {
        setHasPending(false);
        setState('idle');
        setMessage('Незавершённого запроса нет. Приложите рабочую NFC-метку.');
      } else if (outcome.status === 'needs_tag') {
        setHasPending(true);
        setCanRetouchPending(true);
        setState('pending');
        setMessage(
          'Сервер ещё не подтвердил запрос. Приложите ту же NFC-метку: сохранённый идентификатор запроса останется прежним.',
        );
      } else {
        setHasPending(false);
        setResult(outcome.result);
        setState('confirmed');
        setCurrentRefreshFailed(outcome.currentRefreshFailed === true);
        setMessage(
          outcome.currentRefreshFailed
            ? 'Действие подтверждено. Не удалось обновить текущую смену — нажмите «Обновить статус».'
            : describeAction(outcome.result),
        );
      }
    } catch (error) {
      if (!isCurrent() || !ownsNfcOutcome(error, ownedSession.lease, ownedSession.isCurrent)) return;
      const pending = await nativePendingNfc.pending(ownedSession).catch(() => null);
      if (!isCurrent()) return;
      if (pending) setHasPending(true);
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Не удалось восстановить сканирование. Попробуйте ещё раз.');
    } finally {
      if (isCurrent()) setWorking(false);
    }
  };

  const scan = async (fromLink = false) => {
    if (!session || !api || working) return;
    if (statusQuery.data && (!statusQuery.data.shiftsEnabled || !statusQuery.data.canScan)) {
      setState('error');
      setMessage(
        statusQuery.data.openShiftInOtherPoint
          ? 'У вас уже открыта смена в другой точке. Сначала закройте её там.'
          : 'Сейчас отметка NFC недоступна для этой точки.',
      );
      return;
    }
    const ownedSession = session;
    const operationLease = operationController.begin(() => focusedRef.current && ownedSession.isCurrent());
    const isCurrent = operationLease.isCurrent;
    const nativeOperation = createAttendanceNfcOperation(isCurrent);
    nativeOperationRef.current = nativeOperation;
    setWorking(true);
    setState('loading');
    setResult(null);
    let helperDispatched = false;
    try {
      let rawUri: string;
      if (fromLink && linkToken) {
        // The link is only a user-approved fallback. It never dispatches on open.
        rawUri = `https://autexa.pw/nfc/attendance#v=1&token=${linkToken}`;
      } else {
        rawUri = await readAttendanceNfcUri(nativeOperation);
      }
      if (!isCurrent()) return;
      const parsed = parseAttendanceNfcUri(rawUri);
      if (!parsed) throw new Error('Эта метка не является рабочей NFC-меткой Autexa.');
      const currentSession = ownedSession;
      helperDispatched = true;
      const outcome = await nativePendingNfc.scan({
        ...currentSession,
        isCurrent,
        refreshCurrent: async () => {
          if (isCurrent()) await currentSession.refreshCurrent();
        },
        token: parsed.token,
        send: async (body) => {
          if (!isCurrent()) throw new Error('Операция отменена при смене экрана или сессии.');
          const response = await api.scanNfc(body);
          return { status: 200, data: response.data };
        },
      });
      if (!isCurrent()) return;
      if (!ownsNfcOutcome(outcome, currentSession.lease, currentSession.isCurrent)) return;
      if (outcome.status === 'needs_tag') {
        setHasPending(true);
        setCanRetouchPending(true);
        setState('pending');
        setMessage(
          'Сервер пока не подтвердил результат. Повторно приложите ту же метку — запрос восстановится с прежним идентификатором.',
        );
      } else if (outcome.status === 'completed') {
        setHasPending(false);
        setCanRetouchPending(false);
        setLinkToken(null);
        setResult(outcome.result);
        setState('confirmed');
        setCurrentRefreshFailed(outcome.currentRefreshFailed === true);
        setMessage(
          outcome.currentRefreshFailed
            ? 'Действие подтверждено. Текущую смену обновить не удалось — нажмите «Обновить статус».'
            : describeAction(outcome.result),
        );
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (helperDispatched && !ownsNfcOutcome(error, session.lease, session.isCurrent)) return;
      if (helperDispatched) {
        const pending = await nativePendingNfc.pending(session).catch(() => null);
        if (!isCurrent()) return;
        if (pending) setHasPending(true);
      }
      setState('error');
      const code = (error as { code?: string })?.code;
      if (code === 'cancelled') setMessage('Сканирование отменено. Смены не изменились.');
      else if (code === 'disabled') setMessage('Включите NFC в настройках телефона и попробуйте снова.');
      else if (code === 'unsupported')
        setMessage('Это устройство не поддерживает NFC. Обратитесь к руководителю для отметки другим способом.');
      else
        setMessage(
          error instanceof Error
            ? error.message
            : 'Не удалось выполнить сканирование. Проверьте связь и восстановите результат перед повтором.',
        );
    } finally {
      if (nativeOperationRef.current === nativeOperation) nativeOperationRef.current = null;
      if (isCurrent()) setWorking(false);
    }
  };

  const refreshStatus = async () => {
    if (!session || working) return;
    const ownerSession = session;
    const operationLease = operationController.begin(() => focusedRef.current && ownerSession.isCurrent());
    const isCurrent = operationLease.isCurrent;
    setWorking(true);
    await refreshNfcStatusForCurrentSession(
      ownerSession,
      isCurrent,
      () => {
        setCurrentRefreshFailed(false);
        setMessage('Статус смены обновлён.');
      },
      () => {
        setCurrentRefreshFailed(true);
        setMessage('Не удалось обновить статус. Проверьте связь и повторите попытку.');
      },
    );
    if (isCurrent()) setWorking(false);
  };

  const canScan = statusQuery.data?.shiftsEnabled === true && statusQuery.data?.canScan === true;
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Рабочая смена" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.panel, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[styles.title, { color: palette.text.primary }]}>Отметка присутствия</Text>
          <Text style={[styles.body, { color: palette.text.secondary }]}>{message}</Text>
          {statusQuery.isLoading && <ActivityIndicator color={colors.primary[600]} />}
          {statusQuery.isError && (
            <ActionButton label="Повторить загрузку статуса" onPress={() => void statusQuery.refetch()} />
          )}
          {statusQuery.data?.openShiftInOtherPoint && (
            <Text style={styles.warning}>Сначала закройте открытую смену в другой точке.</Text>
          )}
          {statusQuery.data?.shiftsEnabled && (
            <Text style={[styles.caption, { color: palette.text.tertiary }]}>
              {statusQuery.data.hasOpenShift
                ? 'Смена уже открыта в выбранной точке.'
                : statusQuery.data.hasActiveTag
                  ? 'В этой точке есть активная метка.'
                  : 'Для выбранной точки пока нет активной метки.'}
            </Text>
          )}
          {hardware === 'unsupported' && (
            <Text style={styles.warning}>
              Телефон не поддерживает NFC. Спросите руководителя о другом способе отметки.
            </Text>
          )}
          {hardware === 'disabled' && <Text style={styles.warning}>NFC выключен в настройках телефона.</Text>}
          {linkToken && (
            <Text style={[styles.caption, { color: palette.text.tertiary }]}>
              Ссылка NFC открыта. Нажатие кнопки ниже подтвердит сканирование вручную.
            </Text>
          )}
          {state === 'confirmed' && result && (
            <View style={styles.result}>
              <Text style={[styles.resultTitle, { color: colors.primary[700] }]}>{actionLabel(result.action)}</Text>
              <Text style={[styles.body, { color: palette.text.secondary }]}>
                {new Date(result.serverAt).toLocaleString('ru-RU')}
              </Text>
            </View>
          )}
          {(state === 'pending' || hasPending) && (
            <ActionButton
              label={working ? 'Проверяем…' : 'Восстановить результат'}
              disabled={working}
              onPress={() => void recover()}
            />
          )}
          {hasPending && canRetouchPending && (
            <ActionButton
              label={working ? 'Поднесите ту же метку…' : 'Приложить ту же метку'}
              disabled={working || !canScan || hardware === 'disabled' || hardware === 'unsupported'}
              onPress={() => void scan(false)}
            />
          )}
          <ActionButton
            label={working ? 'Поднесите метку…' : linkToken ? 'Подтвердить ссылку и отметить' : 'Сканировать NFC-метку'}
            disabled={working || !canScan || hardware === 'disabled' || hardware === 'unsupported' || hasPending}
            onPress={() => void scan(!!linkToken)}
          />
          {state === 'confirmed' && currentRefreshFailed && (
            <ActionButton label="Обновить статус" disabled={working} onPress={() => void refreshStatus()} />
          )}
          {statusQuery.data?.needsFirstScanConfirmation && (
            <Text style={[styles.caption, { color: palette.text.tertiary }]}>
              Первая NFC-отметка подтверждает уже открытую вручную рабочую смену.
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function describeAction(result: AttendanceNfcScanResult): string {
  switch (result.action) {
    case 'opened':
      return 'Рабочая смена открыта.';
    case 'closed':
      return 'Рабочая смена закрыта.';
    case 'confirmed':
      return 'Присутствие подтверждено.';
    case 'unchanged':
      return 'Смена не изменилась: повторная отметка пришла слишком рано.';
  }
}
function actionLabel(action: AttendanceNfcScanResult['action']) {
  return action === 'opened'
    ? 'Смена открыта'
    : action === 'closed'
      ? 'Смена закрыта'
      : action === 'confirmed'
        ? 'Присутствие подтверждено'
        : 'Смена без изменений';
}
function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing[4], paddingBottom: spacing[10] },
  panel: { borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing[4], gap: spacing[3] },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.base, lineHeight: 23 },
  caption: { fontSize: fontSize.sm, lineHeight: 20 },
  warning: { color: colors.amber[700], fontSize: fontSize.sm, lineHeight: 20 },
  button: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  disabled: { opacity: 0.45 },
  result: { padding: spacing[3], borderRadius: borderRadius.md, backgroundColor: '#eff6ff', gap: spacing[1] },
  resultTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
