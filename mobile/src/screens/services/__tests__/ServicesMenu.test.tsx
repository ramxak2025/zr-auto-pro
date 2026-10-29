const mockValues: unknown[] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
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
import ServicesMenu from '../ServicesMenu';
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
let props: Parameters<typeof ServicesMenu>[0];
const render = () => {
  mockIndex = 0;
  return ServicesMenu(props);
};
const press = (tree: React.ReactNode, label: string) =>
  (nodes(tree).find((node) => node.props.accessibilityLabel === label)!.props.onPress as () => void)();
const modal = (tree: React.ReactNode) => nodes(tree).find((node) => node.type === 'JournalModal')!;
beforeEach(() => {
  mockValues.length = 0;
  props = {
    label: 'Добавить услугу или папку',
    icon: 'add',
    primary: true,
    items: [
      { key: 'service', label: 'Новая услуга', icon: 'add', onSelect: jest.fn() },
      { key: 'folder', label: 'Новая папка', icon: 'folder-outline', onSelect: jest.fn() },
    ],
  };
});
it.each(['Новая услуга', 'Новая папка'])('starts %s exactly once after native menu dismissal', (label) => {
  press(render(), props.label);
  let tree = render();
  expect(modal(tree).props.visible).toBe(true);
  press(tree, label);
  tree = render();
  const action = props.items.find((item) => item.label === label)!;
  expect(action.onSelect).not.toHaveBeenCalled();
  expect(modal(tree).props.visible).toBe(false);
  (modal(tree).props.onExited as () => void)();
  (modal(tree).props.onExited as () => void)();
  expect(action.onSelect).toHaveBeenCalledTimes(1);
});
it('uses current permission and callbacks when the menu has finished closing', () => {
  press(render(), props.label);
  press(render(), 'Новая папка');
  const exit = modal(render()).props.onExited as () => void;
  const removed = props.items[1].onSelect;
  props = { ...props, items: props.items.slice(0, 1) };
  render();
  exit();
  expect(removed).not.toHaveBeenCalled();
  press(render(), props.label);
  press(render(), 'Новая услуга');
  const next = jest.fn();
  props = { ...props, items: [{ ...props.items[0], onSelect: next }] };
  (modal(render()).props.onExited as () => void)();
  expect(next).toHaveBeenCalledTimes(1);
});
it('cancel and disabled items never execute an action', () => {
  props = { ...props, items: props.items.map((item) => ({ ...item, disabled: true })) };
  press(render(), props.label);
  press(render(), 'Новая услуга');
  const tree = render();
  (modal(tree).props.onRequestClose as () => void)();
  (modal(tree).props.onExited as () => void)();
  for (const item of props.items) expect(item.onSelect).not.toHaveBeenCalled();
});
