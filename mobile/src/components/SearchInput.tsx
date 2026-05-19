import React, { useState, useEffect, useRef } from 'react';
import { View, TextInput, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, borderRadius, spacing } from '../theme';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function SearchInput({ value, onChange, placeholder = 'Поиск...' }: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external `value` → internal `localValue` only when they actually
  // differ. Without the guard, a parent that re-renders with the same
  // string still re-fires the effect, and any future change to this
  // component's local state could feed back into a render loop. Cheap
  // primitive comparison; idempotent. Reads `localValue` via functional
  // update so the effect doesn't need to depend on it (closing on the
  // current value would re-create the effect on every keystroke).
  useEffect(() => {
    setLocalValue((prev) => (prev === value ? prev : value));
  }, [value]);

  const handleChange = (text: string) => {
    setLocalValue(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(text), 300);
  };

  const handleClear = () => {
    setLocalValue('');
    if (timerRef.current) clearTimeout(timerRef.current);
    // Push the empty value through immediately — the user explicitly
    // asked for "clear", no point waiting on the 300ms debounce.
    onChange('');
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.gray[400]} style={styles.leadingIcon} />
        <TextInput
          value={localValue}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={colors.gray[400]}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="never"
        />
        {localValue.length > 0 && (
          <Pressable
            onPress={handleClear}
            hitSlop={10}
            style={styles.clearBtn}
            accessibilityRole="button"
            accessibilityLabel="Очистить поиск"
          >
            <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing[4],
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  leadingIcon: {
    marginRight: spacing[2],
  },
  input: {
    flex: 1,
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  clearBtn: {
    marginLeft: spacing[1.5],
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
