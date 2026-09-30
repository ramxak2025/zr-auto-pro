/**
 * StorageCellPickerModal — выбор ячейки хранения товара (2026-09-30).
 *
 * Показывает ячейки ОДНОГО склада (склада товара) с поиском по коду и подписи.
 * Три пути выбора:
 *   • тап по ячейке — она выбрана;
 *   • «Без адреса» — адрес снят (`onSelect(null)`);
 *   • «+ Создать ячейку» — код вводится здесь же, ячейка создаётся и сразу выбирается:
 *     склад, где ещё нет ни одной ячейки, не упирается в отдельный экран.
 *
 * Модалка закрывается сама после выбора — вызывающему не нужно помнить про `onClose`.
 *
 * Данные кеш-первые (`useStorageCells`, слот `['storage-cells', warehouseId]` греется
 * персистентным кешем), поэтому список открывается уже заполненным. Ячейки чужого
 * склада не показываются никогда: сервер отверг бы такой выбор
 * (`STORAGE_CELL_WRONG_WAREHOUSE`).
 *
 * Оформление — как FolderPickerModal (pageSheet + вложенный KeyboardProvider: RN <Modal>
 * это отдельное нативное окно). Поле ввода кода стоит вверху, под ним список — клавиатура
 * его не закрывает. Android-совместимо: RN + FlashList, iOS-only API нет.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal as RNModal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import SearchInput from './SearchInput';
import { CELL_CODE_FONT } from './StorageCellChip';
import { storageCellsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { invalidateStorageCells, toStorageCellArray, useStorageCells } from '../hooks/useStorageCells';
import { haptic } from '../platform/haptics';
import { borderRadius, colors, spacing } from '../theme';
import {
  MAX_CELL_CODE_LENGTH,
  filterStorageCells,
  parseStorageCellError,
  productsCountText,
  storageCellFailureText,
} from '../utils/storageCellsUi';
import { normalizeCellCode } from '../../../shared/utils/storageCells';
import type { StorageCell } from '../../../shared/types';

interface StorageCellPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Склад товара — ячейки читаются и создаются ТОЛЬКО на нём. */
  warehouseId: string | null | undefined;
  /** Текущая ячейка товара — отмечается галочкой. `null` — без адреса. */
  selectedCellId?: string | null;
  /** Ячейка или `null` («Без адреса»). Модалка закрывается сама. */
  onSelect: (cell: StorageCell | null) => void;
  title?: string;
  /** Вторая строка под заголовком, например название товара. */
  subtitle?: string;
  /** Показывать «Без адреса». Для выбора цели переноса товаров — выключить. */
  allowClear?: boolean;
  /** Можно ли создавать ячейку «на месте» — право `warehouse_manage`. */
  canCreate?: boolean;
  /** Ячейка, которую выбрать нельзя (например, удаляемая: в неё же не перенести). */
  excludeCellId?: string | null;
}

export default function StorageCellPickerModal({
  visible,
  onClose,
  warehouseId,
  selectedCellId = null,
  onSelect,
  title = 'Ячейка хранения',
  subtitle,
  allowClear = true,
  canCreate = true,
  excludeCellId = null,
}: StorageCellPickerModalProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useStorageCells(warehouseId, { enabled: visible });

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Каждое открытие — с чистого листа.
  useEffect(() => {
    if (visible) {
      setSearch('');
      setCreating(false);
      setNewCode('');
      setCreateError(null);
    }
  }, [visible]);

  // Ответ на создание мог прийти, когда модалку уже закрыли: тогда ячейка создана, но
  // молча подменять адрес товара выбором, которого человек не подтверждал, нельзя.
  const openRef = useRef(visible);
  openRef.current = visible;

  const cells = useMemo(() => toStorageCellArray(data), [data]);
  const available = useMemo(
    () => (excludeCellId ? cells.filter((c) => c.id !== excludeCellId) : cells),
    [cells, excludeCellId],
  );
  const filtered = useMemo(() => filterStorageCells(available, search), [available, search]);

  const finish = useCallback(
    (cell: StorageCell | null) => {
      haptic('select');
      onSelect(cell);
      onClose();
    },
    [onSelect, onClose],
  );

  const { mutate: createCell, isPending: createPending } = useMutation({
    mutationFn: async (code: string) =>
      (await storageCellsApi.create({ warehouseId: warehouseId as string, code })).data,
    onSuccess: (cell) => {
      invalidateStorageCells(queryClient);
      if (openRef.current) finish(cell);
    },
    // Свой onError обязателен: без него App.tsx покажет общий тост вместо понятного текста.
    onError: (error) => {
      setCreateError(storageCellFailureText(error, 'Не удалось создать ячейку. Проверьте связь и попробуйте ещё раз.'));
      // Дубль — значит список устарел (ячейку только что завела другая смена): обновим его.
      if (parseStorageCellError(error)?.code === 'STORAGE_CELL_EXISTS') invalidateStorageCells(queryClient);
    },
  });

  const openCreate = useCallback(() => {
    setNewCode(normalizeCellCode(search));
    setCreateError(null);
    setCreating(true);
  }, [search]);

  const submitCreate = useCallback(() => {
    if (createPending || !warehouseId) return;
    const code = normalizeCellCode(newCode);
    if (!code) return;
    const existing = cells.find((c) => normalizeCellCode(c.code) === code);
    if (existing) {
      if (existing.id === excludeCellId) {
        setCreateError('Эту ячейку выбрать нельзя — задайте другой код.');
        return;
      }
      // Уже есть на складе — не спорим с сервером, а выбираем её.
      finish(existing);
      return;
    }
    setCreateError(null);
    createCell(code);
  }, [createPending, warehouseId, newCode, cells, excludeCellId, finish, createCell]);

  const renderCell = useCallback(
    ({ item }: { item: StorageCell }) => {
      const isSelected = item.id === selectedCellId;
      const meta = [item.name, productsCountText(item.productsCount)].filter(Boolean).join(' · ');
      return (
        <TouchableOpacity
          onPress={() => finish(item)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          style={[styles.row, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
        >
          <View style={[styles.iconBox, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="file-tray-stacked-outline" size={18} color={colors.primary[500]} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowCode, { color: palette.text.primary }]} numberOfLines={1}>
              {item.code}
            </Text>
            <Text style={[styles.rowMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {isSelected ? <Ionicons name="checkmark-circle" size={18} color={colors.green[500]} /> : null}
        </TouchableOpacity>
      );
    },
    [selectedCellId, finish, palette],
  );

  const firstLoad = isLoading && cells.length === 0;
  const loadFailed = isError && cells.length === 0;
  const noCellsAtAll = !firstLoad && !loadFailed && available.length === 0;
  const searchFoundNothing = !firstLoad && !loadFailed && available.length > 0 && filtered.length === 0;
  const canSubmit = normalizeCellCode(newCode).length > 0 && !createPending;

  return (
    <RNModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardProvider>
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="close" size={20} color={palette.text.primary} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={[styles.headerSubtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.headerBtn} />
          </View>

          {warehouseId ? (
            <>
              <View style={styles.searchWrap}>
                <SearchInput value={search} onChange={setSearch} placeholder="Поиск ячейки..." />
              </View>

              <View style={styles.fixedRows}>
                {allowClear ? (
                  <TouchableOpacity
                    onPress={() => finish(null)}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !selectedCellId }}
                    style={[styles.row, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
                  >
                    <View style={[styles.iconBox, { backgroundColor: palette.bg.muted }]}>
                      <Ionicons name="remove-circle-outline" size={18} color={palette.text.tertiary} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={[styles.rowName, { color: palette.text.primary }]}>Без адреса</Text>
                      <Text style={[styles.rowMeta, { color: palette.text.tertiary }]}>Товар не привязан к ячейке</Text>
                    </View>
                    {!selectedCellId ? <Ionicons name="checkmark-circle" size={18} color={colors.green[500]} /> : null}
                  </TouchableOpacity>
                ) : null}

                {canCreate && !creating ? (
                  <TouchableOpacity
                    onPress={openCreate}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    style={[styles.row, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
                  >
                    <View style={[styles.iconBox, { backgroundColor: palette.accent.primarySoft }]}>
                      <Ionicons name="add" size={20} color={colors.primary[500]} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={[styles.rowName, { color: palette.accent.primary }]}>Создать ячейку</Text>
                      <Text style={[styles.rowMeta, { color: palette.text.tertiary }]}>
                        Новая ячейка сразу станет адресом товара
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : null}

                {canCreate && creating ? (
                  <View
                    style={[styles.createBox, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                  >
                    <Text style={[styles.createLabel, { color: palette.text.secondary }]}>Код новой ячейки</Text>
                    <View style={styles.createRow}>
                      <TextInput
                        value={newCode}
                        onChangeText={(t) => {
                          setNewCode(t);
                          setCreateError(null);
                        }}
                        autoFocus
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={MAX_CELL_CODE_LENGTH}
                        returnKeyType="done"
                        onSubmitEditing={submitCreate}
                        placeholder="Например, A-1-2"
                        placeholderTextColor={palette.text.tertiary}
                        style={[
                          styles.createInput,
                          {
                            backgroundColor: palette.bg.muted,
                            borderColor: createError ? colors.red[500] : palette.border.subtle,
                            color: palette.text.primary,
                          },
                        ]}
                      />
                      <TouchableOpacity
                        onPress={submitCreate}
                        disabled={!canSubmit}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        style={[
                          styles.createBtn,
                          { backgroundColor: canSubmit ? colors.primary[600] : palette.bg.muted },
                        ]}
                      >
                        {createPending ? (
                          <ActivityIndicator color={colors.white} size="small" />
                        ) : (
                          <Text
                            style={[styles.createBtnText, { color: canSubmit ? colors.white : palette.text.tertiary }]}
                          >
                            Создать
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                    {createError ? (
                      <Text style={[styles.createError, { color: colors.red[600] }]}>{createError}</Text>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View style={styles.listWrap}>
                {firstLoad ? (
                  <ActivityIndicator color={colors.primary[600]} style={{ marginTop: spacing[8] }} />
                ) : loadFailed ? (
                  <View style={styles.empty}>
                    <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
                    <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
                      Не удалось загрузить ячейки
                    </Text>
                    <TouchableOpacity
                      onPress={() => refetch()}
                      accessibilityRole="button"
                      style={[styles.retryBtn, { backgroundColor: palette.bg.muted }]}
                    >
                      <Text style={[styles.retryText, { color: palette.accent.primary }]}>Повторить</Text>
                    </TouchableOpacity>
                  </View>
                ) : noCellsAtAll ? (
                  <View style={styles.empty}>
                    <Ionicons name="file-tray-stacked-outline" size={40} color={palette.text.tertiary} />
                    <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
                      На этом складе пока нет ячеек
                    </Text>
                    <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                      {canCreate
                        ? 'Создайте первую — она сразу станет адресом товара.'
                        : 'Ячейки заводит сотрудник с правом управления складом.'}
                    </Text>
                  </View>
                ) : searchFoundNothing ? (
                  <View style={styles.empty}>
                    <Ionicons name="search-outline" size={40} color={palette.text.tertiary} />
                    <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Ячейки не найдены</Text>
                    {canCreate ? (
                      <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                        Можно создать ячейку с таким кодом.
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <FlashList
                    data={filtered}
                    extraData={selectedCellId}
                    keyExtractor={(item) => item.id}
                    renderItem={renderCell}
                    contentContainerStyle={styles.list}
                    keyboardShouldPersistTaps="handled"
                  />
                )}
              </View>
            </>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="business-outline" size={40} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Склад не выбран</Text>
              <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
                Ячейки относятся к складу — откройте склад товара и повторите.
              </Text>
            </View>
          )}
        </SafeAreaView>
      </KeyboardProvider>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', gap: 1, minWidth: 0 },
  headerTitle: { textAlign: 'center', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, fontWeight: '500' },

  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[1] },
  fixedRows: { paddingHorizontal: spacing[4] },
  listWrap: { flex: 1 },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowCode: { fontFamily: CELL_CODE_FONT, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  rowName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  rowMeta: { fontSize: 12 },

  createBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginTop: spacing[2],
    gap: spacing[2],
  },
  createLabel: { fontSize: 12, fontWeight: '600' },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  createInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontFamily: CELL_CODE_FONT,
    fontSize: 15,
  },
  createBtn: {
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  createBtnText: { fontSize: 15, fontWeight: '700' },
  createError: { fontSize: 12, fontWeight: '500', lineHeight: 16 },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[10],
    paddingHorizontal: spacing[6],
    gap: spacing[3],
  },
  emptyText: { fontSize: 14, fontWeight: '500', textAlign: 'center' },
  emptyHint: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  retryBtn: { paddingHorizontal: spacing[5], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  retryText: { fontSize: 14, fontWeight: '600' },
});
