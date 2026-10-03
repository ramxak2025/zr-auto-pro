import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { managerApi, tenantsApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { useColors } from '../../contexts/ThemeContext';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { Text } from '../../platform/Typography';
import { useIosSurface } from '../../platform/iosSurface';
import { spacing } from '../../theme';
import { formatDateTime, useAdminMode } from './adminShared';
import { actionIcon, actionLabel } from './auditActions';

const PAGE_SIZE = 50;

/** Mounted only after an explicit entry from the selected car-service card. */
export default function AdminTenantAuditScreen() {
  const navigation = useNavigation();
  const { id, name } = useRoute<any>().params as { id: string; name: string };
  const mode = useAdminMode();
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const journal = useInfiniteQuery({
    queryKey: [mode === 'manager' ? 'manager' : 'admin', 'tenant-audit', id],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = { limit: PAGE_SIZE, offset: pageParam };
      return (mode === 'manager' ? await managerApi.tenantAuditLog(id, params) : await tenantsApi.auditLog(id, params))
        .data;
    },
    getNextPageParam: (lastPage, pages) => (lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined),
    // Never briefly show another tenant's journal when navigation/query keys change.
    placeholderData: undefined,
  });
  const rows = React.useMemo(() => {
    const unique = new Map((journal.data?.pages.flat() ?? []).map((entry) => [entry.id, entry]));
    return [...unique.values()];
  }, [journal.data]);
  // A revoked assignment must also hide already cached entries on a failed refresh.
  const denied = [403, 404].includes(
    (journal.error as { response?: { status?: number } } | null)?.response?.status ?? 0,
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Журнал действий" subtitle={name} onBack={() => navigation.goBack()} />
      <FlatList
        data={denied ? [] : rows}
        keyExtractor={(entry) => entry.id}
        contentInset={contentInset}
        contentContainerStyle={[styles.list, { paddingBottom: contentContainerPaddingBottom }]}
        refreshing={journal.isRefetching && !journal.isFetchingNextPage}
        onRefresh={() => {
          void journal.refetch();
        }}
        renderItem={({ item }) => (
          <View style={[styles.entry, surface.card]}>
            <Ionicons name={actionIcon(item.action)} size={20} color={palette.accent.primary} />
            <View style={styles.body}>
              <Text style={[styles.action, { color: palette.text.primary }]}>{actionLabel(item.action)}</Text>
              {item.targetName ? <Text style={{ color: palette.text.secondary }}>{item.targetName}</Text> : null}
              <Text style={[styles.meta, { color: palette.text.tertiary }]}>
                {item.actorName ?? 'Система'} · {formatDateTime(item.createdAt)}
              </Text>
            </View>
          </View>
        )}
        ListHeaderComponent={
          journal.isError ? (
            <View style={[styles.state, surface.card]}>
              <Text style={[styles.message, { color: palette.text.secondary }]}>
                {denied ? 'Автосервис недоступен для этой учётной записи.' : 'Не удалось обновить журнал.'}
              </Text>
              {!denied && (
                <Pressable
                  style={styles.button}
                  onPress={() => {
                    void journal.refetch();
                  }}
                >
                  <Text style={{ color: palette.accent.primary }}>Повторить</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          !journal.isError ? (
            <View style={styles.state}>
              {journal.isPending ? (
                <ActivityIndicator color={palette.accent.primary} />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={36} color={palette.text.tertiary} />
                  <Text style={[styles.message, { color: palette.text.secondary }]}>
                    У этого автосервиса пока нет записей.
                  </Text>
                </>
              )}
            </View>
          ) : null
        }
        ListFooterComponent={
          !denied && journal.hasNextPage ? (
            <Pressable
              style={styles.button}
              disabled={journal.isFetchingNextPage}
              onPress={() => {
                void journal.fetchNextPage();
              }}
            >
              {journal.isFetchingNextPage ? (
                <ActivityIndicator color={palette.accent.primary} />
              ) : (
                <Text style={{ color: palette.accent.primary }}>Показать ещё</Text>
              )}
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { paddingHorizontal: spacing[4], gap: spacing[3] },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], padding: spacing[4] },
  body: { flex: 1, minWidth: 0, gap: spacing[1] },
  action: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12 },
  state: { alignItems: 'center', padding: spacing[6], gap: spacing[3] },
  message: { textAlign: 'center' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: spacing[3] },
});
