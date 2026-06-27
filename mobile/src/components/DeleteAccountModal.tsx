import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import Modal from './Modal';
import { authApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import type { DeleteAccountResponse } from '../../../shared/api/types';

interface DeleteAccountModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * True for the account holder (director) — deletion closes the WHOLE tenant
   * (company + all data) after the grace window, access revoked immediately.
   * False for a regular employee — only their own record is removed.
   * The backend is authoritative; this only chooses the wording shown.
   */
  isAccountHolder: boolean;
  /** Fired after a successful deletion — the caller forces logout (single
   *  source of truth: AuthContext.logout, the same path «Выйти» / 401 use). */
  onDeleted: (res: DeleteAccountResponse) => void;
}

/**
 * «Удалить аккаунт» — App Store Guideline 5.1.1(v) / Google Play in-app account
 * deletion. Re-authenticates by requiring the current password (the endpoint
 * body is `{ password, confirm: true }`), explains the consequences in Russian,
 * and on success hands control back to the caller for a forced logout. Stays
 * open with a clear Russian error on a wrong password / network failure.
 */
export default function DeleteAccountModal({ visible, onClose, isAccountHolder, onDeleted }: DeleteAccountModalProps) {
  const palette = useColors();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => authApi.deleteAccount({ password, confirm: true }),
    onSuccess: (res) => {
      haptic('success');
      onDeleted(res.data);
    },
    onError: (err: unknown) => {
      haptic('error');
      const status = (err as { response?: { status?: number } })?.response?.status;
      const hasResponse = !!(err as { response?: unknown })?.response;
      if (status === 400 || status === 401 || status === 403) {
        setError('Неверный пароль. Попробуйте ещё раз.');
      } else if (!hasResponse) {
        setError('Нет соединения с сервером. Проверьте интернет и попробуйте снова.');
      } else {
        setError('Не удалось удалить аккаунт. Попробуйте позже.');
      }
    },
  });

  // Reset the field + error each time the sheet is dismissed so a re-open
  // never shows a stale password or a previous failure.
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setError(null);
    }
  }, [visible]);

  const pending = mutation.isPending;

  const handleClose = () => {
    if (pending) return; // don't let the user dismiss mid-request
    onClose();
  };

  const handleSubmit = () => {
    if (pending) return;
    if (!password.trim()) {
      setError('Введите пароль для подтверждения.');
      return;
    }
    setError(null);
    mutation.mutate();
  };

  const consequences = isAccountHolder
    ? 'Аккаунт компании и все данные — заказ-наряды, склад, клиенты, сотрудники — будут безвозвратно удалены через 30 дней. Доступ к приложению закроется сразу после подтверждения.'
    : 'Ваша учётная запись будет удалена, и вы потеряете доступ к приложению. Это действие необратимо.';

  return (
    <Modal visible={visible} onClose={handleClose} title="Удалить аккаунт">
      {/* Warning banner */}
      <View
        style={[
          styles.warnBanner,
          { backgroundColor: palette.mode === 'dark' ? 'rgba(239,68,68,0.14)' : colors.red[50] },
        ]}
      >
        <Ionicons name="warning-outline" size={20} color={colors.red[600]} />
        <Text style={[styles.warnText, { color: palette.mode === 'dark' ? colors.red[300] : colors.red[700] }]}>
          {consequences}
        </Text>
      </View>

      {/* Password re-auth */}
      <Text style={[styles.label, { color: palette.text.secondary }]}>Подтвердите паролем</Text>
      <TextInput
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (error) setError(null);
        }}
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        placeholder="Ваш пароль"
        placeholderTextColor={palette.text.tertiary}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!pending}
        textContentType="password"
        onSubmitEditing={handleSubmit}
        returnKeyType="done"
      />

      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Actions */}
      <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: palette.border.strong, backgroundColor: palette.bg.elevated }]}
          onPress={handleClose}
          disabled={pending}
          activeOpacity={0.7}
        >
          <Text style={[styles.cancelText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.deleteBtn, pending && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={pending}
          activeOpacity={0.85}
        >
          {pending ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.deleteText}>Удалить аккаунт</Text>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[4],
  },
  warnText: { flex: 1, fontSize: fontSize.sm, lineHeight: 20 },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.red[600],
    marginTop: spacing[2],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    marginTop: spacing[5],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: Platform.OS === 'android' ? 999 : borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  deleteBtn: {
    minWidth: 140,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: Platform.OS === 'android' ? 999 : borderRadius.lg,
    backgroundColor: colors.red[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
