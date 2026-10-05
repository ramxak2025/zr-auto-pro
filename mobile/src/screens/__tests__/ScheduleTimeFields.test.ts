let mockPicker: 'shiftStart' | 'shiftEnd' | null = null;
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: () => [
    mockPicker,
    (value: typeof mockPicker) => {
      mockPicker = value;
    },
  ],
}));
jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  Text: 'Text',
  TouchableOpacity: 'Button',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s },
}));
jest.mock('../../components/DateTimePickerModal', () => 'Picker');
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    bg: { muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
  }),
}));
import React from 'react';
import ScheduleTimeFields from '../ScheduleTimeFields';

type Props = { children?: React.ReactNode; [key: string]: unknown };
function find(
  node: React.ReactNode,
  match: (node: React.ReactElement<Props>) => boolean,
): React.ReactElement<Props> | undefined {
  if (!React.isValidElement<Props>(node)) return;
  if (match(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const result = find(child, match);
    if (result) return result;
  }
}
it('confirms only the clock pair even when base hours come from a larger mode draft', () => {
  mockPicker = null;
  const onChange = jest.fn();
  const value = { shiftStart: '09:00', shiftEnd: '18:00', name: 'Режим', weekDays: [3], dayTimes: {} };
  let tree = ScheduleTimeFields({ value, onChange, label: 'Среда' });
  const button = find(tree, (node) => node.props.accessibilityLabel === 'Среда, начало 09:00');
  expect(button).toBeDefined();
  (button?.props.onPress as () => void)();
  tree = ScheduleTimeFields({ value, onChange, label: 'Среда' });
  const picker = find(tree, (node) => node.type === 'Picker');
  (picker?.props.onConfirm as (date: Date) => void)(new Date(2000, 0, 1, 14, 0));
  expect(onChange).toHaveBeenCalledWith({ shiftStart: '14:00', shiftEnd: '18:00' });
});
