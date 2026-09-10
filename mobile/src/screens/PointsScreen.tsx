/**
 * PointsScreen — раздел «Филиалы» (мульти-точки 156/160/161).
 *
 * ЗАЧЕМ ЭКРАН. Требование владельца: «если у тенанта открыты дополнительные
 * точки, то в Ещё добавляется раздел Филиалы, там список филиалов… где виден
 * оборот за день, оборот за месяц, прибыль и сколько мастеров на работе, и
 * кнопка Перейти».
 *
 * КТО ВИДИТ ЧТО:
 *   • список филиалов и «Перейти» — любой, у кого доступ больше чем к одному
 *     филиалу (в том числе мастер: он работает на двух точках и обязан уметь
 *     переключиться, иначе пробьёт заказ-наряд не туда);
 *   • деньги (оборот, прибыль, мастера на смене) — GET /points/summary под
 *     ключом `financial_reports`; прибыль внутри дополнительно закрыта
 *     `profit_view` (без права сервер отдаёт 0, поэтому строку не рисуем
 *     вовсе — ноль выглядел бы как настоящий убыток);
 *   • назначение сотрудников на точки — `user_management`, как и раньше.
 *
 * Точки заводит/архивирует ТОЛЬКО суперадмин (карточка тенанта в
 * admin-панели) — их количество и есть лимит. Этот экран тенанту точки не
 * создаёт.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { pointsApi } from '../api/services';
import { useUsers } from '../hooks/useUsers';
import { usePointAccess, useSwitchPoint, POINTS_QUERY_KEY } from '../hooks/usePoints';
import IosScreenHeader from '../components/IosScreenHeader';
import { BottomSheet } from '../components/BottomSheet';
import EmptyState from '../components/EmptyState';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface, useShadow } from '../platform/iosSurface';
import { colors, spacing, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { formatMoney } from '../../../shared/utils/formatters';
import type { TenantPoint, PointSummary, PointsSummaryResponse } from '../../../shared/types';

export default function PointsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('user_management');
  // Деньги филиалов — тот же ключ, что гейтит эндпоинт на сервере. Без права
  // запрос даже не отправляем: 403 в консоли ничего не лечит.
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');

  const { selectable, currentPointId, isLoading } = usePointAccess();
  const { switchPoint, isSwitching } = useSwitchPoint();

  const [assigningPoint, setAssigningPoint] = React.useState<TenantPoint | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  // Какую карточку сейчас открываем — чтобы спиннер крутился ровно на ней, а
  // не на всех кнопках «Перейти» сразу.
  const [enteringId, setEnteringId] = React.useState<string | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

  const summaryByPoint = React.useMemo(() => {
    const map = new Map<string, PointSummary>();
    for (const s of summaryData?.points ?? []) map.set(s.pointId, s);
    return map;
  }, [summaryData]);

  // Канонический ['users'] (см. hooks/useUsers.ts) — только активные, не
  // уволенные/не удалённые сотрудники доступны для назначения на точку.
  const { data: allUsers = [] } = useUsers();
  const employees = React.useMemo(
    () => allUsers.filter((u) => u.isActive && !u.dismissedAt && !u.purgedAt),
    [allUsers],
  );

  const openAssign = React.useCallback(
    (point: TenantPoint) => {
      if (!canManage) return;
      haptic('tap');
      setSelectedIds(point.memberIds ?? []);
      setAssigningPoint(point);
    },
    [canManage],
  );

  const toggleEmployee = React.useCallback((userId: string) => {
    haptic('select');
    setSelectedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async ({ pointId, userIds }: { pointId: string; userIds: string[] }) => {
      setSaving(true);
      await pointsApi.setMembers(pointId, userIds);
    },
    onSuccess: () => {
      haptic('success');
      setAssigningPoint(null);
      queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить назначения сотрудников');
    },
    onSettled: () => setSaving(false),
  });

  const handleSave = React.useCallback(() => {
    if (!assigningPoint) return;
    saveMutation.mutate({ pointId: assigningPoint.id, userIds: selectedIds });
  }, [assigningPoint, selectedIds, saveMutation]);

  /**
   * «Перейти» = полностью зайти в филиал. Переключение сбрасывает ВЕСЬ кеш
   * (см. useSwitchPoint), поэтому на главную мы уходим уже без чужих цифр в
   * памяти — экран покажет загрузку, а не деньги прошлого филиала.
   */
  const enterPoint = React.useCallback(
    async (point: TenantPoint) => {
      if (point.id === currentPointId || isSwitching) return;
      haptic('tap');
      setEnteringId(point.id);
      try {
        await switchPoint(point.id);
        haptic('success');
        navigation.navigate('Dashboard');
      } catch {
        haptic('error');
        Alert.alert('Ошибка', 'Не удалось перейти в филиал. Проверьте связь и попробуйте ещё раз.');
      } finally {
        setEnteringId(null);
      }
    },
    [currentPointId, isSwitching, navigation, switchPoint],
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Филиалы" subtitle="Оборот по точкам и переход" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && selectable.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        ) : selectable.length === 0 ? (
          <EmptyState
            title="Пока нет филиалов"
            description="Филиалы (точки) заводит суперадмин в панели управления."
            icon="business"
          />
        ) : (
          <View style={{ gap: spacing[3] }}>
            {selectable.map((p) => {
              const isCurrent = p.id === currentPointId;
              const summary = summaryByPoint.get(p.id);
              const busy = enteringId === p.id;
              return (
                <View
                  key={p.id}
                  style={[
                    styles.card,
                    surface.card,
                    shadow,
                    isCurrent && { borderColor: palette.accent.primary, borderWidth: 1 },
                  ]}
                >
                  <View style={styles.cardHead}>
                    <View
                      style={[
                        styles.pointIcon,
                        { backgroundColor: isCurrent ? palette.accent.primary : palette.accent.primarySoft },
                      ]}
                    >
                      <Ionicons name="business" size={18} color={isCurrent ? colors.white : palette.accent.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pointName, { color: palette.text.primary }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {p.address ? (
                        <Text style={[styles.pointAddress, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {p.address}
                        </Text>
                      ) : null}
                    </View>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: palette.accent.primarySoft }]}>
                        <Ionicons name="checkmark-circle" size={13} color={palette.accent.primary} />
                        <Text style={[styles.currentBadgeText, { color: palette.accent.primary }]}>Вы здесь</Text>
                      </View>
                    )}
                  </View>

                  {canSeeMoney && (
                    <View style={styles.metrics}>
                      {summaryLoading && !summary ? (
                        <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[3] }} />
                      ) : (
                        <>
                          <Metric label="Оборот за день" value={summary ? formatMoney(summary.revenueToday) : '—'} />
                          <Metric label="Оборот за месяц" value={summary ? formatMoney(summary.revenueMonth) : '—'} />
                          {canSeeProfit && (
                            <Metric
                              label="Прибыль за месяц"
                              value={summary ? formatMoney(summary.profitMonth) : '—'}
                              tone={
                                summary && summary.profitMonth < 0
                                  ? colors.red[600]
                                  : summary && summary.profitMonth > 0
                                    ? colors.green[600]
                                    : undefined
                              }
                            />
                          )}
                          {/* mastersOnShift === null — учёт смен у тенанта
                              ВЫКЛЮЧЕН, факта не существует. Рисуем прочерк:
                              «0» прочиталось бы как «сегодня никто не вышел»
                              и отправило бы владельца искать несуществующую
                              проблему. */}
                          <Metric
                            label="Мастеров на работе"
                            value={
                              summary && summary.mastersOnShift !== null && summary.mastersOnShift !== undefined
                                ? String(summary.mastersOnShift)
                                : '—'
                            }
                          />
                        </>
                      )}
                    </View>
                  )}

                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => void enterPoint(p)}
                      disabled={isCurrent || isSwitching}
                      style={[
                        styles.enterBtn,
                        {
                          backgroundColor: isCurrent ? palette.bg.muted : palette.accent.primary,
                          opacity: isSwitching && !busy ? 0.5 : 1,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isCurrent || isSwitching }}
                      accessibilityLabel={isCurrent ? `${p.name} — текущий филиал` : `Перейти в филиал ${p.name}`}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <>
                          <Ionicons
                            name={isCurrent ? 'checkmark' : 'enter-outline'}
                            size={16}
                            color={isCurrent ? palette.text.secondary : colors.white}
                          />
                          <Text
                            style={[styles.enterBtnText, { color: isCurrent ? palette.text.secondary : colors.white }]}
                          >
                            {isCurrent ? 'Текущий филиал' : 'Перейти'}
                          </Text>
                        </>
                      )}
                    </Pressable>

                    {canManage && (
                      <Pressable
                        onPress={() => openAssign(p)}
                        style={[styles.assignBtn, { backgroundColor: palette.bg.muted }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Сотрудники филиала ${p.name}`}
                      >
                        <Ionicons name="people-outline" size={15} color={palette.text.secondary} />
                        <Text style={[styles.assignBtnText, { color: palette.text.secondary }]}>
                          {p.memberIds?.length ?? 0}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {canManage && selectable.length > 0 && (
          <Text style={[styles.hint, { color: palette.text.tertiary }]}>
            Сотрудник без назначений может работать на любом филиале.
          </Text>
        )}
      </ScrollView>

      {/* Назначение сотрудников на точку — чекбоксы по активным сотрудникам
          тенанта, как «Кто принимает оплату» в настройках компании. */}
      <BottomSheet
        visible={!!assigningPoint}
        onClose={() => setAssigningPoint(null)}
        title={assigningPoint?.name ?? 'Филиал'}
        heightRatio={0.78}
      >
        {assigningPoint && (
          <View style={{ gap: spacing[1] }}>
            {employees.length === 0 ? (
              <Text style={[styles.emptyEmployeesText, { color: palette.text.secondary }]}>
                Нет активных сотрудников
              </Text>
            ) : (
              employees.map((u) => {
                const checked = selectedIds.includes(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => toggleEmployee(u.id)}
                    style={styles.employeeRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={u.fullName}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? palette.accent.primary : palette.text.tertiary}
                    />
                    <Text style={[styles.employeeName, { color: palette.text.primary }]} numberOfLines={1}>
                      {u.fullName}
                    </Text>
                  </Pressable>
                );
              })
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: palette.accent.primary }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                  <Text style={styles.saveBtnText}>Сохранить</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

/** Плитка одной цифры в карточке филиала. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const palette = useColors();
  return (
    <View style={[styles.metric, { backgroundColor: palette.bg.muted }]}>
      <Text style={[styles.metricLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricValue, { color: tone ?? palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[3] },
  card: { gap: spacing[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  pointIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pointName: { fontSize: 16, fontWeight: '700' },
  pointAddress: { fontSize: 12, marginTop: 2 },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  currentBadgeText: { fontSize: 11, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  metric: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    gap: 2,
  },
  metricLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  metricValue: { fontSize: 15, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  enterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  enterBtnText: { fontSize: 14, fontWeight: '700' },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  assignBtnText: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: spacing[1] },
  // Assignment sheet
  emptyEmployeesText: { fontSize: 14, textAlign: 'center', paddingVertical: spacing[6] },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
    minHeight: 44,
  },
  employeeName: { flex: 1, fontSize: 15, fontWeight: '500' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[3],
  },
  saveBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
