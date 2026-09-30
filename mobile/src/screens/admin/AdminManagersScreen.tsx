/**
 * AdminManagersScreen — менеджеры платформы (только суперадмин, «Ещё» → «Менеджеры»).
 *
 * Список с балансами: сверху те, кто должен больше всех (красным), отключённые — внизу.
 * «+» заводит менеджера (имя, телефон, пароль, доля владельца); строка ведёт в кабинет
 * менеджера (`AdminManagerDetail`): клиенты, расчёты, правка.
 * Данные — ключ ['admin-managers', 'list'], в persistent cache не попадает.
 */
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { adminManagersApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { formatPhone } from '../../../../shared/validation/phone';
import type { PlatformManager } from '../../../../shared/types';
import { InitialAvatar, StatusChip, balanceCaption, balanceColor, inactiveStatusInfo, pluralRu } from './adminShared';
import ManagerFormSheet from './ManagerFormSheet';

/** Активные выше отключённых; внутри — по убыванию долга, затем по имени. */
function sortManagers(list: PlatformManager[]): PlatformManager[] {
  return [...list].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    if (Math.abs(a.balance - b.balance) >= 0.005) return b.balance - a.balance;
    return a.fullName.localeCompare(b.fullName, 'ru');
  });
}

const keyExtractor = (m: PlatformManager) => m.id;

const ManagerRow = React.memo(function ManagerRow({
  manager,
  palette,
  surfaceCard,
  onPress,
}: {
  manager: PlatformManager;
  palette: SemanticPalette;
  surfaceCard: object;
  onPress: (id: string) => void;
}) {
  const clients = `${manager.tenantsCount} ${pluralRu(manager.tenantsCount, 'клиент', 'клиента', 'клиентов')}`;
  return (
    <Pressable onPress={() => onPress(manager.id)} style={[styles.row, surfaceCard]}>
      <InitialAvatar name={manager.fullName} palette={palette} />
      <View style={styles.rowBody}>
        <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
          {manager.fullName}
        </Text>
        <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {formatPhone(manager.phone)}
        </Text>
        <Text style={[styles.meta, { color: palette.text.secondary }]} numberOfLines={1}>
          {clients} · {manager.activeTenantsCount} активных
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.balance, { color: balanceColor(manager.balance, palette) }]} numberOfLines={1}>
          {balanceCaption(manager.balance)}
        </Text>
        {manager.isActive ? null : <StatusChip status={inactiveStatusInfo(palette.mode)} />}
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </Pressable>
  );
});

export default function AdminManagersScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery<PlatformManager[]>({
    queryKey: ['admin-managers', 'list'],
    queryFn: async () => (await adminManagersApi.list()).data,
    placeholderData: (prev) => prev,
  });

  const managers = React.useMemo(() => sortManagers(data ?? []), [data]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const openManager = React.useCallback(
    (id: string) => {
      haptic('tap');
      navigation.navigate('AdminManagerDetail', { id });
    },
    [navigation],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: PlatformManager }) => (
      <ManagerRow manager={item} palette={palette} surfaceCard={surface.card} onPress={openManager} />
    ),
    [palette, surface.card, openManager],
  );

  const failed = isError && managers.length === 0;

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Менеджеры"
        subtitle={`${managers.length} ${pluralRu(managers.length, 'менеджер', 'менеджера', 'менеджеров')}`}
        onBack={() => navigation.goBack()}
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setCreateOpen(true);
            }}
            style={[styles.headerAdd, { backgroundColor: palette.accent.primary }]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Новый менеджер"
          >
            <Ionicons name="add" size={22} color={colors.white} />
          </Pressable>
        }
      />

      <FlatList
        data={managers}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentInset={contentInset}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            {isLoading ? (
              <ActivityIndicator color={palette.accent.primary} />
            ) : (
              <>
                <Ionicons
                  name={failed ? 'cloud-offline-outline' : 'people-outline'}
                  size={40}
                  color={palette.text.tertiary}
                />
                <Text style={[styles.emptyText, { color: palette.text.secondary }]}>
                  {failed
                    ? 'Не удалось загрузить менеджеров'
                    : 'Менеджеров пока нет. Нажмите «+», чтобы завести первого.'}
                </Text>
                {failed ? (
                  <Pressable
                    onPress={() => {
                      haptic('tap');
                      void refetch();
                    }}
                    hitSlop={8}
                  >
                    <Text style={[styles.retryText, { color: palette.accent.primary }]}>Повторить</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        }
      />

      <ManagerFormSheet visible={createOpen} manager={null} onClose={() => setCreateOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerAdd: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[2.5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  rowBody: { flex: 1, minWidth: 0 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  balance: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[16], gap: spacing[2] },
  emptyText: { fontSize: 14, textAlign: 'center' },
  retryText: { fontSize: 15, fontWeight: '600' },
});
