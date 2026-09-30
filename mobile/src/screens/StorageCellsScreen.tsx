/**
 * StorageCellsScreen — «Ячейки хранения» (2026-09-30, docs/ios-redesign/STORAGE_CELLS_2026-09-30.md).
 *
 * Справочник ячеек ОДНОГО склада (чипы складов — если их несколько) со счётчиком товаров
 * в каждой. Отсюда ячейки заводят по одной или сеткой «стеллажи × полки × ячейки»,
 * переименовывают и удаляют; тап по ячейке открывает «Склад», отфильтрованный по ней.
 *
 * Права: чтение — `warehouse_access`, изменение — `warehouse_manage`. Без второго кнопки
 * управления скрыты: сервер всё равно отклонил бы запрос, а мёртвая кнопка только путает.
 * Экран лежит в стеке «Склад» — плавающий таб-бар виден, edge-swipe возвращает к складу.
 *
 * Данные кеш-первые: `['storage-cells', warehouseId]` греется персистентным кешем, поэтому
 * список появляется сразу. Мутации инвалидируют ячейки и товары (код ячейки стоит чипом в
 * строке склада и в подборе Кассы). У КАЖДОЙ мутации свой `onError`: без него App.tsx
 * покажет общий тост вместо понятного текста («ячейка уже есть», «ячейка не пуста»).
 *
 * Android-совместимо: RN + FlashList + BottomSheet, iOS-only API нет.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { BottomSheet } from '../components/BottomSheet';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import PointIndicator from '../components/PointIndicator';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import { CELL_CODE_FONT } from '../components/StorageCellChip';
import StorageCellPickerModal from '../components/StorageCellPickerModal';
import { Text } from '../platform/Typography';
import { storageCellsApi, warehousesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import {
  invalidateStorageCells,
  invalidateStorageCellsAndProducts,
  storageCellsQueryKey,
  toStorageCellArray,
  useStorageCells,
} from '../hooks/useStorageCells';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { borderRadius, colors, fontWeight, softTint, spacing } from '../theme';
import {
  MAX_CELL_CODE_LENGTH,
  MAX_CELL_NAME_LENGTH,
  STORAGE_CELL_TAKEN_TEXT,
  buildCellGridPreview,
  bulkResultMessage,
  cellsCountText,
  filterStorageCells,
  formatBigCount,
  formatCodesSample,
  parseStorageCellError,
  productsCountText,
  storageCellFailureText,
  storageCellFormFailureText,
} from '../utils/storageCellsUi';
import { MAX_BULK_CELLS, normalizeCellCode } from '../../../shared/utils/storageCells';
import type { UpdateStorageCellRequest } from '../../../shared/api/types';
import type { StorageCell, Warehouse } from '../../../shared/types';

/** Пауза между закрытием одной модалки и открытием следующей — та же, что в ProductsScreen. */
const MODAL_CHAIN_DELAY_MS = 300;
const LONG_PRESS_MS = 350;

/** Разделитель частей кода сетки; пустой — «слитно» (A11). */
const SEPARATORS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '-', label: '-' },
  { value: '.', label: '.' },
  { value: '/', label: '/' },
  { value: '', label: 'Слитно' },
];

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface DeleteVars {
  cell: StorageCell;
  /** Ячейка ТОГО ЖЕ склада, куда переехать товарам. */
  moveTo?: string;
  /** Снять адрес у товаров и удалить ячейку. */
  detach?: boolean;
}

const keyExtractor = (item: StorageCell) => item.id;

function ItemSeparator() {
  return <View style={styles.separator} />;
}

// ─── Строка ячейки ────────────────────────────────────────────────────────────

interface CellRowProps {
  cell: StorageCell;
  canManage: boolean;
  onOpen: (cell: StorageCell) => void;
  onMenu: (cell: StorageCell) => void;
  onLongPress: (cell: StorageCell) => void;
}

const CellRow = React.memo(function CellRow({ cell, canManage, onOpen, onMenu, onLongPress }: CellRowProps) {
  const palette = useColors();
  const count = cell.productsCount ?? 0;
  const countText = count > 0 ? productsCountText(count) : 'Пусто';
  const meta = [cell.name, countText].filter(Boolean).join(' · ');
  return (
    <TouchableOpacity
      onPress={() => onOpen(cell)}
      onLongPress={canManage ? () => onLongPress(cell) : undefined}
      delayLongPress={LONG_PRESS_MS}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={`Ячейка ${cell.code}, ${meta}`}
      accessibilityHint="Открыть товары в ячейке"
      style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={[styles.iconBox, { backgroundColor: palette.accent.primarySoft }]}>
        <Ionicons name="file-tray-stacked-outline" size={18} color={colors.primary[500]} />
      </View>
      <View style={styles.rowInfo}>
        <Text style={[styles.rowCode, { color: palette.text.primary }]} numberOfLines={1}>
          {cell.code}
        </Text>
        <Text variant="caption" color={palette.text.tertiary} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {canManage ? (
        <TouchableOpacity
          onPress={() => onMenu(cell)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={`Действия с ячейкой ${cell.code}`}
          style={styles.moreBtn}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={palette.text.tertiary} />
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      )}
    </TouchableOpacity>
  );
});

// ─── Пункт листа действий ─────────────────────────────────────────────────────

interface SheetItemProps {
  icon: IoniconName;
  title: string;
  description: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}

function SheetItem({ icon, title, description, onPress, danger = false, last = false }: SheetItemProps) {
  const palette = useColors();
  const accent = danger ? colors.red : colors.blue;
  const iconBg = palette.mode === 'dark' ? softTint(accent[600], 'dark') : accent[50];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.sheetItem, { borderBottomColor: palette.border.subtle }, last && styles.sheetItemLast]}
    >
      <View style={[styles.sheetIcon, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={20} color={accent[600]} />
      </View>
      <View style={styles.sheetInfo}>
        <Text style={[styles.sheetTitle, { color: danger ? colors.red[600] : palette.text.primary }]}>{title}</Text>
        <Text style={[styles.sheetDesc, { color: palette.text.tertiary }]}>{description}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </TouchableOpacity>
  );
}

// ─── Форма одной ячейки (создать / переименовать) ─────────────────────────────

interface CellFormSheetProps {
  visible: boolean;
  onClose: () => void;
  /** `null` — новая ячейка. */
  cell: StorageCell | null;
  warehouseId: string | undefined;
  /** Ячейки склада — для проверки дубля до запроса. */
  cells: StorageCell[];
}

function CellFormSheet({ visible, onClose, cell, warehouseId, cells }: CellFormSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={cell ? 'Переименовать ячейку' : 'Новая ячейка'}
      heightRatio={0.6}
    >
      {warehouseId ? <CellFormBody cell={cell} warehouseId={warehouseId} cells={cells} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

// Тело живёт только пока лист открыт (RN Modal размонтирует детей) — каждое открытие с чистого листа.
function CellFormBody({
  cell,
  warehouseId,
  cells,
  onDone,
}: {
  cell: StorageCell | null;
  warehouseId: string;
  cells: StorageCell[];
  onDone: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(cell?.code ?? '');
  const [name, setName] = useState(cell?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<TextInput>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const isEdit = !!cell;
  const nextCode = normalizeCellCode(code);
  const nextName = name.trim();

  const { mutate, isPending } = useMutation({
    mutationFn: async (vars: { code: string; name: string }) => {
      if (!cell) {
        return (
          await storageCellsApi.create({ warehouseId, code: vars.code, ...(vars.name ? { name: vars.name } : {}) })
        ).data;
      }
      // Шлём только изменённое: лишний `code` без изменений упёрся бы в проверку дубля самой себя.
      const patch: UpdateStorageCellRequest = {};
      if (vars.code !== normalizeCellCode(cell.code)) patch.code = vars.code;
      if (vars.name !== (cell.name ?? '')) patch.name = vars.name || null;
      return (await storageCellsApi.update(cell.id, patch)).data;
    },
    onSuccess: () => {
      if (isEdit) invalidateStorageCellsAndProducts(queryClient);
      else invalidateStorageCells(queryClient);
      if (aliveRef.current) onDone();
    },
    onError: (err) => {
      setError(storageCellFormFailureText(err, 'Не удалось сохранить ячейку. Проверьте связь и попробуйте ещё раз.'));
      // Дубль — значит список устарел (ячейку только что завела другая смена): обновим его.
      if (parseStorageCellError(err)?.code === 'STORAGE_CELL_EXISTS') invalidateStorageCells(queryClient);
    },
  });

  const handleSubmit = useCallback(() => {
    if (isPending) return;
    if (!nextCode) {
      setError('Введите код ячейки.');
      return;
    }
    if (cells.some((c) => c.id !== cell?.id && normalizeCellCode(c.code) === nextCode)) {
      setError(STORAGE_CELL_TAKEN_TEXT);
      return;
    }
    if (cell && nextCode === normalizeCellCode(cell.code) && nextName === (cell.name ?? '')) {
      onDone();
      return;
    }
    setError(null);
    mutate({ code: nextCode, name: nextName });
  }, [isPending, nextCode, nextName, cells, cell, onDone, mutate]);

  const canSubmit = nextCode.length > 0 && !isPending;
  const inputStyle = [
    styles.input,
    {
      backgroundColor: palette.bg.muted,
      borderColor: error ? colors.red[500] : palette.border.subtle,
      color: palette.text.primary,
    },
  ];

  return (
    <View>
      <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
        Код ячейки
      </Text>
      <TextInput
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setError(null);
        }}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={MAX_CELL_CODE_LENGTH}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => nameRef.current?.focus()}
        placeholder="Например, A-1-2"
        placeholderTextColor={palette.text.tertiary}
        accessibilityLabel="Код ячейки"
        style={[inputStyle, styles.inputMono]}
      />

      <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
        Подпись (необязательно)
      </Text>
      <TextInput
        ref={nameRef}
        value={name}
        onChangeText={(t) => {
          setName(t);
          setError(null);
        }}
        maxLength={MAX_CELL_NAME_LENGTH}
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        placeholder="Например, у входа"
        placeholderTextColor={palette.text.tertiary}
        accessibilityLabel="Подпись ячейки"
        style={inputStyle}
      />

      {error ? (
        <Text variant="footnote" color={colors.red[600]} style={styles.formError} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={!canSubmit}
        activeOpacity={0.85}
        accessibilityRole="button"
        style={[styles.submitBtn, { backgroundColor: canSubmit ? colors.primary[600] : palette.bg.muted }]}
      >
        {isPending ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text variant="callout" color={canSubmit ? colors.white : palette.text.tertiary}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Сетка «стеллажи × полки × ячейки» ────────────────────────────────────────

interface CellGridSheetProps {
  visible: boolean;
  onClose: () => void;
  warehouseId: string | undefined;
  cells: StorageCell[];
}

function CellGridSheet({ visible, onClose, warehouseId, cells }: CellGridSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Создать сетку ячеек" heightRatio={0.92}>
      {warehouseId ? <CellGridBody warehouseId={warehouseId} cells={cells} onDone={onClose} /> : null}
    </BottomSheet>
  );
}

function CellGridBody({
  warehouseId,
  cells,
  onDone,
}: {
  warehouseId: string;
  cells: StorageCell[];
  onDone: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [racksText, setRacksText] = useState('');
  const [shelves, setShelves] = useState('');
  const [perShelf, setPerShelf] = useState('');
  const [separator, setSeparator] = useState('-');
  const [padZeros, setPadZeros] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Коды и счётчик считают функции shared/utils/storageCells — те же, что примет сервер.
  const preview = useMemo(
    () => buildCellGridPreview({ racksText, shelves, cells: perShelf, separator, padZeros }),
    [racksText, shelves, perShelf, separator, padZeros],
  );
  const existing = useMemo(() => new Set(cells.map((c) => normalizeCellCode(c.code))), [cells]);
  const alreadyCount = useMemo(
    () => (preview.canCreate ? preview.codes.filter((c) => existing.has(c)).length : 0),
    [preview, existing],
  );
  const toCreate = preview.canCreate ? preview.count - alreadyCount : 0;

  const { mutate, isPending } = useMutation({
    mutationFn: async (codes: string[]) => (await storageCellsApi.bulkCreate({ warehouseId, codes })).data,
    onSuccess: ({ created, skipped }) => {
      invalidateStorageCells(queryClient);
      // Итог показываем, даже если лист успели закрыть: запрос мог идти до минуты.
      Alert.alert(created > 0 ? 'Ячейки созданы' : 'Ничего не создано', bulkResultMessage(created, skipped));
      if (aliveRef.current) onDone();
    },
    onError: (err) => {
      setError(storageCellFailureText(err, 'Не удалось создать ячейки. Проверьте связь и попробуйте ещё раз.'));
      invalidateStorageCells(queryClient);
    },
  });

  const canSubmit = preview.canCreate && toCreate > 0 && !isPending;
  const submit = useCallback(() => {
    if (!canSubmit) return;
    setError(null);
    mutate(preview.codes);
  }, [canSubmit, mutate, preview]);

  const inputStyle = [
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ];

  let previewNode: React.ReactNode;
  if (preview.racksInvalid) {
    previewNode = (
      <Text variant="footnote" color={colors.red[600]}>
        Не удалось разобрать стеллажи. Введите диапазон (A-C, А-Г, 1-5) или список через запятую (A, B, C) — не больше
        100 стеллажей.
      </Text>
    );
  } else if (preview.overLimit) {
    previewNode = (
      <Text variant="footnote" color={colors.red[600]}>
        {`Слишком много ячеек: ${formatBigCount(preview.count)}. За один раз можно создать не больше ${formatBigCount(
          MAX_BULK_CELLS,
        )} — уменьшите число стеллажей, полок или ячеек.`}
      </Text>
    );
  } else if (preview.count === 0) {
    previewNode = (
      <Text variant="footnote" color={palette.text.tertiary}>
        Заполните хотя бы одно поле — например, стеллажи A-C, полок 3, ячеек на полке 4: получится A-1-1 … C-3-4.
      </Text>
    );
  } else {
    previewNode = (
      <>
        <Text variant="bodyEmph" color={palette.text.primary}>
          {toCreate > 0 ? `Будет создано: ${cellsCountText(toCreate)}` : 'Все такие ячейки уже есть на складе'}
        </Text>
        <Text style={[styles.previewSample, { color: palette.text.secondary }]} numberOfLines={2}>
          {formatCodesSample(preview.codes)}
        </Text>
        {alreadyCount > 0 && toCreate > 0 ? (
          <Text variant="caption" color={palette.text.tertiary}>
            {`Уже есть на складе: ${alreadyCount} — они будут пропущены`}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <View>
      <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
        Стеллажи
      </Text>
      <TextInput
        value={racksText}
        onChangeText={(t) => {
          setRacksText(t);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={80}
        returnKeyType="done"
        placeholder="A-C"
        placeholderTextColor={palette.text.tertiary}
        accessibilityLabel="Стеллажи"
        style={[inputStyle, styles.inputMono]}
      />
      <Text variant="caption" color={palette.text.tertiary} style={styles.fieldHint}>
        Диапазон (A-C, А-Г, 1-5) или список через запятую (A, B, C)
      </Text>

      <View style={styles.twoCols}>
        <View style={styles.col}>
          <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
            Полок в стеллаже
          </Text>
          <TextInput
            value={shelves}
            onChangeText={(t) => {
              setShelves(t.replace(/\D+/g, ''));
              setError(null);
            }}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="3"
            placeholderTextColor={palette.text.tertiary}
            accessibilityLabel="Полок в стеллаже"
            style={inputStyle}
          />
        </View>
        <View style={styles.col}>
          <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
            Ячеек на полке
          </Text>
          <TextInput
            value={perShelf}
            onChangeText={(t) => {
              setPerShelf(t.replace(/\D+/g, ''));
              setError(null);
            }}
            keyboardType="number-pad"
            maxLength={5}
            placeholder="4"
            placeholderTextColor={palette.text.tertiary}
            accessibilityLabel="Ячеек на полке"
            style={inputStyle}
          />
        </View>
      </View>

      <Text variant="caption" color={palette.text.secondary} style={styles.fieldLabel}>
        Разделитель в коде
      </Text>
      <View style={styles.sepRow}>
        {SEPARATORS.map((s) => {
          const active = separator === s.value;
          return (
            <TouchableOpacity
              key={s.label}
              onPress={() => {
                if (active) return;
                haptic('select');
                setSeparator(s.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={s.value ? `Разделитель ${s.label}` : 'Без разделителя'}
              style={[
                styles.sepChip,
                {
                  backgroundColor: active ? colors.primary[600] : palette.bg.muted,
                  borderColor: palette.border.subtle,
                },
              ]}
            >
              <Text
                variant="footnote"
                color={active ? colors.white : palette.text.secondary}
                style={s.value ? styles.sepChipMono : styles.sepChipText}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.switchRow}>
        <View style={styles.switchInfo}>
          <Text variant="bodyEmph" color={palette.text.primary}>
            Ведущие нули
          </Text>
          <Text variant="caption" color={palette.text.tertiary}>
            01, 02 … вместо 1, 2 — ячейки ровнее выстраиваются в списке
          </Text>
        </View>
        <Switch
          value={padZeros}
          onValueChange={(v) => {
            haptic('select');
            setPadZeros(v);
          }}
          trackColor={{ false: palette.border.subtle, true: colors.green[500] }}
          thumbColor={Platform.OS === 'android' ? colors.white : undefined}
          ios_backgroundColor={palette.border.subtle}
        />
      </View>

      <View style={[styles.previewBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
        {previewNode}
      </View>

      {error ? (
        <Text variant="footnote" color={colors.red[600]} style={styles.formError} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <TouchableOpacity
        onPress={submit}
        disabled={!canSubmit}
        activeOpacity={0.85}
        accessibilityRole="button"
        style={[styles.submitBtn, { backgroundColor: canSubmit ? colors.primary[600] : palette.bg.muted }]}
      >
        {isPending ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <Text variant="callout" color={canSubmit ? colors.white : palette.text.tertiary}>
            {toCreate > 0 ? `Создать ${cellsCountText(toCreate)}` : 'Создать'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Экран ────────────────────────────────────────────────────────────────────

export default function StorageCellsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('warehouse_manage');
  const canRead = hasPermission('warehouse_access') || canManage;

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(route.params?.warehouseId ?? null);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Открытость окон отделена от данных, на которые они смотрят: закрывающийся лист не теряет
  // содержимое в последнем кадре, а повторное открытие всегда задаёт данные заново.
  const [menuCell, setMenuCell] = useState<StorageCell | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [formCell, setFormCell] = useState<StorageCell | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const [deleteCell, setDeleteCell] = useState<StorageCell | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveCell, setMoveCell] = useState<StorageCell | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);

  // RN Modal закрывается асинхронно: следующее окно открываем через паузу, иначе iOS
  // отвечает «already presenting». Таймеры сбрасываем при уходе с экрана.
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const later = useCallback((fn: () => void) => {
    timers.current.push(setTimeout(fn, MODAL_CHAIN_DELAY_MS));
  }, []);

  // ── Склады (кеш общий с «Складом» и «Инвентаризацией») ─────────────────────
  const {
    data: warehouses,
    isLoading: warehousesLoading,
    isError: warehousesError,
    refetch: refetchWarehouses,
  } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await warehousesApi.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 60_000,
    enabled: canRead,
  });

  const activeWarehouse = useMemo<Warehouse | null>(() => {
    if (!warehouses || warehouses.length === 0) return null;
    if (selectedWarehouseId) {
      const found = warehouses.find((w) => w.id === selectedWarehouseId);
      if (found) return found;
    }
    return warehouses.find((w) => w.kind === 'main') ?? warehouses[0];
  }, [warehouses, selectedWarehouseId]);
  const activeWarehouseId = activeWarehouse?.id;

  // ── Ячейки выбранного склада ───────────────────────────────────────────────
  const cellsQuery = useStorageCells(activeWarehouseId, { enabled: canRead });
  const { isLoading: cellsLoading, isError: cellsError, refetch: refetchCells } = cellsQuery;
  const cells = useMemo(() => toStorageCellArray(cellsQuery.data), [cellsQuery.data]);
  // Актуальный список — для решений «пуста ли ячейка», принятых спустя время после тапа.
  const cellsRef = useRef(cells);
  cellsRef.current = cells;
  const filtered = useMemo(() => filterStorageCells(cells, search), [cells, search]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchCells();
    } finally {
      setRefreshing(false);
    }
  }, [refetchCells]);

  // ── Удаление ───────────────────────────────────────────────────────────────
  const deleteRef = useRef<(vars: DeleteVars) => void>(() => {});

  // Не пустую ячейку не удаляем молча: товары либо переезжают, либо остаются без адреса.
  const askNonEmpty = useCallback(
    (cell: StorageCell) => {
      const count = productsCountText(cell.productsCount);
      Alert.alert(
        `Ячейка ${cell.code} не пуста`,
        `В ней ${count}. Перенесите товары в другую ячейку или снимите с них адрес — на складе они останутся, но без ячейки.`,
        [
          {
            text: `Перенести ${count}`,
            onPress: () =>
              later(() => {
                setMoveCell(cell);
                setMoveOpen(true);
              }),
          },
          {
            text: 'Открепить',
            style: 'destructive',
            onPress: () => {
              haptic('warning');
              deleteRef.current({ cell, detach: true });
            },
          },
          { text: 'Отмена', style: 'cancel' },
        ],
        { cancelable: true },
      );
    },
    [later],
  );

  const deleteMutation = useMutation({
    mutationFn: async ({ cell, moveTo, detach }: DeleteVars) =>
      (await storageCellsApi.remove(cell.id, moveTo ? { moveTo } : detach ? { detach: true } : undefined)).data,
    onSuccess: (_data, { cell }) => {
      // Строка исчезает сразу, не дожидаясь перезапроса.
      queryClient.setQueryData<StorageCell[]>(storageCellsQueryKey(cell.warehouseId), (old) =>
        Array.isArray(old) ? old.filter((c) => c.id !== cell.id) : old,
      );
      invalidateStorageCellsAndProducts(queryClient);
    },
    onError: (error, { cell }) => {
      const parsed = parseStorageCellError(error);
      if (parsed?.code === 'STORAGE_CELL_NOT_EMPTY') {
        // Пока экран смотрели, в «пустую» ячейку положили товар (или число изменилось): спрашиваем заново.
        invalidateStorageCellsAndProducts(queryClient);
        askNonEmpty({ ...cell, productsCount: Math.max(1, parsed.productsCount ?? cell.productsCount) });
        return;
      }
      Alert.alert('Не удалось удалить ячейку', storageCellFailureText(error, 'Проверьте связь и попробуйте ещё раз.'));
    },
  });
  deleteRef.current = deleteMutation.mutate;
  const deleting = deleteMutation.isPending;

  const startDelete = useCallback(
    (cell: StorageCell) => {
      if (deleting) return;
      const fresh = cellsRef.current.find((c) => c.id === cell.id) ?? cell;
      if (fresh.productsCount > 0) {
        askNonEmpty(fresh);
        return;
      }
      setDeleteCell(fresh);
      setDeleteOpen(true);
    },
    [askNonEmpty, deleting],
  );

  // ── Действия ───────────────────────────────────────────────────────────────
  const openCellProducts = useCallback(
    (cell: StorageCell) => {
      navigation.push('ProductsHome', {
        storageCellId: cell.id,
        storageCellCode: cell.code,
        warehouseId: cell.warehouseId,
      });
    },
    [navigation],
  );

  const openMenu = useCallback((cell: StorageCell) => {
    setMenuCell(cell);
    setMenuOpen(true);
  }, []);

  const handleLongPress = useCallback(
    (cell: StorageCell) => {
      haptic('select');
      openMenu(cell);
    },
    [openMenu],
  );

  const openCreateForm = useCallback(() => {
    setFormCell(null);
    setFormOpen(true);
  }, []);

  const menuShowProducts = () => {
    const cell = menuCell;
    setMenuOpen(false);
    if (cell) openCellProducts(cell);
  };
  const menuRename = () => {
    const cell = menuCell;
    setMenuOpen(false);
    if (!cell) return;
    later(() => {
      setFormCell(cell);
      setFormOpen(true);
    });
  };
  const menuDelete = () => {
    const cell = menuCell;
    setMenuOpen(false);
    if (cell) later(() => startDelete(cell));
  };

  const renderCell = useCallback(
    ({ item }: { item: StorageCell }) => (
      <CellRow
        cell={item}
        canManage={canManage}
        onOpen={openCellProducts}
        onMenu={openMenu}
        onLongPress={handleLongPress}
      />
    ),
    [canManage, openCellProducts, openMenu, handleLongPress],
  );

  if (!canRead) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
        <IosScreenHeader title="Ячейки хранения" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="lock"
          title="Недостаточно прав"
          description="Ячейки хранения доступны сотрудникам с доступом к складу."
        />
      </SafeAreaView>
    );
  }

  const subtitle =
    [activeWarehouse?.name, cells.length > 0 ? cellsCountText(cells.length) : null].filter(Boolean).join(' · ') ||
    undefined;

  let content: React.ReactNode;
  if (warehousesLoading && !warehouses) {
    content = <ListSkeleton />;
  } else if (warehousesError && !warehouses) {
    content = (
      <EmptyState
        icon="warning"
        title="Не удалось загрузить"
        description="Проверьте соединение и повторите."
        action={{ label: 'Повторить', onPress: () => refetchWarehouses() }}
      />
    );
  } else if (!activeWarehouse) {
    content = <EmptyState icon="warehouse" title="Склад не найден" description="У компании пока нет складов." />;
  } else if (cellsLoading && cells.length === 0) {
    content = <ListSkeleton />;
  } else if (cellsError && cells.length === 0) {
    content = (
      <EmptyState
        icon="warning"
        title="Не удалось загрузить"
        description="Проверьте соединение и повторите."
        action={{ label: 'Повторить', onPress: () => refetchCells() }}
      />
    );
  } else if (cells.length === 0) {
    content = (
      <EmptyState
        icon="cube"
        title="Ячеек пока нет"
        description={
          canManage
            ? 'Нажмите «Добавить», чтобы завести ячейку, или «Создать сетку» — сразу все стеллажи, полки и ячейки.'
            : 'Ячейки заводит сотрудник с правом управления складом.'
        }
      />
    );
  } else if (filtered.length === 0) {
    content = (
      <EmptyState icon="search" title="Ячейки не найдены" description={`По запросу «${search.trim()}» ничего нет.`} />
    );
  } else {
    content = (
      <FlashList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderCell}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary[600]}
            colors={[colors.primary[600]]}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: spacing[4],
          paddingTop: spacing[2],
          paddingBottom: tabBarHeight + spacing[4],
        }}
        ItemSeparatorComponent={ItemSeparator}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Ячейки хранения"
        subtitle={subtitle}
        onBack={() => navigation.goBack()}
        trailing={
          deleting ? (
            <View style={styles.headerSpinner}>
              <ActivityIndicator size="small" color={colors.primary[600]} />
            </View>
          ) : undefined
        }
      />
      <PointIndicator variant="chip" style={styles.pointChipRow} />

      {warehouses && warehouses.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsOuter}
          contentContainerStyle={styles.chipsScroll}
        >
          {warehouses.map((w) => {
            const active = w.id === activeWarehouseId;
            return (
              <TouchableOpacity
                key={w.id}
                onPress={() => {
                  if (active) return;
                  haptic('select');
                  setSelectedWarehouseId(w.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary[600] : palette.bg.muted,
                    borderColor: palette.border.subtle,
                  },
                ]}
              >
                <Text variant="caption" color={active ? colors.white : palette.text.secondary} style={styles.chipText}>
                  {w.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск ячейки..." />
      </View>

      {canManage && activeWarehouse ? (
        <View style={styles.actionRow}>
          <TouchableOpacity
            onPress={openCreateForm}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Добавить ячейку"
            style={[styles.actionBtn, { backgroundColor: colors.primary[600] }]}
          >
            <Ionicons name="add" size={18} color={colors.white} />
            <Text variant="footnote" color={colors.white} style={styles.actionBtnText} numberOfLines={1}>
              Добавить
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setGridOpen(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Создать сетку ячеек"
            style={[styles.actionBtn, { backgroundColor: palette.accent.primarySoft }]}
          >
            <Ionicons name="grid-outline" size={16} color={palette.accent.primaryText} />
            <Text variant="footnote" color={palette.accent.primaryText} style={styles.actionBtnText} numberOfLines={1}>
              Создать сетку
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {content}

      <BottomSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={menuCell ? `Ячейка ${menuCell.code}` : 'Ячейка'}
        heightRatio={0.5}
      >
        <SheetItem
          icon="cube-outline"
          title="Товары в ячейке"
          description="Открыть склад, отфильтрованный по этой ячейке"
          onPress={menuShowProducts}
        />
        <SheetItem
          icon="create-outline"
          title="Переименовать"
          description="Изменить код или подпись ячейки"
          onPress={menuRename}
        />
        <SheetItem
          icon="trash-outline"
          title="Удалить"
          description="Пустую — сразу, с товарами — перенести или открепить"
          onPress={menuDelete}
          danger
          last
        />
      </BottomSheet>

      <CellFormSheet
        visible={formOpen}
        onClose={() => setFormOpen(false)}
        cell={formCell}
        warehouseId={activeWarehouseId}
        cells={cells}
      />
      <CellGridSheet
        visible={gridOpen}
        onClose={() => setGridOpen(false)}
        warehouseId={activeWarehouseId}
        cells={cells}
      />

      <ConfirmDialog
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          haptic('warning');
          if (deleteCell) deleteMutation.mutate({ cell: deleteCell });
        }}
        title={deleteCell ? `Удалить ячейку ${deleteCell.code}?` : 'Удалить ячейку?'}
        message="Ячейка пуста, товары не пострадают."
        confirmText="Удалить"
        variant="danger"
      />

      <StorageCellPickerModal
        visible={moveOpen}
        onClose={() => setMoveOpen(false)}
        warehouseId={moveCell?.warehouseId ?? activeWarehouseId}
        excludeCellId={moveCell?.id}
        allowClear={false}
        canCreate={canManage}
        title="Куда перенести"
        subtitle={moveCell ? `Товары из ячейки ${moveCell.code}` : undefined}
        onSelect={(target) => {
          if (target && moveCell) deleteMutation.mutate({ cell: moveCell, moveTo: target.id });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  pointChipRow: { marginHorizontal: spacing[4], marginBottom: spacing[2], alignSelf: 'flex-start' },
  headerSpinner: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  chipsOuter: { flexGrow: 0, flexShrink: 0 },
  chipsScroll: { gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[1], alignItems: 'center' },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontWeight: fontWeight.medium },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[1] },
  actionRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
  },
  actionBtnText: { fontWeight: fontWeight.semibold },

  separator: { height: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowCode: { fontFamily: CELL_CODE_FONT, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  moreBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetItemLast: { borderBottomWidth: 0 },
  sheetIcon: { width: 44, height: 44, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  sheetInfo: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 15, fontWeight: '600' },
  sheetDesc: { fontSize: 12, marginTop: 2 },

  fieldLabel: { fontWeight: fontWeight.semibold, marginTop: spacing[3], marginBottom: spacing[1.5] },
  fieldHint: { marginTop: spacing[1.5] },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: 15,
  },
  inputMono: { fontFamily: CELL_CODE_FONT },
  formError: { marginTop: spacing[2.5] },
  submitBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
  },

  twoCols: { flexDirection: 'row', gap: spacing[3] },
  col: { flex: 1, minWidth: 0 },
  sepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  sepChip: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sepChipText: { fontWeight: fontWeight.medium },
  sepChipMono: { fontFamily: CELL_CODE_FONT, fontWeight: fontWeight.bold },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[4] },
  switchInfo: { flex: 1, minWidth: 0, gap: 2 },
  previewBox: {
    marginTop: spacing[4],
    padding: spacing[3],
    gap: spacing[1],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewSample: { fontFamily: CELL_CODE_FONT, fontSize: 13, lineHeight: 18 },
});
