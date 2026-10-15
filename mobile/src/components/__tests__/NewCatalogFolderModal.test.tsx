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
        mockStates[index] = next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('../Modal', () => ({ __esModule: true, default: 'Modal' }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    text: { primary: '#111', secondary: '#555' },
    bg: { muted: '#eee' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb' },
  }),
}));

import React from 'react';
import NewCatalogFolderModal from '../NewCatalogFolderModal';
import { newCatalogFolderPath } from '../../utils/catalogFolderName';

type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  React.isValidElement(node)
    ? [node as Element, ...React.Children.toArray((node as Element).props.children).flatMap(nodes)]
    : [];
const words = (node: React.ReactNode): string =>
  typeof node === 'string'
    ? node
    : React.isValidElement(node)
      ? React.Children.toArray((node as Element).props.children)
          .map(words)
          .join('')
      : '';
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const setup = (onCreate: (path: string) => Promise<void>, parentPath = '') => {
  const onClose = jest.fn();
  const render = () => {
    mockIndex = 0;
    return NewCatalogFolderModal({ parentPath, rootLabel: 'Основной склад', onCreate, onClose });
  };
  const input = (tree: Element) => nodes(tree).find((node) => node.type === 'TextInput')!;
  const button = (tree: Element) => nodes(tree).find((node) => node.props.accessibilityLabel === 'Создать папку')!;
  const typeName = (name: string) => (input(render()).props.onChangeText as (name: string) => void)(name);
  const press = (tree = render()) => (button(tree).props.onPress as () => void)();
  return { render, input, button, typeName, press, onClose };
};
beforeEach(() => {
  mockStates.length = 0;
  mockRefs.length = 0;
  mockIndex = 0;
});

it('creates a trimmed single segment in the displayed parent, without requiring a slash path', async () => {
  const create = jest.fn(async () => undefined);
  const form = setup(create, 'Запчасти/Фильтры');
  expect(words(form.render())).toContain('Основной склад / Запчасти / Фильтры');
  form.typeName('  Масляные  ');
  form.press();
  await flush();
  expect(create).toHaveBeenCalledWith('Запчасти/Фильтры/Масляные');
});

it('shows the root location and disables empty input; slash/dot names never call the API', async () => {
  const create = jest.fn(async () => undefined);
  const form = setup(create);
  expect(words(form.render())).toContain('Основной склад · корень');
  expect(form.button(form.render()).props.disabled).toBe(true);
  for (const name of [' ', '/', 'A/B', '.', '..']) {
    form.typeName(name);
    form.press();
    await flush();
    expect(nodes(form.render()).some((node) => node.props.accessibilityRole === 'alert')).toBe(true);
  }
  expect(create).not.toHaveBeenCalled();
});

it('blocks repeated taps and keyboard submission before the next render and while pending', async () => {
  let resolve!: () => void;
  const create = jest.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const form = setup(create);
  form.typeName('Новая');
  const tree = form.render();
  form.press(tree);
  form.press(tree);
  (form.input(tree).props.onSubmitEditing as () => void)();
  expect(create).toHaveBeenCalledTimes(1);
  const pending = form.render();
  expect(form.button(pending).props.accessibilityState).toEqual({ disabled: true, busy: true });
  expect(form.input(pending).props.editable).toBe(false);
  (pending.props.onClose as () => void)();
  expect(form.onClose).not.toHaveBeenCalled();
  resolve();
  await flush();
  expect(form.button(form.render()).props.disabled).toBe(false);
});

it('keeps the name after network/duplicate/context errors and allows an intentional retry', async () => {
  const create = jest
    .fn()
    .mockRejectedValueOnce(new Error('Проверьте соединение и повторите.'))
    .mockRejectedValueOnce(new Error('Папка с таким названием уже существует. Введите другое название.'))
    .mockRejectedValueOnce(new Error('Склад или филиал изменился.'))
    .mockResolvedValue(undefined);
  const form = setup(create);
  form.typeName('Масляные');
  for (const message of ['Проверьте соединение', 'уже существует', 'филиал изменился']) {
    form.press();
    await flush();
    expect(words(form.render())).toContain(message);
    expect(form.input(form.render()).props.value).toBe('Масляные');
    expect(form.button(form.render()).props.disabled).toBe(false);
  }
  form.press();
  await flush();
  expect(create).toHaveBeenCalledTimes(4);
});

it('limits the complete path, including its parent, to 256 characters', () => {
  expect(newCatalogFolderPath('A'.repeat(254), 'Б')).toHaveLength(256);
  expect(() => newCatalogFolderPath('A'.repeat(255), 'Б')).toThrow('256');
  expect(newCatalogFolderPath('Запчасти', 'Фильтры. Масляные')).toBe('Запчасти/Фильтры. Масляные');
});
