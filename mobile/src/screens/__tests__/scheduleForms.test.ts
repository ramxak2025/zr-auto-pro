const mockStates: unknown[] = [];
let mockHookIndex = 0;
let mockSavePromise: Promise<unknown>;
const mockCreateMode = jest.fn<Promise<unknown>, unknown[]>(async () => ({ data: {} }));
const mockUpdateMode = jest.fn<Promise<unknown>, unknown[]>(async () => ({ data: {} }));
const mockCreateDay = jest.fn<Promise<unknown>, unknown[]>(async () => ({ data: {} }));
const mockUpdateDay = jest.fn<Promise<unknown>, unknown[]>(async () => ({ data: {} }));
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: unknown) => {
    const slot = mockHookIndex++;
    if (!(slot in mockStates)) mockStates[slot] = typeof initial === 'function' ? initial() : initial;
    return [
      mockStates[slot],
      (value: unknown) => {
        mockStates[slot] = typeof value === 'function' ? value(mockStates[slot]) : value;
      },
    ];
  },
}));
jest.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../components/Modal', () => 'Modal');
jest.mock('../ScheduleTimeFields', () => 'TimeFields');
jest.mock('../../api/services', () => ({
  scheduleApi: {
    createWorkMode: (...args: unknown[]) => mockCreateMode(...args),
    updateWorkMode: (...args: unknown[]) => mockUpdateMode(...args),
    create: (...args: unknown[]) => mockCreateDay(...args),
    update: (...args: unknown[]) => mockUpdateDay(...args),
  },
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(async () => undefined) }),
  useMutation: (options: { mutationFn: () => Promise<unknown>; onSuccess?: () => void }) => ({
    isPending: false,
    isError: false,
    mutate: () => {
      mockSavePromise = options.mutationFn().then(options.onSuccess);
    },
  }),
}));
jest.mock('../../contexts/ThemeContext', () => ({
  useColors: () => ({
    mode: 'light',
    bg: { muted: '#eee' },
    text: { primary: '#111', secondary: '#555' },
    border: { subtle: '#ddd' },
    accent: { primary: '#2563eb' },
  }),
}));

import React from 'react';
import type { ScheduleEntry, WorkMode } from '../../../../shared/types';
import WorkModeEditor from '../WorkModeEditor';
import ScheduleDayHoursForm from '../ScheduleDayHoursForm';

type Props = { children?: React.ReactNode; [key: string]: unknown };
function find(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Props>) => boolean,
): React.ReactElement<Props> {
  if (React.isValidElement<Props>(node)) {
    if (predicate(node)) return node;
    for (const child of React.Children.toArray(node.props.children)) {
      try {
        return find(child, predicate);
      } catch {
        /* Continue through the actual JSX tree. */
      }
    }
  }
  throw new Error('Control missing');
}
function label(node: React.ReactNode, value: string) {
  return find(node, (e) => e.props.accessibilityLabel === value);
}
function pressText(node: React.ReactNode, text: string) {
  const button = find(
    node,
    (e) =>
      typeof e.props.onPress === 'function' &&
      React.Children.toArray(e.props.children).some(
        (child) => React.isValidElement<Props>(child) && child.props.children === text,
      ),
  );
  (button.props.onPress as () => void)();
}
beforeEach(() => {
  mockStates.length = 0;
  mockHookIndex = 0;
  jest.clearAllMocks();
});

it('saves a Wednesday 14:00 exception from the actual editor and can reset it with {}', async () => {
  const mode: WorkMode = {
    id: 'mode',
    tenantId: 'tenant',
    name: 'Неделя',
    type: 'weekly',
    workDays: 2,
    offDays: 2,
    weekDays: [1, 2, 3, 4, 5, 6, 0],
    shiftStart: '09:00',
    shiftEnd: '18:00',
  };
  const render = () => {
    mockHookIndex = 0;
    return WorkModeEditor({ mode, onClose: jest.fn() });
  };
  let tree = render();
  const wednesday = find(tree, (e) => e.props.label === 'Среда');
  (wednesday.props.onChange as (v: unknown) => void)({ shiftStart: '14:00', shiftEnd: '18:00' });
  tree = render();
  pressText(tree, 'Сохранить режим');
  await mockSavePromise;
  expect(mockUpdateMode).toHaveBeenLastCalledWith(
    'mode',
    expect.objectContaining({ dayTimes: { 3: { shiftStart: '14:00', shiftEnd: '18:00' } } }),
  );
  (label(tree, 'Как в режиме: Ср').props.onPress as () => void)();
  tree = render();
  pressText(tree, 'Сохранить режим');
  await mockSavePromise;
  expect(mockUpdateMode).toHaveBeenLastCalledWith('mode', expect.objectContaining({ dayTimes: {} }));
});

it('creates a named weekly mode and maps Sunday to wire 0', async () => {
  const render = () => {
    mockHookIndex = 0;
    return WorkModeEditor({ onClose: jest.fn() });
  };
  let tree = render();
  (label(tree, 'Название режима').props.onChangeText as (v: string) => void)('Новый режим');
  (label(tree, 'Рабочий день Вс').props.onValueChange as (v: boolean) => void)(false);
  tree = render();
  pressText(tree, 'Сохранить режим');
  await mockSavePromise;
  expect(mockCreateMode).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Новый режим', type: 'weekly', weekDays: [1, 2, 3, 4, 5, 6] }),
  );
});

it.each([true, false])('the actual day form sends only plan hours, existing=%s', async (existing) => {
  const entry = existing
    ? ({
        id: 'entry',
        shiftStart: '09:00',
        shiftEnd: '18:00',
        isManualOverride: true,
        lateStatus: 'late_minor',
        lateMinutes: 15,
        actualArrival: '2026-10-05T00:15:00Z',
      } as ScheduleEntry)
    : undefined;
  const render = () => {
    mockHookIndex = 0;
    return ScheduleDayHoursForm({
      userId: 'master',
      date: '2026-10-05',
      entry,
      onSaved: jest.fn(),
      onCancel: jest.fn(),
    });
  };
  let tree = render();
  const time = find(tree, (e) => e.props.label === 'План на 2026-10-05');
  (time.props.onChange as (v: unknown) => void)({ shiftStart: '14:00', shiftEnd: '18:00' });
  tree = render();
  pressText(tree, 'Сохранить время');
  await mockSavePromise;
  if (existing) expect(mockUpdateDay).toHaveBeenCalledWith('entry', { shiftStart: '14:00', shiftEnd: '18:00' });
  else
    expect(mockCreateDay).toHaveBeenCalledWith({
      userId: 'master',
      date: '2026-10-05',
      shiftStart: '14:00',
      shiftEnd: '18:00',
    });
});
