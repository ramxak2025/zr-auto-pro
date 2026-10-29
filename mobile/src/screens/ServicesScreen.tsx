import React, { useCallback, useEffect, useState } from 'react';
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

import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { servicesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import NewCatalogFolderModal from '../components/NewCatalogFolderModal';
import { captureDataSession } from '../contexts/dataSession';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import * as XLSX from 'xlsx';
import type { Service, ServiceVisibilityConfig, ServicePriceHistoryEntry, ServiceFolder } from '../../../shared/types';
import type { ServiceImportPreview } from '../../../shared/api/types';
import { normalizeServiceCategoryPath } from '../../../shared/utils/normalizeServiceCategoryPath';
import {
  assertNoServiceWorkbookFormulas,
  assertServiceWorkbookSafe,
  parseServiceImportMatrix,
  serviceExportMatrix,
  serviceWorkbookBytesFromBase64,
} from '../../../shared/utils/serviceSpreadsheet';
import { loadAllPages } from '../../../shared/utils/loadAllPages';
import { serviceBrowserLevel } from '../../../shared/utils/serviceBrowser';
import { servicePriceFormValue, preservePlaceholderServicePrice } from '../../../shared/utils/servicePrices';
import { TabBarScrollView as ScrollView, TabBarFlashList as FlashList } from '../components/TabBarScrollable';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── ServiceRow ────────────────────────────────────────────────────────
// Memoised row — module scope so React.memo's identity is stable across
// parent re-renders. Inline form rebuilt every time the parent screen
// re-rendered (which happens on every search keystroke, page advance,
// or background SWR refetch).
interface ServiceRowProps {
  item: Service;
  index: number;
  onOpen: (s: Service) => void;
  onHistory: (s: Service) => void;
  /** ROLE-ONLY: без services_manage строка не открывает редактор (только просмотр). */
  canManage: boolean;
  onVisibility?: (target: { kind: 'service'; id: string; label: string }) => void;
  visibilityEnabled: boolean;
  palette: ReturnType<typeof useColors>;
}
const ServiceRow = React.memo(function ServiceRow({ item, onHistory, palette }: ServiceRowProps) {
  return (
    <TouchableOpacity
      onPress={() => onHistory(item)}
      activeOpacity={0.65}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, открыть услугу`}
      style={[styles.serviceCard, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
    >
      <View style={styles.serviceRow}>
        <View style={styles.serviceInfo}>
          <Text style={[styles.serviceName, { color: palette.text.primary }]}>{item.name}</Text>
          {item.category && (
            <Text style={[styles.serviceCategory, { color: palette.text.secondary }]}>{item.category}</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
          <Text style={[styles.servicePrice, { color: palette.text.primary }]}>
            {item.priceType === 'range'
              ? `${formatMoney(item.minPrice ?? item.defaultPrice)} – ${formatMoney(item.maxPrice ?? item.defaultPrice)}`
              : formatMoney(item.defaultPrice)}
          </Text>
          <Text style={{ color: palette.text.tertiary, fontSize: 12 }}>Подробнее</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      </View>
    </TouchableOpacity>
  );
});

export default function ServicesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { hasPermission, user } = useAuth();
  // ROLE-ONLY (консолидация 2026-07): управление каталогом (создать/редактировать/
  // удалить, менять %+гарантию) — только с services_manage. «Права как в
  // Битрикс24» (2026-07): admin живёт по матрице из /auth/me; superadmin/
  // director байпасятся внутри hasPermission. Без права — просмотр (screen
  // открыт по services_view) + добавление в чек (в Кассе). Бэкенд шлёт 403 на
  // мутации, поэтому кнопки прячем — никаких мёртвых кнопок.
  const canManageServices = hasPermission('services_manage');
  const isOwner = user?.role === 'director' || user?.role === 'superadmin';
  const [showAllServices, setShowAllServices] = useState(false);
  const preferredOnly = !isOwner && !showAllServices;
  const tabBarHeight = useTabBarHeight();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [priceType, setPriceType] = useState<'fixed' | 'range'>('fixed');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  // Особый % мастера — необязательное поле. Пусто = null (берётся личный
  // процент мастера, сегодняшнее поведение). Явный 0 сохраняется как 0
  // (мастер получает 0 за эту услугу). Заданное число 0..100 переопределяет
  // личный процент мастера для строки с этой услугой. Семантика уже
  // проверяется на бэке (Service.masterPercent) — контракт менять не нужно.
  const [masterPercent, setMasterPercent] = useState('');
  const [masterPayMode, setMasterPayMode] = useState<'percent' | 'fixed'>('percent');
  const [masterFixedAmount, setMasterFixedAmount] = useState('');
  const [confirmPrice, setConfirmPrice] = useState(false);
  // Срок гарантии (дней) — необязательное поле. Пусто = без гарантии (null
  // на бэке). Число > 0 — сколько дней действует гарантия на услугу после
  // включения её в чек. Используется для авто-создания WarrantyClaim'ов.
  const [warrantyDays, setWarrantyDays] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Service | null>(null);
  const [historyTab, setHistoryTab] = useState<'work' | 'prices'>('work');
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => {
    setHistoryTab('work');
    setHistoryPage(1);
  }, [historyTarget?.id]);
  const executionQuery = useQuery({
    queryKey: ['service-executions', historyTarget?.id, historyPage],
    queryFn: async () =>
      historyTarget
        ? (await servicesApi.executionHistory(historyTarget.id, { page: historyPage, limit: 20 })).data
        : null,
    enabled: !!historyTarget && historyTab === 'work',
  });
  const folderQuery = useQuery<ServiceFolder[]>({
    queryKey: ['service-folders'],
    queryFn: async () => (await servicesApi.folders.list()).data,
  });
  const [folderEditor, setFolderEditor] = useState<{ path: string | null; name: string; parentPath: string } | null>(
    null,
  );
  const [newFolder, setNewFolder] = useState<{
    parentPath: string;
    session: ReturnType<typeof captureDataSession>;
  } | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const saveFolder = async () => {
    if (!folderEditor || !folderEditor.name.trim() || folderBusy) return;
    setFolderBusy(true);
    try {
      if (!folderEditor.path) return;
      await servicesApi.folders.rename(folderEditor.path, folderEditor.name.trim(), folderEditor.parentPath);
      setFolderEditor(null);
      setActivePath([]);
      invalidateCatalog();
      void folderQuery.refetch();
    } catch {
      Alert.alert('Папка не сохранена', 'Проверьте название и повторите.');
    } finally {
      setFolderBusy(false);
    }
  };
  const folderActions = (path: string) =>
    Alert.alert(path, 'Управление папкой', [
      {
        text: 'Переименовать',
        onPress: () =>
          setFolderEditor({
            path,
            name: path.split('/').pop() ?? '',
            parentPath: path.split('/').slice(0, -1).join('/'),
          }),
      },
      {
        text: 'Удалить папку',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Удалить папку?',
            'Услуги из папки и подпапок будут перемещены в родительскую папку. Цены и история сохранятся.',
            [
              { text: 'Отмена', style: 'cancel' },
              {
                text: 'Удалить',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await servicesApi.folders.remove(path);
                    setActivePath([]);
                    invalidateCatalog();
                    void folderQuery.refetch();
                  } catch {
                    Alert.alert('Ошибка', 'Не удалось удалить папку');
                  }
                },
              },
            ],
          ),
      },
      { text: 'Отмена', style: 'cancel' },
    ]);

  const historyQuery = useQuery<ServicePriceHistoryEntry[]>({
    queryKey: ['service-price-history', historyTarget?.id],
    queryFn: async () => {
      if (!historyTarget) return [];
      return (await servicesApi.priceHistory(historyTarget.id)).data;
    },
    enabled: !!historyTarget && historyTab === 'prices',
  });
  const [visibilityTarget, setVisibilityTarget] = useState<
    { kind: 'service'; id: string; label: string } | { kind: 'category'; path: string } | null
  >(null);
  const [visibilityRoleIds, setVisibilityRoleIds] = useState<string[]>([]);
  const [visibilityRuleActive, setVisibilityRuleActive] = useState(false);
  const [folderListOpen, setFolderListOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ServiceImportPreview | null>(null);
  const [importRequestId, setImportRequestId] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const importStatusLabel = importPreview ? 'Импорт услуг…' : 'Подготовка импорта…';

  const { data, isLoading, isError, refetch } = useQuery<Service[]>({
    queryKey: ['services', { preferredOnly }],
    queryFn: () =>
      loadAllPages(async (page, limit) => (await servicesApi.getAll({ page, limit, preferredOnly })).data, 500),
  });

  const visibilityConfigQuery = useQuery<ServiceVisibilityConfig>({
    queryKey: ['service-visibility-config'],
    queryFn: async () => (await servicesApi.getVisibilityConfig()).data,
    enabled: canManageServices,
  });
  const invalidateCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: ['services'] });
    void queryClient.invalidateQueries({ queryKey: ['all-services'] });
    void queryClient.invalidateQueries({ queryKey: ['service-visibility-config'] });
  };
  const saveRule = async (reset = false) => {
    if (!visibilityTarget) return;
    try {
      if (reset) {
        if (visibilityTarget.kind === 'service') await servicesApi.deleteServiceVisibilityRule(visibilityTarget.id);
        else await servicesApi.deleteCategoryVisibilityRule(visibilityTarget.path);
      } else {
        await servicesApi.putVisibilityRule(
          visibilityTarget.kind === 'service'
            ? { serviceId: visibilityTarget.id, visibleRoleIds: visibilityRoleIds }
            : { categoryPath: visibilityTarget.path, visibleRoleIds: visibilityRoleIds },
        );
      }
      invalidateCatalog();
      setVisibilityTarget(null);
      haptic('success');
    } catch {
      haptic('error');
      Alert.alert('Ошибка', reset ? 'Не удалось сбросить правило' : 'Не удалось сохранить правило');
    }
  };
  const openVisibility = (target: NonNullable<typeof visibilityTarget>) => {
    if (!visibilityConfigQuery.isSuccess) {
      Alert.alert('Не готово', 'Сначала загрузите настройки ролей и папок.');
      void visibilityConfigQuery.refetch();
      return;
    }
    const canonicalTarget =
      target.kind === 'category' ? { ...target, path: normalizeServiceCategoryPath(target.path) } : target;
    const rule = visibilityConfigQuery.data.rules.find((item) =>
      canonicalTarget.kind === 'service'
        ? item.serviceId === canonicalTarget.id
        : normalizeServiceCategoryPath(item.categoryPath ?? '') === canonicalTarget.path,
    );
    setVisibilityRoleIds(rule ? [...rule.visibleRoleIds] : []);
    setVisibilityRuleActive(!!rule);
    setVisibilityTarget(canonicalTarget);
  };

  const createMutation = useMutation({
    mutationFn: (d: any) => servicesApi.create(d),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      // Касса reads the full list under its own key — keep it fresh too.
      queryClient.invalidateQueries({ queryKey: ['all-services'] });
      closeModal();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Ошибка при создании');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => servicesApi.update(id, data),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['all-services'] });
      closeModal();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Ошибка при обновлении');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      queryClient.invalidateQueries({ queryKey: ['all-services'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Ошибка при удалении');
    },
  });

  const openCreate = () => {
    setEditingService(null);
    setConfirmPrice(false);
    setName('');
    setCategory(activePath.join('/'));
    setDefaultPrice('');
    setPriceType('fixed');
    setMinPrice('');
    setMaxPrice('');
    setMasterPercent('');
    setMasterPayMode('percent');
    setMasterFixedAmount('');
    setWarrantyDays('');
    setModalOpen(true);
  };

  const openEdit = useCallback((s: Service) => {
    setEditingService(s);
    setConfirmPrice(false);
    setName(s.name);
    setCategory(s.category || '');
    setDefaultPrice(String(s.defaultPrice));
    setPriceType(s.priceType ?? 'fixed');
    setMinPrice(String(s.minPrice ?? s.defaultPrice));
    setMaxPrice(String(s.maxPrice ?? s.defaultPrice));
    // masterPercent — number | null. Пустая строка = null (личный процент
    // мастера). Явный 0 показываем как «0», не как пусто.
    setMasterPercent(s.masterPercent != null ? String(s.masterPercent) : '');
    setMasterPayMode(s.masterPayMode ?? 'percent');
    setMasterFixedAmount(s.masterFixedAmount != null ? String(s.masterFixedAmount) : '');
    // warrantyDays приходит как number | null — пустая строка означает «без
    // гарантии», иначе показываем число дней.
    setWarrantyDays(s.warrantyDays != null ? String(s.warrantyDays) : '');
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingService(null);
  };

  // Только цифры и одна десятичная точка (веб разрешает шаг 0.5). Запятую
  // приводим к точке для удобства ввода на iOS/Android.
  const onChangeMasterPercent = (t: string) => {
    const cleaned = t.replace(',', '.').replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    setMasterPercent(parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned);
  };

  const handleSubmit = () => {
    // Парсим warrantyDays: пустая строка → null (нет гарантии). Число < 1
    // тоже считаем «нет гарантии», чтобы не плодить мусорные WarrantyClaim'ы.
    const trimmedWarranty = warrantyDays.trim();
    const parsedWarranty = trimmedWarranty === '' ? null : Math.max(0, Math.floor(Number(trimmedWarranty) || 0));
    const warrantyPayload = parsedWarranty && parsedWarranty > 0 ? parsedWarranty : null;
    // masterPercent: пусто → null (личный процент мастера). Иначе — число,
    // зажатое в 0..100. Явный 0 остаётся 0 (не превращаем в null/пусто).
    const trimmedPercent = masterPercent.trim();
    let masterPercentPayload: number | null = null;
    if (trimmedPercent !== '') {
      const n = Number(trimmedPercent);
      masterPercentPayload = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
    }
    let pricePolicy;
    try {
      pricePolicy = servicePriceFormValue(priceType, defaultPrice, minPrice, maxPrice);
    } catch (error) {
      Alert.alert('Проверьте цену', error instanceof Error ? error.message : 'Введите корректную цену.');
      return;
    }
    const fixedAmount = masterFixedAmount.trim() === '' ? NaN : Number(masterFixedAmount.replace(',', '.'));
    if (
      masterPayMode === 'fixed' &&
      (!Number.isFinite(fixedAmount) || fixedAmount < 0 || fixedAmount > 9999999999.99)
    ) {
      Alert.alert('Проверьте начисление', 'Укажите фикс мастеру в рублях. Для нуля введите 0.');
      return;
    }
    const payload = {
      name,
      category: category || undefined,
      ...pricePolicy,
      masterPercent: masterPercentPayload,
      masterPayMode,
      masterFixedAmount: masterPayMode === 'fixed' ? fixedAmount : null,
      warrantyDays: warrantyPayload,
    };
    if (editingService) {
      const updatePayload = {
        name: payload.name,
        category: payload.category,
        masterPercent: payload.masterPercent,
        masterPayMode: payload.masterPayMode,
        masterFixedAmount: payload.masterFixedAmount,
        warrantyDays: payload.warrantyDays,
        ...(preservePlaceholderServicePrice(editingService, pricePolicy, confirmPrice) ? {} : pricePolicy),
      };
      updateMutation.mutate({ id: editingService.id, data: updatePayload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['services'] });
    setRefreshing(false);
  };

  const exportCatalog = async () => {
    try {
      const response = await servicesApi.exportCatalog();
      const sheet = XLSX.utils.aoa_to_sheet(serviceExportMatrix(response.data));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'Услуги');
      const base64 = XLSX.write(book, { type: 'base64', bookType: 'xlsx' }) as string;
      const directory = FileSystem.cacheDirectory;
      if (!directory) throw new Error('Нет временной папки для файла');
      const uri = `${directory}Каталог-услуг-Autexa.xlsx`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
      if (!(await Sharing.isAvailableAsync())) throw new Error('На этом устройстве недоступна отправка файла');
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Экспорт услуг',
      });
    } catch (error) {
      Alert.alert('Экспорт не выполнен', error instanceof Error ? error.message : 'Не удалось выгрузить каталог услуг');
    }
  };

  const chooseImportFile = async () => {
    setImportBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
          'text/csv',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const file = picked.assets[0];
      if ((file.size ?? 0) > 5 * 1024 * 1024) throw new Error('Файл больше 5 МБ');
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
      const bytes = serviceWorkbookBytesFromBase64(base64);
      assertServiceWorkbookSafe(bytes);
      const book = XLSX.read(base64, { type: 'base64', raw: true, cellFormula: true, sheetRows: 2001 });
      assertNoServiceWorkbookFormulas(Object.values(book.Sheets) as Array<Record<string, { f?: unknown }>>);
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error('В книге нет листа с услугами');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
      const rows = parseServiceImportMatrix(matrix);
      const preview = await servicesApi.previewImport(rows);
      setImportPreview(preview.data);
      setImportRequestId(Crypto.randomUUID());
    } catch (error) {
      Alert.alert('Импорт не выполнен', error instanceof Error ? error.message : 'Не удалось прочитать файл услуг');
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!importPreview || !importRequestId || importPreview.summary.errors > 0) return;
    setImportBusy(true);
    try {
      const result = await servicesApi.confirmImport(importPreview.previewId, importRequestId);
      await queryClient.invalidateQueries({ queryKey: ['services'] });
      await queryClient.invalidateQueries({ queryKey: ['all-services'] });
      haptic('success');
      Alert.alert('Импорт завершён', `Создано: ${result.data.created}. Обновлено: ${result.data.updated}.`);
      setImportPreview(null);
      setImportRequestId(null);
    } catch (error) {
      haptic('error');
      const status = (error as { response?: { status?: number } })?.response?.status;
      Alert.alert(
        'Импорт не выполнен',
        status === 409
          ? 'Каталог изменился после просмотра. Загрузите файл повторно.'
          : 'Изменения не применены. Повторите подтверждение.',
      );
    } finally {
      setImportBusy(false);
    }
  };

  const services = data ?? [];
  const total = services.length;
  const [activePath, setActivePath] = useState<string[]>([]);
  const { folders, currentServices } = React.useMemo(
    () => serviceBrowserLevel(services, folderQuery.data ?? [], activePath, search),
    [services, folderQuery.data, activePath, search],
  );

  const renderService = useCallback(
    ({ item, index }: { item: Service; index: number }) => (
      <ServiceRow
        item={item}
        index={index}
        onOpen={openEdit}
        onHistory={setHistoryTarget}
        canManage={canManageServices}
        onVisibility={openVisibility}
        visibilityEnabled={visibilityConfigQuery.isSuccess}
        palette={palette}
      />
    ),
    [openEdit, canManageServices, openVisibility, visibilityConfigQuery.isSuccess, palette],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Услуги"
        subtitle={total > 0 ? `Услуг: ${total}` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          canManageServices ? (
            <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
              <Text style={styles.addBtnText}>+ Новая</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[4],
          marginHorizontal: spacing[4],
          paddingVertical: spacing[2],
        }}
      >
        {!isOwner && (
          <TouchableOpacity
            onPress={() => {
              setShowAllServices((value) => !value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: showAllServices }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1] }}>
              <Ionicons
                name={showAllServices ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={colors.primary[600]}
              />
              <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>
                {showAllServices ? 'Показ по роли' : 'Все услуги'}
              </Text>
            </View>
          </TouchableOpacity>
        )}
        {canManageServices && (
          <TouchableOpacity
            disabled={!visibilityConfigQuery.isSuccess}
            onPress={() => setFolderListOpen(true)}
            accessibilityRole="button"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[1],
              opacity: visibilityConfigQuery.isSuccess ? 1 : 0.45,
            }}
          >
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary[600]} />
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>Видимость</Text>
          </TouchableOpacity>
        )}
      </View>
      {canManageServices && visibilityConfigQuery.isError && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[2],
          }}
        >
          <Text style={{ color: colors.red[500], flex: 1 }}>Не удалось загрузить настройки видимости.</Text>
          <TouchableOpacity onPress={() => void visibilityConfigQuery.refetch()} accessibilityRole="button">
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

      {canManageServices && (
        <View
          style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[4], paddingHorizontal: spacing[4] }}
        >
          <TouchableOpacity
            onPress={() => void exportCatalog()}
            accessibilityRole="button"
            accessibilityLabel="Экспортировать каталог в Excel"
          >
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>Экспорт Excel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void chooseImportFile()}
            disabled={importBusy}
            accessibilityRole="button"
            accessibilityLabel="Импортировать услуги из Excel"
          >
            <Text
              style={{ color: colors.primary[600], fontWeight: fontWeight.semibold, opacity: importBusy ? 0.5 : 1 }}
            >
              Импорт Excel
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {importBusy && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={importStatusLabel}
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
          style={styles.importStatus}
        >
          <ActivityIndicator size="small" color={palette.accent.primary} accessible={false} />
          <Text style={{ flex: 1, fontSize: fontSize.sm, color: palette.text.secondary }}>{importStatusLabel}</Text>
        </View>
      )}

      {/* Breadcrumbs — appear when navigating folders */}
      {!search && activePath.length > 0 && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setActivePath([])} style={styles.breadcrumbItem}>
            <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
            <Text style={styles.breadcrumbText}>Все</Text>
          </TouchableOpacity>
          {activePath.map((seg, i) => (
            <React.Fragment key={i}>
              <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
              <TouchableOpacity
                onPress={() => setActivePath((prev) => prev.slice(0, i + 1))}
                style={styles.breadcrumbItem}
              >
                <Text
                  style={[
                    styles.breadcrumbText,
                    { color: palette.text.secondary },
                    i === activePath.length - 1 && { color: palette.text.primary, fontWeight: '700' },
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
          }}
          placeholder="Поиск во всех папках"
        />
      </View>

      {canManageServices && !search && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing[4],
            paddingVertical: spacing[3],
          }}
        >
          <TouchableOpacity
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: 'center' }}
            accessibilityLabel="Новая папка"
            onPress={() => setNewFolder({ parentPath: activePath.join('/'), session: captureDataSession() })}
          >
            <Text style={{ color: palette.accent.primaryText, fontWeight: '600' }}>Новая папка</Text>
          </TouchableOpacity>
          {activePath.length > 0 && (
            <TouchableOpacity
              accessibilityRole="button"
              style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => folderActions(activePath.join('/'))}
            >
              <Text style={{ color: palette.accent.primaryText }}>Управление папкой</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {isError || folderQuery.isError ? (
        <View style={{ padding: spacing[4] }}>
          <Text style={{ color: palette.text.primary }}>Не удалось загрузить каталог.</Text>
          <TouchableOpacity
            onPress={() => {
              void refetch();
              void folderQuery.refetch();
            }}
            style={{ paddingVertical: 12 }}
          >
            <Text style={{ color: palette.accent.primaryText }}>Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : data === undefined ? (
        // Cold-start: skeleton until ANY data (cached or freshly
        // fetched) lands. After that, SWR keeps the list visible
        // across filter mutations.
        <ListSkeleton count={8} />
      ) : !search && folders.length === 0 && currentServices.length === 0 && !isLoading ? (
        <EmptyState
          title={preferredOnly ? 'Нет услуг по вашей роли' : 'Нет услуг'}
          description={
            preferredOnly
              ? 'Покажите полный каталог или попросите владельца настроить видимость.'
              : canManageServices
                ? 'Добавьте первую услугу'
                : 'Каталог услуг пуст'
          }
          action={
            preferredOnly
              ? { label: 'Показать все услуги', onPress: () => setShowAllServices(true) }
              : canManageServices
                ? { label: 'Добавить', onPress: openCreate }
                : undefined
          }
        />
      ) : (
        <FlashList
          data={currentServices}
          keyExtractor={(item) => item.id}
          renderItem={renderService}
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          ListEmptyComponent={
            search ? (
              <View style={{ padding: 24 }}>
                <Text style={{ color: palette.text.primary, fontWeight: '600' }}>Ничего не найдено</Text>
                <Text style={{ color: palette.text.secondary, marginTop: 6 }}>
                  Попробуйте другое название услуги или папки.
                </Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            !search && folders.length > 0 ? (
              <View style={[styles.foldersList, { backgroundColor: palette.bg.card }]}>
                {folders.map(([folderName, count]) => (
                  <TouchableOpacity
                    key={folderName}
                    style={[styles.folderRow, { borderBottomColor: palette.border.subtle }]}
                    onPress={() => setActivePath((prev) => [...prev, folderName])}
                    activeOpacity={0.6}
                  >
                    <View
                      style={[
                        styles.folderIconBox,
                        palette.mode === 'dark' && { backgroundColor: softTint(colors.primary[600], 'dark') },
                      ]}
                    >
                      <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
                    </View>
                    <View style={styles.folderInfo}>
                      <Text style={[styles.folderName, { color: palette.text.primary }]} numberOfLines={1}>
                        {folderName}
                      </Text>
                      <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>
                        {count ? `${count} услуг` : 'Пустая папка'}
                      </Text>
                    </View>
                    {canManageServices && (
                      <TouchableOpacity
                        disabled={!visibilityConfigQuery.isSuccess}
                        onPress={() =>
                          openVisibility({ kind: 'category', path: [...activePath, folderName].join('/') })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Видимость папки ${folderName}`}
                        style={{ padding: spacing[2] }}
                      >
                        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary[600]} />
                      </TouchableOpacity>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
        />
      )}

      {newFolder && (
        <NewCatalogFolderModal
          parentPath={newFolder.parentPath}
          rootLabel="Услуги"
          onClose={() => setNewFolder(null)}
          onCreate={async (path) => {
            if (!newFolder.session.isCurrent())
              throw new Error('Филиал или аккаунт изменился. Закройте форму и создайте папку в нужном месте.');
            if (!canManageServices) throw new Error('Нет права на управление услугами.');
            try {
              const res = await servicesApi.folders.create(path);
              if (!newFolder.session.isCurrent()) return;
              queryClient.setQueryData<ServiceFolder[]>(['service-folders'], (previous) => {
                const folders = previous ?? [];
                return folders.some((folder) => folder.path === res.data.path) ? folders : [...folders, res.data];
              });
              invalidateCatalog();
              void folderQuery.refetch();
              haptic('success');
              setNewFolder(null);
            } catch (error) {
              if (!newFolder.session.isCurrent()) return;
              if ((error as { response?: { status?: number } })?.response?.status === 409) {
                void folderQuery.refetch();
                throw new Error('Папка с таким названием уже существует. Введите другое название.');
              }
              throw error;
            }
          }}
        />
      )}
      <Modal
        visible={!!folderEditor}
        onClose={() => setFolderEditor(null)}
        title={folderEditor?.path ? 'Переименовать папку' : 'Новая папка'}
      >
        <Text style={{ color: palette.text.secondary, marginBottom: 8 }}>Название</Text>
        <TextInput
          autoFocus
          value={folderEditor?.name ?? ''}
          onChangeText={(name) => setFolderEditor((current) => (current ? { ...current, name } : current))}
          style={[
            styles.formInput,
            { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
        />
        {folderEditor?.path && (
          <>
            <Text style={{ color: palette.text.secondary, marginTop: 16, marginBottom: 8 }}>
              Родительская папка · пусто для корня
            </Text>
            <TextInput
              value={folderEditor.parentPath}
              onChangeText={(parentPath) =>
                setFolderEditor((current) => (current ? { ...current, parentPath } : current))
              }
              style={[
                styles.formInput,
                { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
            />
          </>
        )}
        <TouchableOpacity
          disabled={folderBusy || !folderEditor?.name.trim()}
          onPress={() => void saveFolder()}
          style={[styles.submitBtn, { marginTop: 16, alignItems: 'center', opacity: folderBusy ? 0.5 : 1 }]}
        >
          <Text style={{ color: colors.white, fontWeight: '600' }}>Сохранить</Text>
        </TouchableOpacity>
      </Modal>
      <Modal visible={folderListOpen} onClose={() => setFolderListOpen(false)} title="Видимость по ролям">
        <ScrollView style={{ maxHeight: 420 }} reserveBottomNavigation={false}>
          {(visibilityConfigQuery.data?.categoryPaths ?? []).map((path: string) => (
            <TouchableOpacity
              key={path}
              onPress={() => {
                setFolderListOpen(false);
                openVisibility({ kind: 'category', path });
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing[2],
                paddingVertical: spacing[3],
                paddingLeft: spacing[2] + Math.max(0, path.split('/').length - 1) * 12,
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.border.subtle,
              }}
              accessibilityRole="button"
            >
              <Ionicons name="folder-outline" size={18} color={colors.primary[600]} />
              <Text style={{ flex: 1, color: palette.text.primary }}>{path.split('/').pop()}</Text>
              <Text style={{ color: palette.text.tertiary, fontSize: fontSize.xs }}>{path}</Text>
            </TouchableOpacity>
          ))}
          {(visibilityConfigQuery.data?.categoryPaths.length ?? 0) === 0 && (
            <Text style={{ color: palette.text.tertiary, paddingVertical: spacing[3] }}>Папок пока нет</Text>
          )}
        </ScrollView>
      </Modal>

      <Modal
        visible={!!importPreview}
        onClose={() => {
          if (!importBusy) {
            setImportPreview(null);
            setImportRequestId(null);
          }
        }}
        title="Просмотр импорта"
      >
        {importPreview && (
          <>
            <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold, marginBottom: spacing[3] }}>
              {importPreview.summary.totalRows} строк · создать {importPreview.summary.create} · обновить{' '}
              {importPreview.summary.update} · ошибок {importPreview.summary.errors}
            </Text>
            <ScrollView style={{ maxHeight: 300 }} reserveBottomNavigation={false}>
              {importPreview.rows.map((row) => (
                <View
                  key={row.sourceRow}
                  style={{
                    paddingVertical: spacing[2],
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: palette.border.subtle,
                  }}
                >
                  <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold }} numberOfLines={2}>
                    {row.name}
                  </Text>
                  <Text
                    style={{
                      color: row.action === 'error' ? colors.red[500] : palette.text.tertiary,
                      fontSize: fontSize.xs,
                    }}
                  >
                    Строка {row.sourceRow} ·{' '}
                    {row.action === 'create' ? 'создать' : row.action === 'update' ? 'обновить' : row.message}
                  </Text>
                </View>
              ))}
            </ScrollView>
            {importPreview.summary.errors > 0 && (
              <Text style={{ color: colors.red[500], marginTop: spacing[3] }}>
                Исправьте ошибки и загрузите файл снова. Ни одна строка не будет применена.
              </Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[4], marginTop: spacing[4] }}>
              <TouchableOpacity
                disabled={importBusy}
                onPress={() => {
                  setImportPreview(null);
                  setImportRequestId(null);
                }}
              >
                <Text style={{ color: palette.text.secondary }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={importBusy || importPreview.summary.errors > 0}
                onPress={() => void confirmImport()}
              >
                <Text
                  style={{
                    color: importBusy || importPreview.summary.errors > 0 ? palette.text.tertiary : colors.primary[600],
                    fontWeight: fontWeight.bold,
                  }}
                >
                  {importBusy ? 'Импорт…' : 'Подтвердить'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Modal>

      <Modal visible={!!historyTarget} onClose={() => setHistoryTarget(null)} title="Услуга">
        <Text style={{ color: palette.text.secondary, fontWeight: fontWeight.semibold, marginBottom: spacing[3] }}>
          {historyTarget?.name}
        </Text>
        <Text style={{ color: palette.text.primary, fontWeight: '700', fontSize: 22, marginBottom: 16 }}>
          {historyTarget?.priceType === 'range'
            ? `${formatMoney(historyTarget.minPrice ?? 0)} – ${formatMoney(historyTarget.maxPrice ?? 0)}`
            : formatMoney(historyTarget?.defaultPrice ?? 0)}
        </Text>
        {canManageServices && historyTarget && (
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 12 }}>
            <TouchableOpacity
              style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => {
                openEdit(historyTarget);
                setHistoryTarget(null);
              }}
            >
              <Text style={{ color: palette.accent.primaryText, fontWeight: '600' }}>Изменить</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ minHeight: 44, justifyContent: 'center' }}
              onPress={() => {
                openVisibility({ kind: 'service', id: historyTarget.id, label: historyTarget.name });
                setHistoryTarget(null);
              }}
            >
              <Text style={{ color: palette.accent.primaryText }}>Видимость</Text>
            </TouchableOpacity>
          </View>
        )}
        {!!historyTarget?.warrantyDays && (
          <Text style={{ color: palette.text.secondary, marginBottom: 12 }}>
            Гарантия: {historyTarget.warrantyDays} дн.
          </Text>
        )}
        {canManageServices && historyTarget?.masterPayMode === 'fixed' && (
          <Text style={{ color: palette.text.secondary, marginBottom: spacing[3] }}>
            Мастеру: {historyTarget.masterFixedAmount?.toLocaleString('ru-RU')} ₽ за выполнение
          </Text>
        )}
        {canManageServices && historyTarget?.masterPayMode !== 'fixed' && historyTarget?.masterPercent != null && (
          <Text style={{ color: palette.text.secondary, marginBottom: 12 }}>
            Процент мастера: {historyTarget.masterPercent}%
          </Text>
        )}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: palette.bg.muted,
            borderRadius: 10,
            padding: 3,
            marginBottom: 16,
          }}
        >
          {(['work', 'prices'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: historyTab === tab }}
              onPress={() => setHistoryTab(tab)}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                alignItems: 'center',
                backgroundColor: historyTab === tab ? palette.bg.card : 'transparent',
              }}
            >
              <Text style={{ color: palette.text.primary, fontWeight: '600' }}>
                {tab === 'work' ? 'Выполнение' : 'Изменения прайса'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {historyTab === 'work' && (
          <ScrollView style={{ maxHeight: 360 }} reserveBottomNavigation={false}>
            {executionQuery.isLoading && <ActivityIndicator color={palette.accent.primaryText} />}
            {executionQuery.isError && (
              <TouchableOpacity onPress={() => void executionQuery.refetch()} style={{ paddingVertical: 16 }}>
                <Text style={{ color: palette.accent.primaryText }}>Не удалось загрузить работы. Повторить</Text>
              </TouchableOpacity>
            )}
            {executionQuery.isSuccess && executionQuery.data?.data.length === 0 && (
              <Text style={{ color: palette.text.secondary, paddingVertical: 16 }}>
                В доступных чеках эта услуга ещё не выполнялась.
              </Text>
            )}
            {executionQuery.data?.data.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                accessibilityRole="button"
                style={{
                  paddingVertical: 14,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                }}
                onPress={() => {
                  setHistoryTarget(null);
                  navigation.navigate('CheckDetail', {
                    id: entry.checkId,
                    ...(entry.clientId ? { clientId: entry.clientId } : {}),
                  });
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <Text style={{ color: palette.accent.primaryText, fontWeight: '600' }}>Чек №{entry.checkNumber}</Text>
                  <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{formatMoney(entry.price)}</Text>
                </View>
                <Text style={{ color: palette.text.secondary, fontSize: 12, marginTop: 4 }}>
                  {new Date(entry.date).toLocaleString('ru-RU')} · {entry.executorName || 'Исполнитель не указан'}
                </Text>
              </TouchableOpacity>
            ))}
            {(executionQuery.data?.total ?? 0) > 20 && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 16 }}>
                <TouchableOpacity disabled={historyPage === 1} onPress={() => setHistoryPage((page) => page - 1)}>
                  <Text style={{ color: palette.accent.primaryText, opacity: historyPage === 1 ? 0.4 : 1 }}>Назад</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={historyPage * 20 >= (executionQuery.data?.total ?? 0)}
                  onPress={() => setHistoryPage((page) => page + 1)}
                >
                  <Text style={{ color: palette.accent.primaryText }}>Далее</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}
        {historyTab === 'prices' && (
          <>
            {historyQuery.isLoading && <ActivityIndicator color={colors.primary[500]} />}
            {historyQuery.isError && <Text style={{ color: colors.red[500] }}>Не удалось загрузить историю.</Text>}
            {historyQuery.isSuccess && historyQuery.data.length === 0 && (
              <Text style={{ color: palette.text.tertiary }}>Записей пока нет.</Text>
            )}
            <ScrollView style={{ maxHeight: 320 }} reserveBottomNavigation={false}>
              {historyQuery.data?.map((entry) => (
                <View
                  key={entry.id}
                  style={{
                    paddingVertical: spacing[2],
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: palette.border.subtle,
                  }}
                >
                  <Text style={{ color: palette.text.primary, fontWeight: fontWeight.semibold }}>
                    {entry.priceType === 'range'
                      ? `${formatMoney(entry.minPrice)} – ${formatMoney(entry.maxPrice)}`
                      : formatMoney(entry.defaultPrice)}
                  </Text>
                  <Text style={{ color: palette.text.tertiary, fontSize: fontSize.xs }}>
                    v{entry.version} · {new Date(entry.changedAt).toLocaleString()} · {entry.changedByName || 'Система'}{' '}
                    ·{' '}
                    {entry.source === 'baseline'
                      ? 'Снимок при включении контроля цен'
                      : entry.source === 'create'
                        ? 'Создание услуги'
                        : 'Изменение цены'}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </Modal>

      <Modal visible={!!visibilityTarget} onClose={() => setVisibilityTarget(null)} title="Предпочтительная видимость">
        <ScrollView style={{ maxHeight: 420 }} reserveBottomNavigation={false}>
          <Text style={{ color: palette.text.secondary, marginBottom: spacing[3] }}>
            Это влияет только на список каталога. Любую услугу можно добавить в чек.
          </Text>
          <TouchableOpacity
            onPress={() => setVisibilityRuleActive((value) => !value)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing[2],
              paddingVertical: spacing[2],
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: palette.border.subtle,
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: visibilityRuleActive }}
          >
            <Ionicons
              name={visibilityRuleActive ? 'checkbox' : 'square-outline'}
              size={20}
              color={colors.primary[600]}
            />
            <Text style={{ fontSize: fontSize.sm, color: palette.text.primary }}>Задать роли для объекта</Text>
          </TouchableOpacity>
          {(visibilityConfigQuery.data?.roles ?? []).map((role) => {
            const checked = visibilityRoleIds.includes(role.id);
            return (
              <TouchableOpacity
                key={role.id}
                disabled={!visibilityRuleActive}
                onPress={() =>
                  setVisibilityRoleIds((current) =>
                    checked ? current.filter((id) => id !== role.id) : [...current, role.id],
                  )
                }
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing[2],
                  paddingVertical: spacing[2],
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                  opacity: visibilityRuleActive ? 1 : 0.5,
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={checked ? colors.primary[600] : palette.text.tertiary}
                />
                <Text style={{ fontSize: fontSize.sm, color: palette.text.primary }}>{role.name}</Text>
              </TouchableOpacity>
            );
          })}
          {visibilityRuleActive && visibilityRoleIds.length === 0 && (
            <Text style={{ color: palette.text.tertiary, padding: spacing[2] }}>
              Пустой список скроет объект для всех сотрудников.
            </Text>
          )}
        </ScrollView>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing[3] }}>
          <TouchableOpacity disabled={!visibilityConfigQuery.isSuccess} onPress={() => void saveRule(true)}>
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.semibold }}>Наследовать / Все роли</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!visibilityConfigQuery.isSuccess || !visibilityRuleActive}
            onPress={() => void saveRule(false)}
          >
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.bold }}>Сохранить</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={modalOpen} onClose={closeModal} title={editingService ? 'Редактировать услугу' : 'Новая услуга'}>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Замена масла..."
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Категория</Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Диагностика/Двигатель/Работы"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.formHint, { color: palette.text.tertiary }]}>
            Для вложенной папки разделяйте путь символом «/».
          </Text>
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Тип цены</Text>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            {(['fixed', 'range'] as const).map((kind) => (
              <TouchableOpacity
                key={kind}
                onPress={() => setPriceType(kind)}
                accessibilityRole="button"
                accessibilityState={{ selected: priceType === kind }}
                style={{
                  flex: 1,
                  paddingVertical: spacing[2],
                  borderRadius: borderRadius.lg,
                  alignItems: 'center',
                  backgroundColor: priceType === kind ? palette.accent.primary : palette.bg.muted,
                }}
              >
                <Text
                  style={{
                    color: priceType === kind ? colors.white : palette.text.secondary,
                    fontWeight: fontWeight.semibold,
                  }}
                >
                  {kind === 'fixed' ? 'Фиксированная' : 'Диапазон'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {priceType === 'fixed' ? (
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Цена по умолчанию</Text>
            <TextInput
              value={defaultPrice}
              onChangeText={setDefaultPrice}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            {(
              [
                [minPrice, setMinPrice, 'От'],
                [maxPrice, setMaxPrice, 'До'],
              ] as const
            ).map(([value, setValue, label]) => (
              <View key={label} style={[styles.formField, { flex: 1 }]}>
                <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{label}, ₽</Text>
                <TextInput
                  value={value}
                  onChangeText={(text) => setValue(text.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  style={[
                    styles.formInput,
                    {
                      backgroundColor: palette.bg.muted,
                      borderColor: palette.border.subtle,
                      color: palette.text.primary,
                    },
                  ]}
                  keyboardType="decimal-pad"
                  placeholder={label === 'От' ? 'Минимум' : 'Максимум'}
                  placeholderTextColor={palette.text.tertiary}
                />
              </View>
            ))}
          </View>
        )}
        {editingService?.priceIsPlaceholder && (
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmPrice }}
            onPress={() => setConfirmPrice(!confirmPrice)}
            style={{ minHeight: 44, justifyContent: 'center', marginBottom: spacing[3] }}
          >
            <Text style={{ color: confirmPrice ? palette.accent.primary : palette.text.secondary }}>
              {confirmPrice ? 'Текущая цена подтверждена' : 'Подтвердить текущую цену'}
            </Text>
            <Text style={[styles.formHint, { color: palette.text.tertiary }]}>Сейчас цена предварительная.</Text>
          </TouchableOpacity>
        )}
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Начисление мастеру</Text>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            {(['percent', 'fixed'] as const).map((mode) => (
              <TouchableOpacity
                key={mode}
                onPress={() => setMasterPayMode(mode)}
                accessibilityRole="button"
                accessibilityState={{ selected: masterPayMode === mode }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  justifyContent: 'center',
                  borderRadius: borderRadius.lg,
                  alignItems: 'center',
                  backgroundColor: masterPayMode === mode ? palette.accent.primary : palette.bg.muted,
                }}
              >
                <Text
                  style={{
                    color: masterPayMode === mode ? colors.white : palette.text.secondary,
                    fontWeight: fontWeight.semibold,
                  }}
                >
                  {mode === 'percent' ? 'Процент' : 'Фикс, ₽'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        {/* При смене режима заменяем native редактор; при вводе его key остаётся постоянным. */}
        {masterPayMode === 'fixed' ? (
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Фикс мастеру, ₽</Text>
            <TextInput
              key="master-fixed-amount"
              value={masterFixedAmount}
              onChangeText={setMasterFixedAmount}
              keyboardType="decimal-pad"
              accessibilityLabel="Фикс мастеру в рублях"
              placeholder="Например, 300"
              placeholderTextColor={palette.text.tertiary}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
            />
            <Text style={[styles.formHint, { color: palette.text.tertiary }]}>
              За каждое выполнение, независимо от цены и скидки.
            </Text>
          </View>
        ) : (
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Особый % мастера</Text>
            <TextInput
              key="master-percent"
              value={masterPercent}
              onChangeText={onChangeMasterPercent}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              keyboardType="numeric"
              placeholder="Оставьте пустым — процент мастера"
              placeholderTextColor={palette.text.tertiary}
              maxLength={5}
            />
            <Text style={[styles.formHint, { color: palette.text.tertiary }]}>
              Если задан — считается по нему (важнее процента мастера). Пусто — берётся процент мастера.
            </Text>
          </View>
        )}
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Срок гарантии (дней)</Text>
          <TextInput
            value={warrantyDays}
            onChangeText={setWarrantyDays}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="number-pad"
            placeholder="напр. 30 (необязательно)"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeModal}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          {editingService && (
            <TouchableOpacity
              style={[
                styles.deleteFormBtn,
                palette.mode === 'dark' && { backgroundColor: softTint(colors.red[600], 'dark') },
              ]}
              onPress={() => {
                setDeleteId(editingService.id);
                closeModal();
              }}
            >
              <Text style={[styles.deleteFormBtnText, palette.mode === 'dark' && { color: colors.red[300] }]}>
                Удалить
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleSubmit}
          >
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
  importStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  searchWrap: { paddingHorizontal: spacing[4] },
  // iOS plain-list style (matches warehouse).
  list: { paddingHorizontal: 0, paddingBottom: 120, paddingTop: 0 },
  serviceCard: {
    minHeight: 76,
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
  servicePrice: { fontSize: 15, fontWeight: '700', color: colors.primary[700], letterSpacing: -0.2 },
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
  formHint: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: spacing[1.5],
    lineHeight: 16,
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
