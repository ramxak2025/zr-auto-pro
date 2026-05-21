/**
 * TabBar — iOS variant. Premium native Liquid Glass tab bar rendered as
 * a Telegram-style FLOATING ISLAND over the screen content. The visible
 * surface, the spring-animated droplet that follows the finger, the pan
 * and tap gestures, the haptics, and the iOS 26 UIGlassEffect upgrade
 * all live in Swift. JS only paints icons + labels on top.
 *
 * Geometry:
 *   • Floating island with 14pt horizontal margins and 10pt above the
 *     bottom safe-area inset. Fully rounded (full pill — borderRadius
 *     equals half the bar height).
 *   • Soft drop shadow underneath for depth.
 *   • Glass surface fills the entire island; rounded with continuous
 *     corner curve via the native overflow-clipped UIVisualEffectView.
 *
 * Native side (Swift, in mobile/modules/autexa-liquid-glass/ios/):
 *   • AutexaLiquidGlassTabBarView.swift   — UIVisualEffectView, droplet
 *     (UIView + CAGradientLayer + hairline border), UIPanGestureRecognizer,
 *     UITapGestureRecognizer, UISpringTimingParameters / UIView spring,
 *     UISelectionFeedback / UIImpactFeedback haptics, runtime UIGlassEffect
 *     upgrade for iOS 26+.
 *   • AutexaLiquidGlassModule.swift       — registers the view as a
 *     dedicated Expo Module ("AutexaLiquidGlassTabBar") so the JS lookup
 *     name is unambiguous.
 *
 * onTabPress(index) bubbles up natively → forwarded to react-navigation.
 */
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassTabBar, AutexaKassaButton } from 'autexa-liquid-glass';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Icon } from '../platform/Icon';
import { SPRING_TIGHT } from '../platform/motion';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { TAB_DEFINITIONS } from './TabBarShared';

// Floating island geometry — owner explicitly wants the bar to read as
// a small island floating ABOVE the screen content with content
// passing under the glass, NOT a slab pinned to the bottom edge.
const BAR_HEIGHT = 60;
const HORIZONTAL_MARGIN = 14;
// Breathing room ABOVE the bar (between scroll-end and the island's
// top edge).
const TOP_LIFT = 6;
// Breathing room BELOW the bar (between island's bottom edge and the
// home-indicator safe area). Small but non-zero so the island reads as
// floating rather than touching the safe area.
const BOTTOM_LIFT = 8;
const CORNER_RADIUS = BAR_HEIGHT / 2;

export default function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 8);
  // Theme-aware icon / label tint. Native glass surface itself is
  // rendered by the Swift module and adapts to the system trait
  // (UITraitCollection.userInterfaceStyle) automatically — we don't
  // need to thread a colour scheme through the bridge. We only re-tint
  // the JS-side icons / labels that overlay the glass.
  const palette = useColors();

  const focusedIndex = TAB_DEFINITIONS.findIndex(
    (t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index,
  );
  const safeIndex = focusedIndex < 0 ? 0 : focusedIndex;

  // Index of the Касса slot (the one declared with isKassa: true). The
  // Касса button is rendered as a separate sibling on top of the bar,
  // so we need this index to (a) emit the right tab navigation and
  // (b) compute the focused state.
  const kassaTabIndex = TAB_DEFINITIONS.findIndex((t) => t.isKassa);
  const kassaFocused = safeIndex === kassaTabIndex;

  const navigateToTab = React.useCallback(
    (index: number) => {
      const tab = TAB_DEFINITIONS[index];
      if (!tab) return;
      const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
      const focused = state.index === routeIndex;
      const event = navigation.emit({
        type: 'tabPress',
        target: state.routes[routeIndex]?.key ?? tab.routeName,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(tab.routeName as never);
      }
    },
    [state, navigation],
  );

  // Floating island: glass pill with TOP_LIFT above and (BOTTOM_LIFT +
  // safeBottom) below it.
  //
  // CRITICAL: the wrapper is `position: 'absolute'` so it does NOT take
  // a slot in the BottomTabNavigator's column flex layout. React
  // Navigation's BottomTabView lays out the scene container as
  // `flex: 1` with the tab bar element as a sibling — if our wrapper
  // participated in that flex, the scene would be shorter than the
  // screen by `wrapperHeight` (~108pt) and the navigator's theme bg
  // (gray-50) would show through the transparent padding around the
  // island. That's the "grey plane under the glass" effect: the bar
  // would be floating over navigator-bg, not over live RN content.
  // Pulling the wrapper out of the flex flow lets the scene's
  // ScrollView reach the screen's bottom edge; with each screen's
  // `contentInset.bottom = useTabBarHeight()`, content visibly passes
  // UNDER the glass material as the user scrolls.
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: TOP_LIFT, paddingBottom: safeBottom + BOTTOM_LIFT }]}
    >
      <View style={[styles.island, { height: BAR_HEIGHT }]}>
        {/* Native glass + droplet — fills the rounded island. */}
        <AutexaLiquidGlassTabBar
          tabCount={TAB_DEFINITIONS.length}
          activeIndex={safeIndex}
          bottomInset={0}
          onTabPress={navigateToTab}
          style={styles.bar}
        />

        {/* White hairline rim along the top edge — subtle premium touch. */}
        <View style={styles.topRim} pointerEvents="none" />

        {/* Non-Касса icons + labels on a pass-through absolute layer.
            Fills the entire island vertically — island is now plain
            60pt so icons get vertically centered without doing extra
            offset math. */}
        <View style={styles.iconsRow} pointerEvents="none">
          {TAB_DEFINITIONS.map((tab) => {
            const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
            const focused = state.index === routeIndex;

            if (tab.isKassa) {
              // Empty placeholder slot — actual Касса button rendered
              // separately above so it can receive its own touches.
              return <View key={tab.routeName} style={styles.item} />;
            }

            return <TabItem key={tab.routeName} focused={focused} label={tab.label} icon={tab.icon} palette={palette} />;
          })}
        </View>

        {/* Native premium Касса button — Swift-side AutexaKassaButtonView.
            Fills the island and is centered horizontally + vertically
            against the icon row. */}
        <View style={styles.kassaSlot} pointerEvents="box-none">
          <AutexaKassaButton
            symbolName="bag.fill"
            focused={kassaFocused}
            onPress={() => navigateToTab(kassaTabIndex)}
            style={styles.kassaButton}
          />
        </View>
      </View>
    </View>
  );
}

interface TabItemProps {
  focused: boolean;
  label: string;
  icon: (typeof TAB_DEFINITIONS)[number]['icon'];
  palette: ReturnType<typeof useColors>;
}

function TabItem({ focused, label, icon, palette }: TabItemProps) {
  const scale = useSharedValue(focused ? 1.06 : 1);
  React.useEffect(() => {
    scale.value = withSpring(focused ? 1.06 : 1, SPRING_TIGHT);
  }, [focused, scale]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const tint = focused ? palette.accent.primaryText : palette.text.secondary;

  return (
    <View style={styles.item}>
      <Animated.View style={iconStyle}>
        <Icon name={icon} size={22} color={tint} weight={focused ? 'semibold' : 'regular'} />
      </Animated.View>
      {label.length > 0 && (
        <Text
          variant="caption"
          style={{
            marginTop: 1,
            color: tint,
            fontWeight: focused ? '600' : '500',
            fontSize: 10,
          }}
        >
          {label}
        </Text>
      )}
    </View>
  );
}

// KassaGlassDome (the JS-side dome) was removed — the central CTA is now
// rendered by the native Swift AutexaKassaButtonView (see
// mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift) and
// inserted as a separate sibling above the bar via <AutexaKassaButton />.

const KASSA_SIZE = 52;

const styles = StyleSheet.create({
  // Absolute, anchored to the screen's bottom edge so the BottomTabView
  // gives the scene container the FULL screen height and the glass
  // floats over live content — see the explanation block in the
  // component above.
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  // Floating island — full-pill (height/2 corners), hairline rim,
  // VERY soft shadow. The earlier 0.12/16-radius shadow created a
  // perceptible darker ring around the bar that read as "dead gray
  // zone" on physical iPhones; dropped to 0.06/10 — still gives depth
  // but doesn't paint a visible halo onto the screen's gray-50 bg
  // underneath.
  island: {
    marginHorizontal: HORIZONTAL_MARGIN,
    borderRadius: CORNER_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  bar: {
    ...StyleSheet.absoluteFillObject,
  },
  topRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  iconsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  kassaSlot: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kassaButton: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
  },
});
