const mockHookState: unknown[] = [];
const mockHookRefs: { current: unknown }[] = [];
let mockHookIndex = 0;
const mockAddAccount = jest.fn<Promise<unknown>, unknown[]>();
const mockSavedAccounts: {
  id: string;
  displayName: string;
  identity: { userId: string };
  role: string;
  active: boolean;
  needsReauth: boolean;
}[] = [];

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mockHookIndex++;
      if (!(index in mockHookState))
        mockHookState[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [
        mockHookState[index],
        (next: unknown) => {
          mockHookState[index] =
            typeof next === 'function' ? (next as (mockPrevious: unknown) => unknown)(mockHookState[index]) : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mockHookIndex++;
      if (!mockHookRefs[index]) mockHookRefs[index] = { current: initial };
      return mockHookRefs[index];
    },
    useEffect: (effect: () => void | (() => void)) => {
      effect();
    },
  };
});

jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: jest.fn() },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  TextInput: 'TextInput',
  View: 'View',
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    savedAccounts: mockSavedAccounts,
    cancelAccountLogin: jest.fn(),
    addAccount: (...args: unknown[]) => mockAddAccount(...args),
    completeAccountLogin: jest.fn(),
    switchAccount: jest.fn(),
    inspectAccountRemoval: jest.fn(),
    removeAccount: jest.fn(),
  }),
}));
jest.mock('../../contexts/dataSession', () => ({ captureDataSession: () => ({ isCurrent: () => true }) }));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { canvas: '#fff', card: '#fff' },
    border: { subtle: '#ddd' },
    text: { primary: '#111', secondary: '#555', tertiary: '#777' },
    accent: { primary: '#2563eb', primarySoft: '#eaf0ff', primaryText: '#1d4ed8' },
  }),
}));
jest.mock('../../theme', () => ({
  borderRadius: { lg: 12, xl: 16 },
  colors: { white: '#fff', amber: { 100: '#fff4d6', 800: '#8a5200' }, red: { 600: '#dc2626' } },
  fontSize: { base: 16, lg: 18, sm: 14 },
  fontWeight: { bold: '700', medium: '500', semibold: '600' },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 8: 32 },
}));
jest.mock('../accountPickerActions', () => ({
  cancelPendingAccountLogin: jest.fn(),
  runAccountSwitchAction: jest.fn(),
}));

import React from 'react';
import AccountPickerSheet from '../AccountPickerSheet';

type TestElement = React.ReactElement<{ children?: React.ReactNode; [key: string]: unknown }>;

function renderSheet(): React.ReactNode {
  mockHookIndex = 0;
  return AccountPickerSheet({ visible: true, onClose: jest.fn() });
}

function elements(node: React.ReactNode): TestElement[] {
  if (!React.isValidElement(node)) return [];
  const element = node as TestElement;
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}

function textContent(node: React.ReactNode): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (!React.isValidElement(node)) return [];
  return React.Children.toArray((node as TestElement).props.children).flatMap(textContent);
}

beforeEach(() => {
  mockHookState.length = 0;
  mockHookRefs.length = 0;
  mockHookIndex = 0;
  mockSavedAccounts.splice(0, mockSavedAccounts.length, {
    id: 'saved-account',
    displayName: 'Сервис Ромашка',
    identity: { userId: 'owner' },
    role: 'director',
    active: true,
    needsReauth: false,
  });
  mockAddAccount.mockReset();
});

it('renders the saved-account list and Add form without raw text children, then shows a busy submit state', async () => {
  let tree = renderSheet();
  expect(textContent(tree)).toContain('Сервис Ромашка');
  const addButton = elements(tree).find(
    (element) => element.props.accessibilityRole === 'button' && textContent(element).includes('Добавить аккаунт'),
  );
  expect(addButton).toBeDefined();
  (addButton?.props.onPress as () => void)();

  tree = renderSheet();
  expect(textContent(tree)).toContain('Добавить аккаунт');
  const primary = elements(tree).find(
    (element) =>
      element.props.accessibilityRole !== 'alert' &&
      typeof element.props.onPress === 'function' &&
      element.props.disabled === false &&
      textContent(element).includes('Продолжить'),
  );
  expect(primary).toBeDefined();
  for (const pressable of elements(tree).filter((element) => element.type === 'Pressable')) {
    for (const child of React.Children.toArray(pressable.props.children)) {
      expect(typeof child).not.toBe('string');
    }
  }

  let resolveLogin: (value: unknown) => void = () => undefined;
  mockAddAccount.mockReturnValue(
    new Promise((resolve) => {
      resolveLogin = resolve;
    }),
  );
  const inputs = elements(tree).filter((element) => element.type === 'TextInput');
  (inputs[0].props.onChangeText as (value: string) => void)('+79990000000');
  (inputs[1].props.onChangeText as (value: string) => void)('password');
  tree = renderSheet();
  const continueButton = elements(tree).find(
    (element) => element.type === 'Pressable' && textContent(element).includes('Продолжить'),
  );
  const submission = (continueButton?.props.onPress as () => Promise<void>)();
  tree = renderSheet();
  const busyButton = elements(tree).find(
    (element) =>
      element.type === 'Pressable' &&
      element.props.disabled === true &&
      React.Children.toArray(element.props.children).some(
        (child) => React.isValidElement(child) && child.type === 'ActivityIndicator',
      ),
  );
  expect(busyButton).toBeDefined();
  resolveLogin({ status: 'authenticated' });
  await submission;
});
