/**
 * MotivationScreen — «Мотивация сотрудников» v1 (акционные товары).
 *
 * Owner-facing management screen (director / superadmin). Two tabs:
 *
 *   • «Акционные товары» — the current promo programme. Each row shows the
 *     product (photo / name), the bonus percent and the estimated bonus per
 *     unit. The owner adds a product (reusing the warehouse ProductPickerModal),
 *     edits its percent, pauses it, or removes it from the programme.
 *       getPromos / setPromo / clearPromo  (motivationApi)
 *
 *   • «Начисления» — the accrual ledger (transparency). Who earned what, on
 *     which check, for which product, how much. Filterable by month and by
 *     employee. Backend force-scopes non-privileged callers to their OWN rows;
 *     the owner sees the whole tenant.
 *       getAccruals  (motivationApi)
 *
 * Rule (explained in-UI): сотрудник получает % от МАРЖИ проданного акционного
 * товара; бонус начисляется при ОПЛАТЕ чека и попадает в зарплату
 * (MasterSalary.motivationAmount, см. SalaryScreen → «Мотивация (акции)»).
 *
 * Premium Autexa UX: IosScreenHeader, iosCard surfaces, dark-theme palette,
 * safe-area + useTabBarHeight bottom inset, haptics, Russian throughout.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Switch,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import CachedImage from '../components/CachedImage';
import ProductPickerModal from '../components/ProductPickerModal';
import { motivationApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import type { MotivationPromo, MotivationAccrual, Product } from '../../../shared/types';

// ── Helpers ────────────────────────────────────────────────────────────────

const RUBLE = '₽';

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

const MONTH_NAMES_GEN = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'] as const;

function formatMoney(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    ' ' +
    RUBLE
  );
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatAccrualDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_NAMES_GEN[d.getMonth()]}`;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0][0]?.toUpperCase() || '?';
}

/** Live single-unit bonus preview = round((sell − cost) × percent / 100). */
function bonusPerUnit(sellPrice: number, costPrice: number, percent: number): number {
  const margin = Math.max(0, (sellPrice || 0) - (costPrice || 0));
  return Math.round((margin * (Number.isFinite(percent) ? percent : 0)) / 100);
}

function friendlyError(err: any, fallback: string): string {
  return String(err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback);
}

type Tab = 'promos' | 'accruals';

// The editor target unifies «add a new promo» (seeded from a picked Product)
// and «edit an existing promo» (seeded from a MotivationPromo). The product
// prices ride along so the percent field can preview the per-unit bonus live.
interface EditorTarget {
  productId: string;
  productName: string;
  photo?: string;
  sellPrice: number;
  costPrice: number;
  percent: string;
  active: boolean;
  isExisting: boolean;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function MotivationScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const [tab, setTab] = useState<Tab>('promos');
  const [refreshing, setRefreshing] = useState(false);

  // Product picker (reused warehouse ProductPickerModal) + promo editor modal.
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  // Accruals filters.
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(null); // employeeId | null = «Все»
  const year = selectedMonth.getFullYear();
  const monthIdx = selectedMonth.getMonth();
  const dateFrom = formatDate(new Date(year, monthIdx, 1));
  const dateTo = formatDate(new Date(year, monthIdx + 1, 0));
  const monthLabel = `${MONTH_NAMES[monthIdx]} ${year}`;

  // ── Data ───────────────────────────────────────────────────────────────────

  const {
    data: promos,
    isLoading: promosLoading,
    isError: promosError,
    refetch: refetchPromos,
  } = useQuery<MotivationPromo[]>({
    queryKey: ['motivation', 'promos'],
    queryFn: async () => {
      const res = await motivationApi.getPromos();
      return Array.isArray(res.data) ? res.data : [];
    },
    placeholderData: (prev) => prev,
  });

  const {
    data: accruals,
    isLoading: accrualsLoading,
    isError: accrualsError,
    refetch: refetchAccruals,
  } = useQuery<MotivationAccrual[]>({
    queryKey: ['motivation', 'accruals', dateFrom, dateTo],
    queryFn: async () => {
      const res = await motivationApi.getAccruals({ dateFrom, dateTo });
      return Array.isArray(res.data) ? res.data : [];
    },
    // Fetch only once the user opens the «Начисления» tab — the owner may only
    // ever manage promos. SWR keeps the previous month visible while paging.
    enabled: tab === 'accruals',
    placeholderData: (prev) => prev,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

  const closeEditor = useCallback(() => {
    setEditorVisible(false);
    setEditor(null);
  }, []);

  const setPromoMutation = useMutation({
    mutationFn: (data: { productId: string; percent: number; active?: boolean }) => motivationApi.setPromo(data),
    onSuccess: () => {
      haptic('success');
      closeEditor();
      // Promo config changed → promos list, the accrual estimate AND salary
      // (motivationAmount feeds totalEarnings / remainingAmount) must refresh.
      queryClient.invalidateQueries({ queryKey: ['motivation'] });
      queryClient.invalidateQueries({ queryKey: ['salary'] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', friendlyError(err, 'Не удалось сохранить акцию'));
    },
  });

  const clearPromoMutation = useMutation({
    mutationFn: (productId: string) => motivationApi.clearPromo(productId),
    onSuccess: () => {
      haptic('success');
      closeEditor();
      queryClient.invalidateQueries({ queryKey: ['motivation'] });
      queryClient.invalidateQueries({ queryKey: ['salary'] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', friendlyError(err, 'Не удалось убрать товар из акции'));
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['motivation', 'promos'] }),
      queryClient.invalidateQueries({ queryKey: ['motivation', 'accruals'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  // Opening the editor right after the picker closes: iOS cannot present two
  // RNModals stacked (the second renders invisible), so drop the picker first
  // and mount the editor on the next tick — the same idiom SalaryScreen uses.
  const openEditorForProduct = useCallback((product: Product) => {
    setPickerVisible(false);
    setEditor({
      productId: product.id,
      productName: product.name,
      photo: (product as { photo?: string }).photo,
      sellPrice: product.sellPrice || 0,
      costPrice: product.costPrice || 0,
      percent: '10',
      active: true,
      isExisting: false,
    });
    setTimeout(() => setEditorVisible(true), Platform.OS === 'ios' ? 320 : 0);
  }, []);

  const openEditorForPromo = useCallback((promo: MotivationPromo) => {
    haptic('tap');
    setEditor({
      productId: promo.productId,
      productName: promo.productName,
      photo: promo.photo,
      sellPrice: promo.sellPrice || 0,
      costPrice: promo.costPrice || 0,
      percent: String(promo.percent),
      active: promo.active,
      isExisting: true,
    });
    setEditorVisible(true);
  }, []);

  const updateEditor = useCallback((patch: Partial<EditorTarget>) => {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const submitEditor = useCallback(() => {
    if (!editor) return;
    const pct = parseFloat(editor.percent.replace(/\s+/g, '').replace(',', '.'));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      Alert.alert('Ошибка', 'Процент должен быть от 1 до 100');
      return;
    }
    setPromoMutation.mutate({ productId: editor.productId, percent: pct, active: editor.active });
  }, [editor, setPromoMutation]);

  const confirmRemove = useCallback(() => {
    if (!editor) return;
    Alert.alert('Убрать из акции?', `«${editor.productName}» перестанет приносить бонус сотрудникам.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => clearPromoMutation.mutate(editor.productId) },
    ]);
  }, [editor, clearPromoMutation]);

  // ── Accruals derived view ──────────────────────────────────────────────────────

  const accrualRows = useMemo(() => {
    const rows = Array.isArray(accruals) ? accruals : [];
    if (!employeeFilter) return rows;
    return rows.filter((a) => a.employeeId === employeeFilter);
  }, [accruals, employeeFilter]);

  // Unique employees present in this month's accruals — drives the filter chips.
  const employeeChips = useMemo(() => {
    const rows = Array.isArray(accruals) ? accruals : [];
    const seen = new Map<string, string>();
    for (const a of rows) {
      if (a.employeeId) seen.set(a.employeeId, a.employeeName || 'Без имени');
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [accruals]);

  const accrualsTotal = useMemo(() => accrualRows.reduce((s, a) => s + (a.amount || 0), 0), [accrualRows]);

  // ── Month navigation ───────────────────────────────────────────────────────────

  const prevMonth = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);
  const nextMonth = useCallback(() => {
    haptic('select');
    setSelectedMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, []);

  // ── Render: promos tab ──────────────────────────────────────────────────────────

  const promoList = Array.isArray(promos) ? promos : [];
  const activeCount = promoList.filter((p) => p.active).length;

  const renderPromosTab = () => {
    if (promos === undefined && promosLoading) return <LoadingSpinner />;
    if (promos === undefined && promosError) {
      return (
        <QueryErrorState
          description="Не удалось загрузить акционные товары. Проверьте соединение."
          onRetry={() => refetchPromos()}
        />
      );
    }
    return (
      <ScrollView
        contentContainerStyle={[styles.tabScroll, { paddingBottom: tabBarHeight + spacing[8] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        showsVerticalScrollIndicator={false}
        contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
      >
        {/* Add CTA */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            haptic('tap');
            setPickerVisible(true);
          }}
          style={styles.addCta}
        >
          <LinearGradient
            colors={[colors.green[500], colors.green[700]] as [string, string]}
            style={styles.addCtaGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.white} />
            <Text style={styles.addCtaText}>Добавить акционный товар</Text>
          </LinearGradient>
        </TouchableOpacity>

        {promoList.length > 0 ? (
          <Text style={[styles.listCaption, { color: palette.text.tertiary }]}>
            {promoList.length} {pluralPromo(promoList.length)} · {activeCount} активн.
          </Text>
        ) : null}

        {promoList.length === 0 ? (
          <EmptyState
            icon="gift-outline"
            title="Пока нет акционных товаров"
            subtitle="Отметьте товар процентом — сотрудник будет получать бонус с его продажи"
            palette={palette}
          />
        ) : (
          <View style={styles.promoCard}>
            {promoList.map((promo, idx) => (
              <PromoRow
                key={promo.id}
                promo={promo}
                palette={palette}
                showDivider={idx < promoList.length - 1}
                onPress={() => openEditorForPromo(promo)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  // ── Render: accruals tab ────────────────────────────────────────────────────────

  const renderAccrualRow = useCallback(
    ({ item }: { item: MotivationAccrual }) => <AccrualRow accrual={item} palette={palette} />,
    [palette],
  );
  const accrualKey = useCallback((a: MotivationAccrual) => a.id, []);

  const renderAccrualsTab = () => {
    const loadingFirst = accruals === undefined && accrualsLoading;
    return (
      <View style={{ flex: 1 }}>
        {/* Month switcher */}
        <View style={styles.filterBar}>
          <View style={[styles.monthChip, { backgroundColor: palette.bg.muted }]}>
            <TouchableOpacity onPress={prevMonth} hitSlop={6} style={styles.monthChipBtn}>
              <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
            </TouchableOpacity>
            <Text style={[styles.monthChipLabel, { color: palette.text.primary }]}>{monthLabel}</Text>
            <TouchableOpacity onPress={nextMonth} hitSlop={6} style={styles.monthChipBtn}>
              <Ionicons name="chevron-forward" size={16} color={palette.text.secondary} />
            </TouchableOpacity>
          </View>
          <View
            style={[
              styles.totalPill,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
            ]}
          >
            <Text style={[styles.totalPillText, { color: colors.green[600] }]}>{formatMoney(accrualsTotal)}</Text>
          </View>
        </View>

        {/* Employee filter chips */}
        {employeeChips.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            keyboardShouldPersistTaps="handled"
          >
            <FilterChip
              label="Все"
              active={employeeFilter === null}
              onPress={() => {
                haptic('select');
                setEmployeeFilter(null);
              }}
              palette={palette}
            />
            {employeeChips.map((e) => (
              <FilterChip
                key={e.id}
                label={e.name}
                active={employeeFilter === e.id}
                onPress={() => {
                  haptic('select');
                  setEmployeeFilter(e.id);
                }}
                palette={palette}
              />
            ))}
          </ScrollView>
        ) : null}

        {loadingFirst ? (
          <LoadingSpinner />
        ) : accruals === undefined && accrualsError ? (
          <QueryErrorState
            description="Не удалось загрузить начисления. Проверьте соединение."
            onRetry={() => refetchAccruals()}
          />
        ) : accrualRows.length === 0 ? (
          <ScrollView
            contentContainerStyle={[styles.tabScroll, { flexGrow: 1, paddingBottom: tabBarHeight + spacing[8] }]}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
            }
            showsVerticalScrollIndicator={false}
          >
            <EmptyState
              icon="receipt-outline"
              title="Нет начислений за этот месяц"
              subtitle="Бонусы появятся, когда сотрудники продадут акционные товары и чеки будут оплачены"
              palette={palette}
            />
          </ScrollView>
        ) : (
          <FlashList
            data={accrualRows}
            renderItem={renderAccrualRow}
            keyExtractor={accrualKey}
            contentContainerStyle={{
              paddingHorizontal: spacing[4],
              paddingTop: spacing[1],
              paddingBottom: tabBarHeight + spacing[8],
            }}
            ItemSeparatorComponent={AccrualSeparator}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
            }
            showsVerticalScrollIndicator={false}
            contentInset={Platform.OS === 'ios' ? { bottom: tabBarHeight } : undefined}
          />
        )}
      </View>
    );
  };

  // ── Compose ────────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Мотивация сотрудников" onBack={() => navigation.goBack()} />

      {/* Rule explainer — always visible so the owner understands the mechanic. */}
      <View
        style={[
          styles.ruleBanner,
          {
            backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.emerald[50],
            borderColor: palette.mode === 'dark' ? 'transparent' : colors.emerald[100],
          },
        ]}
      >
        <View
          style={[
            styles.ruleIcon,
            { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[100] },
          ]}
        >
          <Ionicons name="gift-outline" size={18} color={colors.green[600]} />
        </View>
        <Text style={[styles.ruleText, { color: palette.text.secondary }]}>
          Сотрудник получает{' '}
          <Text style={{ color: palette.text.primary, fontWeight: fontWeight.bold }}>% от маржи</Text> проданного
          акционного товара. Бонус начисляется при оплате чека и попадает в зарплату.
        </Text>
      </View>

      {/* Segmented control */}
      <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
        <SegmentButton
          label="Акционные товары"
          active={tab === 'promos'}
          onPress={() => {
            haptic('select');
            setTab('promos');
          }}
          palette={palette}
        />
        <SegmentButton
          label="Начисления"
          active={tab === 'accruals'}
          onPress={() => {
            haptic('select');
            setTab('accruals');
          }}
          palette={palette}
        />
      </View>

      {tab === 'promos' ? renderPromosTab() : renderAccrualsTab()}

      {/* Warehouse product picker — reused, identical look/speed to Склад. */}
      <ProductPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelectProduct={openEditorForProduct}
        title="Выберите товар"
        showCostPrice
      />

      {/* Promo editor — percent / active / remove. */}
      <Modal
        visible={editorVisible}
        onClose={closeEditor}
        title={editor?.isExisting ? 'Акционный товар' : 'Новая акция'}
      >
        {editor ? (
          <PromoEditor
            editor={editor}
            palette={palette}
            onChange={updateEditor}
            onSubmit={submitEditor}
            onRemove={confirmRemove}
            saving={setPromoMutation.isPending}
            removing={clearPromoMutation.isPending}
          />
        ) : null}
      </Modal>
    </View>
  );
}

// ── Plural helper ───────────────────────────────────────────────────────────────

function pluralPromo(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'товар';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'товара';
  return 'товаров';
}

// ── Segmented control button ──────────────────────────────────────────────────────

interface SegmentButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: SemanticPalette;
}

function SegmentButton({ label, active, onPress, palette }: SegmentButtonProps) {
  return (
    <TouchableOpacity
      style={[styles.segmentBtn, active && { backgroundColor: palette.bg.card }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text
        style={[
          styles.segmentText,
          { color: active ? palette.text.primary : palette.text.secondary },
          active && { fontWeight: fontWeight.bold },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Filter chip ─────────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: SemanticPalette;
}

function FilterChip({ label, active, onPress, palette }: FilterChipProps) {
  return (
    <TouchableOpacity
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? palette.accent.primary : palette.bg.muted,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text
        style={[styles.filterChipText, { color: active ? colors.white : palette.text.secondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Promo row ──────────────────────────────────────────────────────────────────

interface PromoRowProps {
  promo: MotivationPromo;
  palette: SemanticPalette;
  showDivider: boolean;
  onPress: () => void;
}

const PromoRow = React.memo(function PromoRow({ promo, palette, showDivider, onPress }: PromoRowProps) {
  const photoUrl = getImageUrl(promo.photo);
  return (
    <>
      <TouchableOpacity style={styles.promoRow} activeOpacity={0.65} onPress={onPress}>
        {photoUrl ? (
          <CachedImage source={{ uri: photoUrl }} style={styles.promoPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.promoPhoto, styles.promoPhotoPlaceholder, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="cube-outline" size={20} color={palette.text.tertiary} />
          </View>
        )}
        <View style={styles.promoInfo}>
          <Text style={[styles.promoName, { color: palette.text.primary }]} numberOfLines={1}>
            {promo.productName}
          </Text>
          <View style={styles.promoMetaRow}>
            <Text style={[styles.promoBonus, { color: colors.green[600] }]}>
              +{formatMoney(promo.estimatedBonusPerUnit)} с 1 шт
            </Text>
            {!promo.active ? (
              <View style={[styles.pausedPill, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="pause" size={9} color={palette.text.tertiary} />
                <Text style={[styles.pausedText, { color: palette.text.tertiary }]}>Пауза</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.promoRight}>
          <View
            style={[
              styles.percentBadge,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
            ]}
          >
            <Text style={[styles.percentBadgeText, { color: colors.green[600] }]}>{promo.percent}%</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </View>
      </TouchableOpacity>
      {showDivider ? <View style={[styles.rowDivider, { backgroundColor: palette.border.subtle }]} /> : null}
    </>
  );
});

// ── Accrual row ────────────────────────────────────────────────────────────────

interface AccrualRowProps {
  accrual: MotivationAccrual;
  palette: SemanticPalette;
}

const AccrualRow = React.memo(function AccrualRow({ accrual, palette }: AccrualRowProps) {
  const initials = getInitials(accrual.employeeName);
  return (
    <View style={[styles.accrualRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={[styles.accrualAvatar, { backgroundColor: palette.accent.primarySoft }]}>
        <Text style={[styles.accrualAvatarText, { color: palette.accent.primaryText }]}>{initials}</Text>
      </View>
      <View style={styles.accrualInfo}>
        <View style={styles.accrualTopRow}>
          <Text style={[styles.accrualName, { color: palette.text.primary }]} numberOfLines={1}>
            {accrual.employeeName || 'Сотрудник'}
          </Text>
          <Text style={[styles.accrualAmount, { color: colors.green[600] }]}>+{formatMoney(accrual.amount)}</Text>
        </View>
        <Text style={[styles.accrualProduct, { color: palette.text.secondary }]} numberOfLines={1}>
          {accrual.productName || 'Товар'}
          {accrual.qty > 1 ? ` · ${accrual.qty} шт` : ''}
        </Text>
        <Text style={[styles.accrualMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {accrual.checkNumber ? `Чек №${accrual.checkNumber}` : 'Чек'} · {accrual.percent}% от маржи ·{' '}
          {formatAccrualDate(accrual.accruedAt)}
        </Text>
      </View>
    </View>
  );
});

function AccrualSeparator() {
  return <View style={{ height: spacing[2.5] }} />;
}

// ── Empty state ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  palette: SemanticPalette;
}

function EmptyState({ icon, title, subtitle, palette }: EmptyStateProps) {
  return (
    <View style={styles.emptyWrap}>
      <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name={icon} size={34} color={palette.text.tertiary} />
      </View>
      <Text style={[styles.emptyTitle, { color: palette.text.secondary }]}>{title}</Text>
      <Text style={[styles.emptySubtitle, { color: palette.text.tertiary }]}>{subtitle}</Text>
    </View>
  );
}

// ── Promo editor (inside Modal) ────────────────────────────────────────────────────

interface PromoEditorProps {
  editor: EditorTarget;
  palette: SemanticPalette;
  onChange: (patch: Partial<EditorTarget>) => void;
  onSubmit: () => void;
  onRemove: () => void;
  saving: boolean;
  removing: boolean;
}

function PromoEditor({ editor, palette, onChange, onSubmit, onRemove, saving, removing }: PromoEditorProps) {
  const photoUrl = getImageUrl(editor.photo);
  const margin = Math.max(0, editor.sellPrice - editor.costPrice);
  const pct = parseFloat(editor.percent.replace(/\s+/g, '').replace(',', '.'));
  const preview = bonusPerUnit(editor.sellPrice, editor.costPrice, Number.isFinite(pct) ? pct : 0);

  return (
    <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Product header */}
      <View style={[styles.editorProduct, { backgroundColor: palette.bg.muted }]}>
        {photoUrl ? (
          <CachedImage source={{ uri: photoUrl }} style={styles.editorPhoto} resizeMode="cover" />
        ) : (
          <View style={[styles.editorPhoto, styles.promoPhotoPlaceholder, { backgroundColor: palette.bg.card }]}>
            <Ionicons name="cube-outline" size={22} color={palette.text.tertiary} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.editorName, { color: palette.text.primary }]} numberOfLines={2}>
            {editor.productName}
          </Text>
          <Text style={[styles.editorPrices, { color: palette.text.tertiary }]} numberOfLines={1}>
            Цена {formatMoney(editor.sellPrice)} · маржа {formatMoney(margin)}
          </Text>
        </View>
      </View>

      {/* Percent input */}
      <View style={styles.editorField}>
        <Text style={[styles.editorLabel, { color: palette.text.secondary }]}>Процент от маржи</Text>
        <View
          style={[styles.editorInputRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="trending-up-outline" size={16} color={palette.text.tertiary} />
          <TextInput
            style={[styles.editorInput, { color: palette.text.primary }]}
            value={editor.percent}
            onChangeText={(v) => onChange({ percent: v })}
            keyboardType="numeric"
            placeholder="10"
            placeholderTextColor={palette.text.tertiary}
            maxLength={3}
          />
          <Text style={[styles.editorCurrency, { color: palette.text.tertiary }]}>%</Text>
        </View>
        <View style={styles.previewRow}>
          <Ionicons name="gift-outline" size={14} color={colors.green[600]} />
          <Text style={[styles.previewText, { color: palette.text.secondary }]}>
            Бонус с 1 шт:{' '}
            <Text style={{ color: colors.green[600], fontWeight: fontWeight.bold }}>+{formatMoney(preview)}</Text>
          </Text>
        </View>
      </View>

      {/* Active toggle */}
      <View style={[styles.toggleRow, { borderColor: palette.border.subtle }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.toggleLabel, { color: palette.text.primary }]}>Акция активна</Text>
          <Text style={[styles.toggleSub, { color: palette.text.tertiary }]}>
            На паузе бонус не начисляется, но настройка сохраняется
          </Text>
        </View>
        <Switch
          value={editor.active}
          onValueChange={(v) => {
            haptic('select');
            onChange({ active: v });
          }}
          trackColor={{ false: palette.bg.muted, true: colors.green[500] }}
          thumbColor={colors.white}
        />
      </View>

      {/* Save */}
      <TouchableOpacity style={styles.saveBtn} onPress={onSubmit} activeOpacity={0.85} disabled={saving || removing}>
        {saving ? (
          <View style={[styles.saveBtnGradient, { backgroundColor: colors.green[600] }]}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : (
          <LinearGradient
            colors={[colors.green[500], colors.green[700]] as [string, string]}
            style={styles.saveBtnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="checkmark" size={18} color={colors.white} />
            <Text style={styles.saveBtnText}>{editor.isExisting ? 'Сохранить' : 'Добавить в акцию'}</Text>
          </LinearGradient>
        )}
      </TouchableOpacity>

      {/* Remove (only for existing promos) */}
      {editor.isExisting ? (
        <TouchableOpacity
          style={[styles.removeBtn, { borderColor: palette.border.subtle }]}
          onPress={onRemove}
          activeOpacity={0.8}
          disabled={saving || removing}
        >
          {removing ? (
            <ActivityIndicator color={colors.red[600]} />
          ) : (
            <>
              <Ionicons name="trash-outline" size={17} color={colors.red[600]} />
              <Text style={styles.removeBtnText}>Убрать из акции</Text>
            </>
          )}
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Rule banner
  ruleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[4],
    marginTop: spacing[1],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  ruleIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleText: { flex: 1, fontSize: 12.5, lineHeight: 17 },

  // Segmented control
  segment: {
    flexDirection: 'row',
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    padding: 3,
    borderRadius: borderRadius.xl,
    gap: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    letterSpacing: -0.2,
  },

  // Tab scroll body
  tabScroll: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[1],
    gap: spacing[3],
  },

  // Add CTA
  addCta: { borderRadius: borderRadius['2xl'], overflow: 'hidden' },
  addCtaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
  },
  addCtaText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white, letterSpacing: -0.2 },

  listCaption: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginLeft: spacing[1],
    marginTop: -spacing[1],
  },

  // Promo card / rows
  promoCard: {
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
  },
  promoPhoto: { width: 48, height: 48, borderRadius: borderRadius.lg },
  promoPhotoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  promoInfo: { flex: 1, minWidth: 0, gap: 3 },
  promoName: { fontSize: 15, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  promoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  promoBonus: { fontSize: 12.5, fontWeight: fontWeight.semibold },
  pausedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  pausedText: { fontSize: 10, fontWeight: fontWeight.semibold },
  promoRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  percentBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: 8,
    minWidth: 42,
    alignItems: 'center',
  },
  percentBadgeText: { fontSize: 13, fontWeight: fontWeight.bold },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 48 + spacing[3] },

  // Accruals filter bar
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[1],
    paddingVertical: 4,
  },
  monthChipBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  monthChipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    minWidth: 96,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  totalPill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  totalPillText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, letterSpacing: -0.2 },

  chipsRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  filterChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 180,
  },
  filterChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // Accrual row
  accrualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  accrualAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accrualAvatarText: { fontSize: 13, fontWeight: fontWeight.bold },
  accrualInfo: { flex: 1, minWidth: 0, gap: 2 },
  accrualTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  accrualName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  accrualAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  accrualProduct: { fontSize: 12.5, fontWeight: fontWeight.medium },
  accrualMeta: { fontSize: 11 },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingTop: spacing[10],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: 'center' },
  emptySubtitle: { fontSize: fontSize.xs, textAlign: 'center', lineHeight: 17 },

  // Editor
  editorProduct: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[4],
  },
  editorPhoto: { width: 52, height: 52, borderRadius: borderRadius.lg },
  editorName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  editorPrices: { fontSize: 12, marginTop: 3 },
  editorField: { marginBottom: spacing[4] },
  editorLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  editorInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  editorInput: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold, padding: 0 },
  editorCurrency: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], marginTop: spacing[2] },
  previewText: { fontSize: fontSize.sm },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing[4],
  },
  toggleLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  toggleSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },

  saveBtn: { borderRadius: borderRadius.xl, overflow: 'hidden' },
  saveBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
  },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },

  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[3],
  },
  removeBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.red[600] },
});
