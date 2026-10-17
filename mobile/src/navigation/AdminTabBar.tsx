import React from 'react';
import { BottomTabBar, type BottomTabBarProps, type BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { AutexaLiquidGlassTabBar } from 'autexa-liquid-glass';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../platform/Typography';
import { Icon } from '../platform/Icon';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import {
  ADMIN_BAR_HEIGHT,
  ADMIN_BAR_HORIZONTAL_MARGIN,
  ADMIN_BAR_TOP_LIFT,
  ADMIN_BAR_BOTTOM_LIFT,
} from '../hooks/useAdminTabBarHeight';
import { createMoreTabPressHandlers, openAccountPicker } from './accountPickerNavigation';
import { ADMIN_TAB_DEFINITIONS, MANAGER_TAB_DEFINITIONS, type AdminShellMode } from './adminTabs';
export { ADMIN_TAB_DEFINITIONS, MANAGER_TAB_DEFINITIONS, type AdminShellMode } from './adminTabs';

function MoreButton(props: BottomTabBarButtonProps) {
  const pressed = React.useRef(false);
  return (
    <Pressable
      style={props.style}
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={props.accessibilityState}
      accessibilityRole="tab"
      onPressIn={() => {
        pressed.current = false;
      }}
      onLongPress={(event) => {
        pressed.current = true;
        props.onLongPress?.(event);
      }}
      delayLongPress={360}
      onPress={(event) => {
        if (!pressed.current) props.onPress?.(event);
      }}
    >
      {props.children}
    </Pressable>
  );
}

export default function AdminTabBar(props: BottomTabBarProps & { mode?: AdminShellMode }) {
  const { state, navigation, mode = 'superadmin' } = props;
  const definitions = mode === 'manager' ? MANAGER_TAB_DEFINITIONS : ADMIN_TAB_DEFINITIONS;
  // Actual route order is authoritative for both Swift slot indices and labels.
  const tabs = state.routes.map((route) => definitions.find((tab) => tab.routeName === route.name)!);
  const insets = useSafeAreaInsets();
  const palette = useColors();
  const morePressed = React.useRef(false);
  const [nativeRevision, setNativeRevision] = React.useState(0);
  const select = (index: number) => {
    const route = state.routes[index];
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (event.defaultPrevented && state.index !== index) setNativeRevision((previous) => previous + 1);
    if (state.index !== index && !event.defaultPrevented) {
      haptic('select');
      navigation.navigate(route.name);
    }
  };
  const accounts = () => openAccountPicker(navigation, 'AdminMore', 'AdminMoreHome');
  if (Platform.OS !== 'ios') {
    const descriptors = Object.fromEntries(
      state.routes.map((route, index) => [
        route.key,
        {
          ...props.descriptors[route.key],
          options: {
            ...props.descriptors[route.key].options,
            tabBarLabel: tabs[index].label,
            tabBarIcon: ({ color, size }: { color: string; size: number }) => (
              <Icon name={tabs[index].icon} color={color} size={size} />
            ),
            tabBarActiveTintColor: palette.accent.primary,
            tabBarInactiveTintColor: palette.text.secondary,
            tabBarStyle: { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle },
            ...(route.name === 'AdminMore'
              ? { tabBarButton: (button: BottomTabBarButtonProps) => <MoreButton {...button} onLongPress={accounts} /> }
              : {}),
          },
        },
      ]),
    );
    return <BottomTabBar {...props} descriptors={descriptors} />;
  }
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { paddingTop: ADMIN_BAR_TOP_LIFT, paddingBottom: Math.max(insets.bottom, 8) + ADMIN_BAR_BOTTOM_LIFT },
      ]}
    >
      <View style={styles.island}>
        <AutexaLiquidGlassTabBar
          key={nativeRevision}
          tabCount={tabs.length}
          activeIndex={state.index}
          onTabPress={select}
          style={styles.native}
        />
        <View style={styles.row} pointerEvents="none">
          {tabs.map((tab, index) => {
            const focused = state.index === index;
            const tint = focused ? palette.accent.primaryText : palette.text.secondary;
            return (
              <View
                key={tab.routeName}
                style={styles.item}
                accessible={tab.routeName !== 'AdminMore'}
                accessibilityElementsHidden={tab.routeName === 'AdminMore'}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: focused }}
                onAccessibilityTap={() => select(index)}
              >
                <Icon name={tab.icon} size={22} color={tint} />
                <Text variant="caption" numberOfLines={1} maxFontSizeMultiplier={1.2} color={tint}>
                  {tab.label}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.row} pointerEvents="box-none">
          {tabs.map((tab, index) => {
            if (tab.routeName !== 'AdminMore')
              return <View key={tab.routeName} pointerEvents="none" style={styles.item} />;
            const handlers = createMoreTabPressHandlers(morePressed, () => select(index), accounts);
            return (
              <Pressable
                key={tab.routeName}
                style={styles.item}
                accessibilityRole="tab"
                accessibilityLabel="Ещё. Удерживайте для смены аккаунта"
                accessibilityState={{ selected: state.index === index }}
                onPressIn={handlers.onPressIn}
                onLongPress={handlers.onLongPress}
                delayLongPress={360}
                onPress={handlers.onPress}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  island: { marginHorizontal: ADMIN_BAR_HORIZONTAL_MARGIN, height: ADMIN_BAR_HEIGHT },
  native: { flex: 1, borderRadius: ADMIN_BAR_HEIGHT / 2, overflow: 'hidden' },
  row: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  item: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 3 },
});
