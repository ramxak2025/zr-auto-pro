/**
 * PurchaseOrderDetailScreen — карточка заказа поставщику.
 *
 * Шапка: поставщик, статус, итог, даты (создан / заказан / получен), автор,
 * комментарий. Позиции: заказано vs получено по каждой строке. Действия по
 * статусу (только write-роль director/admin/superadmin; сервер дублирует):
 *   • draft   — «Оформить заказ» (order) / «Изменить» / «Отменить» (cancel)
 *   • ordered — «Принять поставку» (→ SupplyReceiveScreen: цена за строку,
 *     стоимость накладной, выбор «в долг / оплатить сразу») / «Изменить»
 *     (backend разрешает правку на ordered) / «Отменить»
 *   • received / cancelled — только чтение.
 *
 * Приёмка вынесена на отдельный экран SupplyReceiveScreen (поставка ↔ заказ ↔
 * долг ↔ платёж, миграция 098). Он инвалидирует ['products'] /
 * ['stock-movements'] / ['supplier-*'] и кладёт обновлённый заказ в
 * ['purchase-order', id] — эта карточка освежается по возвращении.
 *
 * Мгновенная отрисовка шапки: route.params.po (из строки списка) идёт в
 * placeholderData, пока getById дотягивает позиции.
 *
 * Android-safe: ScrollView + навигация на экран приёмки, без iOS-only API.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { ListSkeleton } from '../components/Skeleton';
import QueryErrorState from '../components/QueryErrorState';
import SupplierRequestSheet from './purchaseOrders/SupplierRequestSheet';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { purchaseOrdersApi, suppliersApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole, type PurchaseOrder, type Supplier } from '../../../shared/types';
import { PO_STATUS_META, formatMoney, formatPoDate, outstandingQty } from './purchaseOrders/purchaseOrderHelpers';

export default function PurchaseOrderDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const canWrite = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const id: string = route.params?.id;
  const seedPo: PurchaseOrder | undefined = route.params?.po;

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  const {
    data: po,
    isError,
    isFetching,
    refetch,
  } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order', id],
    queryFn: async () => (await purchaseOrdersApi.getById(id)).data,
    // Шапка из строки списка — мгновенно; позиции дотянет getById.
    placeholderData: (prev) => prev ?? seedPo,
  });

  const meta = po ? PO_STATUS_META[po.status] : null;
  const items = useMemo(() => po?.items ?? [], [po]);

  // Supplier phone for the WhatsApp deep link — cache-first ['suppliers'] list
  // (already persisted/warmed). Fetched lazily when the request sheet opens; a
  // late arrival is fine (the link is built at button-press time).
  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await suppliersApi.getAll()).data.data,
    staleTime: 5 * 60 * 1000,
    enabled: showRequest,
  });
  const supplierPhone = useMemo(
    () => (po?.supplierId ? suppliers?.find((s) => s.id === po.supplierId)?.phone : undefined),
    [suppliers, po?.supplierId],
  );

  const applyUpdated = useCallback(
    (updated: PurchaseOrder) => {
      queryClient.setQueryData(['purchase-order', id], updated);
    },
    [queryClient, id],
  );

  // ── Mutations ────────────────────────────────────────────────────────────
  const orderMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.order(id),
    onSuccess: (res) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      applyUpdated(res.data);
    },
    onError: () => haptic('error'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => purchaseOrdersApi.cancel(id),
    onSuccess: (res) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      applyUpdated(res.data);
    },
    onError: () => haptic('error'),
  });

  const busy = orderMutation.isPending || cancelMutation.isPending;

  // Открыть экран приёмки поставки по этому заказу. Приёмка (цена за строку,
  // стоимость накладной, выбор «в долг / оплатить сразу») живёт на отдельном
  // SupplyReceiveScreen; он сам обновит кэш заказа и инвалидирует склад/леджер.
  const openReceive = useCallback(() => {
    haptic('tap');
    navigation.navigate('SupplyReceive', { orderId: id, po });
  }, [navigation, id, po]);

  // ── Loading / error (нет seed-данных) ─────────────────────────────────────
  if (!po) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Заказ" onBack={() => navigation.goBack()} />
        {isError ? (
          <QueryErrorState
            title="Не удалось загрузить заказ"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        ) : (
          <ListSkeleton count={5} />
        )}
      </View>
    );
  }

  const isDraft = po.status === 'draft';
  const isOrdered = po.status === 'ordered';
  const isTerminal = po.status === 'received' || po.status === 'cancelled';

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={po.supplierName || 'Заказ'} subtitle={meta?.label} onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[10] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header card ── */}
        <View style={[styles.headerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.headerTop}>
            <View style={[styles.statusBadge, { backgroundColor: meta?.bg }]}>
              {meta ? <Ionicons name={meta.icon} size={13} color={meta.text} /> : null}
              <Text style={[styles.statusBadgeText, { color: meta?.text }]}>{meta?.label}</Text>
            </View>
            <Text style={[styles.headerTotal, { color: palette.text.primary }]}>{formatMoney(po.total)}</Text>
          </View>

          <View style={[styles.metaGrid, { borderTopColor: palette.border.subtle }]}>
            <MetaRow label="Создан" value={formatPoDate(po.createdAt)} palette={palette} />
            {po.orderedAt ? <MetaRow label="Заказан" value={formatPoDate(po.orderedAt)} palette={palette} /> : null}
            {po.receivedAt ? <MetaRow label="Получен" value={formatPoDate(po.receivedAt)} palette={palette} /> : null}
            {po.createdByName ? <MetaRow label="Автор" value={po.createdByName} palette={palette} /> : null}
          </View>

          {po.note ? (
            <View style={[styles.noteBox, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="document-text-outline" size={14} color={palette.text.tertiary} />
              <Text style={[styles.noteText, { color: palette.text.secondary }]}>{po.note}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Items ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
          ПОЗИЦИИ · {items.length}
        </Text>
        <View style={[styles.itemsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          {items.map((it, idx) => {
            const out = outstandingQty(it.quantity, it.receivedQuantity);
            const fullyReceived = out === 0;
            return (
              <View
                key={it.id}
                style={[
                  styles.itemRow,
                  idx < items.length - 1 && {
                    borderBottomColor: palette.border.subtle,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.itemTop}>
                  <Text style={[styles.itemName, { color: palette.text.primary }]} numberOfLines={2}>
                    {it.name}
                  </Text>
                  <Text style={[styles.itemTotal, { color: palette.text.secondary }]}>{formatMoney(it.total)}</Text>
                </View>
                <View style={styles.itemMetaRow}>
                  <Text style={[styles.itemMeta, { color: palette.text.tertiary }]}>
                    {it.quantity} {'×'} {formatMoney(it.costPrice)}
                  </Text>
                  <View style={styles.itemQtyBadges}>
                    <View style={[styles.qtyBadge, { backgroundColor: palette.bg.muted }]}>
                      <Text style={[styles.qtyBadgeText, { color: palette.text.secondary }]}>
                        Заказано {it.quantity}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.qtyBadge,
                        { backgroundColor: fullyReceived ? colors.green[50] : palette.bg.muted },
                      ]}
                    >
                      <Text
                        style={[
                          styles.qtyBadgeText,
                          { color: fullyReceived ? colors.green[700] : palette.text.secondary },
                        ]}
                      >
                        Получено {it.receivedQuantity}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
          {items.length === 0 ? (
            isFetching ? (
              <ActivityIndicator color={colors.primary[600]} style={{ paddingVertical: spacing[4] }} />
            ) : (
              <Text style={[styles.itemsEmpty, { color: palette.text.tertiary }]}>Нет позиций</Text>
            )
          ) : null}
        </View>

        {/* «Сформировать запрос» — на черновике: текстовый запрос поставщику по
            позициям (без цен) для копирования / отправки в WhatsApp. */}
        {isDraft && items.length > 0 ? (
          <TouchableOpacity
            style={[styles.requestBtn, { borderColor: palette.border.strong, backgroundColor: palette.bg.card }]}
            onPress={() => {
              haptic('tap');
              setShowRequest(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubbles-outline" size={18} color={colors.primary[600]} />
            <Text style={[styles.requestBtnText, { color: palette.text.primary }]}>Сформировать запрос</Text>
          </TouchableOpacity>
        ) : null}

        {/* ── Read-only hint for terminal states ── */}
        {isTerminal ? (
          <View style={styles.terminalHint}>
            <Ionicons
              name={po.status === 'received' ? 'checkmark-done' : 'close-circle'}
              size={16}
              color={po.status === 'received' ? colors.green[600] : colors.red[500]}
            />
            <Text style={[styles.terminalHintText, { color: palette.text.tertiary }]}>
              {po.status === 'received' ? 'Заказ получен, товар оприходован на склад' : 'Заказ отменён'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Action bar (write-роль) ── */}
      {canWrite && !isTerminal ? (
        <View
          style={[
            styles.actionBar,
            { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle, marginBottom: tabBarHeight },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primary[600]} style={{ paddingVertical: spacing[2] }} />
          ) : isDraft ? (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.iconActionBtn, { borderColor: palette.border.strong }]}
                onPress={() => {
                  haptic('tap');
                  navigation.navigate('PurchaseOrderCreate', { editId: po.id, po });
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={18} color={palette.text.secondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.iconActionBtn, { borderColor: colors.red[200] }]}
                onPress={() => {
                  haptic('tap');
                  setConfirmCancel(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.primary[600] }]}
                onPress={() => {
                  haptic('tap');
                  orderMutation.mutate();
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="paper-plane" size={17} color={colors.white} />
                <Text style={styles.primaryBtnText}>Оформить заказ</Text>
              </TouchableOpacity>
            </View>
          ) : isOrdered ? (
            // ordered: главный путь — «Принять поставку» (открывает приёмку с
            // ценой за строку / стоимостью накладной / выбором оплаты). Ниже —
            // «Изменить» (backend разрешает правку на ordered) и «Отменить».
            <View style={styles.receiveActions}>
              <TouchableOpacity
                style={[styles.receiveAllBtn, { backgroundColor: colors.green[600] }]}
                onPress={openReceive}
                activeOpacity={0.85}
              >
                <Ionicons name="cube" size={18} color={colors.white} />
                <Text style={styles.primaryBtnText}>Принять поставку</Text>
              </TouchableOpacity>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, styles.secondaryBtnFlex, { borderColor: palette.border.strong }]}
                  onPress={() => {
                    haptic('tap');
                    navigation.navigate('PurchaseOrderCreate', { editId: po.id, po });
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="create-outline" size={16} color={palette.text.secondary} />
                  <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Изменить</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryBtn, styles.secondaryBtnFlex, { borderColor: colors.red[200] }]}
                  onPress={() => {
                    haptic('tap');
                    setConfirmCancel(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.red[500] }]}>Отменить</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancelMutation.mutate()}
        title="Отменить заказ?"
        message="Заказ будет помечен как отменённый. Это действие нельзя вернуть."
        confirmText="Отменить заказ"
        variant="danger"
      />

      {/* ── Запрос поставщику (текст без цен → копировать / WhatsApp) ── */}
      <SupplierRequestSheet
        visible={showRequest}
        onClose={() => setShowRequest(false)}
        supplierName={po.supplierName}
        supplierPhone={supplierPhone}
        lines={items.map((it) => ({ name: it.name, quantity: it.quantity }))}
      />
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function MetaRow({ label, value, palette }: { label: string; value: string; palette: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.metaRowItem}>
      <Text style={[styles.metaLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },
  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  // Header card
  headerCard: {
    marginTop: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    gap: spacing[3],
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 5,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  headerTotal: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  metaGrid: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[3], gap: spacing[2] },
  metaRowItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { fontSize: 13 },
  metaValue: { fontSize: 13, fontWeight: '600', flexShrink: 1, marginLeft: spacing[3] },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
  },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Items
  itemsCard: { borderRadius: borderRadius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  itemRow: { paddingHorizontal: spacing[3.5], paddingVertical: spacing[3], gap: spacing[1.5] },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing[2] },
  itemName: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  itemTotal: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  itemMeta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  itemQtyBadges: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  qtyBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  qtyBadgeText: { fontSize: 11, fontWeight: '600' },
  itemsEmpty: { fontSize: 13, padding: spacing[4], textAlign: 'center' },

  // «Сформировать запрос»
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  requestBtnText: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },

  // Terminal hint
  terminalHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  terminalHintText: { fontSize: 13, fontWeight: '500' },

  // Action bar
  actionBar: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] },
  // Receive-mode action stack: full-width «Принять полностью» on top, then
  // the [Отмена][Принять выбранное] row. Two tiers so neither button is
  // cramped or truncated on narrow iPhones.
  receiveActions: { gap: spacing[2.5] },
  receiveAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
  secondaryBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  // Equal-width row variant — [Изменить][Отменить] under «Принять поставку».
  secondaryBtnFlex: { flex: 1, flexDirection: 'row', gap: spacing[1.5] },
  iconActionBtn: {
    width: 48,
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
