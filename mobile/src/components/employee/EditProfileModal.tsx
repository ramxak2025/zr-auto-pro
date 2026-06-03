/**
 * EditProfileModal — owner-only dialog for editing the extended
 * employee profile (hireDate, specializations, positionTitle,
 * customTitle, monthlyKpiRevenue/Checks, whatsapp, photo upload).
 *
 * Saves via `employeesApi.update`. Photo via `employeesApi.uploadPhoto`
 * (multipart). Mutations invalidate the `employee-full-profile` query
 * so the screen rehydrates with the latest values.
 *
 * ── Freeze-bug fix (#16.3) ──────────────────────────────────────────────
 * Same root cause as AwardAchievementModal: `animationType="slide"` +
 * backdrop `justifyContent:'flex-end'` + sheet `maxHeight:'92%'` rendered
 * ABOVE the safe area on mount on iOS, off-screen, freezing the app.
 *
 * Replaced with the centered-card pattern from EquipmentScreen's
 * `CenteredDialog`: `animationType="fade"`, `KeyboardAvoidingView`, the
 * shared `ModalBlurBackdrop` (tap blurred area to close) and a centered
 * card that scrolls internally. Card is a touch taller (max 560pt) than
 * the award dialog because the form has more fields.
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
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { employeesApi } from '../../api/services';
import ModalBlurBackdrop from '../ModalBlurBackdrop';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../../theme';
import type { EmployeeProfile } from '../../../../shared/types';
import { useColors } from '../../contexts/ThemeContext';

export interface EditProfileModalProps {
  visible: boolean;
  onClose: () => void;
  profile: EmployeeProfile;
}

export function EditProfileModal({ visible, onClose, profile }: EditProfileModalProps) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [hireDate, setHireDate] = React.useState(profile.hireDate ?? '');
  const [positionTitle, setPositionTitle] = React.useState(profile.positionTitle ?? '');
  const [customTitle, setCustomTitle] = React.useState(profile.customTitle ?? '');
  const [whatsapp, setWhatsapp] = React.useState(profile.whatsapp ?? '');
  const [kpiRevenue, setKpiRevenue] = React.useState(
    profile.monthlyKpiRevenue != null ? String(profile.monthlyKpiRevenue) : '',
  );
  const [kpiChecks, setKpiChecks] = React.useState(
    profile.monthlyKpiChecks != null ? String(profile.monthlyKpiChecks) : '',
  );
  const [specs, setSpecs] = React.useState<string[]>(profile.specializations ?? []);
  const [newSpec, setNewSpec] = React.useState('');
  const [photoUrl, setPhotoUrl] = React.useState<string | null>(profile.photoUrl ?? null);

  // When the modal reopens for a different profile, re-seed local state.
  React.useEffect(() => {
    if (visible) {
      setHireDate(profile.hireDate ?? '');
      setPositionTitle(profile.positionTitle ?? '');
      setCustomTitle(profile.customTitle ?? '');
      setWhatsapp(profile.whatsapp ?? '');
      setKpiRevenue(profile.monthlyKpiRevenue != null ? String(profile.monthlyKpiRevenue) : '');
      setKpiChecks(profile.monthlyKpiChecks != null ? String(profile.monthlyKpiChecks) : '');
      setSpecs(profile.specializations ?? []);
      setNewSpec('');
      setPhotoUrl(profile.photoUrl ?? null);
    }
  }, [visible, profile]);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<EmployeeProfile>) => employeesApi.update(profile.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-full-profile', profile.id] });
      queryClient.invalidateQueries({ queryKey: ['user', profile.id] });
      haptic('success');
      onClose();
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось сохранить');
    },
  });

  const photoMutation = useMutation({
    mutationFn: async (uri: string) => {
      const form = new FormData();
      const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
      form.append('file', {
        uri,
        name: `photo.${ext}`,
        type: ext === 'png' ? 'image/png' : 'image/jpeg',
      } as any);
      return employeesApi.uploadPhoto(profile.id, form);
    },
    onSuccess: (res: any) => {
      const url = res?.data?.photoUrl ?? null;
      if (url) setPhotoUrl(url);
      queryClient.invalidateQueries({ queryKey: ['employee-full-profile', profile.id] });
      haptic('success');
    },
    onError: (e: any) => {
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось загрузить фото');
    },
  });

  const pickPhoto = async () => {
    haptic('tap');
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Нет доступа', 'Разрешите доступ к фото.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!res.canceled && res.assets[0]?.uri) {
      photoMutation.mutate(res.assets[0].uri);
    }
  };

  const addSpec = () => {
    const v = newSpec.trim();
    if (!v) return;
    if (specs.includes(v)) {
      setNewSpec('');
      return;
    }
    setSpecs([...specs, v]);
    setNewSpec('');
  };

  const removeSpec = (s: string) => setSpecs(specs.filter((x) => x !== s));

  const onSave = () => {
    const parsed = (raw: string): number | null | undefined => {
      if (raw.trim() === '') return null;
      const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    };
    const body: Partial<EmployeeProfile> = {
      hireDate: hireDate.trim() === '' ? null : hireDate.trim(),
      positionTitle: positionTitle.trim() === '' ? null : positionTitle.trim(),
      customTitle: customTitle.trim() === '' ? null : customTitle.trim(),
      whatsapp: whatsapp.trim() === '' ? null : whatsapp.trim(),
      specializations: specs,
    };
    const kpiR = parsed(kpiRevenue);
    if (kpiR !== undefined) body.monthlyKpiRevenue = kpiR;
    const kpiC = parsed(kpiChecks);
    if (kpiC !== undefined) body.monthlyKpiChecks = kpiC;
    updateMutation.mutate(body);
  };

  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      {/* Blurred backdrop — tap the blurred area to close. */}
      <ModalBlurBackdrop onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.centerRoot}
        pointerEvents="box-none"
      >
        <View style={[styles.card, { backgroundColor: palette.bg.elevated }]}>
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
              Профиль сотрудника
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
            <Field label="Фото">
              <Pressable onPress={pickPhoto} style={styles.photoRow}>
                <View style={[styles.photoBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
                  {photoUrl ? (
                    <View style={styles.photoCircle}>
                      <NetImage uri={photoUrl} />
                    </View>
                  ) : (
                    <Ionicons name="camera-outline" size={28} color={palette.text.tertiary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.photoBtn, { color: colors.primary[600] }]}>
                    {photoMutation.isPending ? 'Загружаем…' : photoUrl ? 'Изменить фото' : 'Загрузить фото'}
                  </Text>
                  <Text style={[styles.photoHint, { color: palette.text.tertiary }]}>
                    Квадратное фото — лучшая обрезка под аватар.
                  </Text>
                </View>
              </Pressable>
            </Field>

            <Field label="Дата приёма (YYYY-MM-DD)">
              <Input value={hireDate} onChangeText={setHireDate} placeholder="2024-03-15" palette={palette} />
            </Field>

            <Field label="Должность">
              <Input
                value={positionTitle}
                onChangeText={setPositionTitle}
                placeholder="Старший мастер"
                palette={palette}
              />
            </Field>

            <Field label="Кастомный титул (необязательно)">
              <Input
                value={customTitle}
                onChangeText={setCustomTitle}
                placeholder="Гранд-мастер моторного цеха"
                palette={palette}
              />
            </Field>

            <Field label="WhatsApp (с кодом страны, без +)">
              <Input
                value={whatsapp}
                onChangeText={setWhatsapp}
                placeholder="79991234567"
                keyboardType="number-pad"
                palette={palette}
              />
            </Field>

            <Field label="Специализации">
              <View style={styles.specsRow}>
                {specs.map((s) => (
                  <Pressable key={s} onPress={() => removeSpec(s)} style={styles.specChip}>
                    <Text style={styles.specText}>{s}</Text>
                    <Ionicons name="close-circle-outline" size={14} color={colors.primary[700]} />
                  </Pressable>
                ))}
              </View>
              <View style={styles.addRow}>
                <Input
                  value={newSpec}
                  onChangeText={setNewSpec}
                  placeholder="Двигатель"
                  palette={palette}
                  onSubmitEditing={addSpec}
                  style={{ flex: 1 }}
                />
                <Pressable onPress={addSpec} style={styles.addBtn}>
                  <Ionicons name="add" size={20} color="#fff" />
                </Pressable>
              </View>
            </Field>

            <View style={styles.row2}>
              <Field label="План выручки / мес." style={styles.flex}>
                <Input
                  value={kpiRevenue}
                  onChangeText={setKpiRevenue}
                  placeholder="500000"
                  keyboardType="number-pad"
                  palette={palette}
                />
              </Field>
              <Field label="План чеков / мес." style={styles.flex}>
                <Input
                  value={kpiChecks}
                  onChangeText={setKpiChecks}
                  placeholder="30"
                  keyboardType="number-pad"
                  palette={palette}
                />
              </Field>
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: palette.border.subtle }]}>
            <Pressable
              onPress={onClose}
              style={[styles.btn, styles.btnSecondary, { backgroundColor: palette.bg.muted }]}
            >
              <Text style={[styles.btnSecondaryText, { color: palette.text.primary }]}>Отменить</Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              disabled={updateMutation.isPending}
              style={[styles.btn, styles.btnPrimary, updateMutation.isPending && styles.btnDisabled]}
            >
              {updateMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>Сохранить</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

function NetImage({ uri }: { uri: string }) {
  return <ExpoImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />;
}

function Field({
  label,
  children,
  style,
}: {
  label: string;
  children: React.ReactNode;
  style?: any;
}) {
  const palette = useColors();
  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.label, { color: palette.text.tertiary }]}>{label}</Text>
      {children}
    </View>
  );
}

function Input({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  onSubmitEditing,
  style,
  palette,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  onSubmitEditing?: () => void;
  style?: any;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.text.tertiary}
      keyboardType={keyboardType}
      onSubmitEditing={onSubmitEditing}
      returnKeyType="done"
      style={[
        styles.input,
        {
          color: palette.text.primary,
          borderColor: palette.border.subtle,
          backgroundColor: palette.bg.muted,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Centered card root — above ModalBlurBackdrop, fills the screen so the
  // card is centered. box-none so taps that miss the card reach the
  // backdrop (tap-outside-to-close).
  centerRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  card: {
    width: '88%',
    maxWidth: 460,
    maxHeight: 560,
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
  row2: { flexDirection: 'row', gap: spacing[3] },
  specsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  specChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[100],
    borderRadius: 999,
  },
  specText: { color: colors.primary[700], fontSize: 12, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  photoBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
  },
  photoCircle: { width: '100%', height: '100%', overflow: 'hidden' },
  photoBtn: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  photoHint: { fontSize: 12, marginTop: 2 },

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
