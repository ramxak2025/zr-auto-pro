import React from 'react';
let mockFontScale = 1;
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 402, fontScale: mockFontScale }),
}));
jest.mock('../../../../contexts/ThemeContext', () => ({
  useColors: () => ({ text: { primary: '#111', secondary: '#555' }, accent: { primaryText: '#1d4ed8' } }),
}));
jest.mock('../../../../components/icons/IoniconsShim', () => 'Ionicons');
import OwnerHomeDateNavigation from '../OwnerHomeDateNavigation';

function nodes(node: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function props() {
  return {
    period: 'month' as const,
    selectedDate: '2026-09-30',
    todayDate: '2026-10-29',
    enabled: true,
    onPrevious: jest.fn(),
    onNext: jest.fn(),
    onToday: jest.fn(),
    onCalendar: jest.fn(),
  };
}
beforeEach(() => {
  mockFontScale = 1;
});

test('visible arrows, exact-date selector and current return are distinct accessible touch targets', () => {
  const handlers = props();
  const tree = OwnerHomeDateNavigation(handlers);
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  expect(buttons).toHaveLength(4);
  expect(buttons[0].props.accessibilityLabel).toBe('Предыдущий месяц');
  expect(buttons[1].props.accessibilityLabel).toContain('1–30 сентября 2026');
  expect(buttons[2].props.accessibilityLabel).toBe('Следующий месяц');
  expect(buttons[3].props.accessibilityLabel).toBe('Вернуться к текущему месяцу');
  buttons.forEach((button) => (button.props.onPress as () => void)());
  for (const handler of [handlers.onPrevious, handlers.onCalendar, handlers.onNext, handlers.onToday])
    expect(handler).toHaveBeenCalledTimes(1);
  for (const button of [buttons[0], buttons[2]])
    expect((button.props.style as Array<{ width?: number; height?: number }>)[0]).toMatchObject({
      width: 44,
      height: 44,
    });
  expect(nodes(tree).some((node) => node.props.children === 'Сентябрь 2026')).toBe(true);
});

test('next is disabled in the current month, while an earlier cutoff can still return to today', () => {
  const tree = OwnerHomeDateNavigation({ ...props(), selectedDate: '2026-10-02' });
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  expect(buttons[2].props.disabled).toBe(true);
  expect(buttons[2].props.accessibilityState).toEqual({ disabled: true });
  expect(buttons[2].props.onPress).toBeUndefined();
  expect(buttons[3].props.disabled).toBe(false);
});

test('today hides the redundant return action and never offers a future day', () => {
  const tree = OwnerHomeDateNavigation({ ...props(), period: 'day', selectedDate: '2026-10-29' });
  const buttons = nodes(tree).filter((node) => node.props.accessibilityRole === 'button');
  expect(buttons).toHaveLength(3);
  expect(buttons[2].props.accessibilityLabel).toBe('Следующий день');
  expect(buttons[2].props.disabled).toBe(true);
  expect(nodes(tree).some((node) => node.props.children === 'Сегодня, 29 октября')).toBe(true);
});

test.each([{ enabled: false }, { todayDate: undefined }])(
  'inactive or uninitialized navigation disables all actions: %j',
  (state) => {
    const tree = OwnerHomeDateNavigation({ ...props(), ...state });
    for (const button of nodes(tree).filter((node) => node.props.accessibilityRole === 'button')) {
      expect(button.props.disabled).toBe(true);
      expect(button.props.onPress).toBeUndefined();
      expect(button.props.accessibilityState).toEqual({ disabled: true });
    }
  },
);

test('larger text moves the current return onto its own row without truncating the date', () => {
  mockFontScale = 2;
  const tree = OwnerHomeDateNavigation(props());
  const children = React.Children.toArray(tree.props.children);
  expect(children).toHaveLength(2);
  const mainButtons = nodes(children[0]).filter((node) => node.props.accessibilityRole === 'button');
  expect(mainButtons).toHaveLength(3);
  expect(nodes(children[1]).some((node) => node.props.accessibilityLabel === 'Вернуться к текущему месяцу')).toBe(true);
  const dateText = nodes(tree).find((node) => node.props.children === 'Сентябрь 2026')!;
  expect(dateText.props.numberOfLines).toBeUndefined();
  expect(dateText.props.allowFontScaling).not.toBe(false);
});
