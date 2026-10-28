import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../contexts/ThemeContext';
import { Text } from '../platform/Typography';
import { screenSectionGeometry, screenSectionProgress } from './screenSectionGeometry';

const touch = Platform.OS === 'android' ? 48 : 44;
const initialControlsHeight = (fontScale: number) => Math.max(touch + 12, 22 * fontScale + 24) + 4;
const initialNavigationHeight = (fontScale: number) => Math.max(touch, Math.ceil(22 * fontScale)) + 12;

export type ScreenHeaderComposition = 'section' | 'navigation';

/** Attach onScroll only to the screen's main vertical scroller, never nested/modal scrollers. */
export function useScreenSectionScroll({
  composition = 'section',
  hasControls = true,
  hideHeading = false,
  onScroll: observer,
}: {
  composition?: ScreenHeaderComposition;
  hasControls?: boolean;
  hideHeading?: boolean;
  /** Preserve an existing JS scroll observer with the same native event object. */
  onScroll?: ScrollViewProps['onScroll'];
} = {}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const geometry = screenSectionGeometry(fontScale, Math.ceil(28 * fontScale));
  const navigation = composition === 'navigation';
  const scrollY = useSharedValue(0);
  const titleHeight = useSharedValue(navigation || hideHeading ? 0 : geometry.expandedHeight);
  const progress = useDerivedValue(() => screenSectionProgress(scrollY.value, titleHeight.value));
  const [contentTop, setContentTop] = useState(
    insets.top +
      (navigation
        ? initialNavigationHeight(fontScale)
        : (hideHeading ? 0 : geometry.expandedHeight) + (hasControls ? initialControlsHeight(fontScale) : 0)),
  );
  const animatedOnScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = Math.max(0, event.contentOffset.y);
  });
  const onNativeScroll = useCallback<NonNullable<ScrollViewProps['onScroll']>>(
    (event) => {
      scrollY.value = Math.max(0, event.nativeEvent.contentOffset.y);
      observer?.(event);
    },
    [scrollY, observer],
  );
  const reset = useCallback(() => {
    scrollY.value = 0;
  }, [scrollY]);
  const onContentTop = useCallback((height: number) => {
    setContentTop((current) => (current === height ? current : height));
  }, []);
  // Existing JS observers remain JS callbacks. RN Animated.event can retain its
  // native mappings and use onNativeScroll as its listener instead of replacing the event.
  const onScroll = observer ? onNativeScroll : animatedOnScroll;
  return {
    composition,
    scrollY,
    titleHeight,
    progress,
    onScroll,
    onNativeScroll,
    reset,
    contentTop,
    onContentTop,
  } as const;
}

export type ScreenSectionScrollController = ReturnType<typeof useScreenSectionScroll>;

type PresentationProps = {
  title: string;
  subtitle?: string;
  /** Passive freshness/status belongs to the title and scrolls away with it. */
  context?: React.ReactNode;
  hideHeading?: boolean;
  /** Functional controls only. Omit entirely when there are no screen actions. */
  children?: React.ReactNode;
  testIDPrefix?: string;
  /** Navigation-row slots only; section tools remain in children. */
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  onTitlePress?: () => void;
  titleLabel?: string;
};

export type ScreenSectionHeaderProps = PresentationProps &
  (
    | { variant?: 'scroll'; scroll: ScreenSectionScrollController; composition?: never }
    | { variant: 'static'; scroll?: never; composition?: ScreenHeaderComposition }
  );

/**
 * Full viewport header: the measured title leaves naturally, only controls pin at safeTop.
 * `static` is reserved for a canvas with independently scrolling columns/axes, not ordinary lists/forms.
 */
export default function ScreenSectionHeader({
  title,
  subtitle,
  context,
  hideHeading = false,
  children,
  testIDPrefix = 'screen-section',
  variant = 'scroll',
  scroll,
  composition: staticComposition = 'section',
  leading,
  actions,
  onTitlePress,
  titleLabel,
}: ScreenSectionHeaderProps) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const composition = scroll?.composition ?? staticComposition;
  const navigation = composition === 'navigation';
  const hasControls = React.Children.toArray(children).length > 0;
  const [titleRowHeight, setTitleRowHeight] = useState(Math.ceil(28 * fontScale));
  const [controlsHeight, setControlsHeight] = useState(
    navigation ? initialNavigationHeight(fontScale) : hasControls ? initialControlsHeight(fontScale) : 0,
  );
  const [titleHidden, setTitleHidden] = useState(hideHeading);
  const staticOffset = useSharedValue(0);
  const scrollY = scroll?.scrollY ?? staticOffset;
  const geometry = screenSectionGeometry(fontScale, titleRowHeight);
  const expandedHeight = navigation || hideHeading ? 0 : geometry.expandedHeight;
  const measuredControlsHeight = navigation || hasControls ? controlsHeight : 0;
  const titleHeight = scroll?.titleHeight;
  const onContentTop = scroll?.onContentTop;
  useLayoutEffect(() => {
    if (titleHeight) titleHeight.value = expandedHeight;
    // Insets belong inside scrolling content. The actual native viewport stays edge-to-edge.
    onContentTop?.(insets.top + expandedHeight + measuredControlsHeight);
  }, [titleHeight, onContentTop, insets.top, expandedHeight, measuredControlsHeight]);
  useAnimatedReaction(
    () => !navigation && (hideHeading || scrollY.value >= expandedHeight),
    (value, previous) => {
      if (value !== previous) runOnJS(setTitleHidden)(value);
    },
    [navigation, hideHeading, expandedHeight],
  );
  const movement = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.min(scrollY.value, expandedHeight) }] }));
  const identityText = (
    <>
      <View style={s.identityLine}>
        <Text
          variant={navigation ? 'title3' : 'title2'}
          accessibilityRole={onTitlePress ? undefined : 'header'}
          allowFontScaling={false}
          style={[
            s.identityText,
            {
              color: p.text.primary,
              fontSize: (navigation ? 17 : 22) * fontScale,
              lineHeight: (navigation ? 22 : 28) * fontScale,
              minHeight: Math.ceil((navigation ? 22 : 28) * fontScale),
              fontWeight: '600',
            },
          ]}
        >
          {title}
        </Text>
        {onTitlePress && <Ionicons name="chevron-down" size={16} color={p.text.secondary} />}
      </View>
      {!!subtitle && (
        <Text variant="footnote" color={p.text.secondary} style={s.subtitle}>
          {subtitle}
        </Text>
      )}
    </>
  );
  const identity = onTitlePress ? (
    <Pressable
      style={s.identityButton}
      onPress={onTitlePress}
      accessibilityRole="button"
      accessibilityLabel={titleLabel ?? title}
    >
      {identityText}
    </Pressable>
  ) : (
    identityText
  );
  const measureControls = (event: Parameters<NonNullable<React.ComponentProps<typeof View>['onLayout']>>[0]) => {
    const measuredHeight = event.nativeEvent.layout.height;
    setControlsHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
  };
  return (
    <View
      testID={`${testIDPrefix}-header`}
      style={[
        s.header,
        variant === 'static' && s.staticHeader,
        { height: insets.top + expandedHeight + measuredControlsHeight },
      ]}
      pointerEvents="box-none"
    >
      {navigation ? (
        <View
          testID={`${testIDPrefix}-navigation`}
          onLayout={measureControls}
          style={[s.navigation, { top: insets.top, backgroundColor: p.bg.canvas }]}
        >
          <View testID={`${testIDPrefix}-navigation-row`} style={s.navigationRow}>
            {leading != null && <View style={s.leading}>{leading}</View>}
            <View style={s.navigationIdentity}>
              {identity}
              {context != null && <View style={s.navigationContext}>{context}</View>}
            </View>
            {actions != null && <View style={s.navigationActions}>{actions}</View>}
          </View>
          {hasControls && <View style={s.navigationToolbar}>{children}</View>}
        </View>
      ) : (
        <>
          <View
            testID={`${testIDPrefix}-title-clip`}
            pointerEvents="box-none"
            accessibilityElementsHidden={titleHidden}
            importantForAccessibility={titleHidden ? 'no-hide-descendants' : 'auto'}
            style={[s.titleClip, { top: insets.top, height: expandedHeight }]}
          >
            <Animated.View
              testID={`${testIDPrefix}-title-stage`}
              style={[s.stage, { height: expandedHeight, backgroundColor: p.bg.canvas }, movement]}
            >
              <View
                style={[s.titleRow, { paddingTop: geometry.titleTop }]}
                onLayout={(event) => {
                  const measuredHeight = event.nativeEvent.layout.height - geometry.titleTop;
                  setTitleRowHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
                }}
              >
                <View style={s.heading}>{identity}</View>
                {context != null && <View style={s.statusSlot}>{context}</View>}
              </View>
            </Animated.View>
          </View>
          {hasControls && (
            <Animated.View
              testID={`${testIDPrefix}-floating-controls`}
              pointerEvents="box-none"
              onLayout={measureControls}
              style={[s.controls, { top: insets.top + expandedHeight }, movement]}
            >
              {children}
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, overflow: 'visible' },
  staticHeader: { position: 'relative', flexShrink: 0 },
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
  heading: { maxWidth: '100%' },
  identityLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  identityText: { flexShrink: 1 },
  identityButton: { minHeight: touch, justifyContent: 'center' },
  navigation: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 4 },
  navigationRow: {
    minHeight: touch + 8,
    paddingVertical: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
  },
  leading: { minHeight: touch, justifyContent: 'center', flexShrink: 0 },
  navigationIdentity: { flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 0, maxWidth: '100%' },
  navigationContext: { marginTop: 2, alignItems: 'flex-start' },
  navigationActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexShrink: 1,
    maxWidth: '100%',
    gap: 6,
  },
  navigationToolbar: { paddingTop: 4 },
  subtitle: { marginTop: 2 },
  statusSlot: { flexGrow: 1, maxWidth: '100%', alignItems: 'flex-end' },
  controls: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 4 },
});
