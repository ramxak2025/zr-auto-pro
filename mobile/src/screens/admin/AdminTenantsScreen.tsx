/**
 * AdminTenantsScreen — searchable tenant directory for the superadmin.
 *
 * Status chips (Все / Активные / Истёкшие) filter the list; tapping a row
 * pushes AdminTenantDetailScreen onto the tab's native-stack (Apple-Mail
 * pattern — the admin bar stays visible).
 */
import React from 'react';
import { View, StyleSheet, TextInput, Pressable, ScrollView, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { tenantsApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Tenant } from '../../../../shared/types';
import { formatMoney, isExpired, tenantStatus, StatusChip, InitialAvatar } from './adminShared';

type FilterKey = 'all' | 'active' | 'expired';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'active', label: 'Активные' },
  { key: 'expired', label: 'Истёкшие' },
];

export default function AdminTenantsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<FilterKey>('all');

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await tenantsApi.getAll()).data,
  });

  const filtered = React.useMemo(() => {
    let list = tenants;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.phone?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q),
      );
    }
    if (filter === 'active') list = list.filter((t) => t.isActive && !isExpired(t.subscriptionEnd));
    else if (filter === 'expired') list = list.filter((t) => isExpired(t.subscriptionEnd) || !t.isActive);
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tenants, search, filter]);

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Тенанты" subtitle={`${tenants.length} организаций`} />

      <View style={styles.controls}>
        {/* Search */}
        <View style={[styles.searchRow, surface.cardCompact]}>
          <Ionicons name="search-outline" size={18} color={palette.text.tertiary} />
          <TextInput
            style={[styles.searchInput, { color: palette.text.primary }]}
            placeholder="Поиск по названию, телефону…"
            placeholderTextColor={palette.text.tertiary}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
            </Pressable>
          )}
        </View>

        {/* Status filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  haptic('select');
                  setFilter(f.key);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? palette.accent.primary : palette.bg.card,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#fff' : palette.text.secondary }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(t) => t.id}
        contentInset={contentInset}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyBlock}>
            <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Ничего не найдено</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              haptic('tap');
              navigation.navigate('AdminTenantDetail', { id: item.id });
            }}
            style={[styles.row, surface.card]}
          >
            <InitialAvatar name={item.name} palette={palette} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
                {item.plan?.name || 'Без тарифа'} · {formatMoney(item.monthlyPrice)}/мес ·{' '}
                {item.userCount ?? item.users?.length ?? 0} польз.
              </Text>
            </View>
            <StatusChip status={tenantStatus(item)} />
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: { paddingHorizontal: spacing[4], gap: spacing[2.5], paddingBottom: spacing[2] },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: spacing[2.5] },
  chipsScroll: { flexGrow: 0 },
  chipsRow: { gap: spacing[2], paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[2.5] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[16], gap: spacing[2] },
  emptyText: { fontSize: 14 },
});
