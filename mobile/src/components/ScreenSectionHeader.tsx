import React, { useCallback, useLayoutEffect, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
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

/** Attach onScroll only to the screen's main vertical scroller, never nested/modal scrollers. */
export function useScreenSectionScroll({
  hasControls = true,
  hideHeading = false,
  onScroll: observer,
}: {
  hasControls?: boolean;
  hideHeading?: boolean;
  /** Preserve an existing JS scroll observer with the same native event object. */
  onScroll?: ScrollViewProps['onScroll'];
} = {}) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const geometry = screenSectionGeometry(fontScale, Math.ceil(40 * fontScale));
  const scrollY = useSharedValue(0);
  const titleHeight = useSharedValue(hideHeading ? 0 : geometry.expandedHeight);
  const progress = useDerivedValue(() => screenSectionProgress(scrollY.value, titleHeight.value));
  const [contentTop, setContentTop] = useState(
    insets.top + (hideHeading ? 0 : geometry.expandedHeight) + (hasControls ? initialControlsHeight(fontScale) : 0),
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
  return { scrollY, titleHeight, progress, onScroll, onNativeScroll, reset, contentTop, onContentTop };
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
};

export type ScreenSectionHeaderProps = PresentationProps &
  ({ variant?: 'scroll'; scroll: ScreenSectionScrollController } | { variant: 'static'; scroll?: never });

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
}: ScreenSectionHeaderProps) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const hasControls = React.Children.toArray(children).length > 0;
  const [titleRowHeight, setTitleRowHeight] = useState(Math.ceil(40 * fontScale));
  const [controlsHeight, setControlsHeight] = useState(hasControls ? initialControlsHeight(fontScale) : 0);
  const [titleHidden, setTitleHidden] = useState(hideHeading);
  const staticOffset = useSharedValue(0);
  const scrollY = scroll?.scrollY ?? staticOffset;
  const geometry = screenSectionGeometry(fontScale, titleRowHeight);
  const expandedHeight = hideHeading ? 0 : geometry.expandedHeight;
  const measuredControlsHeight = hasControls ? controlsHeight : 0;
  const titleHeight = scroll?.titleHeight;
  const onContentTop = scroll?.onContentTop;
  useLayoutEffect(() => {
    if (titleHeight) titleHeight.value = expandedHeight;
    // Insets belong inside scrolling content. The actual native viewport stays edge-to-edge.
    onContentTop?.(insets.top + expandedHeight + measuredControlsHeight);
  }, [titleHeight, onContentTop, insets.top, expandedHeight, measuredControlsHeight]);
  useAnimatedReaction(
    () => hideHeading || scrollY.value >= expandedHeight,
    (value, previous) => {
      if (value !== previous) runOnJS(setTitleHidden)(value);
    },
    [hideHeading, expandedHeight],
  );
  const movement = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.min(scrollY.value, expandedHeight) }] }));
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
            <View style={s.heading}>
              <Text
                variant="display"
                accessibilityRole="header"
                allowFontScaling={false}
                style={{
                  color: p.text.primary,
                  fontSize: 34 * fontScale,
                  lineHeight: 40 * fontScale,
                  minHeight: Math.ceil(40 * fontScale),
                }}
              >
                {title}
              </Text>
              {!!subtitle && (
                <Text variant="footnote" color={p.text.secondary} style={s.subtitle}>
                  {subtitle}
                </Text>
              )}
            </View>
            {context != null && <View style={s.statusSlot}>{context}</View>}
          </View>
        </Animated.View>
      </View>
      {hasControls && (
        <Animated.View
          testID={`${testIDPrefix}-floating-controls`}
          pointerEvents="box-none"
          onLayout={(event) => {
            const measuredHeight = event.nativeEvent.layout.height;
            setControlsHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
          }}
          style={[s.controls, { top: insets.top + expandedHeight }, movement]}
        >
          {children}
        </Animated.View>
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
  subtitle: { marginTop: 2 },
  statusSlot: { flexGrow: 1, maxWidth: '100%', alignItems: 'flex-end' },
  controls: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 4 },
});
