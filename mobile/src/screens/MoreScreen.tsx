import React, { useRef, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Animated, Alert, ActivityIndicator } from 'react-native';
import CachedImage from '../components/CachedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { uploadsApi, authApi, subscriptionApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { UserPermissions, SubscriptionInfo } from '../../../shared/types';

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

const roleBadgeColors: Record<string, { bg: string; text: string }> = {
  superadmin: { bg: colors.red[50], text: colors.red[700] },
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[600] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

interface MenuItem {
  label: string;
  description: string;
  screen: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission?: keyof UserPermissions;
  roles?: string[];
  featureKey?: string;
  iconBg: string;
  iconColor: string;
}

const menuItems: MenuItem[] = [
  { label: 'Сотрудники', description: 'Карточки персонала, статус, рейтинги', screen: 'Employees', icon: 'people-circle-outline', iconBg: colors.cyan[50], iconColor: colors.cyan[600] },
  { label: 'Корзина склада', description: 'Восстановление удалённых товаров', screen: 'Trash', permission: 'warehouse_access', icon: 'trash-outline', iconBg: colors.rose[50], iconColor: colors.rose[600] },
  { label: 'Расписание', description: 'График работы и смены', screen: 'Schedule', featureKey: 'schedule_view', icon: 'calendar-outline', iconBg: colors.indigo[50], iconColor: colors.indigo[600] },
  { label: 'Клиенты', description: 'База клиентов', screen: 'Clients', permission: 'clients_view', featureKey: 'clients_view', icon: 'people-outline', iconBg: colors.blue[50], iconColor: colors.blue[600] },
  { label: 'Автомобили', description: 'Все автомобили клиентов', screen: 'Cars', permission: 'clients_view', featureKey: 'clients_view', icon: 'car-sport-outline', iconBg: colors.blue[50], iconColor: colors.blue[600] },
  { label: 'Услуги', description: 'Каталог услуг', screen: 'Services', featureKey: 'services_view', icon: 'build-outline', iconBg: colors.orange[50], iconColor: colors.orange[600] },
  { label: 'Поставщики', description: 'Поставки и расчёты', screen: 'Suppliers', permission: 'suppliers_access', featureKey: 'suppliers_view', icon: 'truck-outline' as any, iconBg: colors.amber[50], iconColor: colors.amber[600] },
  { label: 'Движение денег', description: 'Касса по дням и сотрудникам', screen: 'CashFlow', featureKey: 'cashflow_view', icon: 'swap-horizontal-outline', iconBg: colors.teal[50], iconColor: colors.teal[600] },
  { label: 'Зарплата', description: 'Заработок мастеров', screen: 'Salary', featureKey: 'salary_view', icon: 'wallet-outline', iconBg: colors.green[50], iconColor: colors.green[600] },
  { label: 'Расходы', description: 'Аренда, маркетинг и др.', screen: 'Expenses', roles: ['director', 'superadmin'], icon: 'trending-down-outline', iconBg: colors.rose[50], iconColor: colors.rose[600] },
  { label: 'Отчёты', description: 'Финансовые отчёты', screen: 'Reports', permission: 'financial_reports', featureKey: 'reports_view', icon: 'bar-chart-outline', iconBg: colors.purple[50], iconColor: colors.purple[700] },
  { label: 'Звонки', description: 'Журнал звонков и записи', screen: 'Calls', roles: ['director', 'superadmin'], icon: 'call-outline', iconBg: colors.blue[50], iconColor: colors.blue[600] },
  { label: 'Имущество', description: 'Инструменты и оборудование', screen: 'Equipment', icon: 'cube-outline', iconBg: colors.emerald[50], iconColor: colors.emerald[700] },
  { label: 'Маркетинг', description: 'Отзывы и рассылки', screen: 'Marketing', icon: 'megaphone-outline', iconBg: colors.violet[50], iconColor: colors.violet[600] },
  { label: 'Пользователи', description: 'Управление доступом', screen: 'Users', permission: 'user_management', featureKey: 'users_manage', icon: 'shield-outline', iconBg: colors.indigo[50], iconColor: colors.indigo[600] },
  { label: 'Настройки компании', description: 'Реквизиты и данные для чеков', screen: 'CompanySettings', roles: ['director', 'superadmin'], icon: 'business-outline', iconBg: colors.slate[100], iconColor: colors.slate[600] },
  { label: 'Подписка', description: 'Тариф и оплата', screen: 'Subscription', roles: ['director', 'superadmin'], icon: 'card-outline', iconBg: colors.primary[50], iconColor: colors.primary[600] },
  { label: 'Админ-панель', description: 'Управление тенантами и планами', screen: 'Admin', roles: ['superadmin'], icon: 'shield-checkmark-outline', iconBg: colors.red[50], iconColor: colors.red[600] },
];

function AnimatedMenuItem({ item, index, onPress, locked }: { item: MenuItem; index: number; onPress: () => void; locked?: boolean }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    const delay = index * 40;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }] }}>
      <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.6}>
        <View style={[styles.menuIcon, { backgroundColor: item.iconBg }]}>
          <Ionicons name={item.icon} size={20} color={locked ? colors.gray[400] : item.iconColor} />
        </View>
        <View style={styles.menuTextWrap}>
          <Text style={[styles.menuLabel, locked && { color: colors.gray[400] }]}>{item.label}</Text>
          <Text style={styles.menuDesc}>{item.description}</Text>
        </View>
        {locked ? (
          <Ionicons name="lock-closed" size={14} color={colors.gray[300]} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function MoreScreen() {
  const navigation = useNavigation<any>();
  const { user, logout, hasPermission, refreshUser } = useAuth();
  const [uploading, setUploading] = useState(false);
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';
  const userInitial = user?.fullName?.charAt(0) || 'U';
  const badgeColor = user?.role ? roleBadgeColors[user.role] || roleBadgeColors.master : roleBadgeColors.master;
  const avatarUrl = getImageUrl(user?.avatar);

  // Fetch subscription for feature gating
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => { const res = await subscriptionApi.get(); return res.data; },
    staleTime: 5 * 60 * 1000,
  });

  const currentPlan = sub?.plans?.find(p => p.name === sub?.planName);
  const planFeatures: string[] = Array.isArray(currentPlan?.features) ? currentPlan!.features : [];
  const isBypass = user?.role === 'superadmin';

  const isFeatureLocked = (featureKey?: string) => {
    if (!featureKey || isBypass || !sub) return false;
    return !planFeatures.includes(featureKey);
  };

  const filteredItems = menuItems.filter(item => {
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.roles && user?.role && !item.roles.includes(user.role)) return false;
    return true;
  });

  const handleAvatarUpload = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      setUploading(true);
      const uploadRes = await uploadsApi.upload(asset.uri, asset.fileName || 'avatar.jpg');
      await authApi.updateAvatar(uploadRes.data.url);
      await refreshUser();
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить аватарку');
    } finally {
      setUploading(false);
    }
  };

  // Entrance animation for user card
  const cardFade = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.95)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardFade, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardScale, { toValue: 1, friction: 8, tension: 40, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User card */}
        <Animated.View style={[styles.userCard, { opacity: cardFade, transform: [{ scale: cardScale }] }]}>
          <View style={styles.userRow}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <CachedImage source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{userInitial}</Text>
                </View>
              )}
              <TouchableOpacity style={styles.avatarEditBtn} onPress={handleAvatarUpload} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.gray[500]} />
                ) : (
                  <Ionicons name="camera" size={14} color={colors.gray[500]} />
                )}
              </TouchableOpacity>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.userName} numberOfLines={1}>{user?.fullName || 'User'}</Text>
              <View style={[styles.roleBadge, { backgroundColor: badgeColor.bg }]}>
                <Text style={[styles.roleText, { color: badgeColor.text }]}>{roleLabel}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Menu items */}
        <View style={styles.menuCard}>
          {filteredItems.map((item, idx) => (
            <React.Fragment key={item.screen}>
              {idx > 0 && <View style={styles.separator} />}
              <AnimatedMenuItem
                item={item}
                index={idx}
                locked={isFeatureLocked(item.featureKey)}
                onPress={() => navigation.navigate(item.screen)}
              />
            </React.Fragment>
          ))}
        </View>

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={18} color={colors.red[600]} />
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
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 56, height: 56, borderRadius: borderRadius['2xl'],
    backgroundColor: colors.primary[100],
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: {
    width: 56, height: 56, borderRadius: borderRadius['2xl'],
    borderWidth: 2, borderColor: colors.gray[100],
  },
  avatarText: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary[700] },
  avatarEditBtn: {
    position: 'absolute', bottom: -4, right: -4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.gray[200],
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOpacity: 0.08, shadowRadius: 2, elevation: 2,
  },
  userName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full, marginTop: 4 },
  roleText: { fontSize: 11, fontWeight: fontWeight.semibold },
  // Menu
  menuCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  separator: {
    height: 1,
    backgroundColor: colors.gray[50],
    marginHorizontal: spacing[4],
  },
  menuIcon: {
    width: 40, height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  menuTextWrap: { flex: 1, minWidth: 0 },
  menuLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  menuDesc: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
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
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  logoutText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
});
