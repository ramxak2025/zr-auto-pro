import React from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, textVariantStyles } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { JournalPressable } from './JournalMotion';

const touch = Platform.OS === 'android' ? 48 : 44;

export function JournalFilterHeader({
  title,
  detail,
  onBack,
  onClose,
  closeLabel = 'Отменить изменения фильтров',
}: {
  title: string;
  detail: boolean;
  onBack: () => void;
  onClose: () => void;
  closeLabel?: string;
}) {
  const p = useColors();
  return (
    <View style={s.header}>
      {detail && (
        <JournalPressable
          style={[s.back, { backgroundColor: p.bg.muted }]}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Назад к фильтрам"
        >
          <Ionicons name="chevron-back" size={21} color={p.accent.primaryText} />
        </JournalPressable>
      )}
      <Text variant={detail ? 'title2' : 'title1'} color={p.text.primary} accessibilityRole="header" style={s.title}>
        {title}
      </Text>
      <JournalPressable
        style={[s.close, { backgroundColor: p.bg.muted }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      >
        <Ionicons name="close" size={20} color={p.text.secondary} />
      </JournalPressable>
    </View>
  );
}

export function JournalFilterGroup({ children }: { children: React.ReactNode }) {
  const p = useColors();
  return <View style={[s.group, { backgroundColor: p.bg.card }]}>{children}</View>;
}

export function JournalFilterSummary({
  title,
  value,
  icon,
  onPress,
  active = false,
  last = false,
}: {
  title: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  active?: boolean;
  last?: boolean;
}) {
  const p = useColors();
  return (
    <JournalPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${value}`}
      style={[s.row, { borderBottomColor: last ? 'transparent' : p.border.subtle }]}
    >
      <Ionicons name={icon} size={20} color={active ? p.accent.primaryText : p.text.secondary} />
      <View style={s.flex}>
        <Text variant="bodyEmph" color={p.text.primary}>
          {title}
        </Text>
        <Text variant="footnote" color={active ? p.accent.primaryText : p.text.secondary}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={p.text.secondary} />
    </JournalPressable>
  );
}

export function JournalFilterSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const p = useColors();
  return (
    <View style={[s.search, { backgroundColor: p.bg.muted }]}>
      <Ionicons name="search" size={19} color={p.text.secondary} />
      <TextInput
        accessibilityLabel="Найти сотрудника"
        placeholder="Найти сотрудника"
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        selectionColor={p.accent.primary}
        placeholderTextColor={p.text.secondary}
        style={[textVariantStyles.body, s.searchField, { color: p.text.primary }]}
      />
      {!!value && (
        <JournalPressable
          style={s.close}
          onPress={() => onChange('')}
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск сотрудников"
        >
          <Ionicons name="close-circle" size={19} color={p.text.secondary} />
        </JournalPressable>
      )}
    </View>
  );
}
export const journalFilterStyles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  row: {
    minHeight: Platform.OS === 'android' ? 60 : 56,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, minWidth: 0 },
  hint: { paddingTop: 14, paddingBottom: 8, lineHeight: 20 },
  sectionTitle: { paddingTop: 22, paddingBottom: 10, paddingLeft: 2 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 16, paddingTop: 6 },
  preset: { minHeight: touch, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  dateFields: { gap: 12, paddingTop: 4 },
  dateField: { borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center' },
  dateAction: { minHeight: 76, padding: 16, gap: 4 },
  clear: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  amountRow: { flexDirection: 'row', gap: 12, paddingTop: 12, paddingBottom: 20 },
  inputLabel: { marginBottom: 8, paddingLeft: 2 },
  input: { minHeight: 58, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, fontVariant: ['tabular-nums'] },
  footer: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  reset: { minHeight: 52, paddingHorizontal: 4, justifyContent: 'center' },
  apply: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  message: { paddingVertical: 12 },
  loading: { marginVertical: 20 },
});
const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 16,
    gap: 12,
  },
  back: { width: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center', borderRadius: touch / 2 },
  close: { width: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center', borderRadius: touch / 2 },
  title: { flex: 1, minWidth: 0 },
  group: { borderRadius: 16, borderCurve: 'continuous', paddingHorizontal: 16 },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  search: {
    minHeight: 48,
    borderRadius: 16,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  searchField: { flex: 1, minWidth: 0, paddingVertical: 12, paddingRight: 12 },
});
