import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import { journalHeaderGeometry, journalHeaderProgress } from './headerScroll';
import { JournalPressable, useJournalReducedMotion } from './JournalMotion';

export { useJournalReducedMotion } from './JournalMotion';

/** The scroll worklet never rerenders the list. Its top spacer is constant while scrolling. */
export function useJournalHeaderScroll() {
  const { fontScale } = useWindowDimensions();
  const initialGeometry = journalHeaderGeometry(fontScale, Math.ceil(40 * fontScale), touch);
  const progress = useSharedValue(0);
  const focused = useSharedValue(false);
  const [contentTop, setContentTop] = useState(
    initialGeometry.expandedHeight - initialGeometry.compactHeight + Math.max(touch + 12, 22 * fontScale + 24) + 4,
  );
  const onScroll = useAnimatedScrollHandler((event) => {
    if (!focused.value) progress.value = journalHeaderProgress(event.contentOffset.y);
  });
  const onSearchFocus = useCallback(
    (value: boolean) => {
      focused.value = value;
    },
    [focused],
  );
  const expand = useCallback(() => {
    progress.value = 0;
  }, [progress]);
  const onContentTop = useCallback((height: number) => {
    setContentTop((current) => (current === height ? current : height));
  }, []);
  return { progress, onScroll, onSearchFocus, expand, contentTop, onContentTop };
}

/**
 * Only the compact title reserves layout space. The floating controls overlap the
 * list viewport, so iOS material samples actual moving rows beneath them.
 */
export default function JournalHeader({
  progress,
  context,
  children,
  onContentTop,
}: {
  progress: SharedValue<number>;
  context: React.ReactNode;
  children?: React.ReactNode;
  onContentTop: (height: number) => void;
}) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const reduced = useJournalReducedMotion();
  const [titleRowHeight, setTitleRowHeight] = useState(Math.ceil(40 * fontScale));
  const [controlsHeight, setControlsHeight] = useState(Math.max(touch + 12, 22 * fontScale + 24) + 4);
  const [compact, setCompact] = useState(false);
  const { compactHeight, expandedHeight, titleTop } = journalHeaderGeometry(fontScale, titleRowHeight, touch);
  useAnimatedReaction(
    () => progress.value >= 0.75,
    (value, previous) => {
      if (value !== previous) runOnJS(setCompact)(value);
    },
    [progress],
  );
  useEffect(() => {
    onContentTop(expandedHeight - compactHeight + controlsHeight);
  }, [compactHeight, controlsHeight, expandedHeight, onContentTop]);
  const stage = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [expandedHeight, compactHeight]),
  }));
  const title = useAnimatedStyle(() => ({
    fontSize: interpolate(progress.value, [0, 1], [34 * fontScale, 17 * fontScale]),
    lineHeight: interpolate(progress.value, [0, 1], [40 * fontScale, 22 * fontScale]),
    top: -3 * progress.value,
  }));
  const contextMotion = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.65, 1], [1, 0, 0]),
    transform: [{ translateY: reduced ? 0 : -20 * progress.value }],
  }));
  const controls = useAnimatedStyle(() => ({
    transform: [{ translateY: -progress.value * (expandedHeight - compactHeight) }],
  }));
  return (
    <>
      <View testID="journal-header-reservation" style={{ height: insets.top + compactHeight }} />
      <View
        testID="journal-header"
        style={[s.header, { height: insets.top + expandedHeight + controlsHeight }]}
        pointerEvents="box-none"
      >
        <View style={[s.safe, { height: insets.top, backgroundColor: p.bg.canvas }]} />
        <Animated.View
          testID="journal-title-stage"
          style={[s.stage, { top: insets.top, backgroundColor: p.bg.canvas }, stage]}
        >
          <View
            style={[s.titleRow, { top: titleTop }]}
            onLayout={(event) => {
              const measuredHeight = event.nativeEvent.layout.height;
              setTitleRowHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
            }}
          >
            <View style={[s.titleSlot, { minHeight: Math.ceil(40 * fontScale) }]}>
              {/* Both copies receive the full user scale as explicit metrics.
                  This invalidates native measurement after a live size change;
                  automatic scaling would apply the multiplier a second time.
                  Only the visible copy animates, leaving list layout stable. */}
              <Text
                variant="display"
                testID="journal-title-measure"
                allowFontScaling={false}
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={[s.titleMeasure, { fontSize: 34 * fontScale, lineHeight: 40 * fontScale }]}
              >
                Журнал
              </Text>
              <Animated.Text
                accessibilityRole="header"
                allowFontScaling={false}
                style={[textVariantStyles.display, s.title, { color: p.text.primary }, title]}
              >
                Журнал
              </Animated.Text>
            </View>
            <Animated.View
              pointerEvents="none"
              accessibilityElementsHidden={compact}
              importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'}
              style={[s.statusSlot, contextMotion]}
            >
              {context}
            </Animated.View>
          </View>
        </Animated.View>
        <Animated.View
          testID="journal-floating-controls"
          pointerEvents="box-none"
          onLayout={(event) => setControlsHeight(event.nativeEvent.layout.height)}
          style={[s.controls, { top: insets.top + expandedHeight }, controls]}
        >
          {children}
        </Animated.View>
      </View>
    </>
  );
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
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, overflow: 'visible' },
  safe: { position: 'absolute', left: 0, right: 0, top: 0 },
  stage: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  titleRow: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
  },
  titleSlot: { maxWidth: '100%' },
  titleMeasure: { opacity: 0 },
  title: { position: 'absolute', left: 0, right: 0 },
  statusSlot: { flexGrow: 1, maxWidth: '100%', alignItems: 'flex-end' },
  controls: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 4 },
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
