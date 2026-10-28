import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  useDerivedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import { journalHeaderGeometry, journalHeaderProgress } from './headerScroll';
import { JournalPressable } from './JournalMotion';

export { useJournalReducedMotion } from './JournalMotion';

/** Raw scroll follows the list; focusing search never changes header geometry. */
export function useJournalHeaderScroll() {
  const { fontScale } = useWindowDimensions();
  const initialGeometry = journalHeaderGeometry(fontScale, Math.ceil(40 * fontScale));
  const scrollY = useSharedValue(0);
  const titleHeight = useSharedValue(initialGeometry.expandedHeight);
  const progress = useDerivedValue(() => journalHeaderProgress(scrollY.value, titleHeight.value));
  const [contentTop, setContentTop] = useState(
    initialGeometry.expandedHeight + Math.max(touch + 12, 22 * fontScale + 24) + 4,
  );
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = Math.max(0, event.contentOffset.y);
  });
  const reset = useCallback(() => {
    scrollY.value = 0;
  }, [scrollY]);
  const onContentTop = useCallback((height: number) => {
    setContentTop((current) => (current === height ? current : height));
  }, []);
  return { scrollY, titleHeight, progress, onScroll, reset, contentTop, onContentTop };
}
export type JournalScrollController = ReturnType<typeof useJournalHeaderScroll>;

/** Title moves with content; only the existing control island pins at safeTop. */
export default function JournalHeader({
  scroll,
  title = 'Журнал',
  context,
  hideHeading = false,
  children,
}: {
  scroll: JournalScrollController;
  title?: string;
  context: React.ReactNode;
  hideHeading?: boolean;
  children?: React.ReactNode;
}) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [titleRowHeight, setTitleRowHeight] = useState(Math.ceil(40 * fontScale));
  const [controlsHeight, setControlsHeight] = useState(Math.max(touch + 12, 22 * fontScale + 24) + 4);
  const [titleHidden, setTitleHidden] = useState(hideHeading);
  const geometry = journalHeaderGeometry(fontScale, titleRowHeight);
  const expandedHeight = hideHeading ? 0 : geometry.expandedHeight;
  const { scrollY, titleHeight, onContentTop } = scroll;
  useLayoutEffect(() => {
    titleHeight.value = expandedHeight;
    onContentTop(expandedHeight + controlsHeight);
  }, [titleHeight, onContentTop, expandedHeight, controlsHeight]);
  useAnimatedReaction(
    () => hideHeading || scrollY.value >= expandedHeight,
    (value, previous) => {
      if (value !== previous) runOnJS(setTitleHidden)(value);
    },
    [hideHeading, expandedHeight],
  );
  const movement = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.min(scrollY.value, expandedHeight) }] }));
  return (
    <>
      <View testID="journal-header-reservation" style={{ height: insets.top }} />
      <View
        testID="journal-header"
        style={[s.header, { height: insets.top + expandedHeight + controlsHeight }]}
        pointerEvents="box-none"
      >
        <View style={[s.safe, { height: insets.top, backgroundColor: p.bg.canvas }]} />
        <View
          testID="journal-title-clip"
          pointerEvents="box-none"
          accessibilityElementsHidden={titleHidden}
          importantForAccessibility={titleHidden ? 'no-hide-descendants' : 'auto'}
          style={[s.titleClip, { top: insets.top, height: expandedHeight }]}
        >
          <Animated.View
            testID="journal-title-stage"
            style={[s.stage, { height: expandedHeight, backgroundColor: p.bg.canvas }, movement]}
          >
            <View
              style={[s.titleRow, { paddingTop: geometry.titleTop }]}
              onLayout={(event) => {
                const measuredHeight = event.nativeEvent.layout.height - geometry.titleTop;
                setTitleRowHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
              }}
            >
              <Text
                variant="display"
                accessibilityRole="header"
                allowFontScaling={false}
                style={[
                  s.titleSlot,
                  {
                    color: p.text.primary,
                    fontSize: 34 * fontScale,
                    lineHeight: 40 * fontScale,
                    minHeight: Math.ceil(40 * fontScale),
                  },
                ]}
              >
                {title}
              </Text>
              <View style={s.statusSlot}>{context}</View>
            </View>
          </Animated.View>
        </View>
        <Animated.View
          testID="journal-floating-controls"
          pointerEvents="box-none"
          onLayout={(event) => {
            const measuredHeight = event.nativeEvent.layout.height;
            setControlsHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
          }}
          style={[s.controls, { top: insets.top + expandedHeight }, movement]}
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
  titleClip: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  stage: { position: 'absolute', left: 0, right: 0 },
  titleRow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
  },
  titleSlot: { maxWidth: '100%' },
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
