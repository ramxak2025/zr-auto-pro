jest.mock('../../components/ScreenHeaderMenu', () => ({ __esModule: true, default: 'HeaderMenu' }));
// Screen chrome is inert here; these suites exercise the existing business handlers.
const mockSectionScroll = {
  scrollY: { value: 0 },
  titleHeight: { value: 64 },
  progress: { value: 0 },
  contentTop: 0,
  reset: jest.fn(),
  onScroll: jest.fn(),
  onNativeScroll: jest.fn(),
  onContentTop: jest.fn(),
};
jest.mock('../../components/ScreenSectionHeader', () => ({
  __esModule: true,
  default: 'Header',
  useScreenSectionScroll: () => mockSectionScroll,
}));
jest.mock('../../components/ScreenSectionScrollable', () => ({
  ScreenSectionScrollView: 'ScrollView',
  ScreenSectionFlatList: 'FlatList',
  ScreenSectionFlashList: 'FlashList',
}));
jest.mock('../../components/ScreenHeaderControls', () => ({
  HeaderAction: 'HeaderAction',
  HeaderIsland: 'HeaderIsland',
  HeaderSearch: 'SearchInput',
  headerTouchSize: 44,
}));

// Actual ServicesScreen state, input handlers and create/edit payloads.
// Native hosts and transport are inert fixtures: this harness does not prove hit-testing or keyboard geometry.
import React from 'react';
import type { Service } from '../../../../shared/types';
const mockStates: unknown[] = [],
  mockEffects: { deps?: unknown[] }[] = [],
  mockPending: (() => void)[] = [];
let mockIndex = 0;
const mockCreate = jest.fn(),
  mockUpdate = jest.fn(),
  mockAlert = jest.fn();
const mockServices: Service[] = [];
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = initial;
    return [
      mockStates[index],
      (next: unknown) => {
        mockStates[index] =
          typeof next === 'function' ? (next as (mockValue: unknown) => unknown)(mockStates[index]) : next;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = mockIndex++;
    if (!(index in mockStates)) mockStates[index] = { current: initial };
    return mockStates[index] as { current: unknown };
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    const index = mockIndex++,
      old = mockEffects[index];
    if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) {
      mockPending.push(effect);
      mockEffects[index] = { deps };
    }
  },
}));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  RefreshControl: 'RefreshControl',
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('xlsx', () => ({}));
jest.mock('../../api/services', () => ({
  servicesApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: () => true, user: { role: 'director' } }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { canvas: 'white', card: 'white', muted: 'white' },
    text: { primary: 'black', secondary: 'gray', tertiary: 'gray' },
    border: { subtle: 'gray', strong: 'gray' },
    accent: { primary: 'blue' },
  }),
}));
jest.mock('../../hooks/useTabBarHeight', () => ({ useTabBarHeight: () => 80 }));
jest.mock('../../platform/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => ({
    data:
      enabled === false
        ? undefined
        : queryKey[0] === 'service-executions'
          ? { data: [], total: 0 }
          : queryKey[0] === 'services'
            ? mockServices
            : queryKey[0] === 'service-visibility-config'
              ? { rules: [], roles: [], categoryPaths: [] }
              : [],
    isLoading: false,
    isFetching: false,
    isError: false,
    isSuccess: enabled !== false,
    refetch: jest.fn(),
  }),
  useMutation: (options: { mutationFn: (input: unknown) => Promise<unknown>; onSuccess?: () => void }) => ({
    isPending: false,
    mutate: (input: unknown) => {
      void options.mutationFn(input).then(options.onSuccess);
    },
  }),
}));
for (const name of [
  'IosScreenHeader',
  'SearchInput',
  'EmptyState',
  'Modal',
  'NewCatalogFolderModal',
  'ConfirmDialog',
]) {
  jest.doMock(`../../components/${name}`, () => ({ __esModule: true, default: name }));
}
jest.doMock('../../components/Skeleton', () => ({ ListSkeleton: 'ListSkeleton' }));
jest.doMock('../../components/TabBarScrollable', () => ({
  TabBarScrollView: 'ScrollView',
  TabBarFlashList: 'FlashList',
}));
const ServicesScreen = jest.requireActual<{ default: () => React.ReactElement }>('../ServicesScreen').default;
type Element = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;
const nodes = (node: React.ReactNode): Element[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : React.isValidElement(node)
      ? [
          node as Element,
          ...React.Children.toArray((node as Element).props.children).flatMap(nodes),
          ...nodes((node as Element).props.trailing as React.ReactNode),
          ...nodes((node as Element).props.leading as React.ReactNode),
          ...nodes((node as Element).props.actions as React.ReactNode),
          ...nodes(
            node.type === 'HeaderAction'
              ? React.createElement(
                  'TouchableOpacity',
                  {
                    accessibilityLabel: (node as Element).props.label,
                    disabled: Boolean((node as Element).props.disabled || (node as Element).props.loading),
                    onPress: (node as Element).props.onPress,
                  },
                  (node as Element).props.title as React.ReactNode,
                )
              : null,
          ),
          ...nodes(
            node.type === 'HeaderMenu'
              ? ((node as Element).props.items as (false | null | undefined | Record<string, unknown>)[])
                  .filter(
                    (entry): entry is Record<string, unknown> =>
                      Boolean(entry) &&
                      (entry as Record<string, unknown>).type !== 'label' &&
                      (entry as Record<string, unknown>).type !== 'separator',
                  )
                  .map((entry) =>
                    React.createElement(
                      'TouchableOpacity',
                      {
                        key: String(entry.id),
                        accessibilityLabel: entry.label,
                        disabled: Boolean(entry.disabled || entry.loading),
                        onPress: entry.onSelect,
                      },
                      entry.label as React.ReactNode,
                    ),
                  )
              : null,
          ),
        ]
      : [];
const text = (node: React.ReactNode): string =>
  Array.isArray(node)
    ? node.map(text).join('')
    : React.isValidElement(node)
      ? text((node as Element).props.children)
      : node == null || typeof node === 'boolean'
        ? ''
        : String(node);
function render() {
  let tree!: React.ReactElement;
  for (let pass = 0; pass < 3; pass++) {
    mockIndex = 0;
    tree = ServicesScreen();
    mockPending.splice(0).forEach((effect) => effect());
  }
  return tree;
}
const form = () =>
  nodes(render()).find(
    (node) =>
      node.type === 'Modal' &&
      node.props.visible &&
      ['Новая услуга', 'Редактировать услугу'].includes(String(node.props.title)),
  )!;
const button = (tree: React.ReactNode, label: string) =>
  nodes(tree).find((node) => node.type === 'TouchableOpacity' && text(node.props.children) === label)!;
const press = (node: Element) => (node.props.onPress as () => void)();
const input = (label: string) =>
  nodes(form()).find(
    (node) =>
      node.type === 'TextInput' && (node.props.accessibilityLabel === label || node.props.placeholder === label),
  )!;
function enter(label: string, raw: string) {
  (input(label).props.onChangeText as (value: string) => void)(raw);
  return input(label);
}
function create() {
  press(button(render(), '+ Новая'));
  enter('Замена масла...', 'Работа');
  enter('0', '1000');
}
function edit(service: Service) {
  const list = nodes(render()).find((node) => node.type === 'FlashList')!;
  const row = (list.props.renderItem as (arg: { item: Service; index: number }) => Element)({
    item: service,
    index: 0,
  });
  (row.props.onHistory as (value: Service) => void)(service);
  const history = nodes(render()).find((node) => node.type === 'Modal' && node.props.visible)!;
  press(button(history, 'Изменить'));
}
const fixed = () => press(button(form(), 'Фикс, ₽'));
const percent = () => press(button(form(), 'Процент'));
async function save() {
  press(button(form(), form().props.title === 'Новая услуга' ? 'Создать' : 'Сохранить'));
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  mockStates.length = 0;
  mockEffects.length = 0;
  mockPending.length = 0;
  mockServices.length = 0;
  mockIndex = 0;
  jest.clearAllMocks();
  mockCreate.mockImplementation(async (payload: object) => ({ data: { ...payload, id: 'created', createdAt: '' } }));
  mockUpdate.mockImplementation(async (id: string, payload: object) => ({ data: { ...payload, id } }));
});
it('actual create flow accepts sequential fixed digits, editing, comma fractions and clearing without losing the controlled string', async () => {
  create();
  fixed();
  for (const raw of ['3', '30', '300', '', '0', '0,', '0,5', '300,13', '300,1', '300,15'])
    expect(enter('Фикс мастеру в рублях', raw).props.value).toBe(raw);
  await save();
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ masterPayMode: 'fixed', masterFixedAmount: 300.15 });
});
it('fixed and percent preserve their separate drafts and percent null semantics', async () => {
  create();
  enter('Оставьте пустым — процент мастера', '35');
  fixed();
  enter('Фикс мастеру в рублях', '300');
  percent();
  expect(input('Оставьте пустым — процент мастера').props.value).toBe('35');
  fixed();
  expect(input('Фикс мастеру в рублях').props.value).toBe('300');
  percent();
  await save();
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    masterPercent: 35,
    masterPayMode: 'percent',
    masterFixedAmount: null,
  });
});
it.each([0, 300.13, 9999999999.99])(
  'edit, save and reopen fixed %s without changing its numeric payload',
  async (amount) => {
    const service = {
      id: 'existing',
      name: 'Работа',
      defaultPrice: 1000,
      masterPayMode: 'fixed',
      masterFixedAmount: amount,
      masterPercent: null,
      warrantyDays: null,
      createdAt: '',
    } as Service;
    mockServices.push(service);
    edit(service);
    expect(input('Фикс мастеру в рублях').props.value).toBe(String(amount));
    await save();
    expect(mockUpdate.mock.calls[0]).toMatchObject(['existing', { masterPayMode: 'fixed', masterFixedAmount: amount }]);
    edit({ ...service, ...mockUpdate.mock.calls[0][1] });
    expect(input('Фикс мастеру в рублях').props.value).toBe(String(amount));
  },
);
it.each(['', '-1', '10000000000', 'abc'])('rejects fixed %s without sending a money mutation', async (raw) => {
  create();
  fixed();
  enter('Фикс мастеру в рублях', raw);
  await save();
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockAlert).toHaveBeenCalledWith('Проверьте начисление', expect.any(String));
});
it('gives the native fixed editor a distinct identity from percent while keeping that identity stable during typing', () => {
  create();
  const previous = input('Оставьте пустым — процент мастера');
  fixed();
  const editor = input('Фикс мастеру в рублях');
  expect(editor.type).toBe(previous.type);
  expect(editor.key).not.toBe(previous.key);
  for (const raw of ['3', '30', '300,13']) expect(enter('Фикс мастеру в рублях', raw).key).toBe(editor.key);
  percent();
  expect(input('Оставьте пустым — процент мастера').key).toBe(previous.key);
});
it.each(['0', '9999999999.99'])('create accepts the valid fixed boundary %s as a numeric amount', async (raw) => {
  create();
  fixed();
  enter('Фикс мастеру в рублях', raw);
  await save();
  expect(mockCreate.mock.calls[0][0]).toMatchObject({ masterPayMode: 'fixed', masterFixedAmount: Number(raw) });
});
it.each<[string, string, number | null]>([
  ['', '', null],
  ['0', '0', 0],
  ['35,5', '35.5', 35.5],
])('percentage input %s retains its existing normalization and payload', async (raw, displayed, amount) => {
  create();
  expect(enter('Оставьте пустым — процент мастера', raw).props.value).toBe(displayed);
  await save();
  expect(mockCreate.mock.calls[0][0]).toMatchObject({
    masterPayMode: 'percent',
    masterPercent: amount,
    masterFixedAmount: null,
  });
});
