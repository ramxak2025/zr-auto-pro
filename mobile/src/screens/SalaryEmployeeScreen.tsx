/**
 * SalaryEmployeeScreen — full-screen, month-paged salary card for ONE employee.
 *
 * The owner (director/superadmin) reaches this by tapping an employee row in
 * «Зарплата» (SalaryScreen). It lives inside MoreStack so the floating tab bar
 * stays visible and back-nav steps card → list → Ещё (like Сотрудники →
 * EmployeeDetail).
 *
 * All breakdown + owner actions (payout / fine / premium) live in the shared
 * <SalaryEmployeeCard>, which the employee self-view (SalaryScreen for a
 * master/admin) also renders — so the two entry points can never drift.
 *
 * Route params:
 *   • employeeId   — required.
 *   • employeeName — header title (falls back to «Сотрудник»).
 *   • month        — optional 'YYYY-MM' to open on (owner passes the month
 *                    they were viewing in the list).
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import SalaryEmployeeCard from '../components/salary/SalaryEmployeeCard';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { UserRole } from '../../../shared/types';

interface SalaryEmployeeRouteParams {
  employeeId: string;
  employeeName?: string;
  month?: string;
}

export default function SalaryEmployeeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { isRole } = useAuth();
  const palette = useColors();

  const params = (route.params || {}) as SalaryEmployeeRouteParams;
  const employeeId = params.employeeId;
  const employeeName = params.employeeName || 'Сотрудник';
  // «Владелец» = director + superadmin — only they get the payout / fine /
  // premium actions. An employee never reaches this screen (they get their own
  // self-view inside SalaryScreen), but gate defensively all the same.
  const canManage = isRole(UserRole.DIRECTOR, UserRole.SUPERADMIN);

  if (!employeeId) {
    // Defensive — a malformed deep-link without an id just bounces back.
    return <View style={[styles.flex, { backgroundColor: palette.bg.canvas }]} />;
  }

  return (
    <SalaryEmployeeCard
      employeeId={employeeId}
      employeeName={employeeName}
      title={employeeName}
      canManage={canManage}
      initialMonth={params.month}
      onBack={() => navigation.goBack()}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
