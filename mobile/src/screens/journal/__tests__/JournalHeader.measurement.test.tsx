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
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34 }) }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({ bg: { canvas: '#fff' }, text: { primary: '#111' } }),
}));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: {} }));
import React from 'react';
import JournalHeader from '../JournalHeader';
type Element = React.ReactElement<{ children?: React.ReactNode; onLayout?: (event: unknown) => void }>;
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
