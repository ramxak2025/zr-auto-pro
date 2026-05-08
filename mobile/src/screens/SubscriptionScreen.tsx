import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { subscriptionApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { SubscriptionInfo, Plan } from '../../../shared/types';

const WHATSAPP_PHONE = '79884444436';

const ALL_FEATURES: { key: string; label: string }[] = [
  { key: 'checks_view', label: 'Заказ-наряды' },
  { key: 'clients_view', label: 'Клиенты и авто' },
  { key: 'warehouse_view', label: 'Склад' },
  { key: 'services_view', label: 'Услуги' },
  { key: 'suppliers_view', label: 'Поставщики' },
  { key: 'cashflow_view', label: 'Движение денег' },
  { key: 'salary_view', label: 'Зарплата' },
  { key: 'schedule_view', label: 'Расписание' },
  { key: 'reports_view', label: 'Отчёты' },
  { key: 'users_manage', label: 'Управление пользователями' },
  { key: 'export_data', label: 'Экспорт данных' },
];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function SubscriptionScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: sub, isLoading } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['subscription'] });
    setRefreshing(false);
  };

  const isExpired = sub?.subscriptionEnd ? new Date(sub.subscriptionEnd) < new Date() : false;

  const openWhatsApp = () => {
    const msg = encodeURIComponent('Здравствуйте! Хочу оплатить подписку.');
    Linking.openURL(`https://wa.me/${WHATSAPP_PHONE}?text=${msg}`);
  };

  const openWhatsAppForPlan = (planName: string) => {
    const msg = encodeURIComponent(`Здравствуйте! Хочу подключить тариф "${planName}".`);
    Linking.openURL(`https://wa.me/${WHATSAPP_PHONE}?text=${msg}`);
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <View style={styles.safe}>
      <IosScreenHeader title="Подписка" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* Current plan info */}
        <AnimatedCard index={0}>
          <View style={styles.card}>
            <View style={styles.planHeader}>
              <View style={styles.planIconWrap}>
                <Ionicons name="card-outline" size={24} color={colors.primary[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.planOrgName}>{sub?.tenantName || 'Организация'}</Text>
                <Text style={styles.planName}>Тариф: {sub?.planName || 'Не назначен'}</Text>
              </View>
            </View>

            {/* End date & price */}
            <View style={styles.infoGrid}>
              <View style={styles.infoBlock}>
                <Ionicons name="calendar-outline" size={18} color={colors.gray[400]} />
                <View>
                  <Text style={styles.infoLabel}>Оплачено до</Text>
                  {sub?.subscriptionEnd ? (
                    <Text style={[styles.infoValue, isExpired && { color: colors.red[600] }]}>
                      {formatDate(sub.subscriptionEnd)}
                      {isExpired ? '  (истекла)' : ''}
                    </Text>
                  ) : (
                    <Text style={[styles.infoValue, { color: colors.gray[400] }]}>Не указано</Text>
                  )}
                </View>
              </View>

              <View style={styles.infoBlock}>
                <Ionicons name="card-outline" size={18} color={colors.gray[400]} />
                <View>
                  <Text style={styles.infoLabel}>Стоимость</Text>
                  <Text style={styles.infoValue}>
                    {sub?.monthlyPrice ? `${sub.monthlyPrice.toLocaleString('ru-RU')} ₽/мес` : 'Не указано'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Users */}
            {sub && (
              <View style={styles.usersRow}>
                <View style={styles.usersLeft}>
                  <Ionicons name="people-outline" size={16} color={colors.gray[400]} />
                  <Text style={styles.usersLabel}>Сотрудников</Text>
                </View>
                <Text style={styles.usersValue}>
                  {sub.currentUsers} / {sub.maxUsers}
                </Text>
              </View>
            )}

            {/* Note */}
            {sub?.subscriptionNote && (
              <View style={styles.noteBlock}>
                <Ionicons name="information-circle-outline" size={18} color={colors.blue[500]} />
                <Text style={styles.noteText}>{sub.subscriptionNote}</Text>
              </View>
            )}

            {/* WhatsApp button */}
            <TouchableOpacity style={styles.whatsappBtn} onPress={openWhatsApp} activeOpacity={0.8}>
              <Ionicons name="logo-whatsapp" size={20} color={colors.white} />
              <Text style={styles.whatsappText}>Связаться для оплаты</Text>
            </TouchableOpacity>
          </View>
        </AnimatedCard>

        {/* Available plans */}
        {sub?.plans && sub.plans.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Доступные тарифы</Text>
            {sub.plans.map((plan, idx) => {
              const isCurrent = sub.planName === plan.name;
              const features: string[] = Array.isArray(plan.features) ? plan.features : [];
              return (
                <AnimatedCard key={plan.id} index={idx + 1}>
                  <View style={[styles.planCard, isCurrent && styles.planCardCurrent]}>
                    {isCurrent && (
                      <LinearGradient colors={[colors.primary[500], colors.primary[600]]} style={styles.currentBanner}>
                        <Text style={styles.currentBannerText}>Ваш тариф</Text>
                      </LinearGradient>
                    )}

                    <View style={styles.planCardBody}>
                      <Text style={styles.planCardName}>{plan.name}</Text>
                      {plan.description && <Text style={styles.planCardDesc}>{plan.description}</Text>}

                      <View style={styles.priceRow}>
                        <Text style={styles.priceValue}>{plan.monthlyPrice.toLocaleString('ru-RU')}</Text>
                        <Text style={styles.priceSuffix}> ₽/мес</Text>
                      </View>

                      <View style={styles.maxUsersRow}>
                        <Ionicons name="people" size={16} color={colors.primary[600]} />
                        <Text style={styles.maxUsersText}>До {plan.maxUsers} сотрудников</Text>
                      </View>

                      {/* Features list */}
                      <View style={styles.featuresList}>
                        {ALL_FEATURES.map((feat) => {
                          const included = features.includes(feat.key);
                          return (
                            <View key={feat.key} style={styles.featureRow}>
                              <Ionicons
                                name={included ? 'checkmark-circle' : 'close-circle'}
                                size={18}
                                color={included ? colors.green[500] : colors.gray[300]}
                              />
                              <Text style={[styles.featureText, !included && styles.featureTextDisabled]}>
                                {feat.label}
                              </Text>
                            </View>
                          );
                        })}
                      </View>

                      {!isCurrent && (
                        <TouchableOpacity style={styles.connectBtn} onPress={() => openWhatsAppForPlan(plan.name)}>
                          <Ionicons name="logo-whatsapp" size={16} color={colors.white} />
                          <Text style={styles.connectBtnText}>Подключить</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </AnimatedCard>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
  // Main card
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[5],
    gap: spacing[4],
  },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  planIconWrap: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  planOrgName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  planName: { fontSize: fontSize.sm, color: colors.gray[500], marginTop: 2 },
  // Info grid
  infoGrid: { gap: spacing[3] },
  infoBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    backgroundColor: colors.gray[50],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  infoLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  infoValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900], marginTop: 2 },
  // Users
  usersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  usersLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  usersLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  usersValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Note
  noteBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.blue[50],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  noteText: { fontSize: fontSize.sm, color: colors.blue[600], flex: 1 },
  // WhatsApp
  whatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: '#25D366',
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  whatsappText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  // Section
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Plan cards
  planCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
  },
  planCardCurrent: { borderColor: colors.primary[500], borderWidth: 2 },
  currentBanner: { paddingVertical: spacing[1.5], alignItems: 'center' },
  currentBannerText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.white },
  planCardBody: { padding: spacing[5], gap: spacing[3] },
  planCardName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  planCardDesc: { fontSize: fontSize.sm, color: colors.gray[500] },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  priceValue: { fontSize: 32, fontWeight: fontWeight.bold, color: colors.gray[900] },
  priceSuffix: { fontSize: fontSize.sm, color: colors.gray[500] },
  maxUsersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[50],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
  },
  maxUsersText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[700] },
  // Features
  featuresList: { gap: spacing[1.5] },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  featureText: { fontSize: fontSize.sm, color: colors.gray[700] },
  featureTextDisabled: { color: colors.gray[400], textDecorationLine: 'line-through' },
  // Connect
  connectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    marginTop: spacing[1],
  },
  connectBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
});
