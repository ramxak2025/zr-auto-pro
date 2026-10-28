const mockValues: unknown[] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockValues)) mockValues[index] = initial;
    return [
      mockValues[index],
      (value: unknown) => {
        mockValues[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockValues)) mockValues[index] = { current: initial };
    return mockValues[index];
  },
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  View: 'View',
  useWindowDimensions: () => ({ fontScale: 1.353 }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
    text: { primary: '#111', inverse: '#fff' },
    border: { subtle: '#eee' },
  }),
}));
jest.mock('../../journal/JournalMotion', () => ({ JournalPressable: 'Pressable' }));
jest.mock('../../journal/JournalModal', () => ({ __esModule: true, default: 'JournalModal' }));
import React from 'react';
import WarehouseCreateMenu from '../WarehouseCreateMenu';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
let props: Parameters<typeof WarehouseCreateMenu>[0];
const render = () => {
  mockIndex = 0;
  return WarehouseCreateMenu(props);
};
const press = (tree: React.ReactNode, label: string) =>
  (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onPress as () => void)();
const modal = (tree: React.ReactNode) => nodes(tree).find((node) => node.type === 'JournalModal')!;
beforeEach(() => {
  mockValues.length = 0;
  props = { onAdd: jest.fn(), onCreateFolder: jest.fn() };
});
it.each(['Создать папку', 'Добавить товар'])(
  'keeps %s individually accessible and waits for native dismissal before its existing form',
  (label) => {
    let tree = render();
    press(tree, 'Добавить на склад');
    tree = render();
    expect(modal(tree).props.visible).toBe(true);
    expect(
      nodes(tree)
        .filter((node) => ['Создать папку', 'Добавить товар'].includes(String(node.props.accessibilityLabel)))
        .every((node) => node.props.accessibilityRole === 'button'),
    ).toBe(true);
    press(tree, label);
    tree = render();
    expect(modal(tree).props.visible).toBe(false);
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onCreateFolder).not.toHaveBeenCalled();
    (modal(tree).props.onExited as () => void)();
    (modal(tree).props.onExited as () => void)();
    expect(label === 'Создать папку' ? props.onCreateFolder : props.onAdd).toHaveBeenCalledTimes(1);
  },
);
it('supports folder-only warehouses and cancels pending actions on dismissal or permission loss', () => {
  props = { ...props, onAdd: undefined };
  let tree = render();
  press(tree, 'Добавить на склад');
  tree = render();
  expect(nodes(tree).some((node) => node.props.accessibilityLabel === 'Добавить товар')).toBe(false);
  (modal(tree).props.onRequestClose as () => void)();
  tree = render();
  (modal(tree).props.onExited as () => void)();
  expect(props.onCreateFolder).not.toHaveBeenCalled();
  press(tree, 'Добавить на склад');
  tree = render();
  press(tree, 'Создать папку');
  const create = props.onCreateFolder;
  props = { onCreateFolder: undefined };
  tree = render();
  (modal(tree).props.onExited as () => void)();
  expect(create).not.toHaveBeenCalled();
});
