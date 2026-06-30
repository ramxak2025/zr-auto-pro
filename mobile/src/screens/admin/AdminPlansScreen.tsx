/**
 * AdminPlansScreen — in-app tariff editor (full CRUD via plansApi).
 *
 * Mobile was read-only before; now the superadmin can create, edit and archive
 * plans, including a feature toggle list sourced from shared/constants/features
 * (ALL_FEATURES) so check_photos and everything else is editable with zero
 * drift from the backend / web editor.
 *
 *   • List of plans (sorted by sortOrder) with subscriber counts.
 *   • Tap a plan → edit sheet (name, monthlyPrice, maxUsers, sortOrder,
 *     isActive, feature toggles).
 *   • «+» header → create a new plan.
 *   • Archive = isActive:false (soft, via update).
 */
import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plansApi, tenantsApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, softTint } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { ALL_FEATURES } from '../../../../shared/constants/features';
import type { Plan, Tenant, FeatureCatalogItem, FeatureGroup } from '../../../../shared/types';
import { formatMoney, FEATURE_GROUP_LABELS, FEATURE_GROUP_ORDER } from './adminShared';

interface PlanDraft {
  id?: string;
  name: string;
  monthlyPrice: string;
  maxUsers: string;
  sortOrder: string;
  isActive: boolean;
  features: string[];
}

function toDraft(plan?: Plan): PlanDraft {
  return {
    id: plan?.id,
    name: plan?.name ?? '',
    monthlyPrice: plan ? String(plan.monthlyPrice) : '',
    maxUsers: plan ? String(plan.maxUsers) : '',
    sortOrder: plan ? String(plan.sortOrder) : '0',
    isActive: plan ? plan.isActive : true,
    features: Array.isArray(plan?.features) ? [...plan!.features] : [],
  };
}

export default function AdminPlansScreen() {
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();

  const [editing, setEditing] = React.useState<PlanDraft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  const { data: tenants = [] } = useQuery<Tenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await tenantsApi.getAll()).data,
  });

  // Toggleable feature catalog (server-authoritative, superadmin). Falls back to
  // the shared registry until the request resolves so the editor is never empty
  // and a key the server adds later appears without a client rebuild.
  const { data: catalog } = useQuery<FeatureCatalogItem[]>({
    queryKey: ['admin-feature-catalog'],
    queryFn: async () => (await plansApi.getFeatureCatalog()).data,
    staleTime: 30 * 60 * 1000,
  });

  // Catalog grouped by `group`, in the canonical core → section → integration
  // order, each group keeping its registry order. Memoised off whichever source
  // (server catalog or shared fallback) is live.
  const groupedFeatures = React.useMemo(() => {
    const source: FeatureCatalogItem[] =
      catalog && catalog.length > 0 ? catalog : (ALL_FEATURES as readonly FeatureCatalogItem[]).map((f) => f);
    return FEATURE_GROUP_ORDER.map((group) => ({
      group,
      label: FEATURE_GROUP_LABELS[group],
      items: source.filter((f) => f.group === group),
    })).filter((g) => g.items.length > 0);
  }, [catalog]);

  const sorted = React.useMemo(() => [...plans].sort((a, b) => a.sortOrder - b.sortOrder), [plans]);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-plans'] });
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (draft: PlanDraft) => {
      setSaving(true);
      const scalars = {
        name: draft.name.trim(),
        monthlyPrice: parseInt(draft.monthlyPrice, 10) || 0,
        maxUsers: parseInt(draft.maxUsers, 10) || 1,
        sortOrder: parseInt(draft.sortOrder, 10) || 0,
      };
      if (draft.id) {
        // Scalars via PATCH; the enabled feature set via the dedicated
        // PUT /plans/:id/features endpoint (validated against the catalog).
        await plansApi.update(draft.id, { ...scalars, isActive: draft.isActive });
        await plansApi.setFeatures(draft.id, draft.features);
      } else {
        // New plan — no id yet for setFeatures, so create carries the features.
        await plansApi.create({ ...scalars, features: draft.features });
      }
    },
    onSuccess: () => {
      haptic('success');
      setEditing(null);
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить тариф');
    },
    onSettled: () => setSaving(false),
  });

  const archiveMutation = useMutation({
    mutationFn: async (plan: Plan) => {
      await plansApi.update(plan.id, { isActive: false });
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось архивировать тариф');
    },
  });

  const handleSave = React.useCallback(() => {
    if (!editing) return;
    if (!editing.name.trim()) {
      Alert.alert('Укажите название', 'Название тарифа не может быть пустым.');
      return;
    }
    saveMutation.mutate(editing);
  }, [editing, saveMutation]);

  const confirmArchive = React.useCallback(
    (plan: Plan) => {
      haptic('tap');
      Alert.alert('Архивировать тариф?', `«${plan.name}» станет недоступен для новых подписок.`, [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Архивировать', style: 'destructive', onPress: () => archiveMutation.mutate(plan) },
      ]);
    },
    [archiveMutation],
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Тарифы"
        subtitle={`${plans.length} планов`}
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setEditing(toDraft());
            }}
            style={[styles.headerAdd, { backgroundColor: palette.accent.primary }]}
            hitSlop={6}
          >
            <Ionicons name="add" size={22} color={colors.white} />
          </Pressable>
        }
      />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {sorted.length === 0 ? (
          <View style={[styles.card, surface.card, styles.emptyBlock]}>
            <Ionicons name="pricetags-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Тарифов пока нет</Text>
          </View>
        ) : (
          sorted.map((plan) => {
            const subscribers = tenants.filter((t) => t.planId === plan.id).length;
            const features: string[] = Array.isArray(plan.features) ? plan.features : [];
            return (
              <Pressable
                key={plan.id}
                onPress={() => {
                  haptic('tap');
                  setEditing(toDraft(plan));
                }}
                style={[styles.card, surface.card]}
              >
                <View style={styles.planHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planName, { color: palette.text.primary }]}>{plan.name}</Text>
                    <Text style={[styles.planMeta, { color: palette.text.tertiary }]}>
                      до {plan.maxUsers} польз. · {subscribers} подписчиков · {features.length} функций
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.activePill,
                      {
                        backgroundColor: plan.isActive
                          ? palette.mode === 'dark'
                            ? softTint(colors.green[600], 'dark')
                            : colors.green[50]
                          : palette.bg.muted,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.activeDot,
                        { backgroundColor: plan.isActive ? colors.green[500] : palette.text.tertiary },
                      ]}
                    />
                    <Text
                      style={[styles.activeText, { color: plan.isActive ? colors.green[700] : palette.text.tertiary }]}
                    >
                      {plan.isActive ? 'Активен' : 'Архив'}
                    </Text>
                  </View>
                </View>
                <View style={styles.priceRow}>
                  <Text style={[styles.priceValue, { color: palette.text.primary }]}>
                    {plan.monthlyPrice.toLocaleString('ru-RU')}
                  </Text>
                  <Text style={[styles.priceSuffix, { color: palette.text.secondary }]}> ₽/мес</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Edit / create sheet */}
      <Modal
        visible={!!editing}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
            <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Text style={[styles.sheetTitle, { color: palette.text.primary }]}>
                {editing?.id ? 'Тариф' : 'Новый тариф'}
              </Text>
              <Pressable onPress={handleSave} disabled={saving} hitSlop={8}>
                {saving ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <Text style={[styles.sheetSave, { color: palette.accent.primary }]}>Сохранить</Text>
                )}
              </Pressable>
            </View>

            {editing && (
              <ScrollView
                contentContainerStyle={styles.sheetScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Field label="Название" palette={palette} surface={surface}>
                  <TextInput
                    style={[styles.input, { color: palette.text.primary }]}
                    placeholder="Например, Профи"
                    placeholderTextColor={palette.text.tertiary}
                    value={editing.name}
                    onChangeText={(v) => setEditing({ ...editing, name: v })}
                  />
                </Field>
                <View style={styles.fieldRow}>
                  <Field label="Цена, ₽/мес" palette={palette} surface={surface} flex>
                    <TextInput
                      style={[styles.input, { color: palette.text.primary }]}
                      placeholder="0"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={editing.monthlyPrice}
                      onChangeText={(v) => setEditing({ ...editing, monthlyPrice: v.replace(/[^0-9]/g, '') })}
                    />
                  </Field>
                  <Field label="Макс. польз." palette={palette} surface={surface} flex>
                    <TextInput
                      style={[styles.input, { color: palette.text.primary }]}
                      placeholder="1"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={editing.maxUsers}
                      onChangeText={(v) => setEditing({ ...editing, maxUsers: v.replace(/[^0-9]/g, '') })}
                    />
                  </Field>
                </View>
                <View style={styles.fieldRow}>
                  <Field label="Порядок" palette={palette} surface={surface} flex>
                    <TextInput
                      style={[styles.input, { color: palette.text.primary }]}
                      placeholder="0"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={editing.sortOrder}
                      onChangeText={(v) => setEditing({ ...editing, sortOrder: v.replace(/[^0-9]/g, '') })}
                    />
                  </Field>
                  {editing.id ? (
                    <View style={[styles.field, styles.fieldFlex]}>
                      <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Активен</Text>
                      <View style={[styles.switchBox, surface.cardCompact]}>
                        <Text style={[styles.switchLabel, { color: palette.text.primary }]}>
                          {editing.isActive ? 'Да' : 'Архив'}
                        </Text>
                        <Switch
                          value={editing.isActive}
                          onValueChange={(v) => setEditing({ ...editing, isActive: v })}
                          trackColor={{ true: palette.accent.primary }}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.field, styles.fieldFlex]} />
                  )}
                </View>

                <Text style={[styles.featuresLabel, { color: palette.text.tertiary }]}>Функции тарифа</Text>
                {groupedFeatures.map((grp) => {
                  const keys = grp.items.map((f) => f.key);
                  const enabledCount = keys.filter((k) => editing.features.includes(k)).length;
                  const allOn = enabledCount === keys.length;
                  return (
                    <View key={grp.group} style={styles.featGroup}>
                      <View style={styles.featGroupHead}>
                        <Text style={[styles.featGroupLabel, { color: palette.text.secondary }]}>
                          {grp.label}{' '}
                          <Text style={{ color: palette.text.tertiary }}>
                            {enabledCount}/{keys.length}
                          </Text>
                        </Text>
                        <Pressable
                          onPress={() => {
                            haptic('select');
                            setEditing({
                              ...editing,
                              features: allOn
                                ? editing.features.filter((k) => !keys.includes(k))
                                : Array.from(new Set([...editing.features, ...keys])),
                            });
                          }}
                          hitSlop={6}
                        >
                          <Text style={[styles.featGroupAction, { color: palette.accent.primary }]}>
                            {allOn ? 'Снять все' : 'Выбрать все'}
                          </Text>
                        </Pressable>
                      </View>
                      <View style={[styles.featuresCard, surface.card]}>
                        {grp.items.map((feat, i) => {
                          const on = editing.features.includes(feat.key);
                          return (
                            <View
                              key={feat.key}
                              style={[
                                styles.featRow,
                                i > 0 && {
                                  borderTopWidth: StyleSheet.hairlineWidth,
                                  borderTopColor: palette.border.subtle,
                                },
                              ]}
                            >
                              <Text style={[styles.featLabel, { color: palette.text.primary }]}>{feat.label}</Text>
                              <Switch
                                value={on}
                                trackColor={{ true: palette.accent.primary }}
                                onValueChange={(v) => {
                                  haptic('select');
                                  setEditing({
                                    ...editing,
                                    features: v
                                      ? [...editing.features, feat.key]
                                      : editing.features.filter((k) => k !== feat.key),
                                  });
                                }}
                              />
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}

                {editing.id ? (
                  <Pressable
                    onPress={() => {
                      const plan = plans.find((p) => p.id === editing.id);
                      if (plan) confirmArchive(plan);
                    }}
                    style={styles.archiveBtn}
                  >
                    <Ionicons name="archive-outline" size={18} color={colors.red[600]} />
                    <Text style={styles.archiveText}>Архивировать тариф</Text>
                  </Pressable>
                ) : null}
                <View style={{ height: spacing[8] }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  children,
  palette,
  surface,
  flex,
}: {
  label: string;
  children: React.ReactNode;
  palette: ReturnType<typeof useColors>;
  surface: ReturnType<typeof useIosSurface>;
  flex?: boolean;
}) {
  return (
    <View style={[styles.field, flex && styles.fieldFlex]}>
      <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <View style={[styles.inputWrap, surface.cardCompact]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerAdd: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { padding: spacing[4], gap: spacing[2.5] },
  planHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  planName: { fontSize: 17, fontWeight: '700' },
  planMeta: { fontSize: 12, marginTop: 2 },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeText: { fontSize: 10, fontWeight: '700' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  priceValue: { fontSize: 28, fontWeight: '800', letterSpacing: -1 },
  priceSuffix: { fontSize: 14 },
  emptyBlock: { alignItems: 'center', paddingVertical: spacing[10], gap: spacing[2] },
  emptyText: { fontSize: 14 },
  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius['3xl'],
    borderTopRightRadius: borderRadius['3xl'],
    paddingTop: spacing[2],
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetCancel: { fontSize: 15, fontWeight: '500' },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  sheetSave: { fontSize: 15, fontWeight: '700' },
  sheetScroll: { padding: spacing[4], gap: spacing[3] },
  field: { gap: spacing[1.5] },
  fieldRow: { flexDirection: 'row', gap: spacing[3] },
  fieldFlex: { flex: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: spacing[1] },
  inputWrap: { paddingHorizontal: spacing[3] },
  input: { fontSize: 16, paddingVertical: spacing[3] },
  switchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  switchLabel: { fontSize: 15, fontWeight: '600' },
  featuresLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  featGroup: { marginTop: spacing[3] },
  featGroupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[1.5],
    marginLeft: spacing[1],
    paddingRight: spacing[1],
  },
  featGroupLabel: { fontSize: 13, fontWeight: '700' },
  featGroupAction: { fontSize: 13, fontWeight: '600' },
  featuresCard: { paddingHorizontal: spacing[4] },
  featRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[3] },
  featLabel: { fontSize: 15, fontWeight: '500', flex: 1, paddingRight: spacing[3] },
  archiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    marginTop: spacing[2],
  },
  archiveText: { color: colors.red[600], fontSize: 15, fontWeight: '600' },
});
