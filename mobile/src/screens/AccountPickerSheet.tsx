import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useAuth } from '../contexts/AuthContext';
import type { LoginStepResult } from '../contexts/AuthContext';
import { captureDataSession } from '../contexts/dataSession';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../theme';
import { cancelPendingAccountLogin, runAccountSwitchAction, type PendingAccountLogin } from './accountPickerActions';

const MAX_ACCOUNTS = 3;
const roleNames: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  manager: 'Менеджер',
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function AccountPickerSheet({ visible, onClose }: Props) {
  const auth = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [form, setForm] = useState(false);
  const [reauthId, setReauthId] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState<PendingAccountLogin | null>(null);
  const [points, setPoints] = useState<Extract<LoginStepResult, { status: 'point-required' }>['points']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const mounted = useRef(false);
  const pendingRef = useRef<PendingAccountLogin | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      cancelPendingAccountLogin(pendingRef, auth.cancelAccountLogin);
    };
  }, [auth.cancelAccountLogin]);

  useEffect(() => {
    if (visible) return;
    sequence.current += 1;
    cancelPendingAccountLogin(pendingRef, auth.cancelAccountLogin);
    setPending(null);
    setPoints([]);
    setPassword('');
    setForm(false);
    setReauthId(null);
  }, [visible, auth.cancelAccountLogin]);

  const close = () => {
    if (busy) return;
    sequence.current += 1;
    cancelPendingAccountLogin(pendingRef, auth.cancelAccountLogin);
    setPending(null);
    setPoints([]);
    setForm(false);
    setReauthId(null);
    setError('');
    setPassword('');
    onClose();
  };

  const openForm = (accountId: string | null) => {
    setReauthId(accountId);
    setPhone('');
    setPassword('');
    setError('');
    setPending(null);
    pendingRef.current = null;
    setForm(true);
  };

  const submitCredentials = async () => {
    if (busy) return;
    if (!phone.trim() || !password) {
      setError('Введите телефон и пароль.');
      return;
    }
    const id = ++sequence.current;
    const sessionLease = captureDataSession();
    const isCurrent = () => mounted.current && id === sequence.current && sessionLease.isCurrent();
    setBusy('login');
    setError('');
    try {
      const result = await auth.addAccount(
        phone.trim(),
        password,
        reauthId ? { reauthAccountId: reauthId } : undefined,
      );
      if (!isCurrent()) {
        if (result.status === 'point-required') auth.cancelAccountLogin(result.operation);
        return;
      }
      if (result.status === 'point-required') {
        const attempt: PendingAccountLogin = {
          operation: result.operation,
          points: result.points,
          defaultPointId: result.defaultPointId,
          expiresAt: result.expiresAt,
        };
        pendingRef.current = attempt;
        setPending(attempt);
        setPoints(result.points);
        setPassword('');
      } else {
        onClose();
      }
    } catch (cause) {
      if (isCurrent()) setError(errorMessage(cause));
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const choosePoint = async (pointId: string) => {
    const attempt = pendingRef.current;
    if (!attempt || busy) return;
    if (attempt.expiresAt <= Date.now()) {
      auth.cancelAccountLogin(attempt.operation);
      pendingRef.current = null;
      setPending(null);
      setError('Выбор филиала истёк. Введите телефон и пароль ещё раз.');
      return;
    }
    const id = ++sequence.current;
    const sessionLease = captureDataSession();
    const isCurrent = () => mounted.current && id === sequence.current && sessionLease.isCurrent();
    setBusy(pointId);
    setError('');
    try {
      await auth.completeAccountLogin(attempt.operation, pointId);
      if (isCurrent()) onClose();
      pendingRef.current = null;
    } catch (cause) {
      if (isCurrent()) {
        pendingRef.current = null;
        setPending(null);
        setPoints([]);
        setPassword('');
        setError(errorMessage(cause));
      }
    } finally {
      if (isCurrent()) setBusy(null);
    }
  };

  const selectAccount = async (accountId: string) => {
    const account = auth.savedAccounts.find((item) => item.id === accountId);
    if (!account || busy) return;
    if (account.needsReauth) {
      openForm(account.id);
      return;
    }
    const sessionLease = captureDataSession();
    await runAccountSwitchAction({
      accountId,
      sequence,
      isSessionCurrent: sessionLease.isCurrent,
      isMounted: () => mounted.current,
      switchAccount: auth.switchAccount,
      setBusy,
      setError: (cause) => setError(cause ? errorMessage(cause) : ''),
      onSuccess: onClose,
    });
  };

  const removeAccount = (accountId: string) => {
    if (busy) return;
    const sessionLease = captureDataSession();
    const id = ++sequence.current;
    setBusy(`inspect:${accountId}`);
    setError('');
    void auth
      .inspectAccountRemoval(accountId)
      .then((inspection) => {
        if (!mounted.current || sequence.current !== id || !sessionLease.isCurrent()) return;
        setBusy(null);
        const pendingPhotos = inspection.pendingPhotos;
        const legacy = inspection.legacyQuarantined;
        if (!inspection.canRemove || pendingPhotos > 0) {
          Alert.alert(
            'Аккаунт пока нельзя удалить',
            `Есть незавершённая работа: заказ-наряды — ${inspection.offlineChecks}, фотографии к сохранённым чекам — ${pendingPhotos}, финансовые операции — ${inspection.financialIntents}, отметки NFC — ${inspection.nfcScans}.${legacy ? `\n\nЕщё ${legacy} старых записей не привязаны к аккаунту и останутся на устройстве.` : ''}`,
            [{ text: 'Понятно', style: 'cancel' }],
          );
          return;
        }
        const note = legacy ? `\n\n${legacy} старых записей не привязаны к аккаунту и останутся на устройстве.` : '';
        Alert.alert(
          'Удалить аккаунт с устройства?',
          `Сохранённые данные аккаунта будут удалены. Ожидающей работы нет.${note}`,
          [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Удалить',
              style: 'destructive',
              onPress: () => {
                if (!mounted.current || sequence.current !== id || !sessionLease.isCurrent()) return;
                const removeId = ++sequence.current;
                setBusy(`remove:${accountId}`);
                void auth
                  .removeAccount(accountId)
                  .then(() => {
                    if (mounted.current && sequence.current === removeId && sessionLease.isCurrent()) onClose();
                  })
                  .catch((cause) => {
                    if (mounted.current && sequence.current === removeId && sessionLease.isCurrent())
                      setError(errorMessage(cause));
                  })
                  .finally(() => {
                    if (mounted.current && sequence.current === removeId && sessionLease.isCurrent()) setBusy(null);
                  });
              },
            },
          ],
        );
      })
      .catch((cause) => {
        if (mounted.current && sequence.current === id && sessionLease.isCurrent()) {
          setBusy(null);
          setError(errorMessage(cause));
        }
      });
  };

  if (!form && !pending) {
    return (
      <Modal key="account-menu" visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.menuOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            disabled={!!busy}
            accessibilityRole="button"
            accessibilityLabel="Закрыть список аккаунтов"
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.menu,
              {
                backgroundColor: palette.bg.card,
                width: Math.min(336, window.width - 28),
                maxHeight: Math.max(150, window.height - tabBarHeight - insets.top - 32),
                bottom: tabBarHeight + 8,
              },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.menuContent}>
              <Pressable
                disabled={!!busy || auth.savedAccounts.length >= MAX_ACCOUNTS}
                onPress={() => openForm(null)}
                accessibilityRole="button"
                accessibilityState={{ disabled: !!busy || auth.savedAccounts.length >= MAX_ACCOUNTS }}
                style={[styles.menuAdd, { opacity: auth.savedAccounts.length >= MAX_ACCOUNTS ? 0.45 : 1 }]}
              >
                <Ionicons name="add" size={25} color={palette.accent.primaryText} />
                <Text style={[styles.menuAddText, { color: palette.accent.primaryText }]}>Добавить аккаунт</Text>
                <Text style={[styles.menuCount, { color: palette.text.tertiary }]}>{auth.savedAccounts.length}/3</Text>
              </Pressable>
              {auth.savedAccounts.map((account) => {
                const isBusy =
                  busy === `switch:${account.id}` ||
                  busy === `remove:${account.id}` ||
                  busy === `inspect:${account.id}`;
                return (
                  <View key={account.id} style={[styles.menuRow, { borderTopColor: palette.border.subtle }]}>
                    <Pressable
                      disabled={!!busy || (account.active && !account.needsReauth)}
                      onPress={() => void selectAccount(account.id)}
                      style={styles.menuAccount}
                      accessibilityRole="button"
                      accessibilityState={{ selected: account.active, busy: isBusy }}
                      accessibilityLabel={`${account.displayName}${account.active ? ', текущий аккаунт' : ''}${account.needsReauth ? ', войти снова' : ''}`}
                    >
                      <EmployeeAvatar
                        avatar={account.avatar}
                        userId={account.identity.userId}
                        style={[styles.avatar, { backgroundColor: palette.accent.primarySoft }]}
                        imageStyle={styles.avatarImage}
                      >
                        <Text style={[styles.avatarText, { color: palette.accent.primaryText }]}>
                          {account.displayName.trim().charAt(0).toUpperCase() || '?'}
                        </Text>
                      </EmployeeAvatar>
                      <View style={styles.rowCopy}>
                        <Text style={[styles.menuName, { color: palette.text.primary }]} numberOfLines={1}>
                          {account.displayName || 'Аккаунт'}
                        </Text>
                        <Text
                          style={[
                            styles.menuMeta,
                            { color: account.needsReauth ? palette.text.secondary : palette.text.tertiary },
                          ]}
                          numberOfLines={1}
                        >
                          {account.needsReauth
                            ? 'Войти снова'
                            : account.role
                              ? (roleNames[account.role] ?? account.role)
                              : 'Аккаунт'}
                        </Text>
                      </View>
                      {isBusy ? (
                        <ActivityIndicator size="small" color={palette.accent.primaryText} />
                      ) : account.active ? (
                        <Ionicons name="checkmark" size={19} color={palette.accent.primaryText} />
                      ) : null}
                    </Pressable>
                    <Pressable
                      disabled={!!busy}
                      style={styles.menuMore}
                      accessibilityRole="button"
                      accessibilityLabel={`Действия аккаунта ${account.displayName}`}
                      onPress={() =>
                        Alert.alert(account.displayName || 'Аккаунт', undefined, [
                          ...(account.needsReauth
                            ? [{ text: 'Войти снова', onPress: () => openForm(account.id) }]
                            : []),
                          {
                            text: 'Удалить с устройства',
                            style: 'destructive',
                            onPress: () => removeAccount(account.id),
                          },
                          { text: 'Отмена', style: 'cancel' },
                        ])
                      }
                    >
                      <Ionicons name="ellipsis-horizontal" size={20} color={palette.text.tertiary} />
                    </Pressable>
                  </View>
                );
              })}
              {error ? (
                <Text accessibilityRole="alert" style={[styles.menuError, { color: colors.red[600] }]}>
                  {error}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  const title = pending ? 'Выберите филиал' : form ? (reauthId ? 'Войти в аккаунт' : 'Добавить аккаунт') : 'Аккаунты';
  return (
    <Modal
      key="account-login"
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
            <Pressable
              onPress={close}
              disabled={!!busy}
              style={styles.headerAction}
              accessibilityRole="button"
              accessibilityLabel="Закрыть список аккаунтов"
            >
              <Ionicons name="close" size={24} color={palette.text.secondary} />
            </Pressable>
            <Text style={[styles.title, { color: palette.text.primary }]}>{title}</Text>
            <View style={styles.headerAction} />
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {pending ? (
              <>
                <Text style={[styles.subtitle, { color: palette.text.secondary }]}>
                  Выберите, куда войти. Активный аккаунт пока не изменится.
                </Text>
                {points.map((point) => (
                  <Pressable
                    key={point.id}
                    disabled={!!busy}
                    onPress={() => void choosePoint(point.id)}
                    style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={[styles.accountName, { color: palette.text.primary }]} numberOfLines={2}>
                        {point.name}
                      </Text>
                      <Text style={[styles.meta, { color: palette.text.secondary }]}>
                        {point.isMain ? 'Основной сервис' : 'Филиал'}
                        {point.address ? ` · ${point.address}` : ''}
                      </Text>
                    </View>
                    {busy === point.id ? (
                      <ActivityIndicator color={palette.accent.primaryText} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={palette.text.tertiary} />
                    )}
                  </Pressable>
                ))}
              </>
            ) : form ? (
              <>
                <Text style={[styles.subtitle, { color: palette.text.secondary }]}>
                  {reauthId
                    ? 'Введите телефон и пароль именно этого аккаунта.'
                    : 'Добавьте ещё один рабочий аккаунт. Пароль останется только в памяти на время входа.'}
                </Text>
                <Text style={[styles.label, { color: palette.text.secondary }]}>ТЕЛЕФОН</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  editable={!busy}
                  placeholder="Телефон"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  style={[
                    styles.input,
                    {
                      color: palette.text.primary,
                      backgroundColor: palette.bg.card,
                      borderColor: palette.border.subtle,
                    },
                  ]}
                />
                <Text style={[styles.label, { color: palette.text.secondary }]}>ПАРОЛЬ</Text>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                  placeholder="Пароль"
                  secureTextEntry
                  autoComplete="password"
                  style={[
                    styles.input,
                    {
                      color: palette.text.primary,
                      backgroundColor: palette.bg.card,
                      borderColor: palette.border.subtle,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => void submitCredentials()}
                  disabled={!!busy}
                  style={[styles.primary, { backgroundColor: palette.accent.primary }]}
                >
                  {busy === 'login' ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <Text style={styles.primaryText}>{reauthId ? 'Войти снова' : 'Продолжить'}</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    setForm(false);
                    setReauthId(null);
                    setPassword('');
                    setError('');
                  }}
                  disabled={!!busy}
                  style={styles.secondary}
                >
                  <Text style={[styles.secondaryText, { color: palette.accent.primaryText }]}>К списку аккаунтов</Text>
                </Pressable>
              </>
            ) : null}
            {error ? (
              <Text accessibilityRole="alert" style={[styles.error, { color: colors.red[600] }]}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === 'string') return response.data.message;
  }
  if (error instanceof Error) return error.message;
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

const styles = StyleSheet.create({
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.12)' },
  menu: {
    position: 'absolute',
    right: 14,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 12,
  },
  menuContent: { paddingHorizontal: 8, paddingVertical: 6 },
  menuAdd: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12 },
  menuAddText: { flex: 1, fontSize: 15, fontWeight: '500' },
  menuCount: { fontSize: 12, fontVariant: ['tabular-nums'] },
  menuRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  menuAccount: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingVertical: 10,
  },
  menuName: { fontSize: 15, fontWeight: '600' },
  menuMeta: { fontSize: 12, lineHeight: 16 },
  menuMore: { width: 44, minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  menuError: { fontSize: 13, lineHeight: 18, padding: 12 },
  avatarImage: { width: 42, height: 42, borderRadius: 21 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  subtitle: { fontSize: fontSize.sm, lineHeight: 21, marginBottom: spacing[1] },
  accountCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.xl, overflow: 'hidden' },
  accountMain: { minHeight: 76, flexDirection: 'row', alignItems: 'center', padding: spacing[3], gap: spacing[3] },
  row: {
    minHeight: 70,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    gap: spacing[3],
  },
  rowCopy: { flex: 1, gap: 3 },
  accountName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  meta: { fontSize: fontSize.sm, lineHeight: 19 },
  warning: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  accountActions: {
    minHeight: 48,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    gap: spacing[4],
  },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[1] },
  actionText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  addButton: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    gap: spacing[2],
  },
  label: { fontSize: 12, fontWeight: fontWeight.semibold, letterSpacing: 0.6, marginTop: spacing[2] },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: fontSize.base,
  },
  primary: {
    minHeight: 50,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[3],
  },
  primaryText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  error: { fontSize: fontSize.sm, lineHeight: 20, marginTop: spacing[2] },
});
