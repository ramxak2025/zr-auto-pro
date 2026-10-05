import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WorkMode } from '../../../shared/types';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { scheduleApi } from '../api/services';
import Modal from '../components/Modal';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, colors, fontSize, spacing } from '../theme';
import ScheduleTimeFields from './ScheduleTimeFields';
import { SCHEDULE_WEEKDAYS, validateWorkModeDraft, workModeDraft, workModePayload } from './scheduleEditing';

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_FULL_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

export default function WorkModeEditor({ mode, onClose }: { mode?: WorkMode; onClose: () => void }) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => workModeDraft(mode));
  const [validation, setValidation] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const payload = workModePayload(draft, mode);
      return mode ? scheduleApi.updateWorkMode(mode.id, payload) : scheduleApi.createWorkMode(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['work-modes'] });
      onClose();
    },
  });
  const error =
    validation ||
    (save.isError ? apiErrorMessage(save.error) || 'Не удалось сохранить режим. Попробуйте ещё раз.' : null);
  return (
    <Modal
      visible
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      title={mode ? 'Изменить режим' : 'Новый режим'}
    >
      <Text style={[styles.label, { color: palette.text.secondary }]}>Название</Text>
      <TextInput
        accessibilityLabel="Название режима"
        value={draft.name}
        editable={!save.isPending}
        onChangeText={(name) => {
          setValidation(null);
          setDraft((prev) => ({ ...prev, name }));
        }}
        placeholder="Например, обычная неделя"
        placeholderTextColor={palette.text.secondary}
        returnKeyType="done"
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
      />
      <Text style={[styles.label, { color: palette.text.secondary }]}>Время по умолчанию</Text>
      <ScheduleTimeFields
        label="Время режима"
        value={draft}
        disabled={save.isPending}
        onChange={(hours) => setDraft((prev) => ({ ...prev, ...hours }))}
      />
      <Text style={[styles.heading, { color: palette.text.primary }]}>Рабочие дни</Text>
      <Text style={[styles.hint, { color: palette.text.secondary }]}>
        Для отдельного дня недели можно выбрать другое время.
      </Text>
      {SCHEDULE_WEEKDAYS.map((day) => {
        const working = draft.weekDays.includes(day);
        const custom = draft.dayTimes[day];
        return (
          <View key={day} style={[styles.day, { borderBottomColor: palette.border.subtle }]}>
            <Text style={[styles.dayLabel, { color: palette.text.primary }]}>{DAY_NAMES[day]}</Text>
            <Switch
              accessibilityLabel={`Рабочий день ${DAY_NAMES[day]}`}
              value={working}
              disabled={save.isPending}
              onValueChange={(on) =>
                setDraft((prev) => ({
                  ...prev,
                  weekDaysEdited: true,
                  weekDays: on ? [...prev.weekDays, day] : prev.weekDays.filter((d) => d !== day),
                }))
              }
              trackColor={{ false: palette.bg.muted, true: colors.green[500] }}
              thumbColor={colors.white}
            />
            {working ? (
              <ScheduleTimeFields
                compact
                label={DAY_FULL_NAMES[day]}
                value={custom ?? draft}
                disabled={save.isPending}
                onChange={(hours) => setDraft((prev) => ({ ...prev, dayTimes: { ...prev.dayTimes, [day]: hours } }))}
              />
            ) : (
              <Text style={{ flex: 1, color: palette.text.secondary, fontSize: fontSize.sm }}>Выходной</Text>
            )}
            {working && custom && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Как в режиме: ${DAY_NAMES[day]}`}
                disabled={save.isPending}
                style={styles.reset}
                onPress={() =>
                  setDraft((prev) => {
                    const next = { ...prev.dayTimes };
                    delete next[day];
                    return { ...prev, dayTimes: next };
                  })
                }
              >
                <Ionicons name="refresh-outline" size={18} color={palette.text.secondary} />
              </TouchableOpacity>
            )}
          </View>
        );
      })}
      <Text style={[styles.hint, { color: palette.text.secondary }]}>
        После сохранения примените режим к графику. Личные выходные сотрудника сохраняются.
      </Text>
      {error && (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: palette.mode === 'dark' ? colors.red[300] : colors.red[600] }]}
        >
          {error}
        </Text>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        disabled={save.isPending}
        style={[styles.save, { backgroundColor: palette.accent.primary }]}
        onPress={() => {
          const message = validateWorkModeDraft(draft);
          setValidation(message);
          if (!message) save.mutate();
        }}
      >
        {save.isPending ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.saveText}>Сохранить режим</Text>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: fontSize.sm, fontWeight: '600', marginBottom: spacing[2] },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: fontSize.sm,
    marginBottom: spacing[4],
  },
  heading: { fontSize: fontSize.base, fontWeight: '600', marginTop: spacing[5], marginBottom: spacing[2] },
  hint: { fontSize: fontSize.xs, lineHeight: 18, marginVertical: spacing[2] },
  day: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayLabel: { width: 22, fontSize: fontSize.sm, fontWeight: '600' },
  reset: { width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  error: { fontSize: fontSize.sm, lineHeight: 20, marginVertical: spacing[3] },
  save: {
    minHeight: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[3],
  },
  saveText: { color: colors.white, fontSize: fontSize.sm, fontWeight: '600' },
});
