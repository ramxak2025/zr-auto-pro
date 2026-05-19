import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal as RNModal, StyleSheet, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

interface Props {
  visible: boolean;
  value: Date;
  mode: 'date' | 'time';
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const DAY_ABBR = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

// ── Calendar Date Picker ──
function CalendarPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
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
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View>
      {/* Month navigation */}
      <View style={cs.monthNav}>
        <TouchableOpacity onPress={prevMonth} style={cs.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
        <Text style={cs.monthText}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
        <TouchableOpacity onPress={nextMonth} style={cs.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.gray[600]} />
        </TouchableOpacity>
      </View>

      {/* Day of week headers */}
      <View style={cs.weekRow}>
        {DAY_ABBR.map(d => (
          <View key={d} style={cs.weekCell}>
            <Text style={cs.weekText}>{d}</Text>
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
              style={[cs.dayCell, isSelected && cs.dayCellSelected, isToday && !isSelected && cs.dayCellToday]}
              onPress={() => {
                const newDate = new Date(value);
                newDate.setFullYear(viewYear, viewMonth, day);
                onChange(newDate);
              }}
              activeOpacity={0.6}
            >
              <Text style={[cs.dayText, isSelected && cs.dayTextSelected, isToday && !isSelected && cs.dayTextToday]}>
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
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[2], marginBottom: spacing[3] },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  monthText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  weekRow: { flexDirection: 'row', marginBottom: spacing[1] },
  weekCell: { flex: 1, alignItems: 'center', paddingVertical: spacing[1] },
  weekText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[400] },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: spacing[1.5] },
  dayCellSelected: { backgroundColor: colors.primary[600], borderRadius: 20 },
  dayCellToday: { backgroundColor: colors.primary[50], borderRadius: 20 },
  dayText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900], width: 32, height: 32, lineHeight: 32, textAlign: 'center' },
  dayTextSelected: { color: colors.white, fontWeight: fontWeight.bold },
  dayTextToday: { color: colors.primary[600], fontWeight: fontWeight.bold },
});

// ── Time Picker ──
function TimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
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
        <Text style={ts.label}>Часы</Text>
        <View style={ts.controls}>
          <TouchableOpacity style={ts.arrowBtn} onPress={() => setHours((hours + 1) % 24)}>
            <Ionicons name="chevron-up" size={22} color={colors.gray[600]} />
          </TouchableOpacity>
          <View style={ts.valueBox}>
            <Text style={ts.valueText}>{String(hours).padStart(2, '0')}</Text>
          </View>
          <TouchableOpacity style={ts.arrowBtn} onPress={() => setHours((hours + 23) % 24)}>
            <Ionicons name="chevron-down" size={22} color={colors.gray[600]} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={ts.separator}>:</Text>

      {/* Minutes */}
      <View style={ts.column}>
        <Text style={ts.label}>Минуты</Text>
        <View style={ts.controls}>
          <TouchableOpacity style={ts.arrowBtn} onPress={() => setMinutes((minutes + 5) % 60)}>
            <Ionicons name="chevron-up" size={22} color={colors.gray[600]} />
          </TouchableOpacity>
          <View style={ts.valueBox}>
            <Text style={ts.valueText}>{String(minutes).padStart(2, '0')}</Text>
          </View>
          <TouchableOpacity style={ts.arrowBtn} onPress={() => setMinutes((minutes + 55) % 60)}>
            <Ionicons name="chevron-down" size={22} color={colors.gray[600]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick presets */}
      <View style={ts.presetsColumn}>
        <Text style={ts.label}>Быстро</Text>
        <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
          {['09:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map(preset => {
            const [h, m] = preset.split(':').map(Number);
            const isActive = hours === h && minutes === m;
            return (
              <TouchableOpacity
                key={preset}
                style={[ts.presetBtn, isActive && ts.presetBtnActive]}
                onPress={() => { const d = new Date(value); d.setHours(h, m); onChange(d); }}
              >
                <Text style={[ts.presetText, isActive && ts.presetTextActive]}>{preset}</Text>
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
  label: { fontSize: 10, color: colors.gray[400], fontWeight: fontWeight.semibold, marginBottom: spacing[2], letterSpacing: 0.5 },
  controls: { alignItems: 'center', gap: spacing[1] },
  arrowBtn: { width: 44, height: 36, borderRadius: borderRadius.lg, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  valueBox: { width: 60, height: 56, borderRadius: borderRadius.xl, backgroundColor: colors.primary[50], borderWidth: 2, borderColor: colors.primary[200], alignItems: 'center', justifyContent: 'center' },
  valueText: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.primary[700] },
  separator: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.gray[300], marginTop: 42 },
  presetsColumn: { alignItems: 'center', marginLeft: spacing[3] },
  presetBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.md, marginBottom: spacing[1] },
  presetBtnActive: { backgroundColor: colors.primary[50] },
  presetText: { fontSize: fontSize.xs, color: colors.gray[500], fontWeight: fontWeight.medium },
  presetTextActive: { color: colors.primary[700], fontWeight: fontWeight.bold },
});

// ── Main Modal ──
export default function DateTimePickerModal({ visible, value, mode, onConfirm, onCancel }: Props) {
  const [tempDate, setTempDate] = useState(value);

  useEffect(() => {
    if (visible) setTempDate(new Date(value));
  }, [visible]);

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
              <Text style={styles.cancelText}>Отмена</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{mode === 'date' ? 'Выберите дату' : 'Выберите время'}</Text>
            <TouchableOpacity onPress={() => onConfirm(tempDate)} style={styles.headerBtn}>
              <Text style={styles.doneText}>Готово</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.body}>
            {mode === 'date' ? (
              <CalendarPicker value={tempDate} onChange={setTempDate} />
            ) : (
              <TimePicker value={tempDate} onChange={setTempDate} />
            )}
          </View>
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
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
    borderBottomColor: colors.gray[100],
  },
  headerBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  cancelText: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
  doneText: {
    fontSize: fontSize.sm,
    color: colors.primary[600],
    fontWeight: fontWeight.bold,
  },
  body: {
    padding: spacing[4],
  },
});
