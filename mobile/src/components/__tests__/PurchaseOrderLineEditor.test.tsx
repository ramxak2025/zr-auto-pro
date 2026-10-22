import React from 'react';
import { Platform } from 'react-native';
const mockStates: unknown[] = [];
const mockRefs: { current: unknown }[] = [];
let mockIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
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
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  Keyboard: { dismiss: jest.fn() },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('../BottomSheet', () => ({ BottomSheet: 'BottomSheet' }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ccc' },
  }),
}));
import Editor, { type PurchaseOrderLineEditorProps } from '../PurchaseOrderLineEditor';
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (value: React.ReactNode): Element[] =>
  Array.isArray(value)
    ? value.flatMap(nodes)
    : React.isValidElement(value)
      ? [value as Element, ...nodes((value as Element).props.children)]
      : [];
const text = (value: React.ReactNode): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map(text).join('')
      : React.isValidElement(value)
        ? text((value as Element).props.children)
        : '';
function fixture(extra: Partial<PurchaseOrderLineEditorProps> = {}) {
  const props = {
    name: 'Шланг',
    unit: 'm',
    quantityText: '1',
    costPriceText: '25.5',
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
    ...extra,
  };
  const render = () => {
    mockIndex = 0;
    return Editor(props);
  };
  const field = (tree: React.ReactNode, label: string) =>
    nodes(tree).find((n) => n.type === 'TextInput' && n.props.accessibilityLabel === label)!;
  const press = (tree: React.ReactNode, label: string) =>
    (nodes(tree).find((n) => n.type === 'TouchableOpacity' && text(n) === label)!.props.onPress as () => void)();
  return { props, render, field, press };
}
beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
});
for (const platform of ['ios', 'android'])
  test(`${platform} inert native host: confirm reads last focused keyboard values with comma and zero price`, () => {
    Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
    const f = fixture();
    const tree = f.render();
    (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)('125,5');
    (f.field(tree, 'Закупочная цена за единицу').props.onChangeText as (value: string) => void)('0');
    f.press(tree, 'Добавить в заказ');
    expect(f.props.onConfirm).toHaveBeenCalledWith({ quantity: 125.5, costPrice: 0 });
  });
test('live total, cancel and repeated edit use order snapshots instead of catalogue prices', () => {
  const f = fixture({ existing: true, quantityText: '2.5', costPriceText: '10.25' });
  let tree = f.render();
  expect(text(tree)).toContain('25,63');
  (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)('9');
  tree = f.render();
  f.press(tree, 'Отмена');
  expect(f.props.onCancel).toHaveBeenCalledTimes(1);
  expect(f.props.onConfirm).not.toHaveBeenCalled();
});
test('invalid quantity/price never silently becomes zero; text and errors remain editable', () => {
  const f = fixture();
  for (const [qty, cost] of [
    ['12abc', '10'],
    ['1,2,3', '10'],
    ['0', '0'],
    ['1.0001', '1'],
    ['1', ''],
    ['1', '-1'],
    ['1', '1.234'],
  ]) {
    let tree = f.render();
    (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)(qty);
    (f.field(tree, 'Закупочная цена за единицу').props.onChangeText as (value: string) => void)(cost);
    f.press(tree, 'Добавить в заказ');
    tree = f.render();
    expect(f.props.onConfirm).not.toHaveBeenCalled();
    expect(f.field(tree, 'Количество товара').props.value).toBe(qty);
    expect(f.field(tree, 'Закупочная цена за единицу').props.value).toBe(cost);
    expect(nodes(tree).some((n) => n.props.accessibilityRole === 'alert')).toBe(true);
  }
  const tree = f.render();
  (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)('0,001');
  (f.field(tree, 'Закупочная цена за единицу').props.onChangeText as (value: string) => void)('0');
  f.press(tree, 'Добавить в заказ');
  expect(f.props.onConfirm).toHaveBeenCalledWith({ quantity: 0.001, costPrice: 0 });
});
test('received minimum and callback failure preserve draft; retry consumes the same entered values', () => {
  const onConfirm = jest.fn().mockImplementationOnce(() => {
    throw new Error('fixture temporary failure');
  });
  const f = fixture({ existing: true, quantityText: '4', costPriceText: '2', receivedQuantity: 3, onConfirm });
  let tree = f.render();
  (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)('2');
  f.press(tree, 'Сохранить позицию');
  tree = f.render();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(text(tree)).toContain('Уже принято 3');
  (f.field(tree, 'Количество товара').props.onChangeText as (value: string) => void)('3');
  f.press(tree, 'Сохранить позицию');
  tree = f.render();
  expect(text(tree)).toContain('fixture temporary failure');
  expect(f.field(tree, 'Количество товара').props.value).toBe('3');
  f.press(tree, 'Сохранить позицию');
  expect(onConfirm).toHaveBeenLastCalledWith({ quantity: 3, costPrice: 2 });
});
