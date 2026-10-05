import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { formatDayKey, timezoneLabel, timezoneOption } from '../../../shared/utils/formatters';
import { shiftsApi } from '../api/services';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../theme';
import {
  attendanceCalendarDate,
  attendanceDays,
  attendanceMonthKey,
  attendanceShiftsForDate,
  defaultAttendanceDate,
  formatShiftTime,
  shiftAttendanceStatus,
} from './shiftAttendanceHelpers';

interface Props {
  currentMonth: Date;
  onMonthChange: (month: Date) => void;
}

/** The journal reads recorded Shift openings; a planned schedule is a separate view. */
export default function ShiftAttendanceHistory({ currentMonth, onMonthChange }: Props) {
  const palette = useColors();
  const timeZone = useTenantTimezone();
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const monthKey = attendanceMonthKey(currentMonth);
  const [pickedDate, setPickedDate] = useState(() => defaultAttendanceDate(currentMonth, timeZone));
  // Resolve during render, before the effect, so changing the month never
  // sends a request for the previous month's selected day.
  const selectedDate = pickedDate.startsWith(`${monthKey}-`)
    ? pickedDate
    : defaultAttendanceDate(currentMonth, timeZone);
  useEffect(() => {
    setPickedDate(selectedDate);
  }, [selectedDate]);
  const days = useMemo(() => attendanceDays(attendanceCalendarDate(`${monthKey}-01`)), [monthKey]);
  const dayStrip = useRef<ScrollView>(null);
  const scrollToSelectedDate = useCallback(() => {
    const index = days.indexOf(selectedDate);
    dayStrip.current?.scrollTo({ x: Math.max(0, index * 56 - 112), animated: false });
  }, [days, selectedDate]);
  useEffect(scrollToSelectedDate, [scrollToSelectedDate]);

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['shifts', 'attendance', user?.tenantId, user?.currentPointId ?? null, selectedDate],
    queryFn: async () => attendanceShiftsForDate((await shiftsApi.getAll({ date: selectedDate })).data, selectedDate),
    // Override the app-wide previous-query placeholder: another day must not
    // appear underneath this day's heading, even during a fast date change.
    placeholderData: () => undefined,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });
  const shifts = Array.isArray(data) ? attendanceShiftsForDate(data, selectedDate) : [];
  const dateLabel = attendanceCalendarDate(selectedDate).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[4] }]}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isPending}
          onRefresh={() => void refetch()}
          tintColor={palette.accent.primary}
        />
      }
    >
      <View style={styles.dateHeading}>
        <Text style={[styles.dateTitle, { color: palette.text.primary }]}>{dateLabel}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Показать смены за сегодня"
          onPress={() => {
            haptic('select');
            const today = formatDayKey(new Date(), timeZone);
            onMonthChange(attendanceCalendarDate(today));
            setPickedDate(today);
          }}
          style={[styles.todayButton, { backgroundColor: palette.accent.primarySoft }]}
        >
          <Text style={[styles.todayText, { color: palette.accent.primaryText }]}>Сегодня</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        ref={dayStrip}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        onContentSizeChange={scrollToSelectedDate}
      >
        {days.map((day) => {
          const selected = day === selectedDate;
          return (
            <TouchableOpacity
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={attendanceCalendarDate(day).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
              })}
              onPress={() => {
                haptic('select');
                setPickedDate(day);
              }}
              style={[styles.day, { backgroundColor: selected ? palette.accent.primary : palette.bg.muted }]}
            >
              <Text style={[styles.weekday, { color: selected ? palette.text.inverse : palette.text.secondary }]}>
                {attendanceCalendarDate(day).toLocaleDateString('ru-RU', { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNumber, { color: selected ? palette.text.inverse : palette.text.primary }]}>
                {Number(day.slice(-2))}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.journalHeading}>
        <Text style={[styles.journalTitle, { color: palette.text.primary }]}>Открытия смен</Text>
        <Text style={[styles.timezone, { color: palette.text.secondary }]}>
          Время автосервиса · {timezoneLabel(timeZone)} ({timezoneOption(timeZone).utc})
        </Text>
      </View>
      {isPending ? (
        <ActivityIndicator
          style={styles.loading}
          size="large"
          color={palette.accent.primary}
          accessibilityLabel="Загрузка смен"
        />
      ) : isError && data === undefined ? (
        <QueryErrorState
          title="Не удалось загрузить смены"
          description="Проверьте соединение и повторите загрузку."
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {isError && (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => void refetch()}
              style={[styles.refreshError, { backgroundColor: palette.bg.muted }]}
            >
              <Text style={[styles.refreshErrorText, { color: palette.text.secondary }]}>
                Не удалось обновить смены. Показаны сохранённые данные за этот день. Нажмите, чтобы повторить.
              </Text>
            </TouchableOpacity>
          )}
          {shifts.length === 0 ? (
            <EmptyState
              title="Открытий смен нет"
              description="За выбранный день открытие смен не зарегистрировано."
              icon="clock"
            />
          ) : (
            <View style={[styles.list, { backgroundColor: palette.bg.card }]}>
              {shifts.map((shift, index) => (
                <View
                  key={shift.id}
                  style={[styles.row, index > 0 && styles.rowSeparator, { borderTopColor: palette.border.subtle }]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: palette.bg.muted }]}>
                    <Ionicons
                      name={shift.closedAt ? 'checkmark-circle-outline' : 'time-outline'}
                      size={20}
                      color={palette.text.secondary}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.employee, { color: palette.text.primary }]}>
                      {shift.user?.fullName || 'Сотрудник'}
                    </Text>
                    <Text style={[styles.opening, { color: palette.text.primary }]}>
                      Открытие {formatShiftTime(shift.openedAt, timeZone)}
                    </Text>
                    <Text
                      style={[
                        styles.status,
                        {
                          color: !shift.closedAt
                            ? palette.mode === 'dark'
                              ? colors.green[300]
                              : colors.green[700]
                            : palette.text.secondary,
                        },
                      ]}
                    >
                      {shiftAttendanceStatus(shift)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[4] },
  dateHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  dateTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  todayButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  todayText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  days: { gap: spacing[2], paddingBottom: spacing[1] },
  day: {
    width: 48,
    minHeight: 64,
    borderRadius: borderRadius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing[1],
  },
  weekday: { fontSize: fontSize.xs },
  dayNumber: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  journalHeading: { marginTop: spacing[5], marginBottom: spacing[3], gap: spacing[1] },
  journalTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  timezone: { fontSize: fontSize.xs, lineHeight: 18 },
  loading: { paddingVertical: spacing[8] },
  refreshError: { borderRadius: borderRadius.lg, padding: spacing[3], marginBottom: spacing[3] },
  refreshErrorText: { fontSize: fontSize.sm, lineHeight: 20 },
  list: { borderRadius: borderRadius.xl, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing[3], padding: spacing[4], alignItems: 'flex-start' },
  rowSeparator: { borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 36, height: 36, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: spacing[1] },
  employee: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  opening: { fontSize: fontSize.base, fontVariant: ['tabular-nums'] },
  status: { fontSize: fontSize.sm },
});
