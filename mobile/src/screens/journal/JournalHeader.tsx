import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import { initialJournalScrollState, nextJournalScrollState } from './headerScroll';

export function useJournalReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      listener.remove();
    };
  }, []);
  return reduced;
}

/** Direction hysteresis changes state only after intentional travel, never once per scroll frame. */
export function useJournalHeaderScroll() {
  const [compact, setCompact] = useState(false);
  const state = useRef({ ...initialJournalScrollState(), focused: false });
  const update = useCallback((next: boolean) => {
    if (state.current.compact !== next) {
      state.current.compact = next;
      setCompact(next);
    }
  }, []);
  const onSearchFocus = useCallback(
    (focused: boolean) => {
      state.current.focused = focused;
      if (focused) update(false);
    },
    [update],
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = nextJournalScrollState(state.current, event.nativeEvent.contentOffset.y, state.current.focused);
      state.current = { ...next, compact: state.current.compact, focused: state.current.focused };
      update(next.compact);
    },
    [update],
  );
  const expand = useCallback(() => {
    state.current.anchor = state.current.y;
    update(false);
  }, [update]);
  return { compact, onScroll, onSearchFocus, expand };
}

export default function JournalHeader({
  compact,
  context,
  actions,
}: {
  compact: boolean;
  context: React.ReactNode;
  actions: React.ReactNode;
}) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const titleMinHeight = Math.ceil((textVariantStyles.title2.lineHeight ?? 28) * fontScale) + 12;
  const reduced = useJournalReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const [contextHeight, setContextHeight] = useState(0);
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: compact ? 0 : 1,
      duration: reduced ? 0 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [compact, progress, reduced]);
  return (
    <View style={[s.header, { paddingTop: insets.top, backgroundColor: p.bg.canvas }]}>
      <View style={[s.toolbar, { minHeight: Math.max(touch + 4, titleMinHeight) }, largeText && s.toolbarLarge]}>
        <Text
          variant="title2"
          color={p.text.primary}
          accessibilityRole="header"
          style={[s.title, largeText && s.titleLarge]}
        >
          Журнал
        </Text>
        <View style={[s.actions, largeText && s.actionsLarge]}>{actions}</View>
      </View>
      <Animated.View
        style={{
          height: contextHeight
            ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, contextHeight] })
            : undefined,
          overflow: 'hidden',
        }}
        pointerEvents={compact ? 'none' : 'auto'}
        accessibilityElementsHidden={compact}
        importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'}
      >
        <Animated.View
          onLayout={(event) => {
            // Native layout events are pooled; capture before React runs a deferred state updater.
            const measuredHeight = event.nativeEvent.layout.height;
            setContextHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
          }}
          style={[
            s.context,
            {
              opacity: progress,
              transform: [
                { translateY: reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
              ],
            },
          ]}
        >
          {context}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** Stable field: filtering and header condensation never remount the native input. */
export function JournalSearchInput({
  value,
  onChange,
  onFocusChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  placeholder: string;
}) {
  const p = useColors();
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const field = useRef<TextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
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
    <View style={s.searchRow}>
      <View style={[s.search, { backgroundColor: p.bg.muted }]}>
        <Ionicons name="search" size={18} color={p.text.secondary} />
        <TextInput
          ref={field}
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
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={Keyboard.dismiss}
          onFocus={() => {
            setFocused(true);
            onFocusChange(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange(false);
          }}
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
            <Ionicons name="close-circle" size={20} color={p.text.secondary} />
          </Pressable>
        )}
      </View>
      {focused && (
        <Pressable
          style={s.cancel}
          accessibilityRole="button"
          accessibilityLabel="Отменить поиск"
          onPress={() => {
            clearTimer();
            setLocal('');
            onChange('');
            field.current?.blur();
            Keyboard.dismiss();
          }}
        >
          <Text variant="footnote" color={p.accent.primary}>
            Отмена
          </Text>
        </Pressable>
      )}
    </View>
  );
}
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  header: { paddingHorizontal: 16 },
  toolbar: { minHeight: touch + 4, flexDirection: 'row', alignItems: 'center', gap: 12 },
  toolbarLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 0 },
  title: { flex: 1, minWidth: 0, paddingVertical: 6 },
  titleLarge: { flex: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionsLarge: { alignSelf: 'flex-end', maxWidth: '100%' },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 4,
    paddingBottom: 8,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  search: {
    flex: 1,
    minWidth: 0,
    minHeight: touch,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 8,
  },
  field: { flex: 1, minWidth: 0, minHeight: touch, paddingVertical: 8, paddingRight: 4 },
  icon: { minWidth: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: touch, justifyContent: 'center', paddingHorizontal: 4 },
});
