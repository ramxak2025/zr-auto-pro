import React from 'react';

const mockToggle = jest.fn();
const mockSettings = jest.fn();
const mockTheme = { mode: 'light', toggle: mockToggle };
let mockCurrent = true;
const mockRefs: { current: any }[] = [];
let mockRefIndex = 0;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({
  View: 'View',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withTiming: (value: unknown) => value,
  cancelAnimation: jest.fn(),
  Easing: { cubic: 'cubic', out: (v: unknown) => v },
  ReduceMotion: { System: 'system' },
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useThemeMode: () => mockTheme,
  useColors: () => ({ mode: mockTheme.mode, text: { primary: '#eee' } }),
}));
jest.mock('lucide-react-native', () => ({
  Sun: 'RealSun',
  Moon: 'RealMoon',
  SlidersHorizontal: 'SlidersHorizontal',
  Circle: 'FallbackCircle',
}));
import OwnerHomeWidgetActions from '../OwnerHomeWidgetActions';
import Ionicons from '../../../../components/icons/IoniconsShim';

function nodes(node: React.ReactNode): React.ReactElement<any>[] {
  if (!React.isValidElement<any>(node)) return [];
  return [node, ...React.Children.toArray((node.props as { children?: React.ReactNode }).children).flatMap(nodes)];
}
function render(enabled = true) {
  mockRefIndex = 0;
  return OwnerHomeWidgetActions({
    enabled,
    isCurrent: () => mockCurrent,
    onSettings: mockSettings,
    reducedMotion: true,
  });
}
function pressAll(tree: React.ReactNode) {
  nodes(tree)
    .filter((n) => n.props.accessibilityRole === 'button')
    .forEach((n) => n.props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockRefs.length = 0;
  mockCurrent = true;
  mockTheme.mode = 'light';
  jest.requireMock('react-native').AppState.currentState = 'active';
});

test('embedded controls toggle the actual theme provider with the correct glyph and open widget settings', () => {
  for (const [mode, label, glyph] of [
    ['light', 'Включить тёмную тему', 'moon-outline'],
    ['dark', 'Включить светлую тему', 'sun-outline'],
  ]) {
    mockTheme.mode = mode;
    const tree = render();
    const theme = nodes(tree).find((n) => n.props.accessibilityLabel === label)!;
    expect(nodes(theme).some((n) => n.props.name === glyph)).toBe(true);
    pressAll(tree);
  }
  expect(mockToggle).toHaveBeenCalledTimes(2);
  expect(mockSettings).toHaveBeenCalledTimes(2);
  expect(Ionicons({ name: 'sun-outline' }).type).toBe('RealSun');
  expect(Ionicons({ name: 'moon-outline' }).type).toBe('RealMoon');
});

test.each(['inactive', 'expired-scope', 'background', 'unmount'])(
  'retained appearance controls do nothing after %s',
  (event) => {
    const tree = render();
    const cleanup = (React.useEffect as jest.Mock).mock.calls[0][0]();
    if (event === 'inactive') render(false);
    if (event === 'expired-scope') mockCurrent = false;
    if (event === 'background') jest.requireMock('react-native').AppState.currentState = 'background';
    if (event === 'unmount') cleanup();
    pressAll(tree);
    expect(mockToggle).not.toHaveBeenCalled();
    expect(mockSettings).not.toHaveBeenCalled();
  },
);
