const mockStates: unknown[] = [];
let mockIndex = 0,
  mockFontScale = 1;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (value: unknown) => {
        mockStates[index] = value;
      },
    ];
  },
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Text: 'Text',
  Pressable: 'Pressable',
  View: 'View',
  useWindowDimensions: () => ({ fontScale: mockFontScale, width: 402 }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (compute: () => unknown) => compute(),
  interpolate: (value: number) => value,
  Easing: { out: jest.fn(), exp: jest.fn() },
  withTiming: (value: unknown) => value,
  withSpring: (value: unknown) => value,
}));
jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('../JournalMotion', () => ({
  JournalPressable: 'Pressable',
  useJournalReducedMotion: () => false,
  useJournalReducedTransparency: () => false,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../JournalModal', () => ({ __esModule: true, default: 'JournalModal' }));
jest.mock('../JournalHeader', () => ({ JournalSearchInput: 'SearchInput' }));
import React from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { getPalette } from '../../../theme/palette';
import { JournalCommandBar, JournalHeaderActions, JournalHeaderSegments } from '../JournalHeaderControls';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
function nodes(node: React.ReactNode): Element[] {
  return React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
}
const render = <P,>(component: (props: P) => React.ReactNode, props: P) => {
  mockIndex = 0;
  return component(props);
};
const press = (tree: React.ReactNode, label: string) =>
  (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onPress as () => void)();
beforeEach(() => {
  mockStates.length = 0;
  mockIndex = 0;
  mockFontScale = 1;
});
it('shows a search action at rest and keeps the same field position when searching and changing scopes', () => {
  const props = {
    palette: getPalette('light'),
    progress: { value: 0 } as SharedValue<number>,
    actions: null,
    active: 'checks' as const,
    onScopeChange: jest.fn(),
    search: '',
    onSearchChange: jest.fn(),
    onSearchFocus: jest.fn(),
    filterCount: 2,
    onFilters: jest.fn(),
  };
  let tree = render(JournalCommandBar, props);
  const restField = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(restField.props.active).toBe(false);
  press(tree, 'Фильтры, применено: 2');
  expect(props.onFilters).toHaveBeenCalledTimes(1);
  press(tree, 'Поиск в журнале');
  tree = render(JournalCommandBar, props);
  const field = nodes(tree).find((node) => node.type === 'SearchInput')!;
  expect(field.props.active).toBe(true);
  expect(field.type).toBe(restField.type);
  expect(field.key).toBe(restField.key);
  expect(
    nodes(tree)
      .filter((node) => node.type === JournalHeaderSegments)
      .some((node) => node.props.compact),
  ).toBe(true);
  press(tree, 'Фильтры поиска, применено: 2');
  expect(props.onFilters).toHaveBeenCalledTimes(2);
  expect(nodes(tree).find((node) => node.type === 'SearchInput')!.props.active).toBe(true);
  tree = render(JournalCommandBar, { ...props, active: 'warehouse' as const, search: 'Иван' });
  expect(nodes(tree).find((node) => node.type === 'SearchInput')!.props.value).toBe('Иван');
  (field.props.onCancel as () => void)();
  tree = render(JournalCommandBar, props);
  expect(nodes(tree).find((node) => node.type === 'SearchInput')!.props.active).toBe(false);
});
it('keeps board and permission-gated trash behind a single ellipsis action', () => {
  const props = { palette: getPalette('dark'), canSeeTrash: true, onBoard: jest.fn(), onTrash: jest.fn() };
  let tree = render(JournalHeaderActions, props);
  expect(nodes(tree).find((node) => node.type === 'JournalModal')!.props.visible).toBe(false);
  press(tree, 'Ещё действия журнала');
  tree = render(JournalHeaderActions, props);
  expect(nodes(tree).find((node) => node.type === 'JournalModal')!.props.visible).toBe(true);
  press(tree, 'Открыть доску заказ-нарядов');
  expect(props.onBoard).toHaveBeenCalledTimes(1);
  tree = render(JournalHeaderActions, props);
  expect(nodes(tree).find((node) => node.type === 'JournalModal')!.props.visible).toBe(false);
  tree = render(JournalHeaderActions, { ...props, canSeeTrash: false });
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Открыть корзину удалённых заказ-нарядов')).toBe(
    false,
  );
});
it.each(['light', 'dark'] as const)('keeps scope state and readable selection in %s', (mode) => {
  const props = { palette: getPalette(mode), active: 'checks' as const, onChange: jest.fn() };
  const tree = render(JournalHeaderSegments, props);
  const tabs = nodes(tree).filter((node) => node.props.accessibilityRole === 'tab');
  expect(tabs).toHaveLength(2);
  const selected = tabs.find((node) => (node.props.accessibilityState as { selected: boolean }).selected)!;
  expect(nodes(selected).find((node) => node.props.color)!.props.color).toBe(props.palette.accent.primaryText);
  press(tree, 'Складские документы');
  expect(props.onChange).toHaveBeenCalledWith('warehouse');
});
it('large accessibility sizes use a scope menu with full labels', () => {
  mockFontScale = 2;
  const tree = render(JournalHeaderSegments, { palette: getPalette('dark'), active: 'warehouse', onChange: jest.fn() });
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Раздел журнала: Документы')).toBe(true);
});
