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
import { useAuth } from '../contexts/AuthContext';
import { usePosSettings } from '../hooks/usePosSettings';
import { useOfflineCheckQueue } from '../utils/offlineCheckQueue';
import { colors } from '../theme';
import { getTabDefinitions, type TabDefinition } from './TabBarShared';

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

  // Cash-shift-mode (092) + per-role tab sets (Round 14). orderMode = shift-mode
  // ON && caller is a master без права «Приём оплаты» — центральный сквиркл
  // меняет символ и открывает «Доску» (состав слотов легаси). Кассир / админ
  // при режиме ВКЛ получают свои составы из getTabDefinitions; OFF/loading →
  // легаси-пятёрка байт-в-байт.
  const { orderMode, isCashier, shiftModeEnabled } = usePosSettings();
  const { user } = useAuth();
  const tabs = React.useMemo(
    () => getTabDefinitions({ role: user?.role, orderMode, isCashier, shiftModeEnabled }),
    [user?.role, orderMode, isCashier, shiftModeEnabled],
  );

  const focusedIndex = tabs.findIndex((t) => state.routes.findIndex((r) => r.name === t.routeName) === state.index);
  const safeIndex = focusedIndex < 0 ? 0 : focusedIndex;

  // Index of the Касса slot (the one declared with isKassa: true). The
  // Касса button is rendered as a separate sibling on top of the bar,
  // so we need this index to (a) emit the right tab navigation and
  // (b) compute the focused state.
  const kassaTabIndex = tabs.findIndex((t) => t.isKassa);
  const kassaTab = tabs[kassaTabIndex];
  const kassaFocused = safeIndex === kassaTabIndex;

  // Офлайн-очередь чеков (волна C, C-6): пока есть несотправленные записи
  // (pending + отклонённые), таб «Журнал» несёт маленький амбер-бейдж со
  // счётчиком — пилюля «Ожидают отправки» внутри Журнала не видна с других
  // экранов, а мастер должен ЗНАТЬ, что чек ещё не на сервере. Снапшот
  // useSyncExternalStore стабилен между изменениями — лишних ререндеров нет.
  const queuedCheckCount = useOfflineCheckQueue().length;
  const openBoard = React.useCallback(() => {
    // Nested navigate (tab → stack screen) — cast to any for the 2-arg overload,
    // same convention as the screens' useNavigation<any>() callers.
    (navigation as any).navigate('Checks', { screen: 'WorkBoard', initial: false });
  }, [navigation]);

  const navigateToTab = React.useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (!tab) return;
      const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
      const focused = state.index === routeIndex;
      const event = navigation.emit({
        type: 'tabPress',
        target: state.routes[routeIndex]?.key ?? tab.routeName,
        canPreventDefault: true,
      });
      if (event.defaultPrevented) return;
      if (tab.nestedScreen) {
        // Слот-«трамплин» (Round 14): «Доска» админа = Checks → WorkBoard.
        // initial:false держит ChecksHome (Журнал) под доской — back работает.
        (navigation as any).navigate(tab.routeName, { screen: tab.nestedScreen, initial: false });
        return;
      }
      if (!focused) {
        navigation.navigate(tab.routeName as never);
      }
    },
    [tabs, state, navigation],
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
  // The island's hairline border adapts to the theme: translucent white
  // over light glass, the palette's white-alpha hairline over dark glass —
  // a hard-white ring on dark material reads as a rendering glitch.
  const islandBorderColor = palette.mode === 'dark' ? palette.border.strong : 'rgba(255,255,255,0.6)';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { paddingTop: TOP_LIFT, paddingBottom: safeBottom + BOTTOM_LIFT }]}
    >
      {/* Unclipped frame in normal flow — exactly the island's vertical
          box. Hosts the clipped glass island AND the Касса overlay as
          siblings, so the button's glow can render past the island's
          overflow:hidden bounds. */}
      <View pointerEvents="box-none" style={{ height: BAR_HEIGHT }}>
        <View style={[styles.island, { height: BAR_HEIGHT, borderColor: islandBorderColor }]}>
          {/* Native glass + droplet — fills the rounded island. The native
              view also draws the 1px top rim (theme-aware on the Swift
              side), so JS adds no rim of its own. */}
          <AutexaLiquidGlassTabBar
            tabCount={tabs.length}
            activeIndex={safeIndex}
            onTabPress={navigateToTab}
            style={styles.bar}
          />

          {/* Non-Касса icons + labels on a pass-through absolute layer.
              Fills the entire island vertically — island is now plain
              60pt so icons get vertically centered without doing extra
              offset math. */}
          <View style={styles.iconsRow} pointerEvents="none">
            {tabs.map((tab) => {
              const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
              const focused = state.index === routeIndex;

              if (tab.isKassa) {
                // Empty placeholder slot — actual Касса button rendered
                // separately above so it can receive its own touches.
                return <View key={tab.routeName} style={styles.item} />;
              }

              return (
                <TabItem
                  key={tab.routeName}
                  focused={focused}
                  label={tab.label}
                  icon={tab.icon}
                  palette={palette}
                  badgeCount={tab.routeName === 'Checks' ? queuedCheckCount : 0}
                />
              );
            })}
          </View>
        </View>

        {/* Native premium Касса button — Swift-side AutexaKassaButtonView.
            Rendered as a SIBLING of the island (inside the unclipped
            frame) rather than inside it: the island clips its children
            (overflow: hidden for the rounded glass), which used to
            swallow the button's brand-glow drop shadow. Out here the
            glow renders fully while the button stays centered exactly
            where its in-island slot was. */}
        <View style={styles.kassaSlot} pointerEvents="box-none">
          <AutexaKassaButton
            symbolName={orderMode ? 'square.grid.2x2.fill' : (kassaTab?.kassaSymbol ?? 'bag.fill')}
            focused={orderMode ? false : kassaFocused}
            onPress={orderMode ? openBoard : () => navigateToTab(kassaTabIndex)}
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
  icon: TabDefinition['icon'];
  palette: ReturnType<typeof useColors>;
  /** >0 → маленький амбер-бейдж на иконке (офлайн-очередь чеков у Журнала). */
  badgeCount?: number;
}

function TabItem({ focused, label, icon, palette, badgeCount = 0 }: TabItemProps) {
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
        {badgeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
          </View>
        )}
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
  // borderColor is injected inline from the theme palette (hard white on
  // dark glass read as a glitch — see islandBorderColor in the component).
  island: {
    marginHorizontal: HORIZONTAL_MARGIN,
    borderRadius: CORNER_RADIUS,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  bar: {
    ...StyleSheet.absoluteFillObject,
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
  // Бейдж офлайн-очереди на иконке «Журнал» — амбер (язык пилюли «Ожидают
  // отправки» в самом Журнале), белая цифра, сигнальный цвет одинаков в
  // light/dark. Слой иконок pointerEvents="none" — тапы не перехватывает.
  badge: {
    position: 'absolute',
    top: -5,
    right: -11,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.amber[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
  // Fills the unclipped island frame (NOT the island itself) so the
  // button's brand-glow shadow isn't cut off by the island's
  // overflow:hidden. Horizontal centring is identical because the
  // island's horizontal margins are symmetric.
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
