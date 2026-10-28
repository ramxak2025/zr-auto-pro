import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import ScreenSectionHeader, {
  useScreenSectionScroll,
  type ScreenSectionScrollController,
} from '../../components/ScreenSectionHeader';
import { JournalPressable } from './JournalMotion';

export { useJournalReducedMotion } from './JournalMotion';
export const useJournalHeaderScroll = useScreenSectionScroll;
export type JournalScrollController = ScreenSectionScrollController;

/** Compatibility surface: the shared header keeps Journal/Warehouse's accepted geometry. */
export default function JournalHeader({
  title = 'Журнал',
  ...props
}: {
  scroll: JournalScrollController;
  title?: string;
  context: React.ReactNode;
  hideHeading?: boolean;
  children?: React.ReactNode;
}) {
  return <ScreenSectionHeader {...props} title={title} testIDPrefix="journal" />;
}

/** One native field survives both the authored reveal and all scope/filter changes. */
export function JournalSearchInput({
  value,
  onChange,
  onFocusChange,
  placeholder,
  active = true,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  placeholder: string;
  active?: boolean;
  onCancel?: () => void;
}) {
  const p = useColors();
  const [local, setLocal] = useState(value);
  const field = useRef<TextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => {
    if (active) field.current?.focus();
    else field.current?.blur();
  }, [active]);
  useEffect(() => {
    clearTimer();
    setLocal((previous) => (previous === value ? previous : value));
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <View
      style={s.searchRow}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[s.search, { backgroundColor: p.bg.muted }]}>
        <Ionicons name="search" size={19} color={p.text.secondary} />
        <TextInput
          ref={field}
          testID="journal-search-input"
          value={local}
          onChangeText={(next) => {
            setLocal(next);
            clearTimer();
            timer.current = setTimeout(() => onChange(next), 300);
          }}
          style={[textVariantStyles.body, s.field, { color: p.text.primary }]}
          accessibilityRole="search"
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={p.text.secondary}
          selectionColor={p.accent.primary}
          editable={active}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => {
            clearTimer();
            onChange(local);
            Keyboard.dismiss();
          }}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
        />
        {!!local && (
          <Pressable
            style={s.icon}
            accessibilityRole="button"
            accessibilityLabel="Очистить поиск"
            onPress={() => {
              clearTimer();
              setLocal('');
              onChange('');
              field.current?.focus();
            }}
          >
            <Ionicons name="close-circle" size={19} color={p.text.secondary} />
          </Pressable>
        )}
      </View>
      <JournalPressable
        style={s.cancel}
        accessibilityRole="button"
        accessibilityLabel="Отменить поиск"
        onPress={() => {
          clearTimer();
          setLocal('');
          onChange('');
          field.current?.blur();
          Keyboard.dismiss();
          onFocusChange(false);
          onCancel?.();
        }}
      >
        <Text variant="footnote" color={p.accent.primaryText}>
          Отмена
        </Text>
      </JournalPressable>
    </View>
  );
}
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  searchRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: {
    flex: 1,
    minWidth: 0,
    minHeight: touch,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 8,
  },
  field: { flex: 1, minWidth: 0, minHeight: touch, paddingVertical: 8, paddingRight: 4 },
  icon: { minWidth: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: touch, justifyContent: 'center', paddingRight: 6 },
});
