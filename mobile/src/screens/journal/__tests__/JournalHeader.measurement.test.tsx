let mockFontScale = 1;
const mockDeferredUpdates: Array<(previous: number) => number> = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, (update: (previous: number) => number) => mockDeferredUpdates.push(update)],
}));
jest.mock('react-native', () => ({
  Animated: {
    View: 'AnimatedView',
    Value: class {
      interpolate() {
        return 0;
      }
    },
  },
  Easing: { out: jest.fn(), cubic: jest.fn() },
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ fontScale: mockFontScale, width: 402, height: 874 }),
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { canvas: '#fff' }, text: { primary: '#111' } }),
}));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { title2: { lineHeight: 28 } } }));
import React from 'react';
import JournalHeader from '../JournalHeader';
type Element = React.ReactElement<{
  children?: React.ReactNode;
  onLayout?: (event: unknown) => void;
  style?: unknown;
  accessibilityRole?: string;
  allowFontScaling?: boolean;
  maxFontSizeMultiplier?: number;
}>;
function nodes(node: React.ReactNode): Element[] {
  return React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
}
it('captures measured height before a pooled native layout event is released', () => {
  mockDeferredUpdates.length = 0;
  const tree = JournalHeader({ compact: false, context: 'Север', actions: null });
  const onLayout = nodes(tree).find((node) => node.props.onLayout)!.props.onLayout!;
  const event: { nativeEvent: { layout: { height: number } } | null } = { nativeEvent: { layout: { height: 38 } } };
  onLayout(event);
  // React Native releases the synthetic event before a deferred updater may run.
  event.nativeEvent = null;
  expect(mockDeferredUpdates).toHaveLength(1);
  expect(mockDeferredUpdates[0](0)).toBe(38);
  expect(mockDeferredUpdates[0](38)).toBe(38);
});

function flattenStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.map(flattenStyle))
    : style && typeof style === 'object'
      ? (style as Record<string, unknown>)
      : {};
}
it.each([1.4, 2, 3])('gives scaled title and actions intrinsic separate rows at fontScale %s', (fontScale) => {
  mockFontScale = fontScale;
  const tree = JournalHeader({ compact: false, context: 'Север', actions: <ViewAction /> });
  const title = nodes(tree).find((node) => node.props.accessibilityRole === 'header')!;
  const toolbar = nodes(tree).find((node) =>
    React.Children.toArray(node.props.children).some(
      (child) =>
        React.isValidElement(child) && (child.props as { accessibilityRole?: string }).accessibilityRole === 'header',
    ),
  )!;
  const toolbarStyle = flattenStyle(toolbar.props.style);
  expect(toolbarStyle.height).toBeUndefined();
  expect(toolbarStyle.minHeight).toBeGreaterThanOrEqual(28 * fontScale + 12);
  expect(toolbarStyle.flexDirection).toBe('column');
  expect(flattenStyle(title.props.style).flex).toBe(0);
  expect(title.props.allowFontScaling).not.toBe(false);
  expect(title.props.maxFontSizeMultiplier).toBeUndefined();
});
function ViewAction() {
  return null;
}
it('keeps the normal reading-size toolbar compact and horizontal', () => {
  mockFontScale = 1;
  const tree = JournalHeader({ compact: false, context: 'Север', actions: null });
  const title = nodes(tree).find((node) => node.props.accessibilityRole === 'header')!;
  const toolbar = nodes(tree).find((node) =>
    React.Children.toArray(node.props.children).some(
      (child) =>
        React.isValidElement(child) && (child.props as { accessibilityRole?: string }).accessibilityRole === 'header',
    ),
  )!;
  expect(flattenStyle(toolbar.props.style)).toMatchObject({ flexDirection: 'row', minHeight: 48 });
});
