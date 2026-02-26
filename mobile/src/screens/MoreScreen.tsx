import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { UserPermissions } from '../../../shared/types';

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

interface MenuItem {
  label: string;
  description: string;
  screen: string;
  emoji: string;
  permission?: keyof UserPermissions;
  roles?: string[];
  bgColor: string;
}

const menuItems: MenuItem[] = [
  { label: 'Расписание', description: 'График работы и смены', screen: 'Schedule', emoji: '📅', bgColor: colors.indigo[50] },
  { label: 'Клиенты', description: 'База клиентов', screen: 'Clients', permission: 'clients_view', emoji: '👥', bgColor: colors.blue[50] },
  { label: 'Услуги', description: 'Каталог услуг', screen: 'Services', emoji: '🔧', bgColor: colors.orange[50] },
  { label: 'Поставщики', description: 'Поставки и расчёты', screen: 'Suppliers', permission: 'suppliers_access', emoji: '🚛', bgColor: colors.amber[50] },
  { label: 'Движение денег', description: 'Касса по дням и сотрудникам', screen: 'CashFlow', emoji: '↔️', bgColor: colors.teal[50] },
  { label: 'Зарплата', description: 'Заработок мастеров', screen: 'Salary', emoji: '💰', bgColor: colors.green[50] },
  { label: 'Расходы', description: 'Аренда, маркетинг и др.', screen: 'Expenses', roles: ['director', 'superadmin'], emoji: '📉', bgColor: colors.rose[50] },
  { label: 'Отчёты', description: 'Финансовые отчёты', screen: 'Reports', permission: 'financial_reports', emoji: '📊', bgColor: colors.purple[50] },
  { label: 'Пользователи', description: 'Управление доступом', screen: 'Users', permission: 'user_management', emoji: '🛡', bgColor: colors.indigo[50] },
];

export default function MoreScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, hasPermission } = useAuth();
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';
  const userInitial = user?.fullName?.charAt(0) || 'U';

  const filteredItems = menuItems.filter(item => {
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.roles && user?.role && !item.roles.includes(user.role)) return false;
    return true;
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User card */}
        <View style={styles.userCard}>
          <View style={styles.userRow}>
            {user?.avatar ? (
              <View style={styles.avatarImg}>
                <Text style={styles.avatarText}>{userInitial}</Text>
              </View>
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{userInitial}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user?.fullName || 'User'}</Text>
              <Text style={styles.userRole}>{roleLabel}</Text>
            </View>
          </View>
        </View>

        {/* Menu items */}
        <View style={styles.menuCard}>
          {filteredItems.map((item, idx) => (
            <TouchableOpacity
              key={item.screen}
              style={[styles.menuItem, idx < filteredItems.length - 1 && styles.menuItemBorder]}
              onPress={() => navigation.navigate(item.screen)}
              activeOpacity={0.6}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.bgColor }]}>
                <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuDesc}>{item.description}</Text>
              </View>
              <Text style={styles.menuArrow}>›</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
          <Text style={{ fontSize: 16 }}>🚪</Text>
          <Text style={styles.logoutText}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
  // User card
  userCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[5],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary[100],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary[100],
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.gray[100],
  },
  avatarText: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary[700] },
  userName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  userRole: { fontSize: fontSize.sm, color: colors.gray[500], marginTop: 2 },
  // Menu
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  menuIcon: {
    width: 40, height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  menuTextWrap: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  menuDesc: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 1 },
  menuArrow: { fontSize: 20, color: colors.gray[300] },
  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingVertical: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  logoutText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
});
