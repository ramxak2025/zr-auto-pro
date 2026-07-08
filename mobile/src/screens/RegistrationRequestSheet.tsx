/**
 * RegistrationRequestSheet — self-service registration form (migration 123).
 *
 * Presented as a bottom sheet from LoginScreen (pre-auth). A prospective
 * autoservice owner fills компания / имя владельца / телефон / пароль /
 * комментарий and submits an UNAUTHENTICATED request via
 * `registrationApi.submit()`. A superadmin later reviews it in the admin
 * cabinet; on approval the owner signs in with the phone + password they chose
 * here.
 *
 * The sheet is intentionally LOCKED to the light palette to match the
 * light-locked LoginScreen — it never reads ThemeContext, so it renders the
 * same on iOS and Android regardless of the user's stored theme mode.
 *
 * On success it swaps to a confirmation state («Заявка отправлена…») rather than
 * closing immediately, so the owner clearly understands what happens next.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '../components/Button';
import { getPalette } from '../theme/palette';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import { formatPhone, normalizePhone, isValidPhone } from '../../../shared/validation/phone';
import { registrationApi } from '../api/services';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Pull a human message out of an axios error (string | string[] | fallback). */
function extractErrorMessage(error: unknown, fallback: string): string {
  const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m): m is string => typeof m === 'string').join('\n');
    if (joined.trim()) return joined;
  }
  if (typeof msg === 'string' && msg.trim()) return msg;
  // No server body → network class. Give an honest, actionable line.
  if (!(error as { response?: unknown })?.response) {
    return 'Нет связи с сервером. Проверьте подключение и попробуйте ещё раз.';
  }
  return fallback;
}

export default function RegistrationRequestSheet({ visible, onClose }: Props) {
  // Locked to light — mirrors LoginScreen. Not theme-aware by design.
  const palette = getPalette('light');

  const [companyName, setCompanyName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [comment, setComment] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const resetAndClose = () => {
    // Clear everything so a re-open starts fresh (and the password never lingers).
    setCompanyName('');
    setOwnerName('');
    setPhone('');
    setPassword('');
    setComment('');
    setShowPassword(false);
    setFormError('');
    setSubmitted(false);
    setSubmitting(false);
    onClose();
  };

  const handleSubmit = async () => {
    setFormError('');
    if (!companyName.trim()) {
      setFormError('Укажите название автосервиса');
      return;
    }
    if (!ownerName.trim()) {
      setFormError('Укажите имя владельца');
      return;
    }
    if (!phone.trim() || !isValidPhone(phone)) {
      setFormError('Введите корректный номер телефона');
      return;
    }
    if (password.length < 8) {
      setFormError('Пароль должен быть не короче 8 символов');
      return;
    }

    setSubmitting(true);
    try {
      await registrationApi.submit({
        companyName: companyName.trim(),
        ownerName: ownerName.trim(),
        phone: normalizePhone(phone),
        password,
        comment: comment.trim() || undefined,
      });
      haptic('success');
      setSubmitted(true);
    } catch (error) {
      haptic('error');
      // Backend conflicts (уже зарегистрирован / заявка уже отправлена) come
      // through as a 409 with a Russian message — surface it verbatim.
      setFormError(extractErrorMessage(error, 'Не удалось отправить заявку. Попробуйте позже.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={resetAndClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
            {/* Handle row */}
            <View style={[styles.handleRow, { borderBottomColor: palette.border.subtle }]}>
              <TouchableOpacity onPress={resetAndClose} hitSlop={8}>
                <Text style={[styles.cancel, { color: palette.text.secondary }]}>
                  {submitted ? 'Закрыть' : 'Отмена'}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.title, { color: palette.text.primary }]}>Регистрация</Text>
              <View style={styles.cancelPlaceholder} />
            </View>

            {submitted ? (
              <View style={styles.successWrap}>
                <View style={[styles.successIcon, { backgroundColor: colors.green[50] }]}>
                  <Ionicons name="checkmark-circle" size={48} color={colors.green[500]} />
                </View>
                <Text style={[styles.successTitle, { color: palette.text.primary }]}>Заявка отправлена</Text>
                <Text style={[styles.successText, { color: palette.text.secondary }]}>
                  После одобрения войдёте под своим телефоном и паролем.
                </Text>
                <View style={styles.successBtn}>
                  <Button title="Вернуться ко входу" onPress={resetAndClose} size="lg" />
                </View>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.scroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.intro, { color: palette.text.secondary }]}>
                  Оставьте заявку — после одобрения вы войдёте под указанным телефоном и паролем.
                </Text>

                {formError ? (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={18} color={colors.red[500]} />
                    <Text style={styles.errorBannerText}>{formError}</Text>
                  </View>
                ) : null}

                {/* Company */}
                <Text style={[styles.label, { color: palette.text.secondary }]}>НАЗВАНИЕ АВТОСЕРВИСА</Text>
                <TextInput
                  value={companyName}
                  onChangeText={(t) => {
                    setCompanyName(t);
                    setFormError('');
                  }}
                  placeholder="Например, «Автосервис на Ленина»"
                  placeholderTextColor={palette.text.tertiary}
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                  ]}
                />

                {/* Owner */}
                <Text style={[styles.label, { color: palette.text.secondary }]}>ИМЯ ВЛАДЕЛЬЦА</Text>
                <TextInput
                  value={ownerName}
                  onChangeText={(t) => {
                    setOwnerName(t);
                    setFormError('');
                  }}
                  placeholder="Ваше имя"
                  placeholderTextColor={palette.text.tertiary}
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                  ]}
                />

                {/* Phone */}
                <Text style={[styles.label, { color: palette.text.secondary }]}>ТЕЛЕФОН</Text>
                <TextInput
                  value={phone}
                  onChangeText={(t) => {
                    setPhone(formatPhone(t));
                    setFormError('');
                  }}
                  placeholder="+7 (___) ___-__-__"
                  placeholderTextColor={palette.text.tertiary}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  style={[
                    styles.input,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                  ]}
                />

                {/* Password */}
                <Text style={[styles.label, { color: palette.text.secondary }]}>ПАРОЛЬ</Text>
                <View style={styles.passwordWrap}>
                  <TextInput
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      setFormError('');
                    }}
                    placeholder="Минимум 8 символов"
                    placeholderTextColor={palette.text.tertiary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[
                      styles.input,
                      styles.passwordInput,
                      {
                        backgroundColor: palette.bg.muted,
                        borderColor: palette.border.subtle,
                        color: palette.text.primary,
                      },
                    ]}
                  />
                  <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword((s) => !s)} hitSlop={8}>
                    <Ionicons name={showPassword ? 'eye' : 'eye-off'} size={20} color={colors.gray[400]} />
                  </TouchableOpacity>
                </View>

                {/* Comment */}
                <Text style={[styles.label, { color: palette.text.secondary }]}>КОММЕНТАРИЙ (НЕОБЯЗАТЕЛЬНО)</Text>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Город, количество постов, пожелания…"
                  placeholderTextColor={palette.text.tertiary}
                  multiline
                  maxLength={500}
                  style={[
                    styles.input,
                    styles.commentInput,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                  ]}
                />

                <View style={styles.submitWrap}>
                  <Button title="Отправить заявку" onPress={handleSubmit} loading={submitting} size="lg" />
                </View>
                {submitting ? (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size="small" color={palette.accent.primary} />
                    <Text style={[styles.pendingText, { color: palette.text.tertiary }]}>Отправляем заявку…</Text>
                  </View>
                ) : null}

                <View style={{ height: spacing[8] }} />
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  kav: { width: '100%' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius['3xl'],
    borderTopRightRadius: borderRadius['3xl'],
    paddingTop: spacing[2],
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 15, fontWeight: fontWeight.medium },
  cancelPlaceholder: { width: 56 },
  title: { fontSize: 16, fontWeight: fontWeight.bold },
  scroll: { paddingHorizontal: spacing[5], paddingTop: spacing[4] },
  intro: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing[4] },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    letterSpacing: 1.2,
    marginBottom: spacing[2],
    marginTop: spacing[3],
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    fontSize: 15,
  },
  passwordWrap: { position: 'relative' },
  passwordInput: { paddingRight: spacing[12] },
  commentInput: { minHeight: 84, textAlignVertical: 'top', paddingTop: spacing[3.5] },
  eyeBtn: { position: 'absolute', right: spacing[4], top: 0, bottom: 0, justifyContent: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: '#fef2f2',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[1],
  },
  errorBannerText: { flex: 1, fontSize: fontSize.sm, color: colors.red[600] },
  submitWrap: { marginTop: spacing[6] },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  pendingText: { fontSize: fontSize.xs },
  successWrap: {
    alignItems: 'center',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[8],
    paddingBottom: spacing[10],
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[5],
  },
  successTitle: { fontSize: 22, fontWeight: fontWeight.bold, marginBottom: spacing[2] },
  successText: { fontSize: fontSize.base, textAlign: 'center', lineHeight: 22 },
  successBtn: { alignSelf: 'stretch', marginTop: spacing[8] },
});
