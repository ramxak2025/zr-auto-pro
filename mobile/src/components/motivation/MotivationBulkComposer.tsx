import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal as RNModal, View, Pressable, StyleSheet, TextInput, Keyboard } from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import type { MotivationBulkInput, MotivationBulkResult } from '../../../../shared/types';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import { motivationApi, productsApi, warehouseCategoriesApi, warehousesApi } from '../../api/services';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import { borderRadius, colors, spacing } from '../../theme';
import IosScreenHeader from '../IosScreenHeader';
import QueryErrorState from '../QueryErrorState';
import { ListSkeleton } from '../Skeleton';
import { TabBarFlashList, TabBarScrollView } from '../TabBarScrollable';
import {
  buildMotivationChoices,
  coversChoice,
  filterMotivationChoices,
  motivationError,
  motivationTargetKey,
  parseMotivationPercent,
  toggleMotivationChoice,
  type MotivationChoice,
} from './selection';

interface Props {
  visible: boolean;
  sessionId: number;
  onClose: () => void;
  onDismiss: () => void;
  onSaved: (result: MotivationBulkResult, presentationActive: boolean) => void;
}

/** One native presentation; review is an inline step, never another modal. */
export default function MotivationBulkComposer(props: Props) {
  return (
    <RNModal
      visible={props.visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={props.onClose}
      onDismiss={props.onDismiss}
    >
      <KeyboardProvider>
        <MotivationBulkForm key={props.sessionId} {...props} />
      </KeyboardProvider>
    </RNModal>
  );
}

export function MotivationBulkForm({ visible, onClose, onSaved }: Omit<Props, 'sessionId' | 'onDismiss'>) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const [warehouseId, setWarehouseId] = useState<string | null | undefined>(undefined);
  const [warehousesOpen, setWarehousesOpen] = useState(false);
  const [segment, setSegment] = useState<'products' | 'folders'>('products');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<MotivationChoice[]>([]);
  const [percent, setPercent] = useState('10');
  const [preview, setPreview] = useState<MotivationBulkResult | null>(null);
  const [replacements, setReplacements] = useState<NonNullable<MotivationBulkInput['replaceLegacyPromos']>>([]);
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(visible);
  useEffect(() => {
    active.current = visible;
    return () => {
      active.current = false;
    };
  }, [visible]);
  const request = useRef<MotivationBulkInput | null>(null);
  const generation = useRef(0);
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    enabled: visible,
  });
  const activeWarehouse =
    warehouseId === undefined
      ? (warehouses.data?.find((warehouse) => warehouse.kind === 'main') ?? warehouses.data?.[0])
      : warehouses.data?.find((warehouse) => warehouse.id === warehouseId);
  const activeWarehouseId = activeWarehouse?.id ?? null;
  const catalog = useQuery({
    queryKey: ['motivation', 'catalog', activeWarehouseId],
    queryFn: async () => {
      const [products, folders] = await Promise.all([
        loadProductCatalog(productsApi.getAll, activeWarehouseId ? { warehouseId: activeWarehouseId } : {}),
        warehouseCategoriesApi.getAll(activeWarehouseId ?? undefined).then((response) => response.data),
      ]);
      return buildMotivationChoices(products, folders, activeWarehouseId);
    },
    enabled: visible && warehouses.data !== undefined,
    // Never show the previous warehouse while a different one is loading.
    placeholderData: undefined,
  });
  const choices = useMemo(
    () => filterMotivationChoices(catalog.data?.[segment] ?? [], search),
    [catalog.data, segment, search],
  );
  const numericPercent = parseMotivationPercent(percent);
  const invalidate = () => {
    generation.current += 1;
    request.current = null;
    setPreview(null);
    setError('');
  };
  const changeSelection = (choice: MotivationChoice) => {
    if (busy.current) return;
    invalidate();
    setReplacements([]);
    setSelected((previous) => toggleMotivationChoice(previous, choice));
  };
  const close = () => {
    if (!busy.current) onClose();
  };
  const run = async (apply: boolean) => {
    if (busy.current || !selected.length || numericPercent === null) return;
    busy.current = true;
    setPending(true);
    Keyboard.dismiss();
    setError('');
    const currentGeneration = generation.current;
    // Freeze the exact apply input. A lost response must retry the same UUID,
    // preview token and payload; editing anything invalidates it first.
    if (!request.current)
      request.current = {
        targets: selected.map((choice) => choice.target),
        percent: numericPercent,
        active: true,
        requestId: randomUUID(),
        replaceLegacyPromos: replacements,
      };
    const input: MotivationBulkInput = apply
      ? { ...request.current, dryRun: false, previewRevision: preview?.previewRevision }
      : { ...request.current, dryRun: true };
    try {
      const result = (await motivationApi.bulkRules(input)).data;
      if (apply) {
        // Refresh configuration even if navigation hid this presentation;
        // a late success must never close a later, newly opened composer.
        onSaved(result, active.current && generation.current === currentGeneration);
      } else if (active.current && generation.current === currentGeneration) {
        setPreview(result);
        setReviewing(true);
      }
    } catch (cause) {
      if (!active.current || generation.current !== currentGeneration) return;
      const failure = motivationError(cause, 'Не удалось сохранить правило. Повторите попытку.');
      setError(failure.message);
      if (failure.stale) {
        request.current = null;
        setPreview(null);
        setReplacements([]);
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const changeReplacements = () => {
    if (busy.current) return;
    const next = replacements.length
      ? []
      : (preview?.legacyExceptions ?? []).map(({ productId, updatedAt }) => ({ productId, updatedAt }));
    invalidate();
    setReplacements(next);
  };

  const action = (label: string, onPress: () => void, disabled = false, testID?: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.action,
        { backgroundColor: palette.accent.primary, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text variant="callout" color={colors.white} style={styles.actionText}>
        {label}
      </Text>
    </Pressable>
  );
  const retry = (
    <QueryErrorState
      description="Не удалось загрузить склад. Выбор сохранён."
      onRetry={() => {
        void warehouses.refetch();
        void catalog.refetch();
      }}
    />
  );
  const legacyReview =
    preview?.legacyExceptions.length || replacements.length ? (
      <View style={[styles.summary, { backgroundColor: palette.bg.card }]}>
        <Text variant="bodyEmph" color={palette.text.primary}>
          Старые правила от маржи
        </Text>
        <Text color={palette.text.secondary}>
          {replacements.length
            ? `Будут заменены: ${replacements.length}. Прежние начисления сохранятся.`
            : `Сохранятся как исключения: ${preview?.legacyExceptions.length}. Для них новый процент не применяется.`}
        </Text>
        {(preview?.legacyExceptions ?? []).slice(0, 12).map((exception) => (
          <Text key={exception.productId} variant="footnote" color={palette.text.secondary}>
            {exception.productName} · {exception.percent}% от маржи{exception.active ? '' : ' · пауза'}
          </Text>
        ))}
        {(preview?.legacyExceptions.length ?? 0) > 12 ? (
          <Text variant="footnote" color={palette.text.secondary}>
            И ещё {(preview?.legacyExceptions.length ?? 0) - 12}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: replacements.length > 0, disabled: pending }}
          onPress={changeReplacements}
          disabled={pending}
          style={styles.choice}
          testID="replace-legacy"
        >
          <Ionicons
            name={replacements.length ? 'checkbox' : 'square-outline'}
            size={24}
            color={palette.accent.primary}
          />
          <Text color={palette.text.primary} style={styles.grow}>
            Заменить эти старые правила процентом от продажи
          </Text>
        </Pressable>
      </View>
    ) : null;
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={reviewing ? 'Проверка правила' : 'Товары и папки'}
        onBack={
          reviewing
            ? () => {
                if (!busy.current) setReviewing(false);
              }
            : close
        }
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор"
            onPress={close}
            disabled={pending}
            style={styles.iconButton}
          >
            <Ionicons name="close" size={24} color={palette.text.secondary} />
          </Pressable>
        }
      />

      {reviewing ? (
        <TabBarFlashList
          style={styles.grow}
          reserveBottomNavigation={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.review}
          data={selected}
          keyExtractor={(choice) => motivationTargetKey(choice.target)}
          ListHeaderComponent={
            <View style={{ gap: spacing[3], paddingBottom: spacing[3] }}>
              <Text variant="title2" color={palette.text.primary}>
                {percent}% от продажи
              </Text>
              <Text color={palette.text.secondary}>Только для новых продаж. Старые чеки не изменятся.</Text>
              <Text color={palette.text.secondary}>
                После скидки на товары. Себестоимость и услуги в расчёт не входят.
              </Text>
              <Text color={palette.text.secondary}>
                Бонус делится поровну между назначенными исполнителями. Пока исполнителей нет, начислений нет.
              </Text>
              <View style={[styles.summary, { backgroundColor: palette.bg.card }]}>
                <Text variant="bodyEmph" color={palette.text.primary}>
                  Выбрано целей: {selected.length}
                </Text>
                {preview ? (
                  <>
                    <Text color={palette.text.secondary}>Товаров в выборе сейчас: {preview.coveredProductCount}</Text>
                    <Text color={palette.text.secondary}>
                      Под новое правило попадёт: {preview.affectedProductCount}
                    </Text>
                  </>
                ) : (
                  <Text color={palette.text.secondary}>Изменения нужно проверить перед сохранением.</Text>
                )}
                {selected.some((choice) => choice.target.kind === 'folder') ? (
                  <Text variant="footnote" color={palette.text.secondary}>
                    Папки действуют постоянно: с подпапками и будущими товарами.
                  </Text>
                ) : null}
              </View>
              {legacyReview}
            </View>
          }
          renderItem={({ item: choice }) => (
            <View style={[styles.reviewRow, { borderBottomColor: palette.border.subtle }]}>
              <View style={styles.grow}>
                <Text variant="bodyEmph" color={palette.text.primary}>
                  {choice.title}
                </Text>
                <Text variant="footnote" color={palette.text.secondary}>
                  {choice.target.kind === 'folder' ? choice.path : choice.detail}
                </Text>
                <Text variant="footnote" color={palette.text.tertiary}>
                  {warehouses.data?.find((warehouse) => warehouse.id === choice.warehouseId)?.name || 'Склад'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Убрать ${choice.title}`}
                disabled={pending}
                style={styles.iconButton}
                onPress={() => changeSelection(choice)}
              >
                <Ionicons name="close-circle-outline" size={22} color={palette.text.secondary} />
              </Pressable>
            </View>
          )}
        />
      ) : (
        <>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Выбрать склад"
              accessibilityState={{ expanded: warehousesOpen }}
              onPress={() => setWarehousesOpen((value) => !value)}
              style={[styles.warehouse, { backgroundColor: palette.bg.card }]}
            >
              <Ionicons name="cube-outline" size={20} color={palette.accent.primary} />
              <Text variant="bodyEmph" color={palette.text.primary} style={styles.grow}>
                {activeWarehouse?.name || 'Склад'}
              </Text>
              <Ionicons
                name={warehousesOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={palette.text.secondary}
              />
            </Pressable>
            {warehousesOpen ? (
              <TabBarScrollView horizontal reserveBottomNavigation={false} showsHorizontalScrollIndicator={false}>
                {(warehouses.data ?? []).map((warehouse) => (
                  <Pressable
                    key={warehouse.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: warehouse.id === activeWarehouseId }}
                    onPress={() => {
                      setWarehouseId(warehouse.id);
                      setWarehousesOpen(false);
                    }}
                    style={styles.warehouseOption}
                  >
                    <Text
                      color={warehouse.id === activeWarehouseId ? palette.accent.primaryText : palette.text.secondary}
                    >
                      {warehouse.name}
                    </Text>
                  </Pressable>
                ))}
              </TabBarScrollView>
            ) : null}
            <View style={[styles.search, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="search" size={20} color={palette.text.secondary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Название, папка, артикул"
                accessibilityLabel="Поиск товаров и папок"
                placeholderTextColor={palette.text.tertiary}
                style={[styles.input, textVariantStyles.body, { color: palette.text.primary }]}
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
            <View accessibilityRole="tablist" style={[styles.segments, { backgroundColor: palette.bg.muted }]}>
              {(['products', 'folders'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: segment === value }}
                  onPress={() => setSegment(value)}
                  style={[styles.segment, segment === value && { backgroundColor: palette.bg.card }]}
                >
                  <Text variant="bodyEmph" color={segment === value ? palette.text.primary : palette.text.secondary}>
                    {value === 'products' ? 'Товары' : 'Папки'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {warehouses.isError || catalog.isError ? (
            retry
          ) : !catalog.data ? (
            <ListSkeleton count={5} />
          ) : (
            <TabBarFlashList
              style={styles.grow}
              reserveBottomNavigation={false}
              data={choices}
              keyExtractor={(choice) => motivationTargetKey(choice.target)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text variant="title3" color={palette.text.primary}>
                    {search
                      ? 'Ничего не найдено'
                      : segment === 'folders'
                        ? 'В этом складе нет папок'
                        : 'В этом складе нет товаров'}
                  </Text>
                  <Text color={palette.text.secondary}>
                    {search
                      ? 'Измените запрос. Выбранные позиции сохранены.'
                      : 'Выберите другой склад или добавьте товары в разделе «Склад».'}
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const direct = selected.some(
                  (choice) => motivationTargetKey(choice.target) === motivationTargetKey(item.target),
                );
                const inherited = !direct && selected.some((choice) => coversChoice(choice, item));
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${item.title}, ${item.detail}`}
                    accessibilityState={{ checked: direct || inherited, disabled: inherited }}
                    onPress={() => changeSelection(item)}
                    disabled={inherited}
                    style={({ pressed }) => [
                      styles.catalogRow,
                      {
                        backgroundColor: pressed ? palette.bg.muted : palette.bg.card,
                        borderBottomColor: palette.border.subtle,
                      },
                    ]}
                  >
                    <Ionicons
                      name={direct || inherited ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={direct || inherited ? palette.accent.primary : palette.text.tertiary}
                    />
                    <View style={styles.grow}>
                      <Text variant="bodyEmph" color={palette.text.primary}>
                        {item.title}
                      </Text>
                      <Text variant="footnote" color={palette.text.secondary}>
                        {item.detail}
                      </Text>
                      {item.target.kind === 'folder' ? (
                        <Text variant="footnote" color={palette.text.secondary}>
                          С подпапками и будущими товарами
                        </Text>
                      ) : null}
                      {inherited ? (
                        <Text variant="footnote" color={palette.accent.primaryText}>
                          Уже входит в выбранную папку
                        </Text>
                      ) : null}
                    </View>
                    {item.target.kind === 'folder' ? (
                      <Ionicons name="folder-outline" size={22} color={palette.text.secondary} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          )}
        </>
      )}
      <View
        style={[
          styles.footer,
          {
            backgroundColor: palette.bg.card,
            borderTopColor: palette.border.subtle,
            paddingBottom: Math.max(insets.bottom, spacing[3]),
          },
        ]}
      >
        {!reviewing ? (
          <View style={styles.percentRow}>
            <View style={styles.grow}>
              <Text variant="bodyEmph" color={palette.text.primary}>
                Общий процент от продажи
              </Text>
              <Text variant="footnote" color={palette.text.secondary}>
                Выбрано целей: {selected.length}
              </Text>
            </View>
            <View style={[styles.percentBox, { backgroundColor: palette.bg.muted }]}>
              <TextInput
                accessibilityLabel="Общий процент от продажи"
                value={percent}
                keyboardType="decimal-pad"
                style={[textVariantStyles.title3, styles.percentInput, { color: palette.text.primary }]}
                maxLength={6}
                onChangeText={(value) => {
                  invalidate();
                  setPercent(value);
                }}
              />
              <Text color={palette.text.secondary}>%</Text>
            </View>
          </View>
        ) : null}
        {numericPercent === null ? (
          <Text variant="footnote" color={palette.mode === 'dark' ? colors.red[400] : colors.red[600]}>
            Введите процент больше 0 и не больше 100, до двух знаков после запятой.
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" color={palette.mode === 'dark' ? colors.red[400] : colors.red[600]}>
            {error}
          </Text>
        ) : null}
        {action(
          pending ? 'Подождите…' : reviewing && preview ? 'Сохранить правило' : 'Проверить правило',
          () => {
            void run(reviewing && !!preview);
          },
          pending || !selected.length || numericPercent === null,
          'bulk-submit',
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: spacing[4], gap: spacing[2], paddingBottom: spacing[3] },
  warehouse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 48,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  warehouseOption: { minHeight: 48, paddingHorizontal: spacing[3], justifyContent: 'center' },
  search: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  input: { flex: 1, minHeight: 48, paddingVertical: spacing[2] },
  segments: { flexDirection: 'row', borderRadius: borderRadius.lg, padding: spacing[1] },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
  },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: 72,
    padding: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { paddingVertical: spacing[6], gap: spacing[2] },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  percentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  percentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  percentInput: { minWidth: 60, minHeight: 48, textAlign: 'right', paddingRight: spacing[2] },
  action: {
    minHeight: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[3],
  },
  actionText: { textAlign: 'center' },
  review: { padding: spacing[4], gap: spacing[3] },
  summary: { padding: spacing[4], borderRadius: borderRadius.lg, gap: spacing[2] },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[2],
  },
  choice: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: spacing[3], paddingVertical: spacing[2] },
});
