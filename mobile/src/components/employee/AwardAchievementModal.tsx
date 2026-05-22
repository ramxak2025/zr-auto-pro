/**
 * AwardAchievementModal — owner-only sheet to award a custom badge.
 *
 * Custom achievements live alongside auto ones; the type=`custom` flag
 * lets the trophy case style them differently (golden with subtle glow).
 *
 * Form: name, description, icon (emoji), color (hex). Submits through
 * `employeesApi.addAchievement` then invalidates the full-profile query.
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { employeesApi } from '../../api/services';
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
    <RNModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.elevated }]}>
            <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={onClose} hitSlop={10}>
                <Text style={[styles.headerBtn, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Text style={[styles.headerTitle, { color: palette.text.primary }]}>Новый значок</Text>
              <Pressable onPress={onSave} hitSlop={10} disabled={addMutation.isPending}>
                {addMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.primary[600]} />
                ) : (
                  <Text style={[styles.headerBtn, { color: colors.primary[600], fontWeight: '700' }]}>Выдать</Text>
                )}
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
          </View>
        </KeyboardAvoidingView>
      </View>
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
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  headerBtn: { fontSize: fontSize.base },
  body: { flex: 1 },
  bodyContent: { padding: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
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
});
