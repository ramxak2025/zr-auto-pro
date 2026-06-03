/**
 * AwardAchievementModal — owner-only dialog to award a custom badge.
 *
 * Custom achievements live alongside auto ones; the type=`custom` flag
 * lets the trophy case style them differently (golden with subtle glow).
 *
 * Form: name, description, icon (emoji), color (hex). Submits through
 * `employeesApi.addAchievement` then invalidates the full-profile query.
 *
 * ── Freeze-bug fix (#16.3) ──────────────────────────────────────────────
 * The previous version used `animationType="slide"` with a backdrop
 * `justifyContent:'flex-end'` + sheet `maxHeight:'92%'`. On iOS the sheet
 * laid out ABOVE the safe area on mount (off-screen) and the app froze —
 * touches landed on a sheet positioned outside the visible bounds.
 *
 * Replaced with the same CENTERED card pattern as EquipmentScreen's
 * `CenteredDialog`: `animationType="fade"`, a `KeyboardAvoidingView`
 * wrapper, the shared `ModalBlurBackdrop` (tap-outside / blurred area to
 * close) and a vertically-centered card (88% width, max 460pt wide,
 * max 520pt tall). The card scrolls internally if it overflows.
 */
import React from 'react';
import {
  Alert,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../../api/services';
import ModalBlurBackdrop from '../ModalBlurBackdrop';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';

const EMOJI_CHOICES = ['🏆', '🥇', '⭐', '💎', '🔥', '🚀', '🎯', '🛠️', '⚡', '👑', '💪', '🌟'];
const COLOR_CHOICES = ['#D97706', '#0F766E', '#3B82F6', '#9333EA', '#EF4444', '#22C55E', '#0EA5E9', '#F59E0B'];

export interface AwardAchievementModalProps {
  visible: boolean;
  onClose: () => void;
  employeeId: string;
}

export function AwardAchievementModal({ visible, onClose, employeeId }: AwardAchievementModalProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [icon, setIcon] = React.useState('🏆');
  const [color, setColor] = React.useState('#D97706');

  React.useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
      setIcon('🏆');
      setColor('#D97706');
    }
  }, [visible]);

  const addMutation = useMutation({
    mutationFn: () =>
      employeesApi.addAchievement(employeeId, {
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        color,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-full-profile', employeeId] });
      haptic('success');
      onClose();
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось выдать значок');
    },
  });

  const onSave = () => {
    if (!name.trim()) {
      Alert.alert('Укажите название');
      return;
    }
    addMutation.mutate();
  };

  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      {/* Blurred backdrop — tapping the blurred area closes the dialog. */}
      <ModalBlurBackdrop onPress={onClose} />
      {/* The card is a sibling above the backdrop so the blur never sits on
          top of it. KeyboardAvoidingView keeps the centered card clear of
          the keyboard when the text fields are focused. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.centerRoot}
        pointerEvents="box-none"
      >
        <View style={[styles.card, { backgroundColor: palette.bg.elevated }]}>
          {/* Header strip — title centered, × top-right (mirrors CenteredDialog). */}
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
              Новый значок
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="close" size={20} color={palette.text.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Preview */}
            <View style={[styles.preview, { borderColor: color, shadowColor: color }]}>
              <Text style={styles.previewIcon}>{icon}</Text>
              <Text style={[styles.previewName, { color: palette.text.primary }]} numberOfLines={1}>
                {name || 'Название значка'}
              </Text>
              {!!description && (
                <Text style={[styles.previewDesc, { color: palette.text.secondary }]} numberOfLines={2}>
                  {description}
                </Text>
              )}
            </View>

            <Field label="Название">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Лучший мастер месяца"
                placeholderTextColor={palette.text.tertiary}
                style={[
                  styles.input,
                  {
                    color: palette.text.primary,
                    borderColor: palette.border.subtle,
                    backgroundColor: palette.bg.muted,
                  },
                ]}
              />
            </Field>

            <Field label="Описание">
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="За высочайшее качество работы"
                placeholderTextColor={palette.text.tertiary}
                multiline
                numberOfLines={3}
                style={[
                  styles.input,
                  {
                    color: palette.text.primary,
                    borderColor: palette.border.subtle,
                    backgroundColor: palette.bg.muted,
                    minHeight: 70,
                    paddingTop: 12,
                    textAlignVertical: 'top',
                  },
                ]}
              />
            </Field>

            <Field label="Иконка">
              <View style={styles.iconRow}>
                {EMOJI_CHOICES.map((e) => (
                  <Pressable
                    key={e}
                    onPress={() => {
                      setIcon(e);
                      haptic('tap');
                    }}
                    style={[
                      styles.iconBtn,
                      {
                        backgroundColor: e === icon ? colors.primary[50] : palette.bg.muted,
                        borderColor: e === icon ? colors.primary[400] : palette.border.subtle,
                      },
                    ]}
                  >
                    <Text style={styles.iconGlyph}>{e}</Text>
                  </Pressable>
                ))}
              </View>
            </Field>

            <Field label="Цвет">
              <View style={styles.iconRow}>
                {COLOR_CHOICES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setColor(c);
                      haptic('tap');
                    }}
                    style={[
                      styles.colorBtn,
                      { backgroundColor: c, borderColor: c === color ? '#0F172A' : 'transparent' },
                    ]}
                  />
                ))}
              </View>
            </Field>
          </ScrollView>

          {/* Footer CTA — pinned inside the card. */}
          <View style={[styles.footer, { borderTopColor: palette.border.subtle }]}>
            <Pressable
              onPress={onClose}
              style={[styles.btn, styles.btnSecondary, { backgroundColor: palette.bg.muted }]}
            >
              <Text style={[styles.btnSecondaryText, { color: palette.text.primary }]}>Отменить</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={addMutation.isPending}
              style={[styles.btn, styles.btnPrimary, addMutation.isPending && styles.btnDisabled]}
            >
              {addMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>Выдать</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const palette = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text.tertiary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centered card root — sits above ModalBlurBackdrop, fills the screen so
  // the card is vertically + horizontally centered. box-none so taps that
  // miss the card fall through to the backdrop (tap-outside-to-close).
  centerRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  card: {
    width: '88%',
    maxWidth: 460,
    maxHeight: 520,
    borderRadius: Platform.OS === 'android' ? 28 : 22,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3.5],
    paddingBottom: spacing[2],
  },
  headerSpacer: { width: 32, height: 32 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // flexGrow:0 keeps the ScrollView only as tall as it needs, never
  // overrunning the card's maxHeight.
  body: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], paddingBottom: spacing[3], gap: spacing[3] },
  field: { gap: spacing[1.5] },
  label: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    fontSize: fontSize.base,
    paddingHorizontal: spacing[3],
    paddingVertical: 12,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconGlyph: { fontSize: 22 },
  colorBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 3 },

  preview: {
    alignItems: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  previewIcon: { fontSize: 48 },
  previewName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, marginTop: spacing[2] },
  previewDesc: { fontSize: 13, marginTop: spacing[1], textAlign: 'center' },

  // ── Footer CTA row ──
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flex: 1,
    height: Platform.OS === 'android' ? 44 : 48,
    borderRadius: Platform.OS === 'android' ? 22 : 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.primary[600] },
  btnSecondary: {},
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: { color: colors.white, fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
  btnSecondaryText: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
});
