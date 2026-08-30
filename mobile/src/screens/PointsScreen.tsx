/**
 * PointsScreen — мульти-точки (156): список живых точек тенанта + назначение
 * сотрудников на каждую.
 *
 * Точки заводит/архивирует ТОЛЬКО суперадмин (карточка тенанта в
 * admin-панели, см. AdminTenantDetailScreen) — их количество и есть лимит.
 * Этот экран — тенант-сторона: только назначение, КТО из сотрудников
 * работает на какой точке (`PUT /points/:id/members`, гейт user_management
 * на сервере). Сотрудник без назначений на любую точку не ограничен —
 * работает где угодно (см. shared/types TenantPoint).
 *
 * Видимость входа — в MoreScreen (строка «Точки» показывается только когда
 * live-точек > 1 И есть право user_management); сам экран дополнительно
 * держит `canManage`, чтобы прямой deep-link не открывал шторку назначения
 * тому, кому сервер её всё равно не даст сохранить.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { pointsApi } from '../api/services';
import { useUsers } from '../hooks/useUsers';
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
import type { TenantPoint, PointsListResponse } from '../../../shared/types';

export default function PointsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('user_management');

  const [assigningPoint, setAssigningPoint] = React.useState<TenantPoint | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  const { data, isLoading } = useQuery<PointsListResponse>({
    queryKey: ['points'],
    queryFn: async () => (await pointsApi.list()).data,
  });
  const points = data?.points ?? [];

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
      queryClient.invalidateQueries({ queryKey: ['points'] });
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

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Точки" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        ) : points.length === 0 ? (
          <EmptyState
            title="Пока нет точек"
            description="Точки (филиалы) заводит суперадмин в панели управления."
            icon="business"
          />
        ) : (
          <View style={{ gap: spacing[2.5] }}>
            {points.map((p) => {
              const count = p.memberIds?.length ?? 0;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => openAssign(p)}
                  disabled={!canManage}
                  style={[styles.pointRow, surface.card, shadow]}
                >
                  <View style={[styles.pointIcon, { backgroundColor: palette.accent.primarySoft }]}>
                    <Ionicons name="location" size={18} color={palette.accent.primary} />
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
                  <View style={[styles.countBadge, { backgroundColor: palette.bg.muted }]}>
                    <Ionicons name="people-outline" size={13} color={palette.text.secondary} />
                    <Text style={[styles.countBadgeText, { color: palette.text.secondary }]}>{count}</Text>
                  </View>
                  {canManage && <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />}
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={[styles.hint, { color: palette.text.tertiary }]}>
          Сотрудник без назначений может работать на любой точке.
        </Text>
      </ScrollView>

      {/* Назначение сотрудников на точку — чекбоксы по активным сотрудникам
          тенанта, как «Кто принимает оплату» в настройках компании. */}
      <BottomSheet
        visible={!!assigningPoint}
        onClose={() => setAssigningPoint(null)}
        title={assigningPoint?.name ?? 'Точка'}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  pointIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pointName: { fontSize: 15, fontWeight: '700' },
  pointAddress: { fontSize: 12, marginTop: 2 },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  countBadgeText: { fontSize: 12, fontWeight: '700' },
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
