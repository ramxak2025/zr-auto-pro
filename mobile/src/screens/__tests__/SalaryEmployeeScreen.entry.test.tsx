import React from 'react';
let mockParams: Record<string, string> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('react-native', () => ({ View: 'View', StyleSheet: { create: (s: unknown) => s } }));
jest.mock('../../components/salary/SalaryEmployeeCard', () => 'SalaryEmployeeCard');
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ hasPermission: () => false }) }));
jest.mock('../../contexts/ThemeContext', () => ({ useColors: () => ({ bg: { canvas: '#fff' } }) }));
import SalaryEmployeeScreen from '../SalaryEmployeeScreen';

test('a repeated Home salary entry remounts the same employee card at the newly supplied server month', () => {
  mockParams = { employeeId: 'employee-a', month: '2026-10', entryRequestId: 'home-1' };
  const first = SalaryEmployeeScreen() as React.ReactElement<Record<string, unknown>>;
  mockParams = { ...mockParams, entryRequestId: 'home-2' };
  const next = SalaryEmployeeScreen() as React.ReactElement<Record<string, unknown>>;
  expect(first.key).not.toBeNull();
  expect(next.key).not.toBe(first.key);
  expect(next.props.initialMonth).toBe('2026-10');
  expect(next.props.employeeId).toBe('employee-a');
});

test('legacy entries reset on employee or requested month change but keep identity during a card rerender', () => {
  mockParams = { employeeId: 'employee-a', month: '2026-09' };
  const first = SalaryEmployeeScreen();
  expect(SalaryEmployeeScreen().key).toBe(first.key);
  mockParams = { ...mockParams, month: '2026-10' };
  const changedMonth = SalaryEmployeeScreen();
  expect(changedMonth.key).not.toBe(first.key);
  mockParams = { ...mockParams, employeeId: 'employee-b' };
  expect(SalaryEmployeeScreen().key).not.toBe(changedMonth.key);
});
