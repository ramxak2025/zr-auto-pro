/**
 * TemplatesScreen — раздел «Шаблоны» (Ещё → Работа).
 *
 * Личные шаблоны чеков с личными вложенными папками + общие шаблоны
 * (userId NULL — legacy или опубликованные owner-class'ом). Правила зеркалят
 * backend `check-templates.service.ts` (единственный настоящий страж):
 *   • личный шаблон — полный CRUD автору, любая роль;
 *   • общий шаблон — update/delete только owner-class (director/admin/
 *     superadmin); для остальных действия скрыты, тап открывает просмотр;
 *   • папки строго личные (дерево через parentId), общие шаблоны вне папок;
 *   • удаление папки каскадно удаляет подпапки, шаблоны при этом остаются
 *     и переезжают в корень (backend nulls folder_id в одной транзакции).
 *
 * Навигация по папкам — in-screen стек id (drill-down): кнопка «Назад» в
 * шапке поднимает на уровень выше, на корне — закрывает экран. Android
 * hardware back повторяет то же самое. Query-ключи ['check-templates'] и
 * ['check-template-folders'] общие с Кассой (и с web) — любая мутация здесь
 * мгновенно видна в пикере шаблонов Кассы через invalidate.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  Platform,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';
import { checkTemplatesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint, getBadgeColors } from '../theme';
import { iosCard, iosSectionLabel, useShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { CheckTemplate, CheckTemplateFolder } from '../../../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Помощники домена шаблонов — экспортируются: их переиспользуют
// TemplateEditorScreen и пикер шаблонов Кассы (CheckCreateScreen), чтобы
// правила «что общий / как считать состав / как строить дерево» жили в одном
// месте и не расходились между экранами.
// ─────────────────────────────────────────────────────────────────────────────

/** userId NULL → общий (legacy или опубликованный owner-class'ом). */
export function isSharedTemplate(t: CheckTemplate): boolean {
  return t.isShared ?? t.userId == null;
}

export interface FolderNode extends CheckTemplateFolder {
  children: FolderNode[];
}

/** Плоский список папок API → дерево (сортировка sort, затем имя по-русски). */
export function buildFolderTree(folders: CheckTemplateFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const f of folders) byId.set(f.id, { ...f, children: [] });
  const roots: FolderNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const sortRec = (list: FolderNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Дерево → плоский список с глубиной (для indented-пикеров). */
export function flattenFolderTree(nodes: FolderNode[], depth = 0): Array<{ folder: FolderNode; depth: number }> {
  const out: Array<{ folder: FolderNode; depth: number }> = [];
  for (const n of nodes) {
    out.push({ folder: n, depth });
    out.push(...flattenFolderTree(n.children, depth + 1));
  }
  return out;
}

export function templateTotal(t: Pick<CheckTemplate, 'services' | 'products'>): number {
  const services = (t.services || []).reduce((sum, s) => sum + (s.price || 0) * (s.quantity || 0), 0);
  const products = (t.products || []).reduce((sum, p) => sum + (p.sellPrice || 0) * (p.quantity || 0), 0);
  return services + products;
}

export function formatTemplateMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/** «2 усл. · 3 тов. · 4 500 ₽» — короткая строка состава для строк списка. */
export function templateSummary(t: CheckTemplate): string {
  const parts: string[] = [];
  if (t.services.length > 0) parts.push(`${t.services.length} усл.`);
  if (t.products.length > 0) parts.push(`${t.products.length} тов.`);
  if (parts.length === 0) return 'Пустой шаблон';
  const total = templateTotal(t);
  if (total > 0) parts.push(formatTemplateMoney(total));
  return parts.join(' · ');
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

/**
 * FolderPickerList — плоский indented-список папок с «Без папки» сверху.
 * Radio-семантика: галочка на выбранной. Используется в модалке
 * «Переместить» здесь, в выборе папки редактора шаблона и (инлайн) в
 * шите «Сохранить как шаблон» Кассы. Скроллом владеет вызывающий
 * (Modal уже оборачивает контент в ScrollView).
 */
export function FolderPickerList({
  folders,
  selectedId,
  onSelect,
}: {
  folders: CheckTemplateFolder[];
  selectedId: string | null;
  onSelect: (folderId: string | null) => void;
}) {
  const palette = useColors();
  const isDark = palette.mode === 'dark';
  const flat = useMemo(() => flattenFolderTree(buildFolderTree(folders)), [folders]);

  const renderRow = (id: string | null, label: string, depth: number, isRoot: boolean) => {
    const selected = selectedId === id;
    return (
      <TouchableOpacity
        key={id ?? 'root'}
        style={[pickerStyles.row, { borderBottomColor: palette.border.subtle, paddingLeft: spacing[2] + depth * 18 }]}
        onPress={() => {
          haptic('tap');
          onSelect(id);
        }}
        activeOpacity={0.6}
      >
        <Ionicons
          name={isRoot ? 'albums-outline' : 'folder-open-outline'}
          size={17}
          color={selected ? colors.primary[500] : palette.text.tertiary}
        />
        <Text
          style={[
            pickerStyles.rowText,
            { color: selected ? (isDark ? colors.primary[300] : colors.primary[600]) : palette.text.primary },
            selected && { fontWeight: fontWeight.semibold },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {selected && <Ionicons name="checkmark" size={18} color={isDark ? colors.primary[300] : colors.primary[600]} />}
      </TouchableOpacity>
    );
  };

  return (
    <View>
      {renderRow(null, 'Без папки (корень)', 0, true)}
      {flat.map(({ folder, depth }) => renderRow(folder.id, folder.name, depth, false))}
      {flat.length === 0 && (
        <Text style={[pickerStyles.emptyHint, { color: palette.text.tertiary }]}>
          Папок пока нет — создайте их в разделе «Шаблоны»
        </Text>
      )}
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[3],
    paddingRight: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 46,
  },
  rowText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  emptyHint: { fontSize: 12, paddingVertical: spacing[3], textAlign: 'center' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Экран
// ─────────────────────────────────────────────────────────────────────────────

type FolderModalState = { mode: 'create' } | { mode: 'rename'; folder: CheckTemplateFolder } | null;

export default function TemplatesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const isDark = palette.mode === 'dark';
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  // Owner-class — как в backend OWNER_CLASS_ROLES: правка/удаление общих шаблонов.
  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);

  // Drill-down: стек id папок, последний элемент — текущий уровень.
  const [folderStack, setFolderStack] = useState<string[]>([]);
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null;

  const [refreshing, setRefreshing] = useState(false);
  const [folderModal, setFolderModal] = useState<FolderModalState>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [folderSaving, setFolderSaving] = useState(false);
  const [moveTemplate, setMoveTemplate] = useState<CheckTemplate | null>(null);

  const { data: templates = [], isLoading: templatesLoading } = useQuery<CheckTemplate[]>({
    queryKey: ['check-templates'],
    queryFn: async () => (await checkTemplatesApi.list()).data,
    staleTime: 60_000,
  });
  const { data: folders = [], isLoading: foldersLoading } = useQuery<CheckTemplateFolder[]>({
    queryKey: ['check-template-folders'],
    queryFn: async () => (await checkTemplatesApi.folders.list()).data,
    staleTime: 60_000,
  });

  const foldersById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const currentFolder = currentFolderId ? foldersById.get(currentFolderId) : undefined;

  // Если текущая папка исчезла (удалена, в т.ч. каскадом с родителя) —
  // поднимаемся до ближайшего живого предка в стеке.
  useEffect(() => {
    if (folderStack.length === 0) return;
    if (folderStack.every((id) => foldersById.has(id))) return;
    setFolderStack((stack) => {
      const alive: string[] = [];
      for (const id of stack) {
        if (!foldersById.has(id)) break;
        alive.push(id);
      }
      return alive;
    });
  }, [folderStack, foldersById]);

  const myTemplates = useMemo(() => templates.filter((t) => !isSharedTemplate(t)), [templates]);
  const sharedTemplates = useMemo(() => templates.filter((t) => isSharedTemplate(t)), [templates]);

  const childFolders = useMemo(
    () =>
      folders
        .filter((f) => (f.parentId ?? null) === currentFolderId)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru')),
    [folders, currentFolderId],
  );
  const levelTemplates = useMemo(
    () => myTemplates.filter((t) => (t.folderId ?? null) === currentFolderId),
    [myTemplates, currentFolderId],
  );

  // Счётчики для подписи строки папки: прямые шаблоны + прямые подпапки.
  const folderStats = useMemo(() => {
    const tplCount = new Map<string, number>();
    for (const t of myTemplates) {
      if (t.folderId) tplCount.set(t.folderId, (tplCount.get(t.folderId) ?? 0) + 1);
    }
    const subCount = new Map<string, number>();
    for (const f of folders) {
      if (f.parentId) subCount.set(f.parentId, (subCount.get(f.parentId) ?? 0) + 1);
    }
    return { tplCount, subCount };
  }, [myTemplates, folders]);

  const goUp = useCallback(() => {
    haptic('tap');
    setFolderStack((s) => s.slice(0, -1));
  }, []);

  // Android hardware back: внутри папки — уровень выше, на корне — штатный pop.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (folderStack.length > 0) {
          setFolderStack((s) => s.slice(0, -1));
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [folderStack.length]),
  );

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['check-templates'] }),
      queryClient.invalidateQueries({ queryKey: ['check-template-folders'] }),
    ]);
  }, [queryClient]);

  const onRefresh = async () => {
    setRefreshing(true);
    await invalidateAll();
    setRefreshing(false);
  };

  // ── Папки: создание / переименование / удаление ────────────────────────────

  const openCreateFolder = () => {
    setFolderNameDraft('');
    setFolderModal({ mode: 'create' });
  };

  const openRenameFolder = (folder: CheckTemplateFolder) => {
    setFolderNameDraft(folder.name);
    setFolderModal({ mode: 'rename', folder });
  };

  const submitFolderModal = async () => {
    const name = folderNameDraft.trim();
    if (!name || !folderModal || folderSaving) return;
    setFolderSaving(true);
    try {
      if (folderModal.mode === 'create') {
        await checkTemplatesApi.folders.create({ name, parentId: currentFolderId });
      } else {
        await checkTemplatesApi.folders.update(folderModal.folder.id, { name });
      }
      await queryClient.invalidateQueries({ queryKey: ['check-template-folders'] });
      haptic('success');
      setFolderModal(null);
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить папку');
    } finally {
      setFolderSaving(false);
    }
  };

  const confirmDeleteFolder = (folder: CheckTemplateFolder) => {
    Alert.alert(
      'Удалить папку?',
      `«${folder.name}». Вложенные папки тоже удалятся, а шаблоны останутся — переместятся в корень.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await checkTemplatesApi.folders.remove(folder.id);
              await invalidateAll();
              haptic('success');
            } catch (err: any) {
              Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить папку');
            }
          },
        },
      ],
    );
  };

  const showFolderActions = (folder: CheckTemplateFolder) => {
    haptic('tap');
    Alert.alert(folder.name, undefined, [
      { text: 'Переименовать', onPress: () => openRenameFolder(folder) },
      { text: 'Удалить', style: 'destructive', onPress: () => confirmDeleteFolder(folder) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  // ── Шаблоны: открытие / перемещение / удаление ─────────────────────────────

  const openEditor = (template?: CheckTemplate) => {
    haptic('tap');
    navigation.navigate('TemplateEditor', {
      templateId: template?.id,
      initialFolderId: template ? (template.folderId ?? null) : currentFolderId,
    });
  };

  const confirmDeleteTemplate = (template: CheckTemplate) => {
    Alert.alert('Удалить шаблон?', template.name, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await checkTemplatesApi.remove(template.id);
            await queryClient.invalidateQueries({ queryKey: ['check-templates'] });
            haptic('success');
          } catch (err: any) {
            Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить шаблон');
          }
        },
      },
    ]);
  };

  const showTemplateActions = (template: CheckTemplate) => {
    haptic('tap');
    const shared = isSharedTemplate(template);
    // ВАЖНО: Android Alert рендерит максимум 3 кнопки — «Изменить» здесь
    // сознательно нет (правка — это тап по самой строке).
    const actions: Array<{ text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }> = [];
    // Переместить — только личные: общие шаблоны вне папок (backend вернёт 400).
    if (!shared) actions.push({ text: 'Переместить', onPress: () => setMoveTemplate(template) });
    actions.push({ text: 'Удалить', style: 'destructive', onPress: () => confirmDeleteTemplate(template) });
    actions.push({ text: 'Отмена', style: 'cancel' });
    Alert.alert(template.name, templateSummary(template), actions);
  };

  const submitMove = async (folderId: string | null) => {
    if (!moveTemplate) return;
    const tpl = moveTemplate;
    setMoveTemplate(null);
    if ((tpl.folderId ?? null) === folderId) return;
    try {
      await checkTemplatesApi.update(tpl.id, { folderId });
      await queryClient.invalidateQueries({ queryKey: ['check-templates'] });
      haptic('success');
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось переместить шаблон');
    }
  };

  const openCreateMenu = () => {
    haptic('tap');
    Alert.alert('Создать', undefined, [
      { text: 'Новый шаблон', onPress: () => openEditor() },
      { text: 'Новую папку', onPress: openCreateFolder },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  // ── Рендер ──────────────────────────────────────────────────────────────────

  const initialLoading = (templatesLoading || foldersLoading) && templates.length === 0 && folders.length === 0;
  const rootEmpty =
    !initialLoading &&
    currentFolderId === null &&
    childFolders.length === 0 &&
    levelTemplates.length === 0 &&
    sharedTemplates.length === 0;
  const folderEmpty =
    !initialLoading && currentFolderId !== null && childFolders.length === 0 && levelTemplates.length === 0;

  const sharedBadge = isDark ? getBadgeColors('dark').blue : { bg: colors.blue[50], text: colors.blue[600] };
  const iconBoxBg = isDark ? softTint(colors.primary[500], 'dark') : colors.primary[50];
  const tplIconBoxBg = isDark ? softTint(colors.violet[500], 'dark') : colors.violet[50];

  const renderFolderRow = (folder: CheckTemplateFolder, idx: number, count: number) => {
    const tplCount = folderStats.tplCount.get(folder.id) ?? 0;
    const subCount = folderStats.subCount.get(folder.id) ?? 0;
    const subtitleParts: string[] = [];
    if (tplCount > 0) subtitleParts.push(`${tplCount} ${pluralRu(tplCount, 'шаблон', 'шаблона', 'шаблонов')}`);
    if (subCount > 0) subtitleParts.push(`${subCount} ${pluralRu(subCount, 'папка', 'папки', 'папок')}`);
    return (
      <React.Fragment key={folder.id}>
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => {
            haptic('tap');
            setFolderStack((s) => [...s, folder.id]);
          }}
        >
          <View style={[styles.rowIcon, { backgroundColor: iconBoxBg }]}>
            <Ionicons name="folder-open-outline" size={19} color={colors.primary[500]} />
          </View>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowName, { color: palette.text.primary }]} numberOfLines={1}>
              {folder.name}
            </Text>
            <Text style={[styles.rowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
              {subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'Пустая папка'}
            </Text>
          </View>
          <TouchableOpacity hitSlop={10} onPress={() => showFolderActions(folder)} style={styles.ellipsisBtn}>
            <Ionicons name="ellipsis-horizontal" size={18} color={palette.text.tertiary} />
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        {idx < count - 1 && <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />}
      </React.Fragment>
    );
  };

  const renderTemplateRow = (template: CheckTemplate, idx: number, count: number) => {
    const shared = isSharedTemplate(template);
    const canManage = !shared || isOwnerClass;
    return (
      <React.Fragment key={template.id}>
        <TouchableOpacity style={styles.row} activeOpacity={0.6} onPress={() => openEditor(template)}>
          <View style={[styles.rowIcon, { backgroundColor: tplIconBoxBg }]}>
            <Ionicons name="copy-outline" size={18} color={isDark ? colors.violet[500] : colors.violet[600]} />
          </View>
          <View style={styles.rowInfo}>
            <View style={styles.rowNameLine}>
              <Text style={[styles.rowName, { color: palette.text.primary, flexShrink: 1 }]} numberOfLines={1}>
                {template.name}
              </Text>
              {shared && (
                <View style={[styles.sharedBadge, { backgroundColor: sharedBadge.bg }]}>
                  <Text style={[styles.sharedBadgeText, { color: sharedBadge.text }]}>Общий</Text>
                </View>
              )}
            </View>
            <Text style={[styles.rowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
              {templateSummary(template)}
            </Text>
          </View>
          {canManage && (
            <TouchableOpacity hitSlop={10} onPress={() => showTemplateActions(template)} style={styles.ellipsisBtn}>
              <Ionicons name="ellipsis-horizontal" size={18} color={palette.text.tertiary} />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
        {idx < count - 1 && <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />}
      </React.Fragment>
    );
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={currentFolder ? currentFolder.name : 'Шаблоны'}
        subtitle={
          currentFolder
            ? 'Папка шаблонов'
            : `${myTemplates.length} ${pluralRu(myTemplates.length, 'личный шаблон', 'личных шаблона', 'личных шаблонов')}`
        }
        onBack={folderStack.length > 0 ? goUp : () => navigation.goBack()}
        trailing={
          <TouchableOpacity
            onPress={openCreateMenu}
            hitSlop={10}
            style={[styles.addBtn, { backgroundColor: palette.bg.muted }]}
            accessibilityRole="button"
            accessibilityLabel="Создать шаблон или папку"
          >
            <Ionicons name="add" size={22} color={isDark ? colors.primary[300] : colors.primary[600]} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentInsetAdjustmentBehavior="never"
      >
        {initialLoading ? (
          <ListSkeleton count={6} />
        ) : rootEmpty ? (
          <EmptyState
            icon="receipt"
            title="Нет шаблонов"
            description="Сохраняйте наборы услуг и товаров, чтобы заполнять заказ-наряд в одно касание"
            action={{ label: 'Создать шаблон', onPress: () => openEditor() }}
          />
        ) : (
          <>
            {childFolders.length > 0 && (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Папки</Text>
                <View
                  style={[
                    styles.card,
                    shadow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  {childFolders.map((f, idx) => renderFolderRow(f, idx, childFolders.length))}
                </View>
              </View>
            )}

            {levelTemplates.length > 0 && (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                  {currentFolderId ? 'Шаблоны' : 'Мои шаблоны'}
                </Text>
                <View
                  style={[
                    styles.card,
                    shadow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  {levelTemplates.map((t, idx) => renderTemplateRow(t, idx, levelTemplates.length))}
                </View>
              </View>
            )}

            {folderEmpty && (
              <View style={styles.folderEmptyWrap}>
                <Ionicons name="folder-open-outline" size={34} color={palette.text.tertiary} />
                <Text style={[styles.folderEmptyTitle, { color: palette.text.secondary }]}>В этой папке пусто</Text>
                <Text style={[styles.folderEmptyHint, { color: palette.text.tertiary }]}>
                  «+» создаст шаблон или подпапку прямо здесь
                </Text>
              </View>
            )}

            {currentFolderId === null && sharedTemplates.length > 0 && (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                  Общие шаблоны
                </Text>
                <View
                  style={[
                    styles.card,
                    shadow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  {sharedTemplates.map((t, idx) => renderTemplateRow(t, idx, sharedTemplates.length))}
                </View>
                {!isOwnerClass && (
                  <Text style={[styles.sectionFootnote, { color: palette.text.tertiary }]}>
                    Общие шаблоны видны всем сотрудникам, изменяет их руководитель
                  </Text>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Создание / переименование папки — свой модал с TextInput:
          Alert.prompt есть только на iOS, Android получил бы заглушку. */}
      <Modal
        visible={folderModal !== null}
        onClose={() => setFolderModal(null)}
        title={folderModal?.mode === 'rename' ? 'Переименовать папку' : 'Новая папка'}
      >
        <View style={{ gap: spacing[3] }}>
          {folderModal?.mode === 'create' && currentFolder && (
            <Text style={[styles.modalHint, { color: palette.text.tertiary }]}>
              Будет создана внутри папки «{currentFolder.name}»
            </Text>
          )}
          <TextInput
            value={folderNameDraft}
            onChangeText={setFolderNameDraft}
            placeholder="Название папки"
            placeholderTextColor={palette.text.tertiary}
            style={[
              styles.modalInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitFolderModal}
          />
          <TouchableOpacity
            style={[styles.modalPrimaryBtn, { opacity: folderNameDraft.trim() && !folderSaving ? 1 : 0.5 }]}
            disabled={!folderNameDraft.trim() || folderSaving}
            onPress={submitFolderModal}
            activeOpacity={0.8}
          >
            {folderSaving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.modalPrimaryBtnText}>{folderModal?.mode === 'rename' ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Перемещение шаблона между папками */}
      <Modal visible={moveTemplate !== null} onClose={() => setMoveTemplate(null)} title="Переместить шаблон">
        <View>
          {moveTemplate && (
            <Text style={[styles.modalHint, { color: palette.text.tertiary, marginBottom: spacing[2] }]}>
              «{moveTemplate.name}»
            </Text>
          )}
          <FolderPickerList
            folders={folders}
            selectedId={moveTemplate?.folderId ?? null}
            onSelect={(folderId) => void submitMove(folderId)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[4] },

  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: { gap: spacing[1.5] },
  sectionTitle: { marginLeft: spacing[3], marginBottom: spacing[1.5] },
  sectionFootnote: { fontSize: 12, marginLeft: spacing[3], marginTop: spacing[1.5] },

  card: {
    ...iosCard,
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 60,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, minWidth: 0, gap: 2 },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowName: { fontSize: 15, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  rowSub: { fontSize: 12 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing[4] + 40 + spacing[3],
  },
  ellipsisBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  sharedBadgeText: { fontSize: 10, fontWeight: fontWeight.semibold },

  folderEmptyWrap: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  folderEmptyTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  folderEmptyHint: { fontSize: 12, textAlign: 'center' },

  modalHint: { fontSize: 12 },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  modalPrimaryBtn: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  modalPrimaryBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
