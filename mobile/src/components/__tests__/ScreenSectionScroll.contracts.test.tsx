let mockTabHeight = 90;
let mockSafeBottom = 34;
jest.mock('react', () => ({ ...jest.requireActual('react'), useContext: () => mockTabHeight }));
jest.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  FlatList: 'FlatList',
  Platform: { OS: 'ios' },
  StyleSheet: {
    create: (value: unknown) => value,
    flatten: (value: unknown): unknown =>
      Array.isArray(value)
        ? Object.assign({}, ...value.map((item) => (Array.isArray(item) ? Object.assign({}, ...item) : item)))
        : value,
  },
}));
jest.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBarHeightContext: {} }));
jest.mock('@shopify/flash-list', () => ({ FlashList: 'FlashList' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: mockSafeBottom }) }));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAwareScrollView: 'KeyboardControllerScrollView',
  KeyboardAvoidingView: 'KeyboardControllerAvoidingView',
}));
import React from 'react';
import type { ScrollView, ScrollViewProps } from 'react-native';
import { StyleSheet } from 'react-native';
import { TabBarScrollView, TabBarFlatList, TabBarFlashList, type ScrollReservation } from '../TabBarScrollable';
import { KeyboardAwareScroll, type KeyboardAwareScrollProps } from '../KeyboardAware';
import { floatingTabBarHeight } from '../../utils/tabBarGeometry';

type Element = React.ReactElement<Record<string, unknown>>;
const renderForward = <P,>(component: unknown, props: P, ref: React.Ref<ScrollView> = null) =>
  (component as { render: (props: P, ref: React.Ref<ScrollView>) => Element }).render(props, ref);
const bottomPadding = (tree: Element) =>
  (StyleSheet.flatten(tree.props.contentContainerStyle) as { paddingBottom?: number })?.paddingBottom;

beforeEach(() => {
  mockTabHeight = 90;
  mockSafeBottom = 34;
});

it('keeps navigation/content/safe-area reservations as a maximum on each existing virtualizer', () => {
  const props = {
    data: [],
    renderItem: () => null,
    reserveSafeAreaBottom: true,
    contentContainerStyle: { paddingBottom: 120 },
    contentInset: { bottom: 20 },
  };
  const trees = [
    renderForward(TabBarScrollView, props),
    renderForward(TabBarFlatList, props),
    TabBarFlashList(props) as Element,
  ];
  for (const tree of trees) {
    expect(bottomPadding(tree)).toBe(Math.max(120, floatingTabBarHeight(34) + 16));
    expect(tree.props.contentInset).toEqual({ bottom: 0 });
  }
  expect(trees.map((tree) => tree.type)).toEqual(['ScrollView', 'FlatList', 'FlashList']);
});

it('reserves standalone bottom safe area only by explicit opt-in, and never on a horizontal scroller', () => {
  mockTabHeight = 0;
  const props: ScrollViewProps & ScrollReservation = { contentContainerStyle: { paddingBottom: 16 } };
  expect(bottomPadding(renderForward(TabBarScrollView, props))).toBe(16);
  expect(bottomPadding(renderForward(TabBarScrollView, { ...props, reserveSafeAreaBottom: true }))).toBe(34);
  expect(
    bottomPadding(renderForward(TabBarScrollView, { ...props, reserveSafeAreaBottom: true, horizontal: true })),
  ).toBe(16);
});

it('passes scroll handlers and native ref through the actual keyboard controller while preserving focus options', () => {
  const onScroll = jest.fn();
  const ref = { current: null };
  const props: KeyboardAwareScrollProps = {
    children: 'form',
    onScroll,
    scrollEventThrottle: 16,
    contentInsetAdjustmentBehavior: 'never',
    reserveSafeAreaBottom: true,
    extraKeyboardBottomOffset: 16,
    keyboardDismissMode: 'on-drag',
    contentContainerStyle: { paddingBottom: 24 },
  };
  const tree = renderForward(KeyboardAwareScroll, props, ref);
  expect(tree.type).toBe('KeyboardControllerScrollView');
  expect(tree.props.ref).toBe(ref);
  expect(tree.props.onScroll).toBe(onScroll);
  expect(tree.props.scrollEventThrottle).toBe(16);
  expect(tree.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(tree.props.keyboardDismissMode).toBe('on-drag');
  expect(tree.props.keyboardShouldPersistTaps).toBe('handled');
  expect(tree.props.bottomOffset).toBe(floatingTabBarHeight(34) + 16);
  expect(bottomPadding(tree)).toBe(floatingTabBarHeight(34) + 16);
  mockTabHeight = 0;
  expect(bottomPadding(renderForward(KeyboardAwareScroll, { ...props, reserveTabBar: false }))).toBe(34);
});
