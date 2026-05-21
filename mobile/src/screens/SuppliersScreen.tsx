import React, { useCallback, useState } from 'react';
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
import { Swipeable } from 'react-native-gesture-handler';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole, type Supplier } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── SupplierRow ────────────────────────────────────────────────────────
// Module-scope React.memo'd row + Swipeable wrapper. Identity is stable
// across parent re-renders, so each keystroke in the search box (which
// rebuilds the SuppliersScreen) doesn't tear down + rebuild every row.
//
// Memo works because the props are primitive + stable callbacks via
// useCallback in the parent (onPress / onEdit / onDelete). Swipeable
// retains its native handler across renders thanks to that stability.
interface SupplierRowProps {
  item: Supplier;
  index: number;
  canDelete: boolean;
  onPress: (id: string) => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
}
const SupplierRow = React.memo(function SupplierRow({
  item,
  index,
  canDelete,
  onPress,
  onEdit,
  onDelete,
}: SupplierRowProps) {
  const hasDebt = item.currentDebt > 0;

  const card = (
    <AnimatedCard style={styles.card} index={index} onPress={() => onPress(item.id)}>
      <View style={styles.row}>
        <View style={[styles.iconCircle, hasDebt ? styles.iconCircleDebt : styles.iconCircleClean]}>
          <Ionicons
            name={hasDebt ? 'wallet-outline' : 'business-outline'}
            size={18}
            color={hasDebt ? colors.orange[600] : colors.gray[400]}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {[item.contactPerson, item.phone ? formatPhone(item.phone) : null].filter(Boolean).join(' · ') ||
              'Без контактов'}
          </Text>
        </View>
        <View style={styles.amountWrap}>
          {hasDebt ? (
            <>
              <Text style={styles.debtAmount}>{formatMoney(item.currentDebt)}</Text>
              <Text style={styles.debtLabel}>долг</Text>
            </>
          ) : (
            <Ionicons name="checkmark-circle" size={20} color={colors.green[500]} />
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} style={{ marginLeft: 6 }} />
      </View>
    </AnimatedCard>
  );

  if (!canDelete) return card;

  return (
    <Swipeable
      renderRightActions={() => (
        /* Two trailing actions, iOS-style: Edit (primary blue, pencil)
           then Delete (destructive red, trash). Tap on Edit opens
           the same edit modal as a regular row tap; tap on Delete
           goes through ConfirmDialog → optimistic delete. */
        <View style={styles.swipeActionsRow}>
          <TouchableOpacity style={styles.swipeEditAction} onPress={() => onEdit(item)} activeOpacity={0.85}>
            <Ionicons name="pencil" size={20} color={colors.white} />
            <Text style={styles.swipeEditText}>Изменить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.swipeDeleteAction} onPress={() => onDelete(item)} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={20} color={colors.white} />
            <Text style={styles.swipeDeleteText}>Удалить</Text>
          </TouchableOpacity>
        </View>
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
  );
});

export default function SuppliersScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Permission gate for the destructive swipe-delete. Owner-class roles
  // see it unconditionally; otherwise we require `suppliers_access`
  // (the only suppliers-related permission key in UserPermissions).
  const canDelete = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('suppliers_access');

  // Confirm dialog state — driven by row swipe.
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [comment, setComment] = useState('');

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const res = await suppliersApi.getAll({ search });
      return res.data?.data || res.data;
    },
    // SWR: when `search` mutates the key, keep the previous results
    // visible until the new ones arrive. No empty flash mid-typing.
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  // Optimistic delete — cache snapshot, eager local removal, rollback on
  // error. The backend already exposes DELETE /suppliers/:id; we never
  // touch the API contract, only the JS-side cache shape.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.remove(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['suppliers'] });
      const prev = queryClient.getQueriesData<Supplier[]>({ queryKey: ['suppliers'] });
      queryClient.setQueriesData<Supplier[] | undefined>({ queryKey: ['suppliers'] }, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      ctx?.prev.forEach(([key, val]) => queryClient.setQueryData(key, val));
      Alert.alert('Не удалось удалить', 'Поставщик может быть связан с поставками или долгами.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const openCreate = useCallback(() => {
    setEditingSupplier(null);
    setName('');
    setPhone('');
    setContactPerson('');
    setComment('');
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((s: Supplier) => {
    setEditingSupplier(s);
    setName(s.name);
    setPhone(s.phone ? formatPhone(s.phone) : '');
    setContactPerson(s.contactPerson || '');
    setComment(s.comment || '');
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = () => {
    const payload = {
      name,
      phone: phone || undefined,
      contactPerson: contactPerson || undefined,
      comment: comment || undefined,
    };
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    setRefreshing(false);
  };

  // Stable handlers passed to memoised SupplierRow — without useCallback
  // every search-input keystroke would change the function identity and
  // bust React.memo's shallow prop comparison for every row in the list.
  const handlePressSupplier = useCallback(
    (id: string) => navigation.navigate('SupplierDetail', { id }),
    [navigation],
  );
  const handleDeleteSupplier = useCallback((s: Supplier) => setPendingDelete(s), []);

  const renderSupplier = useCallback(
    ({ item, index }: { item: Supplier; index: number }) => (
      <SupplierRow
        item={item}
        index={index}
        canDelete={canDelete}
        onPress={handlePressSupplier}
        onEdit={openEdit}
        onDelete={handleDeleteSupplier}
      />
    ),
    [canDelete, handlePressSupplier, openEdit, handleDeleteSupplier],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Поставщики"
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
            <Text style={styles.addBtnText}>+ Новый</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск поставщика..." />
      </View>

      {suppliers === undefined ? (
        // Cold-start guard — show skeleton, never EmptyState while
        // data is genuinely unknown. Once any response (even cached)
        // lands, EmptyState becomes legitimate again.
        <ListSkeleton count={6} />
      ) : !suppliers.length && !isLoading ? (
        <EmptyState
          title="Нет поставщиков"
          description="Добавьте первого поставщика"
          action={{ label: 'Добавить', onPress: openCreate }}
        />
      ) : (
        <FlashList
          data={suppliers}
          keyExtractor={(i) => i.id}
          renderItem={renderSupplier}
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}

      <Modal visible={modalOpen} onClose={closeModal} title={editingSupplier ? 'Редактировать' : 'Новый поставщик'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Название</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.formInput}
            placeholder="ООО Запчасти"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Телефон</Text>
          {/* Phone mask shared with LoginScreen / ClientsScreen — user types
              digits, formatPhone re-formats to +7 (XXX) XXX-XX-XX live. */}
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t.replace(/\D/g, '')))}
            style={styles.formInput}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+7 (___) ___-__-__"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Контактное лицо</Text>
          <TextInput
            value={contactPerson}
            onChangeText={setContactPerson}
            style={styles.formInput}
            placeholder="Имя"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending || updateMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingSupplier ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Удалить поставщика?"
        message={pendingDelete ? `«${pendingDelete.name}» будет удалён. Это действие нельзя отменить.` : ''}
        confirmText="Удалить"
        variant="danger"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
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
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  // iOS-grouped plain list — same look as warehouse rows.
  list: { paddingHorizontal: 0, paddingBottom: 120, paddingTop: 0 },
  card: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  iconCircleClean: { backgroundColor: colors.gray[100] },
  iconCircleDebt: { backgroundColor: colors.orange[50] },
  info: { flex: 1, minWidth: 0 },
  swipeActionsRow: {
    flexDirection: 'row',
  },
  swipeEditAction: {
    backgroundColor: colors.primary[600],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeEditText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  swipeDeleteAction: {
    backgroundColor: colors.red[500],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  cardName: { fontSize: 15, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.1 },
  cardSub: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  amountWrap: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 70 },
  debtAmount: { fontSize: 15, fontWeight: '700', color: colors.orange[700], letterSpacing: -0.3 },
  debtLabel: { fontSize: 10, color: colors.gray[400], marginTop: -1 },
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
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
