/**
 * «Мой профиль» — self profile management, reachable by tapping the profile
 * header at the top of the «Ещё» (MoreScreen) screen.
 *
 * Backend contract (migration 099, profileApi):
 *   • updateProfile({ fullName?, phone?, avatar? }) → { status, applied, user?, request? }
 *       - владелец (director / superadmin)  → status 'applied'  → applied directly.
 *       - сотрудник (admin / master)         → status 'requested' → a pending
 *         change-request is created/superseded for owner approval.
 *   • changePassword({ currentPassword, newPassword }) → self-service for EVERY role.
 *   • getMyChangeRequest() → the caller's own pending request (or null) — drives the
 *     «на рассмотрении» banner so it survives an app restart.
 *   • listChangeRequests() / approveChangeRequest(id) / rejectChangeRequest(id) —
 *     owner review queue (director / superadmin only).
 *
 * The avatar / ФИО / телефон edits are batched under ONE «Сохранить» so an
 * employee never accidentally supersedes one pending request with another.
 * Password change is independent and always available. «Удалить аккаунт» lives at
 * the very bottom (destructive), reusing DeleteAccountModal.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import IosScreenHeader from '../components/IosScreenHeader';
import CachedImage from '../components/CachedImage';
import DeleteAccountModal from '../components/DeleteAccountModal';
import { Text } from '../platform/Typography';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { profileApi, uploadsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { iosSectionLabel, useShadow } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { ProfileChangeRequest, ProfileChangeDiff, ProfileChangeField } from '../../../shared/types';
import type { UpdateProfileRequest, ChangePasswordRequest, DeleteAccountResponse } from '../../../shared/api/types';

const QK_MINE = ['profile-change-request-mine'] as const;
const QK_LIST = ['profile-change-requests'] as const;
// User-list keys to refresh after an approval applies a name/phone/avatar change.
const USER_LIST_KEYS = ['users', 'all-users', 'users-all', 'users-for-filter'];

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

const FIELD_LABELS: Record<ProfileChangeField, string> = {
  fullName: 'Фамилия и имя',
  phone: 'Телефон',
  avatar: 'Фото профиля',
};

// ─── Error helpers ────────────────────────────────────────────────────────────
function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}
function hasResponse(err: unknown): boolean {
  return !!(err as { response?: unknown })?.response;
}
/** Surface the server's friendly Russian `{ message }` when present (string or
 *  ValidationPipe array), else null so the caller picks a fallback. */
function apiMessage(err: unknown): string | null {
  const m = (err as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

/** Client-side mirror of the backend password rules (8+ chars, an uppercase
 *  letter — Latin or Cyrillic — and a digit, different from the current). */
function validateNewPassword(newPassword: string, currentPassword: string): string | null {
  if (newPassword.length < 8) return 'Пароль должен быть не менее 8 символов.';
  if (!/[A-ZА-Я]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return 'Пароль должен содержать заглавную букву и цифру.';
  }
  if (newPassword === currentPassword) return 'Новый пароль должен отличаться от текущего.';
  return null;
}

// ─── Diff list (was → стало) shared by the pending banner & the owner cards ────
const ProfileDiffList = React.memo(function ProfileDiffList({ changes }: { changes: ProfileChangeDiff[] }) {
  const palette = useColors();
  return (
    <View style={{ gap: spacing[2] }}>
      {changes.map((d) => (
        <View key={d.field} style={styles.diffRow}>
          <Text style={[styles.diffLabel, { color: palette.text.secondary }]}>{FIELD_LABELS[d.field]}</Text>
          <View style={styles.diffValues}>
            {d.field === 'avatar' ? (
              <AvatarDiff oldValue={d.oldValue} newValue={d.newValue} tertiary={palette.text.tertiary} />
            ) : (
              <>
                <Text style={[styles.diffOld, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {d.oldValue || '—'}
                </Text>
                <Ionicons name="arrow-forward" size={13} color={palette.text.tertiary} />
                <Text style={[styles.diffNew, { color: palette.text.primary }]} numberOfLines={1}>
                  {d.newValue || '—'}
                </Text>
              </>
            )}
          </View>
        </View>
      ))}
    </View>
  );
});

function AvatarDiff({
  oldValue,
  newValue,
  tertiary,
}: {
  oldValue: string | null;
  newValue: string | null;
  tertiary: string;
}) {
  const oldUrl = getImageUrl(oldValue);
  const newUrl = getImageUrl(newValue);
  return (
    <View style={styles.avatarDiffRow}>
      {oldUrl ? (
        <CachedImage source={{ uri: oldUrl }} style={styles.diffAvatar} />
      ) : (
        <Text style={[styles.diffOld, { color: tertiary }]}>—</Text>
      )}
      <Ionicons name="arrow-forward" size={13} color={tertiary} />
      {newUrl ? (
        <CachedImage source={{ uri: newUrl }} style={styles.diffAvatar} />
      ) : (
        <Text style={[styles.diffOld, { color: tertiary }]}>удалить</Text>
      )}
    </View>
  );
}

// ─── Owner: a single change-request card with Принять / Отклонить ───────────────
const RequestCard = React.memo(function RequestCard({
  request,
  busyAction,
  onDecide,
}: {
  request: ProfileChangeRequest;
  /** 'approve' | 'reject' while THIS card's decision is in flight, else null. */
  busyAction: 'approve' | 'reject' | null;
  onDecide: (id: string, action: 'approve' | 'reject') => void;
}) {
  const palette = useColors();
  const shadow = useShadow();
  const requester = request.requester;
  const avatarUrl = getImageUrl(requester?.avatar);
  const initial = requester?.fullName?.charAt(0) || '?';
  const busy = busyAction !== null;

  return (
    <View
      style={[styles.requestCard, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.requesterRow}>
        {avatarUrl ? (
          <CachedImage source={{ uri: avatarUrl }} style={styles.requesterAvatar} />
        ) : (
          <View style={[styles.requesterAvatar, styles.requesterAvatarFallback, { backgroundColor: palette.bg.muted }]}>
            <Text style={[styles.requesterInitial, { color: palette.text.secondary }]}>{initial}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.requesterName, { color: palette.text.primary }]} numberOfLines={1}>
            {requester?.fullName || 'Сотрудник'}
          </Text>
          <Text style={[styles.requesterRole, { color: palette.text.tertiary }]} numberOfLines={1}>
            {requester?.role ? (roleLabels[requester.role] ?? requester.role) : ''}
          </Text>
        </View>
      </View>

      <View style={[styles.requestDivider, { backgroundColor: palette.border.subtle }]} />
      <ProfileDiffList changes={request.changes} />

      <View style={styles.requestActions}>
        <TouchableOpacity
          style={[styles.rejectBtn, { borderColor: palette.border.strong }, busy && styles.btnDisabled]}
          onPress={() => onDecide(request.id, 'reject')}
          disabled={busy}
          activeOpacity={0.7}
        >
          {busyAction === 'reject' ? (
            <ActivityIndicator size="small" color={colors.red[600]} />
          ) : (
            <Text style={styles.rejectText}>Отклонить</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.approveBtn, { backgroundColor: palette.accent.primary }, busy && styles.btnDisabled]}
          onPress={() => onDecide(request.id, 'approve')}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busyAction === 'approve' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.approveText}>Принять</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
});

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { user, refreshUser } = useAuth();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();

  const isOwner = user?.role === 'director' || user?.role === 'superadmin';
  const initial = user?.fullName?.charAt(0) || 'U';

  // ── Profile-edit form state (batched under one «Сохранить») ──────────────────
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  // A freshly-uploaded avatar URL, staged locally until the user presses Save.
  const [stagedAvatar, setStagedAvatar] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // ── Password change state ────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  // ── Delete account ───────────────────────────────────────────────────────────
  const [deleteVisible, setDeleteVisible] = useState(false);
  const isAccountHolder = user?.role === 'director';

  // ── The employee's own pending request (drives the «на рассмотрении» banner) ──
  const { data: myRequest } = useQuery<ProfileChangeRequest | null>({
    queryKey: QK_MINE,
    queryFn: async () => (await profileApi.getMyChangeRequest()).data,
    enabled: !!user && !isOwner,
    staleTime: 30 * 1000,
  });
  const pending = myRequest && myRequest.status === 'pending' ? myRequest : null;
  // Employees can't queue a second edit until the owner decides the first.
  const isLocked = !isOwner && !!pending;

  // ── Owner review queue ───────────────────────────────────────────────────────
  const {
    data: requests,
    isLoading: requestsLoading,
    isError: requestsError,
  } = useQuery<ProfileChangeRequest[]>({
    queryKey: QK_LIST,
    queryFn: async () => (await profileApi.listChangeRequests()).data,
    enabled: !!user && isOwner,
    staleTime: 30 * 1000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (body: UpdateProfileRequest) => profileApi.updateProfile(body),
    onSuccess: async (res) => {
      const data = res.data;
      setStagedAvatar(null);
      if (data.status === 'applied') {
        haptic('success');
        // Pull the canonical user (also refreshes the persisted cold-start copy).
        await refreshUser();
        Alert.alert('Готово', 'Профиль обновлён.');
      } else {
        haptic('success');
        // Render the pending banner instantly + persist it for next launch.
        queryClient.setQueryData(QK_MINE, data.request ?? null);
        Alert.alert('Заявка отправлена', 'Изменения профиля ожидают подтверждения владельца.');
      }
    },
    onError: (err) => {
      haptic('error');
      const status = statusOf(err);
      if (status === 409) {
        Alert.alert('Телефон занят', 'Этот номер телефона уже используется другим сотрудником.');
      } else if (status === 400) {
        Alert.alert('Проверьте данные', apiMessage(err) ?? 'Проверьте имя и телефон и попробуйте снова.');
      } else if (!hasResponse(err)) {
        Alert.alert('Нет соединения', 'Проверьте интернет и попробуйте снова.');
      } else {
        Alert.alert('Ошибка', 'Не удалось сохранить изменения. Попробуйте позже.');
      }
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (body: ChangePasswordRequest) => profileApi.changePassword(body),
    onSuccess: () => {
      haptic('success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwError(null);
      Alert.alert('Пароль изменён', 'Используйте новый пароль при следующем входе.');
    },
    onError: (err) => {
      haptic('error');
      const status = statusOf(err);
      if (status === 401 || status === 403) {
        setPwError('Неверный текущий пароль.');
      } else if (status === 400) {
        setPwError(apiMessage(err) ?? 'Проверьте требования к новому паролю.');
      } else if (!hasResponse(err)) {
        setPwError('Нет соединения с сервером. Попробуйте снова.');
      } else {
        setPwError('Не удалось изменить пароль. Попробуйте позже.');
      }
    },
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      action === 'approve' ? profileApi.approveChangeRequest(id) : profileApi.rejectChangeRequest(id),
    onSuccess: (_res, vars) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: QK_LIST });
      if (vars.action === 'approve') {
        // An employee's name / phone / avatar changed — refresh the lists that show it.
        USER_LIST_KEYS.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      }
    },
    onError: (err) => {
      haptic('error');
      const status = statusOf(err);
      if (status === 409) {
        Alert.alert('Телефон занят', 'Не удалось применить: этот номер уже используется другим сотрудником.');
      } else {
        Alert.alert('Ошибка', apiMessage(err) ?? 'Не удалось обработать заявку. Попробуйте позже.');
      }
    },
  });

  // Which card (if any) currently has a decision in flight.
  const decidingId = decideMutation.isPending ? (decideMutation.variables?.id ?? null) : null;
  const decidingAction = decideMutation.isPending ? (decideMutation.variables?.action ?? null) : null;

  // ── Derived: what changed vs the canonical user ──────────────────────────────
  const trimmedName = fullName.trim();
  const trimmedPhone = phone.trim();
  const nameChanged = trimmedName !== (user?.fullName ?? '');
  const phoneChanged = trimmedPhone !== (user?.phone ?? '');
  const avatarChanged = stagedAvatar !== null;
  const hasChanges = nameChanged || phoneChanged || avatarChanged;
  const canSave = hasChanges && !isLocked && !saveMutation.isPending;

  const displayAvatar = getImageUrl(stagedAvatar ?? user?.avatar);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handlePickAvatar = useCallback(async () => {
    if (isLocked) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      setAvatarUploading(true);
      const uploadRes = await uploadsApi.upload(asset.uri, asset.fileName || 'avatar.jpg');
      setStagedAvatar(uploadRes.data.url);
      haptic('success');
    } catch {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось загрузить фото.');
    } finally {
      setAvatarUploading(false);
    }
  }, [isLocked]);

  const handleSave = () => {
    if (!canSave) return;
    if (!trimmedName) {
      Alert.alert('Укажите имя', 'Поле «Фамилия и имя» не может быть пустым.');
      return;
    }
    if (!trimmedPhone) {
      Alert.alert('Укажите телефон', 'Поле «Телефон» не может быть пустым.');
      return;
    }
    const body: UpdateProfileRequest = {};
    if (nameChanged) body.fullName = trimmedName;
    if (phoneChanged) body.phone = trimmedPhone;
    if (avatarChanged) body.avatar = stagedAvatar ?? '';
    haptic('tap');
    saveMutation.mutate(body);
  };

  const handleChangePassword = () => {
    if (passwordMutation.isPending) return;
    if (!currentPassword) {
      setPwError('Введите текущий пароль.');
      return;
    }
    const strength = validateNewPassword(newPassword, currentPassword);
    if (strength) {
      setPwError(strength);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('Пароли не совпадают.');
      return;
    }
    setPwError(null);
    haptic('tap');
    passwordMutation.mutate({ currentPassword, newPassword });
  };

  const onDecide = useCallback(
    (id: string, action: 'approve' | 'reject') => {
      if (decideMutation.isPending) return;
      if (action === 'reject') {
        Alert.alert('Отклонить заявку?', 'Изменения профиля сотрудника не будут применены.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Отклонить', style: 'destructive', onPress: () => decideMutation.mutate({ id, action }) },
        ]);
        return;
      }
      decideMutation.mutate({ id, action });
    },
    [decideMutation],
  );

  const handleDeleted = (res: DeleteAccountResponse) => {
    setDeleteVisible(false);
    const isTenant = res.status === 'tenant_deletion_requested';
    Alert.alert(
      isTenant ? 'Запрос на удаление принят' : 'Аккаунт удалён',
      isTenant
        ? 'Доступ закрыт. Все данные компании будут безвозвратно удалены через 30 дней. Если передумаете — свяжитесь с поддержкой до окончания этого срока.'
        : 'Ваша учётная запись удалена. Сейчас вы выйдете из приложения.',
      [{ text: 'OK' }],
      { cancelable: false },
    );
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Мой профиль" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[8] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Avatar + identity */}
          <View style={styles.avatarBlock}>
            <View style={styles.avatarWrap}>
              {displayAvatar ? (
                <CachedImage source={{ uri: displayAvatar }} style={styles.avatarLarge} />
              ) : (
                <View
                  style={[styles.avatarLarge, styles.avatarFallback, { backgroundColor: palette.accent.primarySoft }]}
                >
                  <Text style={[styles.avatarLargeText, { color: palette.accent.primaryText }]}>{initial}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[
                  styles.cameraBtn,
                  shadow,
                  { backgroundColor: palette.accent.primary, borderColor: palette.bg.canvas },
                ]}
                onPress={handlePickAvatar}
                disabled={avatarUploading || isLocked}
                hitSlop={8}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Изменить фото профиля"
              >
                {avatarUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={16} color="#fff" />
                )}
              </TouchableOpacity>
            </View>
            <Text style={[styles.identName, { color: palette.text.primary }]} numberOfLines={1}>
              {user?.fullName || 'User'}
            </Text>
            <Text style={[styles.identRole, { color: palette.text.secondary }]}>
              {user?.role ? (roleLabels[user.role] ?? user.role) : ''}
            </Text>
          </View>

          {/* Employee: pending-request banner («на рассмотрении») */}
          {pending && (
            <View
              style={[
                styles.pendingBanner,
                {
                  backgroundColor: palette.mode === 'dark' ? 'rgba(245,158,11,0.14)' : colors.amber[50],
                  borderColor: palette.mode === 'dark' ? 'rgba(245,158,11,0.32)' : colors.amber[200],
                },
              ]}
            >
              <View style={styles.pendingHeader}>
                <Ionicons name="hourglass-outline" size={18} color={colors.amber[600]} />
                <Text
                  style={[
                    styles.pendingTitle,
                    { color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[700] },
                  ]}
                >
                  Изменения на рассмотрении
                </Text>
              </View>
              <Text style={[styles.pendingSub, { color: palette.text.secondary }]}>
                Заявка отправлена владельцу. Новые правки можно будет внести после решения.
              </Text>
              <View style={styles.pendingDiffWrap}>
                <ProfileDiffList changes={pending.changes} />
              </View>
            </View>
          )}

          {/* Личные данные */}
          <View style={styles.section}>
            <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>ЛИЧНЫЕ ДАННЫЕ</Text>
            <View
              style={[styles.card, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Фамилия и имя</Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                style={inputStyle}
                placeholder="Иванов Иван"
                placeholderTextColor={palette.text.tertiary}
                editable={!isLocked}
                autoCapitalize="words"
                returnKeyType="next"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, { color: palette.text.secondary }]}>
                Телефон
              </Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                style={inputStyle}
                placeholder="+7 999 123-45-67"
                placeholderTextColor={palette.text.tertiary}
                editable={!isLocked}
                keyboardType="phone-pad"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: palette.accent.primary }, !canSave && styles.btnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.85}
              >
                {saveMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveText}>{isOwner ? 'Сохранить' : 'Отправить на согласование'}</Text>
                )}
              </TouchableOpacity>
              {!isOwner && !isLocked && (
                <Text style={[styles.hint, { color: palette.text.tertiary }]}>
                  Изменения профиля применяются после подтверждения владельцем.
                </Text>
              )}
            </View>
          </View>

          {/* Смена пароля — self-service for every role */}
          <View style={styles.section}>
            <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>СМЕНА ПАРОЛЯ</Text>
            <View
              style={[styles.card, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Текущий пароль</Text>
              <TextInput
                value={currentPassword}
                onChangeText={(v) => {
                  setCurrentPassword(v);
                  if (pwError) setPwError(null);
                }}
                style={inputStyle}
                placeholder="Текущий пароль"
                placeholderTextColor={palette.text.tertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, { color: palette.text.secondary }]}>
                Новый пароль
              </Text>
              <TextInput
                value={newPassword}
                onChangeText={(v) => {
                  setNewPassword(v);
                  if (pwError) setPwError(null);
                }}
                style={inputStyle}
                placeholder="Минимум 8 символов, буква и цифра"
                placeholderTextColor={palette.text.tertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
              />
              <Text style={[styles.fieldLabel, styles.fieldLabelSpaced, { color: palette.text.secondary }]}>
                Повторите новый пароль
              </Text>
              <TextInput
                value={confirmPassword}
                onChangeText={(v) => {
                  setConfirmPassword(v);
                  if (pwError) setPwError(null);
                }}
                style={inputStyle}
                placeholder="Ещё раз новый пароль"
                placeholderTextColor={palette.text.tertiary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="newPassword"
                onSubmitEditing={handleChangePassword}
                returnKeyType="done"
              />
              {pwError && <Text style={styles.errorText}>{pwError}</Text>}
              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  { backgroundColor: palette.accent.primary },
                  passwordMutation.isPending && styles.btnDisabled,
                ]}
                onPress={handleChangePassword}
                disabled={passwordMutation.isPending}
                activeOpacity={0.85}
              >
                {passwordMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveText}>Изменить пароль</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Owner: «Запросы на правки» review queue (director / superadmin) */}
          {isOwner && (
            <View style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                ЗАПРОСЫ НА ПРАВКИ{requests && requests.length > 0 ? ` · ${requests.length}` : ''}
              </Text>
              {requestsLoading ? (
                <ActivityIndicator style={{ marginTop: spacing[3] }} color={palette.accent.primary} />
              ) : requestsError && !requests ? (
                <View
                  style={[
                    styles.card,
                    shadow,
                    styles.emptyCard,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  <Ionicons name="cloud-offline-outline" size={20} color={palette.text.tertiary} />
                  <Text style={[styles.emptyText, { color: palette.text.secondary }]}>
                    Не удалось загрузить заявки. Потяните вниз, чтобы повторить.
                  </Text>
                </View>
              ) : !requests || requests.length === 0 ? (
                <View
                  style={[
                    styles.card,
                    shadow,
                    styles.emptyCard,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  <Ionicons name="checkmark-done-outline" size={20} color={palette.text.tertiary} />
                  <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Нет заявок на рассмотрении.</Text>
                </View>
              ) : (
                <View style={{ gap: spacing[3] }}>
                  {requests.map((req) => (
                    <RequestCard
                      key={req.id}
                      request={req}
                      busyAction={decidingId === req.id ? decidingAction : null}
                      onDecide={onDecide}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Удалить аккаунт — destructive, at the very bottom */}
          <TouchableOpacity
            style={[styles.deleteAccountBtn, { borderColor: palette.border.subtle }]}
            onPress={() => setDeleteVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
            <Text style={styles.deleteAccountText}>Удалить аккаунт</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <DeleteAccountModal
        visible={deleteVisible}
        onClose={() => setDeleteVisible(false)}
        isAccountHolder={isAccountHolder}
        onDeleted={handleDeleted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[5] },

  // Avatar + identity block
  avatarBlock: { alignItems: 'center', gap: spacing[2], paddingTop: spacing[2] },
  avatarWrap: { position: 'relative' },
  avatarLarge: { width: 96, height: 96, borderRadius: 48 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarLargeText: { fontSize: 36, fontWeight: fontWeight.bold },
  cameraBtn: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: -0.3, marginTop: spacing[1] },
  identRole: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // Section + card
  section: { gap: spacing[1.5] },
  sectionTitle: { marginLeft: spacing[3], marginBottom: spacing[1] },
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },

  // Fields
  fieldLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  fieldLabelSpaced: { marginTop: spacing[3.5] },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: Platform.OS === 'ios' ? spacing[3] : spacing[2.5],
    fontSize: fontSize.base,
  },
  hint: { fontSize: fontSize.xs, lineHeight: 16, marginTop: spacing[2.5] },
  errorText: { fontSize: fontSize.sm, color: colors.red[600], marginTop: spacing[2.5] },

  // Primary buttons (Сохранить / Изменить пароль / Отправить на согласование)
  saveBtn: {
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: '#fff' },
  btnDisabled: { opacity: 0.45 },

  // Pending banner
  pendingBanner: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    gap: spacing[2],
  },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pendingTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  pendingSub: { fontSize: fontSize.sm, lineHeight: 19 },
  pendingDiffWrap: { marginTop: spacing[1] },

  // Diff (было → стало)
  diffRow: { gap: 3 },
  diffLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  diffValues: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  diffOld: { fontSize: fontSize.sm, textDecorationLine: 'line-through', flexShrink: 1 },
  diffNew: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flexShrink: 1 },
  avatarDiffRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  diffAvatar: { width: 32, height: 32, borderRadius: 16 },

  // Owner request card
  requestCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    gap: spacing[3],
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  requesterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  requesterAvatar: { width: 40, height: 40, borderRadius: 20 },
  requesterAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  requesterInitial: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  requesterName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  requesterRole: { fontSize: fontSize.xs, marginTop: 1 },
  requestDivider: { height: StyleSheet.hairlineWidth },
  requestActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
  rejectBtn: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingVertical: spacing[2.5],
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.red[600] },
  approveBtn: {
    flex: 1,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[2.5],
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: '#fff' },

  // Empty / error state for the owner queue
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] },
  emptyText: { flex: 1, fontSize: fontSize.sm, lineHeight: 18 },

  // Delete account
  deleteAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3.5],
    minHeight: 52,
    marginTop: spacing[2],
  },
  deleteAccountText: { fontSize: 15, fontWeight: fontWeight.semibold, color: colors.red[600] },
});
