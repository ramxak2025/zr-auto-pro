import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../contexts/ThemeContext';
import { Text, textVariantStyles } from '../platform/Typography';

export const compactTouchSize = Platform.OS === 'android' ? 48 : 44;

interface HeaderProps {
  title: string;
  subtitle?: string;
  onTitlePress?: () => void;
  titleLabel?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  context?: React.ReactNode;
  status?: React.ReactNode;
}

/** Local toolbar for warehouse, journal and check creation. Owns the top inset. */
export default function CompactScreenHeader({
  title,
  subtitle,
  onTitlePress,
  titleLabel,
  onBack,
  actions,
  context,
  status,
}: HeaderProps) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const heading = (
    <>
      <View style={s.titleRow}>
        <Text
          variant="title2"
          color={p.text.primary}
          accessibilityRole="header"
          style={[s.title, Platform.OS === 'android' && s.androidTitle]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {onTitlePress && <Ionicons name="chevron-down" size={16} color={p.text.secondary} />}
      </View>
      {subtitle ? (
        <Text variant="caption" color={p.text.secondary}>
          {subtitle}
        </Text>
      ) : null}
    </>
  );
  return (
    <View style={[s.header, { paddingTop: insets.top, backgroundColor: p.bg.canvas }]}>
      <View style={s.toolbar}>
        {onBack && (
          <Pressable onPress={onBack} style={s.iconAction} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={24} color={p.accent.primary} />
          </Pressable>
        )}
        {onTitlePress ? (
          <Pressable
            onPress={onTitlePress}
            style={s.heading}
            accessibilityRole="button"
            accessibilityLabel={titleLabel || title}
          >
            {heading}
          </Pressable>
        ) : (
          <View style={s.heading}>{heading}</View>
        )}
        {actions && <View style={s.actions}>{actions}</View>}
      </View>
      {(context || status) && (
        <View style={s.contextRow}>
          {context}
          {status}
        </View>
      )}
    </View>
  );
}

/** Search with the list's existing 300 ms debounce and full native tap targets. */
export function CompactSearchInput({
  value,
  onChange,
  placeholder = 'Поиск',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const p = useColors();
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setLocal((previous) => (previous === value ? previous : value));
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <View style={[s.search, { backgroundColor: p.bg.muted }]}>
      <Ionicons name="search" size={18} color={p.text.secondary} />
      <TextInput
        value={local}
        onChangeText={(next) => {
          setLocal(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(next), 300);
        }}
        style={[textVariantStyles.body, s.searchField, { color: p.text.primary }]}
        accessibilityRole="search"
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={p.text.secondary}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={Keyboard.dismiss}
        clearButtonMode="never"
      />
      {local.length > 0 && (
        <Pressable
          style={s.iconAction}
          accessibilityRole="button"
          accessibilityLabel="Очистить поиск"
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            setLocal('');
            onChange('');
          }}
        >
          <Ionicons name="close-circle" size={20} color={p.text.secondary} />
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  androidTitle: { fontSize: 18, lineHeight: 24 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  toolbar: { minHeight: Platform.OS === 'android' ? 56 : 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { flex: 1, minWidth: 0, minHeight: compactTouchSize, justifyContent: 'center', paddingVertical: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconAction: { width: compactTouchSize, minHeight: compactTouchSize, alignItems: 'center', justifyContent: 'center' },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  search: {
    minHeight: compactTouchSize,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 8,
  },
  searchField: { minWidth: 0, flex: 1, minHeight: compactTouchSize, paddingVertical: 8, paddingRight: 8 },
});
