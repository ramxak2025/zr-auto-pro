/**
 * InstallmentReminderSettingsScreen — «Напоминания о платежах» по рассрочке.
 * Открывается шестерёнкой (колокольчиком) из InstallmentsScreen (owner-class).
 * Backed by GET/PATCH /installments/reminder-settings.
 *
 * Режимы:
 *   • Выкл    — напоминания не отправляются.
 *   • Авто    — ежедневный крон сам шлёт клиенту шаблонный текст
 *               («Напоминаем, у вас оплата {amount} до {date}»). Настраиваются
 *               за сколько дней (daysBefore), в день платежа (onDue),
 *               по просрочке (onOverdue) и сам шаблон.
 *   • Вручную — владелец сам напоминает: на экране каждой рассрочки появляются
 *               действия «Скопировать» / «Открыть WhatsApp» / «Позвонить».
 *
 * «Отправить напоминания сейчас» — ручной триггер (sendReminders) для режима
 * Авто, показывает сводку отправленных.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { installmentsApi } from '../api/services';
import { DEFAULT_REMINDER_TEMPLATE } from '../components/installments/installmentUi';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import type { InstallmentReminderSettings } from '../../../shared/types';

type Mode = InstallmentReminderSettings['mode'];

const MODES: { key: Mode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'off', label: 'Выкл', icon: 'close-circle-outline' },
  { key: 'auto', label: 'Авто', icon: 'flash-outline' },
  { key: 'manual', label: 'Вручную', icon: 'create-outline' },
];

const QK = ['installments', 'reminder-settings'] as const;

export default function InstallmentReminderSettingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const { data, isLoading, isError } = useQuery<InstallmentReminderSettings>({
    queryKey: QK,
    queryFn: async () => (await installmentsApi.getReminderSettings()).data,
    staleTime: 60 * 1000,
  });

  // Local form mirror — hydrated once from the server payload.
  const [mode, setMode] = useState<Mode>('off');
  const [daysBefore, setDaysBefore] = useState(1);
  const [onDue, setOnDue] = useState(true);
  const [onOverdue, setOnOverdue] = useState(true);
  const [template, setTemplate] = useState(DEFAULT_REMINDER_TEMPLATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (data && !hydrated) {
      setMode(data.mode);
      setDaysBefore(data.daysBefore ?? 1);
      setOnDue(data.onDue ?? true);
      setOnOverdue(data.onOverdue ?? true);
      setTemplate(data.template && data.template.trim() ? data.template : DEFAULT_REMINDER_TEMPLATE);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<InstallmentReminderSettings>) => installmentsApi.updateReminderSettings(patch),
    onSuccess: (res) => {
      queryClient.setQueryData(QK, res.data);
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить настройки напоминаний');
    },
  });

  const sendMutation = useMutation({
    mutationFn: () => installmentsApi.sendReminders(),
    onSuccess: (res) => {
      haptic('success');
      const { sent, total } = res.data;
      Alert.alert(
        'Напоминания отправлены',
        total === 0 ? 'Сейчас некому напоминать — нет подходящих платежей.' : `Отправлено ${sent} из ${total}.`,
      );
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отправить напоминания');
    },
  });

  const save = () => {
    haptic('tap');
    saveMutation.mutate({ mode, daysBefore, onDue, onOverdue, template: template.trim() || DEFAULT_REMINDER_TEMPLATE });
  };

  const trackOn = palette.accent.primary;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Напоминания о платежах" onBack={() => navigation.goBack()} centerTitle />

      {isLoading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent.primary} />
        </View>
      ) : isError && !data ? (
        <View style={styles.center}>
          <Text style={{ color: palette.text.tertiary }}>Не удалось загрузить настройки</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[8] }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mode segmented */}
          <Text style={[styles.sectionLabel, { color: palette.text.secondary }]}>РЕЖИМ</Text>
          <View style={[styles.segmented, { backgroundColor: palette.bg.muted }]}>
            {MODES.map((m) => {
              const active = mode === m.key;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.segmentBtn, active && [styles.segmentActive, { backgroundColor: palette.bg.card }]]}
                  onPress={() => {
                    haptic('tap');
                    setMode(m.key);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name={m.icon} size={16} color={active ? palette.accent.primary : palette.text.secondary} />
                  <Text
                    style={[
                      styles.segmentText,
                      { color: active ? palette.accent.primary : palette.text.secondary },
                      active && { fontWeight: fontWeight.bold },
                    ]}
                  >
                    {m.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {mode === 'off' ? (
            <View style={[styles.infoCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Ionicons name="close-circle-outline" size={20} color={palette.text.tertiary} />
              <Text style={[styles.infoText, { color: palette.text.secondary }]}>
                Напоминания о платежах отключены. Включите «Авто» для автоматической рассылки или «Вручную», чтобы
                напоминать самим из карточки рассрочки.
              </Text>
            </View>
          ) : null}

          {mode === 'manual' ? (
            <View style={[styles.infoCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Ionicons name="create-outline" size={20} color={palette.accent.primary} />
              <Text style={[styles.infoText, { color: palette.text.secondary }]}>
                В ручном режиме откройте рассрочку — там появятся кнопки «Скопировать» (готовый текст), «Открыть
                WhatsApp» и «Позвонить». Автоматическая рассылка не выполняется.
              </Text>
            </View>
          ) : null}

          {mode === 'auto' ? (
            <>
              <Text style={[styles.sectionLabel, { color: palette.text.secondary, marginTop: spacing[5] }]}>
                КОГДА НАПОМИНАТЬ
              </Text>
              <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
                {/* daysBefore stepper */}
                <View style={styles.stepRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowLabel, { color: palette.text.primary }]}>За сколько дней</Text>
                    <Text style={[styles.rowDesc, { color: palette.text.tertiary }]}>Предупредить до даты платежа</Text>
                  </View>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={[styles.stepBtn, { backgroundColor: palette.bg.muted }]}
                      onPress={() => {
                        haptic('tap');
                        setDaysBefore((d) => Math.max(0, d - 1));
                      }}
                      hitSlop={6}
                    >
                      <Ionicons name="remove" size={18} color={palette.text.primary} />
                    </TouchableOpacity>
                    <Text style={[styles.stepValue, { color: palette.text.primary }]}>{daysBefore}</Text>
                    <TouchableOpacity
                      style={[styles.stepBtn, { backgroundColor: palette.bg.muted }]}
                      onPress={() => {
                        haptic('tap');
                        setDaysBefore((d) => Math.min(14, d + 1));
                      }}
                      hitSlop={6}
                    >
                      <Ionicons name="add" size={18} color={palette.text.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />
                <View style={styles.stepRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowLabel, { color: palette.text.primary }]}>В день платежа</Text>
                    <Text style={[styles.rowDesc, { color: palette.text.tertiary }]}>Напомнить в саму дату</Text>
                  </View>
                  <Switch
                    value={onDue}
                    onValueChange={(v) => {
                      haptic('tap');
                      setOnDue(v);
                    }}
                    trackColor={{ false: palette.border.subtle, true: trackOn }}
                    thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                    ios_backgroundColor={palette.border.subtle}
                  />
                </View>
                <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />
                <View style={styles.stepRow}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.rowLabel, { color: palette.text.primary }]}>По просрочке</Text>
                    <Text style={[styles.rowDesc, { color: palette.text.tertiary }]}>
                      Напоминать, если платёж просрочен
                    </Text>
                  </View>
                  <Switch
                    value={onOverdue}
                    onValueChange={(v) => {
                      haptic('tap');
                      setOnOverdue(v);
                    }}
                    trackColor={{ false: palette.border.subtle, true: trackOn }}
                    thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                    ios_backgroundColor={palette.border.subtle}
                  />
                </View>
              </View>

              <Text style={[styles.sectionLabel, { color: palette.text.secondary, marginTop: spacing[5] }]}>
                ТЕКСТ СООБЩЕНИЯ
              </Text>
              <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
                <TextInput
                  style={[styles.templateInput, { color: palette.text.primary, backgroundColor: palette.bg.muted }]}
                  value={template}
                  onChangeText={setTemplate}
                  multiline
                  placeholder={DEFAULT_REMINDER_TEMPLATE}
                  placeholderTextColor={palette.text.tertiary}
                />
                <Text style={[styles.hint, { color: palette.text.tertiary }]}>
                  Подстановки: {'{clientName}'} — имя клиента, {'{amount}'} — остаток, {'{date}'} — дата платежа.
                </Text>
              </View>
            </>
          ) : null}

          {/* Save */}
          <TouchableOpacity
            style={[
              styles.saveBtn,
              { backgroundColor: palette.accent.primary },
              saveMutation.isPending && { opacity: 0.5 },
            ]}
            onPress={save}
            disabled={saveMutation.isPending}
            activeOpacity={0.85}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark" size={19} color={colors.white} />
                <Text style={styles.saveBtnText}>Сохранить</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Manual «send now» — only meaningful when auto rules exist. */}
          {mode === 'auto' ? (
            <TouchableOpacity
              style={[styles.sendNowBtn, { backgroundColor: softTint(colors.green[600], palette.mode) }]}
              onPress={() => {
                haptic('tap');
                sendMutation.mutate();
              }}
              disabled={sendMutation.isPending}
              activeOpacity={0.85}
            >
              {sendMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.green[600]} />
              ) : (
                <>
                  <Ionicons
                    name="paper-plane-outline"
                    size={17}
                    color={palette.mode === 'dark' ? colors.green[300] : colors.green[700]}
                  />
                  <Text
                    style={[
                      styles.sendNowText,
                      { color: palette.mode === 'dark' ? colors.green[300] : colors.green[700] },
                    ]}
                  >
                    Отправить напоминания сейчас
                  </Text>
                </>
              )}
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },

  sectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    marginLeft: spacing[1],
    marginBottom: spacing[2],
  },

  segmented: { flexDirection: 'row', borderRadius: borderRadius.lg, padding: 3 },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.md,
  },
  segmentActive: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: { fontSize: 13, fontWeight: fontWeight.medium },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    marginTop: spacing[3],
  },
  infoText: { flex: 1, fontSize: 13.5, lineHeight: 19 },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  rowLabel: { fontSize: 15, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  rowDesc: { fontSize: 12.5, marginTop: 2 },
  separator: { height: StyleSheet.hairlineWidth },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, minWidth: 22, textAlign: 'center' },

  templateInput: {
    minHeight: 88,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginVertical: spacing[3],
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: spacing[3] },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    marginTop: spacing[6],
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },

  sendNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    marginTop: spacing[3],
  },
  sendNowText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
