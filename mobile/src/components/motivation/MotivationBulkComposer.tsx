import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal as RNModal,
  View,
  Pressable,
  StyleSheet,
  TextInput,
  Keyboard,
  InputAccessoryView,
  Platform,
  Switch,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import type { MotivationBulkInput, MotivationBulkResult } from '../../../../shared/types';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import { motivationApi, productsApi, warehouseCategoriesApi, warehousesApi } from '../../api/services';
import { useColors } from '../../contexts/ThemeContext';
import { Text, textVariantStyles } from '../../platform/Typography';
import { borderRadius, colors, spacing } from '../../theme';
import QueryErrorState from '../QueryErrorState';
import { ListSkeleton } from '../Skeleton';
import { TabBarScrollView } from '../TabBarScrollable';
import {
  buildMotivationChoices,
  coversChoice,
  filterMotivationChoices,
  motivationError,
  motivationApplyTargets,
  motivationTargetKey,
  parseMotivationPercent,
  toggleMotivationChoice,
  type MotivationChoice,
} from './selection';
import ScreenSectionHeader, { useScreenSectionScroll } from '../ScreenSectionHeader';
import { ScreenSectionFlashList, ScreenSectionScrollView } from '../ScreenSectionScrollable';
import { HeaderAction, HeaderIsland, headerTouchSize } from '../ScreenHeaderControls';

interface Props {
  visible: boolean;
  sessionId: number;
  onClose: () => void;
  onDismiss: () => void;
  onSaved: (result: MotivationBulkResult, presentationActive: boolean) => void;
}

/** One native presentation; review is an inline step, never another modal. */
export default function MotivationBulkComposer(props: Props) {
  const closeBlocked = useRef(false);
  return (
    <RNModal
      visible={props.visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        if (!closeBlocked.current) props.onClose();
      }}
      onDismiss={props.onDismiss}
    >
      <KeyboardProvider>
        <MotivationBulkForm
          key={props.sessionId}
          {...props}
          onCloseBlockedChange={(blocked) => {
            closeBlocked.current = blocked;
          }}
        />
      </KeyboardProvider>
    </RNModal>
  );
}

export function MotivationBulkForm({
  visible,
  onClose,
  onSaved,
  onCloseBlockedChange,
}: Omit<Props, 'sessionId' | 'onDismiss'> & { onCloseBlockedChange?: (blocked: boolean) => void }) {
  const section = useScreenSectionScroll();
  const palette = useColors();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [warehouseId, setWarehouseId] = useState<string | null | undefined>(undefined);
  const [warehousesOpen, setWarehousesOpen] = useState(false);
  const [segment, setSegment] = useState<'products' | 'folders'>('products');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selected, setSelected] = useState<MotivationChoice[]>([]);
  const [percent, setPercent] = useState('10');
  const [beforeDiscount, setBeforeDiscount] = useState(false);
  const [preview, setPreview] = useState<MotivationBulkResult | null>(null);
  const [replacements, setReplacements] = useState<NonNullable<MotivationBulkInput['replaceLegacyPromos']>>([]);
  const [reviewing, setReviewing] = useState(false);

  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const locked = pending || uncertain;
  useEffect(() => {
    onCloseBlockedChange?.(locked);
  }, [locked, onCloseBlockedChange]);
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
  const applyRequest = useRef<MotivationBulkInput | null>(null);
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
  const effectiveTargets = motivationApplyTargets(
    selected.map((choice) => choice.target),
    replacements,
  );
  const targetSummary = `Папок: ${effectiveTargets.filter((target) => target.kind === 'folder').length} · Товаров: ${effectiveTargets.filter((target) => target.kind === 'product').length}`;
  const replaceableExceptions = (preview?.legacyExceptions ?? []).filter(
    (exception) => !exception.replacementBlockedReason,
  );
  const blockedExceptions = (preview?.legacyExceptions ?? []).filter(
    (exception) => !!exception.replacementBlockedReason,
  );
  const replacementDisabled = locked || (!replacements.length && !replaceableExceptions.length);
  const invalidate = () => {
    generation.current += 1;
    request.current = null;
    applyRequest.current = null;
    setPreview(null);
    setError('');
  };
  const changeSelection = (choice: MotivationChoice) => {
    if (busy.current || uncertain) return;
    invalidate();
    setReplacements([]);
    setSelected((previous) => toggleMotivationChoice(previous, choice));
  };
  const close = () => {
    if (!busy.current && !uncertain) onClose();
  };
  const run = async (apply: boolean) => {
    if (busy.current || !selected.length || numericPercent === null || (apply && !preview)) return;
    busy.current = true;
    setPending(true);
    Keyboard.dismiss();
    setError('');
    const currentGeneration = generation.current;
    // Freeze the exact apply input. A lost response must retry the same UUID,
    // preview token and payload; editing anything invalidates it first.
    if (!request.current)
      request.current = {
        targets: effectiveTargets,
        percent: numericPercent,
        beforeDiscount,
        active: true,
        requestId: randomUUID(),
        replaceLegacyPromos: replacements,
      };
    const input: MotivationBulkInput = apply
      ? (applyRequest.current ?? { ...request.current, dryRun: false, previewRevision: preview?.previewRevision })
      : { ...request.current, dryRun: true };
    if (apply) applyRequest.current = input;
    const wasUncertain = uncertain;
    try {
      const result = (await motivationApi.bulkRules(input)).data;
      if (result?.beforeDiscount !== input.beforeDiscount) {
        if (apply) void queryClient.invalidateQueries({ queryKey: ['motivation'] });
        if (!active.current || generation.current !== currentGeneration) return;
        setError('Сервер не подтвердил выбранный способ расчёта. Обновите настройки перед повтором');
        if (apply) setUncertain(true);
        else {
          request.current = null;
          setPreview(null);
        }
        return;
      }
      setUncertain(false);
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
      const status = (cause as { response?: { status?: number } })?.response?.status;
      const definiteRejection = typeof status === 'number' && status >= 400 && status < 500 && status !== 408;
      if (!wasUncertain && (failure.stale || definiteRejection)) {
        request.current = null;
        applyRequest.current = null;
        setPreview(null);
        setReplacements([]);
        setUncertain(false);
      } else if (apply) setUncertain(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  const changeReplacements = () => {
    if (busy.current || uncertain) return;
    const next = replacements.length
      ? []
      : replaceableExceptions.map(({ productId, updatedAt }) => ({ productId, updatedAt }));
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
          <View key={exception.productId}>
            <Text variant="footnote" color={palette.text.secondary}>
              {exception.productName} · {exception.percent}% от маржи{exception.active ? '' : ' · пауза'}
            </Text>
            {exception.replacementBlockedReason ? (
              <View accessible accessibilityRole="checkbox" accessibilityState={{ checked: false, disabled: true }}>
                <Text variant="footnote" color={palette.text.secondary}>
                  Замена недоступна: {exception.replacementBlockedReason}
                </Text>
              </View>
            ) : null}
          </View>
        ))}
        {(preview?.legacyExceptions.length ?? 0) > 12 ? (
          <Text variant="footnote" color={palette.text.secondary}>
            И ещё {(preview?.legacyExceptions.length ?? 0) - 12}
          </Text>
        ) : null}
        {blockedExceptions.length ? (
          <Text variant="footnote" color={palette.text.secondary}>
            Сохранятся без замены: {blockedExceptions.length}.{' '}
            {[...new Set(blockedExceptions.map((exception) => exception.replacementBlockedReason))].join(' ')}
          </Text>
        ) : null}
        {replacements.length ? (
          <Text variant="footnote" color={palette.text.secondary}>
            Для заменяемых товаров будут сохранены отдельные правила от продажи.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: replacements.length > 0, disabled: replacementDisabled }}
          onPress={changeReplacements}
          disabled={replacementDisabled}
          style={styles.choice}
          testID="replace-legacy"
        >
          <Ionicons
            name={replacements.length ? 'checkbox' : 'square-outline'}
            size={24}
            color={palette.accent.primary}
          />
          <Text color={palette.text.primary} style={styles.grow}>
            Заменить доступные старые правила процентом от продажи (
            {replacements.length || replaceableExceptions.length})
          </Text>
        </Pressable>
      </View>
    ) : null;
  // A replacement native scroller starts at zero; keep the heading on that same offset.
  const sectionBody = reviewing
    ? 'review'
    : warehouses.isError || catalog.isError || !catalog.data
      ? 'catalog-state'
      : 'catalog-list';
  React.useEffect(() => section.reset(), [sectionBody, section.reset]);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <ScreenSectionHeader scroll={section} title={reviewing ? 'Проверка правила' : 'Товары и папки'}>
        <HeaderIsland layout="column">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <HeaderAction
              label="Назад"
              icon="chevron-back"
              onPress={
                reviewing
                  ? () => {
                      if (!busy.current && !uncertain) setReviewing(false);
                    }
                  : close
              }
            />
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {
                <Pressable
                  accessibilityState={{ disabled: Boolean(locked) }}
                  accessibilityRole="button"
                  accessibilityLabel="Закрыть выбор"
                  onPress={close}
                  disabled={locked}
                  style={[styles.iconButton, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                >
                  <Ionicons name="close" size={24} color={palette.text.secondary} />
                </Pressable>
              }
            </View>
          </View>
          {!reviewing ? (
            <View style={styles.controls}>
              {!searchFocused ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Выбрать склад"
                    accessibilityState={{ expanded: warehousesOpen }}
                    onPress={() => setWarehousesOpen((value) => !value)}
                    style={[
                      [styles.warehouse, { backgroundColor: palette.bg.card }],
                      { minWidth: headerTouchSize, minHeight: headerTouchSize },
                    ]}
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
                          style={[styles.warehouseOption, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                        >
                          <Text
                            color={
                              warehouse.id === activeWarehouseId ? palette.accent.primaryText : palette.text.secondary
                            }
                          >
                            {warehouse.name}
                          </Text>
                        </Pressable>
                      ))}
                    </TabBarScrollView>
                  ) : null}
                </>
              ) : null}
              <View style={[styles.search, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="search" size={20} color={palette.text.secondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  onSubmitEditing={Keyboard.dismiss}
                  placeholder="Название, папка, артикул"
                  accessibilityLabel="Поиск товаров и папок"
                  placeholderTextColor={palette.text.tertiary}
                  style={[styles.input, textVariantStyles.body, { color: palette.text.primary }]}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </View>
              {!searchFocused ? (
                <View accessibilityRole="tablist" style={[styles.segments, { backgroundColor: palette.bg.muted }]}>
                  {(['products', 'folders'] as const).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: segment === value }}
                      onPress={() => setSegment(value)}
                      style={[
                        [styles.segment, segment === value && { backgroundColor: palette.bg.card }],
                        { minWidth: headerTouchSize, minHeight: headerTouchSize },
                      ]}
                    >
                      <Text
                        variant="bodyEmph"
                        color={segment === value ? palette.text.primary : palette.text.secondary}
                      >
                        {value === 'products' ? 'Товары' : 'Папки'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </HeaderIsland>
      </ScreenSectionHeader>

      {reviewing ? (
        <ScreenSectionFlashList
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          style={styles.grow}
          reserveBottomNavigation={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.review, { paddingTop: section.contentTop + spacing[4] }]}
          data={selected}
          keyExtractor={(choice) => motivationTargetKey(choice.target)}
          ListHeaderComponent={
            <View style={{ gap: spacing[3], paddingBottom: spacing[3] }}>
              <Text variant="title2" color={palette.text.primary}>
                {percent}% от продажи
              </Text>
              <Text color={palette.text.secondary}>Только для новых продаж. Старые чеки не изменятся.</Text>
              <Text color={palette.text.secondary}>
                {beforeDiscount ? 'До скидки на товары.' : 'После скидки на товары.'} Себестоимость и услуги в расчёт не
                входят.
              </Text>
              <Text color={palette.text.secondary}>
                Бонус делится поровну между назначенными исполнителями. Пока исполнителей нет, начислений нет.
              </Text>
              <View style={[styles.summary, { backgroundColor: palette.bg.card }]}>
                <Text variant="bodyEmph" color={palette.text.primary}>
                  {targetSummary}
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
              <Text variant="footnote" color={palette.text.secondary}>
                Индивидуальные и вложенные правила сохраняются, если не выбраны отдельно.
              </Text>
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
                disabled={locked}
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
          {warehouses.isError || catalog.isError ? (
            <ScreenSectionScrollView
              style={{ flex: 1 }}
              onScroll={section.onScroll}
              scrollEventThrottle={16}
              contentInsetAdjustmentBehavior="never"
              reserveBottomNavigation={false}
              contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
            >
              {retry}
            </ScreenSectionScrollView>
          ) : !catalog.data ? (
            <ScreenSectionScrollView
              style={{ flex: 1 }}
              onScroll={section.onScroll}
              scrollEventThrottle={16}
              contentInsetAdjustmentBehavior="never"
              reserveBottomNavigation={false}
              contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop + 12, paddingBottom: 24 }}
            >
              <ListSkeleton count={5} />
            </ScreenSectionScrollView>
          ) : (
            <ScreenSectionFlashList
              onScroll={section.onScroll}
              scrollEventThrottle={16}
              contentInsetAdjustmentBehavior="never"
              style={styles.grow}
              reserveBottomNavigation={false}
              data={choices}
              keyExtractor={(choice) => motivationTargetKey(choice.target)}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.list, { paddingTop: section.contentTop }]}
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
                    accessibilityState={{ checked: direct }}
                    onPress={() => changeSelection(item)}
                    style={({ pressed }) => [
                      styles.catalogRow,
                      {
                        backgroundColor: pressed ? palette.bg.muted : palette.bg.card,
                        borderBottomColor: palette.border.subtle,
                      },
                    ]}
                  >
                    <Ionicons
                      name={direct ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={direct ? palette.accent.primary : palette.text.tertiary}
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
                          В выбранной папке · можно выбрать отдельно
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
      {!searchFocused ? (
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
                  {targetSummary}
                </Text>
              </View>
              <View style={[styles.percentBox, { backgroundColor: palette.bg.muted }]}>
                <TextInput
                  accessibilityLabel="Общий процент от продажи"
                  value={percent}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={Platform.OS === 'ios' ? 'motivation-bulk-percent-done' : undefined}
                  style={[textVariantStyles.title3, styles.percentInput, { color: palette.text.primary }]}
                  maxLength={6}
                  editable={!locked}
                  onChangeText={(value) => {
                    if (locked) return;
                    invalidate();
                    setPercent(value);
                  }}
                />
                <Text color={palette.text.secondary}>%</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.percentRow}>
            <Text color={palette.text.primary} style={styles.grow}>
              Считать процент до скидки
            </Text>
            <Switch
              accessibilityLabel="Считать процент до скидки"
              testID="before-discount"
              value={beforeDiscount}
              disabled={locked}
              onValueChange={(value) => {
                if (busy.current || uncertain) return;
                invalidate();
                setBeforeDiscount(value);
              }}
            />
          </View>
          <Text variant="footnote" color={palette.text.secondary}>
            {beforeDiscount ? 'Скидка не уменьшает бонус.' : 'Скидка уменьшает бонус.'} При цене 1 000 ₽, скидке 200 ₽ и
            ставке 8%: {beforeDiscount ? '80 ₽' : '64 ₽'}.
          </Text>
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
            pending
              ? 'Подождите…'
              : uncertain
                ? 'Повторить сохранение'
                : reviewing && preview
                  ? 'Сохранить правило'
                  : 'Проверить правило',
            () => {
              void run(reviewing && !!preview);
            },
            pending || !selected.length || numericPercent === null,
            'bulk-submit',
          )}
        </View>
      ) : null}
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID="motivation-bulk-percent-done" backgroundColor={palette.bg.card}>
          <View style={styles.keyboardAccessory}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Скрыть клавиатуру процента"
              onPress={Keyboard.dismiss}
              style={styles.keyboardDone}
            >
              <Text variant="callout" color={palette.accent.primaryText}>
                Готово
              </Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardAccessory: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing[4] },
  keyboardDone: { minHeight: 44, minWidth: 64, justifyContent: 'center', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: 0, gap: spacing[2], paddingBottom: 0 },
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
