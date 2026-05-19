import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { servicesApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Service, PaginatedResponse } from '../../../shared/types';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

export default function ServicesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, page, limit }],
    queryFn: async () => {
      const res = await servicesApi.getAll({ search, page, limit });
      return res.data;
    },
    // Per-screen SWR — keep previous page while search/pagination
    // mutates the key, so the breadcrumb folder view never falls
    // back to a skeleton between transitions.
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => servicesApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => servicesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении'),
  });

  const openCreate = () => {
    setEditingService(null);
    setName('');
    setCategory('');
    setDefaultPrice('');
    setModalOpen(true);
  };

  const openEdit = (s: Service) => {
    setEditingService(s);
    setName(s.name);
    setCategory(s.category || '');
    setDefaultPrice(String(s.defaultPrice));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingService(null);
  };

  const handleSubmit = () => {
    const payload = { name, category: category || undefined, defaultPrice: Number(defaultPrice) || 0 };
    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['services'] });
    setRefreshing(false);
  };

  const services = data?.data || [];
  const total = data?.total || 0;
  const hasMore = page * limit < total;

  // Folder navigation built from category strings ("Двигатель/Замена масла").
  // Same approach as warehouse: split category on '/', walk path, show
  // child folders + leaf services. activePath = current breadcrumb segments.
  const [activePath, setActivePath] = useState<string[]>([]);

  const { folders, currentServices } = React.useMemo<{
    folders: [string, number][];
    currentServices: Service[];
  }>(() => {
    if (search) {
      return { folders: [] as [string, number][], currentServices: services };
    }
    const folderSet = new Map<string, number>();
    const leafs: Service[] = [];
    for (const s of services) {
      const cat = s.category || '';
      const parts = cat ? cat.split('/').filter(Boolean) : [];
      const matchesPath = activePath.every((seg, i) => parts[i] === seg);
      if (!matchesPath && activePath.length > 0) continue;
      if (parts.length > activePath.length) {
        const folderName = parts[activePath.length];
        folderSet.set(folderName, (folderSet.get(folderName) || 0) + 1);
      } else if (parts.length === activePath.length) {
        leafs.push(s);
      }
    }
    if (activePath.length === 0) {
      for (const s of services) {
        if (!s.category && !leafs.includes(s)) leafs.push(s);
      }
    }
    return {
      folders: Array.from(folderSet.entries()).sort((a, b) => a[0].localeCompare(b[0])),
      currentServices: leafs,
    };
  }, [services, activePath, search]);

  const renderService = ({ item, index }: { item: Service; index: number }) => (
    <AnimatedCard style={styles.serviceCard} index={index} onPress={() => openEdit(item)}>
      <View style={styles.serviceRow}>
        <View style={styles.serviceIconCircle}>
          <Ionicons name="construct-outline" size={16} color={colors.primary[500]} />
        </View>
        <View style={styles.serviceInfo}>
          <Text style={styles.serviceName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.category && (
            <Text style={styles.serviceCategory} numberOfLines={1}>
              {item.category.split('/').pop()}
            </Text>
          )}
        </View>
        <Text style={styles.servicePrice}>{formatMoney(item.defaultPrice)}</Text>
      </View>
    </AnimatedCard>
  );

  return (
    <View style={styles.safe}>
      <IosScreenHeader
        title="Услуги"
        subtitle={total > 0 ? `Услуг: ${total}` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
            <Text style={styles.addBtnText}>+ Новая</Text>
          </TouchableOpacity>
        }
      />

      {/* Breadcrumbs — appear when navigating folders */}
      {!search && activePath.length > 0 && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setActivePath([])} style={styles.breadcrumbItem}>
            <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.breadcrumbText}>Все</Text>
          </TouchableOpacity>
          {activePath.map((seg, i) => (
            <React.Fragment key={i}>
              <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
              <TouchableOpacity
                onPress={() => setActivePath((prev) => prev.slice(0, i + 1))}
                style={styles.breadcrumbItem}
              >
                <Text
                  style={[
                    styles.breadcrumbText,
                    i === activePath.length - 1 && { color: colors.gray[900], fontWeight: '700' },
                  ]}
                >
                  {seg}
                </Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </View>
      )}

      <View style={styles.searchWrap}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
            setActivePath([]);
          }}
          placeholder="Поиск услуги..."
        />
      </View>

      {data === undefined ? (
        // Cold-start: skeleton until ANY data (cached or freshly
        // fetched) lands. After that, SWR keeps the list visible
        // across filter mutations.
        <ListSkeleton count={8} />
      ) : !search && folders.length === 0 && currentServices.length === 0 && !isLoading ? (
        <EmptyState
          title="Нет услуг"
          description="Добавьте первую услугу"
          action={{ label: 'Добавить', onPress: openCreate }}
        />
      ) : (
        <FlashList
          data={currentServices}
          keyExtractor={(item) => item.id}
          renderItem={renderService}
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          onEndReached={() => {
            if (hasMore) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            !search && folders.length > 0 ? (
              <View style={styles.foldersList}>
                {folders.map(([folderName, count]) => (
                  <TouchableOpacity
                    key={folderName}
                    style={styles.folderRow}
                    onPress={() => setActivePath((prev) => [...prev, folderName])}
                    activeOpacity={0.6}
                  >
                    <View style={styles.folderIconBox}>
                      <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
                    </View>
                    <View style={styles.folderInfo}>
                      <Text style={styles.folderName} numberOfLines={1}>
                        {folderName}
                      </Text>
                      <Text style={styles.folderCount}>
                        {count} {count === 1 ? 'услуга' : count < 5 ? 'услуги' : 'услуг'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
        />
      )}

      <Modal visible={modalOpen} onClose={closeModal} title={editingService ? 'Редактировать услугу' : 'Новая услуга'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Название</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.formInput}
            placeholder="Замена масла..."
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Категория</Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            style={styles.formInput}
            placeholder="ТО, кузов..."
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Цена по умолчанию</Text>
          <TextInput
            value={defaultPrice}
            onChangeText={setDefaultPrice}
            style={styles.formInput}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          {editingService && (
            <TouchableOpacity
              style={styles.deleteFormBtn}
              onPress={() => {
                setDeleteId(editingService.id);
                closeModal();
              }}
            >
              <Text style={styles.deleteFormBtnText}>Удалить</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending || updateMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingService ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить услугу"
        message="Вы уверены?"
        confirmText="Удалить"
        variant="danger"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  countBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  countBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[600] },
  addBtn: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  // iOS plain-list style (matches warehouse).
  list: { paddingHorizontal: 0, paddingBottom: 120, paddingTop: 0 },
  serviceCard: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  serviceIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceInfo: { flex: 1, minWidth: 0 },
  serviceName: { fontSize: 15, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.1 },
  serviceCategory: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  servicePrice: { fontSize: 14, fontWeight: '700', color: colors.primary[700], letterSpacing: -0.2 },
  // Folder rows
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    gap: spacing[1],
    flexWrap: 'wrap',
  },
  breadcrumbItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: spacing[1],
  },
  breadcrumbText: { fontSize: 13, color: colors.primary[600], fontWeight: '500' },
  foldersList: { backgroundColor: colors.white, marginBottom: spacing[2] },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  folderIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderInfo: { flex: 1 },
  folderName: { fontSize: 15, fontWeight: '600', color: colors.gray[900] },
  folderCount: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deleteFormBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[50],
  },
  deleteFormBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
