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

interface SalaryEmployeeRouteParams {
  employeeId: string;
  employeeName?: string;
  month?: string;
}

export default function SalaryEmployeeScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { hasPermission } = useAuth();
  const palette = useColors();

  const params = (route.params || {}) as SalaryEmployeeRouteParams;
  const employeeId = params.employeeId;
  const employeeName = params.employeeName || 'Сотрудник';
  // Два независимых серверных ключа (сид «Администратора»: payouts=false,
  // premiums=true — один общий prop скрывал бы ему «Премию» или, наоборот,
  // показывал бы выплаты):
  //   • salary_payouts_manage — POST /salary/payments, payouts, penalties
  //     (выплаты / авансы / штрафы; сид Директор true, Админ false).
  //   • salary_premiums_manage — POST /salary/premiums (премии; сид Директор
  //     И Админ true).
  // Держатель salary_view_all без обоих прав видит карту read-only.
  const canManagePayouts = hasPermission('salary_payouts_manage');
  const canManagePremiums = hasPermission('salary_premiums_manage');
  // Round 15 п.1 — «Изменить процент за <месяц>» прямо из зарплатной карточки:
  // тот же серверный гейт, что и у PATCH /users/:id/rate (owner-class
  // байпасится внутри hasPermission).
  const canManageRates = hasPermission('user_management');

  if (!employeeId) {
    // Defensive — a malformed deep-link without an id just bounces back.
    return <View style={[styles.flex, { backgroundColor: palette.bg.canvas }]} />;
  }

  return (
    <SalaryEmployeeCard
      employeeId={employeeId}
      employeeName={employeeName}
      title={employeeName}
      canManagePayouts={canManagePayouts}
      canManagePremiums={canManagePremiums}
      canManageRates={canManageRates}
      initialMonth={params.month}
      onBack={() => navigation.goBack()}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
