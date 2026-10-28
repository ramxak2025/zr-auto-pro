const mockStates: unknown[] = [],
  mockDeps: unknown[][] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates))
      mockStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = { current: initial };
    return mockStates[index];
  },
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = mockIndex++;
    if (!mockDeps[index] || deps.some((v, i) => v !== mockDeps[index][i])) {
      mockDeps[index] = deps;
      effect();
    }
  },
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator',
  TextInput: 'TextInput',
  Switch: 'Switch',
  Platform: { OS: 'ios' },
  useWindowDimensions: () => ({ height: 844, width: 390, fontScale: 1 }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAwareScrollView: 'ScrollView' }));
jest.mock('../JournalMotion', () => ({ JournalPressable: 'TouchableOpacity' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text', textVariantStyles: { body: {} } }));
jest.mock('../../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff', muted: '#eee' },
    text: { primary: '#111', secondary: '#555', inverse: '#fff' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../../components/DateTimePickerModal', () => ({ __esModule: true, default: 'DatePicker' }));
jest.mock('../JournalModal', () => ({ __esModule: true, default: 'JournalModal', JournalFilterPage: 'Page' }));
import React from 'react';
import JournalWarehouseFilters from '../JournalWarehouseFilters';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] => {
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  if (typeof element.type === 'function')
    return nodes((element.type as (props: unknown) => React.ReactNode)(element.props));
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
};
let props: Parameters<typeof JournalWarehouseFilters>[0];
const render = () => {
  mockIndex = 0;
  return JournalWarehouseFilters(props);
};
const press = (tree: React.ReactNode, label: string) => {
  const item = nodes(tree).find((node) => String(node.props.accessibilityLabel).startsWith(label));
  expect(item).toBeDefined();
  (item!.props.onPress as () => void)();
};
beforeEach(() => {
  mockStates.length = 0;
  mockDeps.length = 0;
  props = {
    visible: true,
    onClose: jest.fn(),
    dateFrom: null,
    dateTo: null,
    kind: null,
    kinds: [
      { key: null, label: 'Все' },
      { key: 'purchase', label: 'Поступление' },
    ],
    onDateFrom: jest.fn(),
    onDateTo: jest.fn(),
    onKind: jest.fn(),
    formatDate: (value) => value.toISOString().slice(0, 10),
  };
});
it('warehouse type applies immediately and closing never rolls it back', () => {
  let tree = render();
  press(tree, 'Тип документа:');
  tree = render();
  press(tree, 'Поступление');
  expect(props.onKind).toHaveBeenCalledWith('purchase');
  expect(props.onClose).not.toHaveBeenCalled();
  tree = render();
  press(tree, 'Закрыть фильтры документов');
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(props.onKind).toHaveBeenCalledTimes(1);
});
it('warehouse dates remain independent and immediately applied through the picker', () => {
  let tree = render();
  press(tree, 'Период:');
  tree = render();
  press(tree, 'Документы с даты:');
  tree = render();
  const date = new Date('2026-10-28T12:00:00Z');
  (nodes(tree).find((node) => node.type === 'DatePicker')!.props.onConfirm as (date: Date) => void)(date);
  expect(props.onDateFrom).toHaveBeenCalledWith(date);
  expect(props.onDateTo).not.toHaveBeenCalled();
  expect(props.onKind).not.toHaveBeenCalled();
});
