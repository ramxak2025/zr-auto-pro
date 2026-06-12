/**
 * DateTimePickerModal — единый пикер даты/времени для всего приложения
 * (8 экранов: касса, журнал, расписание, отчёты, расходы и т.д.).
 *
 *  iOS:     нативный UIDatePicker через @react-native-community/datetimepicker —
 *           inline-календарь для mode="date", spinner-барабаны для mode="time".
 *           themeVariant привязан к теме приложения, locale ru-RU фиксирует
 *           русские месяцы и 24-часовой формат независимо от языка устройства.
 *  Android: проверенная JS-реализация (календарная сетка + часы/минуты со
 *           стрелками). Нативный Android-диалог следует системной теме, а не
 *           внутреннему переключателю приложения — поэтому оставляем JS,
 *           но перекрашиваем его в семантическую палитру.
 *
 * Оболочка модалки theme-aware (useColors), фон — общий ModalBlurBackdrop
 * (никаких тёмных rgba-скримов). Контракт Props не менялся.
 */
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal as RNModal, StyleSheet, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import ModalBlurBackdrop from './ModalBlurBackdrop';

interface Props {
  visible: boolean;
  value: Date;
  mode: 'date' | 'time';
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
const DAY_ABBR = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

// ── Calendar Date Picker (Android-фоллбек, перекрашен в палитру) ──
function CalendarPicker({ value, onChange, p }: { value: Date; onChange: (d: Date) => void; p: SemanticPalette }) {
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const [viewMonth, setViewMonth] = useState(value.getMonth());

  // Sync the displayed month/year to whatever Date the parent currently
  // shows. Parents often pass `value={someDate || new Date()}` inline — a
  // brand-new Date instance on every render — which would re-fire this
  // effect endlessly. Guard with functional setState + value-equality so
  // a same-day re-render is a no-op rather than a render-loop trigger.
  useEffect(() => {
    const nextYear = value.getFullYear();
    const nextMonth = value.getMonth();
    setViewYear((prev) => (prev === nextYear ? prev : nextYear));
    setViewMonth((prev) => (prev === nextMonth ? prev : nextMonth));
  }, [value]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const selectedStr = `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else setViewMonth(viewMonth + 1);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      {/* Month navigation */}
      <View style={cs.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={[cs.navBtn, { backgroundColor: p.bg.muted }]}>
          <Ionicons name="chevron-back" size={18} color={p.text.secondary} />
        </TouchableOpacity>
        <Text style={[cs.monthText, { color: p.text.primary }]}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <TouchableOpacity onPress={nextMonth} style={[cs.navBtn, { backgroundColor: p.bg.muted }]}>
          <Ionicons name="chevron-forward" size={18} color={p.text.secondary} />
        </TouchableOpacity>
      </View>

      {/* Day of week headers */}
      <View style={cs.weekRow}>
        {DAY_ABBR.map((d) => (
          <View key={d} style={cs.weekCell}>
            <Text style={[cs.weekText, { color: p.text.tertiary }]}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Days grid */}
      <View style={cs.daysGrid}>
        {cells.map((day, idx) => {
          if (day === null) return <View key={`e-${idx}`} style={cs.dayCell} />;
          const dayStr = `${viewYear}-${viewMonth}-${day}`;
          const isToday = dayStr === todayStr;
          const isSelected = dayStr === selectedStr;
          return (
            <TouchableOpacity
              key={day}
              style={[
                cs.dayCell,
                isSelected && [cs.dayCellRounded, { backgroundColor: p.accent.primary }],
                isToday && !isSelected && [cs.dayCellRounded, { backgroundColor: p.accent.primarySoft }],
              ]}
              onPress={() => {
                const newDate = new Date(value);
                newDate.setFullYear(viewYear, viewMonth, day);
                onChange(newDate);
              }}
              activeOpacity={0.6}
            >
              <Text
                style={[
                  cs.dayText,
                  { color: p.text.primary },
                  isSelected && [cs.dayTextStrong, { color: p.text.inverse }],
                  isToday && !isSelected && [cs.dayTextStrong, { color: p.accent.primaryText }],
                ]}
              >
                {day}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const cs = StyleSheet.create({
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    marginBottom: spacing[3],
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // backgroundColor — из палитры (theme-aware) инлайном.
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthText: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  weekRow: { flexDirection: 'row', marginBottom: spacing[1] },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: spacing[1] },
  weekText: { fontSize: 11, fontWeight: fontWeight.semibold },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: spacing[1.5] },
  dayCellRounded: { borderRadius: 20 },
  dayText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    width: 32,
    height: 32,
    lineHeight: 32,
    textAlign: 'center',
  },
  dayTextStrong: { fontWeight: fontWeight.bold },
});

// ── Time Picker (Android-фоллбек, перекрашен в палитру) ──
function TimePicker({ value, onChange, p }: { value: Date; onChange: (d: Date) => void; p: SemanticPalette }) {
  const hours = value.getHours();
  const minutes = value.getMinutes();

  const setHours = (h: number) => {
    const d = new Date(value);
    d.setHours(h);
    onChange(d);
  };
  const setMinutes = (m: number) => {
    const d = new Date(value);
    d.setMinutes(m);
    onChange(d);
  };

  return (
    <View style={ts.container}>
      {/* Hours */}
      <View style={ts.column}>
        <Text style={[ts.label, { color: p.text.tertiary }]}>Часы</Text>
        <View style={ts.controls}>
          <TouchableOpacity
            style={[ts.arrowBtn, { backgroundColor: p.bg.muted }]}
            onPress={() => setHours((hours + 1) % 24)}
          >
            <Ionicons name="chevron-up" size={22} color={p.text.secondary} />
          </TouchableOpacity>
          <View style={[ts.valueBox, { backgroundColor: p.accent.primarySoft, borderColor: p.accent.primary }]}>
            <Text style={[ts.valueText, { color: p.accent.primaryText }]}>{String(hours).padStart(2, '0')}</Text>
          </View>
          <TouchableOpacity
            style={[ts.arrowBtn, { backgroundColor: p.bg.muted }]}
            onPress={() => setHours((hours + 23) % 24)}
          >
            <Ionicons name="chevron-down" size={22} color={p.text.secondary} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[ts.separator, { color: p.text.tertiary }]}>:</Text>

      {/* Minutes */}
      <View style={ts.column}>
        <Text style={[ts.label, { color: p.text.tertiary }]}>Минуты</Text>
        <View style={ts.controls}>
          <TouchableOpacity
            style={[ts.arrowBtn, { backgroundColor: p.bg.muted }]}
            onPress={() => setMinutes((minutes + 5) % 60)}
          >
            <Ionicons name="chevron-up" size={22} color={p.text.secondary} />
          </TouchableOpacity>
          <View style={[ts.valueBox, { backgroundColor: p.accent.primarySoft, borderColor: p.accent.primary }]}>
            <Text style={[ts.valueText, { color: p.accent.primaryText }]}>{String(minutes).padStart(2, '0')}</Text>
          </View>
          <TouchableOpacity
            style={[ts.arrowBtn, { backgroundColor: p.bg.muted }]}
            onPress={() => setMinutes((minutes + 55) % 60)}
          >
            <Ionicons name="chevron-down" size={22} color={p.text.secondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick presets */}
      <View style={ts.presetsColumn}>
        <Text style={[ts.label, { color: p.text.tertiary }]}>Быстро</Text>
        <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
          {['09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((preset) => {
            const [h, m] = preset.split(':').map(Number);
            const isActive = hours === h && minutes === m;
            return (
              <TouchableOpacity
                key={preset}
                style={[ts.presetBtn, isActive && { backgroundColor: p.accent.primarySoft }]}
                onPress={() => {
                  const d = new Date(value);
                  d.setHours(h, m);
                  onChange(d);
                }}
              >
                <Text
                  style={[
                    ts.presetText,
                    { color: p.text.secondary },
                    isActive && [ts.presetTextActive, { color: p.accent.primaryText }],
                  ]}
                >
                  {preset}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const ts = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: spacing[2] },
  column: { alignItems: 'center' },
  label: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
    letterSpacing: 0.5,
  },
  controls: { alignItems: 'center', gap: spacing[1] },
  arrowBtn: {
    width: 44,
    height: 36,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueBox: {
    width: 60,
    height: 56,
    borderRadius: borderRadius.xl,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: { fontSize: 28, fontWeight: fontWeight.bold },
  separator: { fontSize: 28, fontWeight: fontWeight.bold, marginTop: 42 },
  presetsColumn: { alignItems: 'center', marginLeft: spacing[3] },
  presetBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    marginBottom: spacing[1],
  },
  presetText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  presetTextActive: { fontWeight: fontWeight.bold },
});

// ── Main Modal ──
export default function DateTimePickerModal({ visible, value, mode, onConfirm, onCancel }: Props) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const [tempDate, setTempDate] = useState(value);

  useEffect(() => {
    if (visible) setTempDate(new Date(value));
  }, [visible]);

  // iOS: нативный пикер репортит выбор через onChange; date undefined только
  // при dismiss-событиях — игнорируем их, выбор фиксируется кнопкой «Готово».
  const handleNativeChange = (_event: DateTimePickerEvent, d?: Date) => {
    if (d) setTempDate(d);
  };

  const handleConfirm = () => {
    haptic('tap');
    onConfirm(tempDate);
  };

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={[styles.overlay, { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[4] }]}
      >
        <ModalBlurBackdrop onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: p.bg.elevated }]}>
          <View style={[styles.header, { borderBottomColor: p.border.subtle }]}>
            <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
              <Text style={[styles.cancelText, { color: p.text.secondary }]}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: p.text.primary }]}>
              {mode === 'date' ? 'Выберите дату' : 'Выберите время'}
            </Text>
            <TouchableOpacity onPress={handleConfirm} style={styles.headerBtn}>
              <Text style={[styles.doneText, { color: p.accent.primary }]}>Готово</Text>
            </TouchableOpacity>
          </View>
          {Platform.OS === 'ios' ? (
            <View style={styles.iosBody}>
              <DateTimePicker
                value={tempDate}
                mode={mode}
                display={mode === 'date' ? 'inline' : 'spinner'}
                onChange={handleNativeChange}
                themeVariant={p.mode}
                accentColor={p.accent.primary}
                // Продуктовый язык — русский: фиксируем месяцы/дни недели и
                // 24-часовые барабаны независимо от языка устройства.
                locale="ru-RU"
                style={styles.iosPicker}
              />
            </View>
          ) : (
            <View style={styles.body}>
              {mode === 'date' ? (
                <CalendarPicker value={tempDate} onChange={setTempDate} p={p} />
              ) : (
                <TimePicker value={tempDate} onChange={setTempDate} p={p} />
              )}
            </View>
          )}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  sheet: {
    // backgroundColor — из палитры (bg.elevated) инлайном.
    // M3 Alert Dialog использует 28pt corner — как в components/Modal.tsx.
    borderRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    width: '100%',
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  headerBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  cancelText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  doneText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  body: {
    padding: spacing[4],
  },
  iosBody: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
  },
  iosPicker: {
    alignSelf: 'center',
  },
});
