/**
 * RoleEditorScreen — редактор одной роли (Bitrix24-style, миграция 114).
 *
 * Режимы (route.params):
 *   • { roleId }            — существующая роль. Своя и системные
 *                             «Мастер»/«Администратор» → редактирование (сервер
 *                             делает copy-on-write в тенантный override, глобал
 *                             не трогается). «Директор» (`locked: true`) →
 *                             read-only: все контролы disabled, плашка
 *                             «Директор — полные права, редактировать нельзя» +
 *                             кнопка «Создать копию».
 *   • { copyFromRoleId }    — создание КОПИИ: имя «<источник> (копия)», матрица
 *                             и описание предзаполнены с источника; на сервер
 *                             уходит copyFromRoleId + полная локальная матрица
 *                             (backend мёржит матрицу поверх копии — будущие
 *                             ячейки, которых mobile ещё не знает, сохранятся).
 *   • {} / undefined        — создание с нуля (всё запрещено, fail-closed).
 *
 * Матрица — секции-аккордеоны в порядке PERMISSION_GROUPS (Касса / Финансы /
 * Склад / CRM / Управление, см. utils/roleMatrixEditor.ts). Строка = подпись
 * права + контрол: boolean-ячейка → Switch; scope-ячейка (checks.view,
 * checks.edit, salary.view) → сегмент [Нет | Свои | Все].
 *
 * Изменения копятся локально; «Сохранить» делает один POST/PATCH /roles и
 * инвалидирует ['roles']. Уход с экрана с несохранёнными правками перехвачен
 * beforeRemove-гвардом. Смена матрицы применяется у назначенных сотрудников
 * ~30 секунд (сервер сбрасывает их auth-кэш) или при следующем действии.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { rolesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import { useRoles, ROLES_QUERY_KEY } from '../hooks/useRoles';
import {
  MATRIX_GROUPS,
  PERMISSION_LABELS,
  countGranted,
  draftFromMatrix,
  emptyDraft,
  matrixFromDraft,
  type BoolPermissionKey,
  type PermissionGroupTitle,
  type RoleMatrixDraft,
  type ScopePermissionKey,
} from '../utils/roleMatrixEditor';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { RoleScope } from '../../../shared/types';

// Иконки секций — те же глифы, что у групп матрицы прав в UsersScreen.
const GROUP_ICONS: Record<PermissionGroupTitle, keyof typeof Ionicons.glyphMap> = {
  Касса: 'receipt-outline',
  Услуги: 'pricetags-outline',
  Финансы: 'wallet-outline',
  Склад: 'cube-outline',
  Поставщики: 'business-outline',
  Имущество: 'construct-outline',
  CRM: 'people-outline',
  Управление: 'shield-checkmark-outline',
  Настройки: 'settings-outline',
  'База знаний': 'book-outline',
};

// Подсказки под строками, где название не раскрывает нюанс. Контекст —
// РЕДАКТОР РОЛИ (не карточка сотрудника), поэтому формулировки свои.
const ROW_HINTS: Partial<Record<string, string>> = {
  checks_view: '«Свои» — сотрудник видит только чеки, где он мастер. «Все» — чеки всего автосервиса.',
  checks_edit: '«Свои» — редактирует только свои чеки. «Все» — редактирует чужие чеки тоже.',
  salary_view: '«Свои» — сотрудник видит только свою зарплату. «Все» — зарплату всей команды.',
  cashflow_view: '«Свои» — сотрудник видит движение денег только по своим операциям. «Все» — касса всего автосервиса.',
  services_manage:
    'Создаёт, редактирует и удаляет услуги, меняет % мастера и гарантию. Без него услуги только смотрит.',
  warehouse_manage:
    'Себестоимость, создание/редактирование товаров, цены, инвентаризация. Без него — только просмотр без себестоимости.',
  warehouse_delete: 'Удаление товаров и папок склада. Удалённое попадает в Корзину — можно восстановить.',
  suppliers_manage: 'Создаёт, редактирует, удаляет поставщиков и оформляет поставки. Без него — только просмотр.',
  equipment_manage: 'Выдаёт, создаёт, редактирует и удаляет имущество. Без него — только просмотр справочника.',
  edit_closed_check: 'Правка уже проведённого чека: склад, зарплата и касса пересчитаются автоматически.',
  user_management: 'Доступ к экрану «Пользователи»: сотрудники и роли.',
};

// Scope-строки берут подпись из PERMISSION_LABELS, кроме «Движения денег»: в
// плоской матрице сотрудника это ДВА ключа («…: свои» / «…: все»), а в редакторе
// роли — одна scope-строка с сегментом [Нет | Свои | Все], поэтому имя короче.
const SCOPE_ROW_LABELS: Partial<Record<ScopePermissionKey, string>> = {
  cashflow_view: 'Движение денег',
};

const SCOPE_OPTIONS: { value: RoleScope; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'own', label: 'Свои' },
  { value: 'all', label: 'Все' },
];

/** Сегмент [Нет | Свои | Все] — компактный iOS-style segmented control. */
function ScopeSegment({
  value,
  disabled,
  onChange,
}: {
  value: RoleScope;
  disabled?: boolean;
  onChange: (v: RoleScope) => void;
}) {
  const palette = useColors();
  return (
    <View style={[styles.segmentTrack, { backgroundColor: palette.bg.muted }, disabled && styles.segmentDisabled]}>
      {SCOPE_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            disabled={disabled}
            style={[
              styles.segmentItem,
              active && [
                styles.segmentItemActive,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ],
            ]}
            onPress={() => {
              if (value === opt.value) return;
              haptic('select');
              onChange(opt.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={`Охват: ${opt.label}`}
          >
            <Text
              style={[
                styles.segmentText,
                { color: active ? palette.text.primary : palette.text.secondary },
                active && styles.segmentTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function RoleEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const roleId: string | undefined = route.params?.roleId;
  const copyFromRoleId: string | undefined = route.params?.copyFromRoleId;

  const queryClient = useQueryClient();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission, refreshUser } = useAuth();
  // Матрица авторитетна: сервер (roles.controller) гейтит user_management —
  // superadmin/director байпасятся внутри hasPermission, admin по матрице.
  const canManage = hasPermission('user_management');

  const { data: rolesData, isSuccess, isError, refetch } = useRoles(canManage);
  const roles = Array.isArray(rolesData) ? rolesData : [];
  const existing = roleId ? roles.find((r) => r.id === roleId) : undefined;
  const copySource = copyFromRoleId ? roles.find((r) => r.id === copyFromRoleId) : undefined;

  const isCreate = !roleId;
  const isSystem = !!existing?.isSystem;
  // Волна 3 (миграция 121): системные «Мастер»/«Администратор» теперь
  // РЕДАКТИРУЕМЫ — при сохранении сервер делает copy-on-write в тенантный
  // override. Read-only остаётся ТОЛЬКО у заблокированного «Директора»
  // (`locked: true`, полные права владельца). Все disabled-контролы и скрытие
  // кнопки «Сохранить» завязаны на `readOnly`, поэтому меняем один флаг.
  const isLocked = !!existing?.locked;
  const readOnly = isLocked;
  // Системная «Мастер»/«Администратор» — редактируема, но правки материализуют
  // тенантную копию: показываем информирующую (не блокирующую) плашку.
  const isEditableSystem = isSystem && !isLocked;

  // Роль-источник черновика: редактируемая (roleId) или копируемая
  // (copyFromRoleId); создание с нуля — источника нет.
  const seedRole = roleId ? existing : copySource;

  // Тёплый путь (вход из RolesScreen → ['roles'] уже в кэше): состояние
  // засеивается СИНХРОННО в useState-инициализаторах — без кадра пустой формы.
  // useRef захватывает значение только первого рендера — то, что источник
  // прилетел позже, ref не перещёлкнет; это делает useEffect ниже.
  const seededAtMount = roleId || copyFromRoleId ? !!seedRole : true;
  const seededRef = useRef(seededAtMount);
  const [name, setName] = useState(() =>
    roleId && existing ? existing.name : copyFromRoleId && copySource ? `${copySource.name} (копия)` : '',
  );
  const [description, setDescription] = useState(() => seedRole?.description ?? '');
  const [draft, setDraft] = useState<RoleMatrixDraft>(() =>
    seedRole ? draftFromMatrix(seedRole.matrix) : emptyDraft(),
  );
  // Секции-аккордеоны: по умолчанию раскрыта «Касса» — владелец сразу видит,
  // как выглядит строка матрицы, остальные группы в одном экране.
  const [expandedGroup, setExpandedGroup] = useState<PermissionGroupTitle | null>('Касса');

  // Холодный путь: ['roles'] ещё грузился на маунте — черновик засеивается
  // ОДИН раз, когда роль-источник появляется в кэше.
  useEffect(() => {
    if (seededRef.current) return;
    if (roleId) {
      if (!existing) return;
      seededRef.current = true;
      setName(existing.name);
      setDescription(existing.description ?? '');
      setDraft(draftFromMatrix(existing.matrix));
    } else if (copyFromRoleId) {
      if (!copySource) return;
      seededRef.current = true;
      setName(`${copySource.name} (копия)`);
      setDescription(copySource.description ?? '');
      setDraft(draftFromMatrix(copySource.matrix));
    } else {
      // Создание с нуля — пустой драфт уже стоит (fail-closed: всё запрещено).
      seededRef.current = true;
    }
  }, [roleId, copyFromRoleId, existing, copySource]);

  // «Есть несохранённые правки» — для beforeRemove-гварда. Refs, чтобы не
  // переподписывать листенер на каждый чих.
  const dirtyRef = useRef(false);
  const leavingRef = useRef(false);
  const markDirty = () => {
    dirtyRef.current = true;
  };
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e: any) => {
      if (!dirtyRef.current || leavingRef.current) return;
      // Смена таба: blur-листенер MoreTab (AppNavigator) делает popToTop
      // внутреннего стека — блокировать ЕГО нельзя (алерт всплыл бы поверх
      // чужого таба, а стек «Ещё» остался бы глубоким и сломал возврат).
      // Гвардим только осознанный уход внутри секции: back-кнопка / edge-swipe
      // на сфокусированном экране.
      if (!navigation.isFocused()) return;
      e.preventDefault();
      Alert.alert('Не сохранять изменения?', 'Правки роли будут потеряны.', [
        { text: 'Остаться', style: 'cancel' },
        {
          text: 'Не сохранять',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return sub;
  }, [navigation]);

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof rolesApi.create>[0]) => rolesApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ROLES_QUERY_KEY] });
      // Права клиента живут в /auth/me (эффективная матрица) — после правки
      // ролей рефетчим себя, чтобы гейты UI применились без перезахода.
      void refreshUser();
      haptic('success');
      leavingRef.current = true;
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось создать роль');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof rolesApi.update>[1] }) =>
      rolesApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ROLES_QUERY_KEY] });
      // Смена матрицы роли меняет эффективные права её носителей — включая,
      // возможно, текущего пользователя (admin правит свою системную роль).
      // refreshUser подтягивает свежий /auth/me → все hasPermission-гейты UI
      // обновляются сразу (сервер применит через ~30 c из-за auth-кэша).
      void refreshUser();
      haptic('success');
      leavingRef.current = true;
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить роль');
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const setScope = (key: ScopePermissionKey, value: RoleScope) => {
    if (readOnly) return;
    markDirty();
    setDraft((prev) => ({ ...prev, scopes: { ...prev.scopes, [key]: value } }));
  };

  const toggleBool = (key: BoolPermissionKey) => {
    if (readOnly) return;
    haptic('select');
    markDirty();
    setDraft((prev) => ({ ...prev, bools: { ...prev.bools, [key]: !prev.bools[key] } }));
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Ошибка', 'Введите название роли');
      return;
    }
    const matrix = matrixFromDraft(draft);
    const trimmedDescription = description.trim();
    if (isCreate) {
      createMutation.mutate({
        name: trimmedName,
        description: trimmedDescription || undefined,
        matrix,
        // Копия: сервер мёржит нашу матрицу поверх матрицы источника — ячейки,
        // которых mobile ещё не знает, не потеряются.
        copyFromRoleId,
      });
    } else if (roleId) {
      updateMutation.mutate({ id: roleId, body: { name: trimmedName, description: trimmedDescription, matrix } });
    }
  };

  const openCopy = () => {
    haptic('tap');
    navigation.push('RoleEditor', { copyFromRoleId: roleId });
  };

  // ── Гейты и пограничные состояния ─────────────────────────────────────────
  if (!canManage) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Роль" onBack={() => navigation.goBack()} />
        <EmptyState title="Нет доступа" description="Управлять ролями может владелец или администратор" />
      </View>
    );
  }

  // Роль-источник (редактирование/копия) ещё не в черновике. Пока не засеялись —
  // спиннер, а не мигание пустой формой (passive-эффект засева срабатывает
  // после коммита). Тёплый кэш (обычный вход из RolesScreen) сюда не попадает:
  // useState-инициализаторы засеяли всё синхронно.
  const needsSource = (!!roleId || !!copyFromRoleId) && !seededRef.current;
  // ['roles'] подтверждённо загружен, а роли с таким id нет (удалили с другого
  // устройства и т.п.) — честное «не найдено», не вечный спиннер.
  const sourceMissing = needsSource && isSuccess && ((!!roleId && !existing) || (!!copyFromRoleId && !copySource));
  // Холодный кэш + сеть упала: честная ошибка с «Повторить», не вечный спиннер.
  const sourceError = needsSource && !sourceMissing && isError;
  const waitingForSource = needsSource && !sourceMissing && !sourceError;

  if (waitingForSource) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Роль" onBack={() => navigation.goBack()} />
        <LoadingSpinner />
      </View>
    );
  }
  if (sourceError) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Роль" onBack={() => navigation.goBack()} />
        <EmptyState
          title="Не удалось загрузить"
          description="Проверьте соединение и нажмите «Повторить»"
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      </View>
    );
  }
  if (sourceMissing) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Роль" onBack={() => navigation.goBack()} />
        <EmptyState
          title="Роль не найдена"
          description="Возможно, её удалили. Обновите список ролей."
          action={{ label: 'К списку ролей', onPress: () => navigation.goBack() }}
        />
      </View>
    );
  }

  const headerTitle = isCreate ? 'Новая роль' : existing?.name || 'Роль';
  const headerSubtitle = isLocked
    ? 'Только просмотр'
    : isSystem
      ? 'Системная роль'
      : copySource
        ? `Копия «${copySource.name}»`
        : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={headerTitle} subtitle={headerSubtitle} onBack={() => navigation.goBack()} />

      {/* KeyboardAwareScroll (Round 11 #1): поле названия роли держится над
          клавиатурой на iOS И Android. */}
      <KeyboardAwareScroll contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}>
        {/* Заблокированный «Директор» — вечно read-only плашка + «Создать копию». */}
        {isLocked && (
          <View
            style={[
              styles.systemNote,
              shadow,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <Ionicons name="lock-closed" size={18} color={colors.primary[600]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.systemNoteTitle, { color: palette.text.primary }]}>
                Директор — полные права, редактировать нельзя
              </Text>
              <Text style={[styles.systemNoteSub, { color: palette.text.tertiary }]}>
                Это роль владельца автосервиса: полный доступ ко всему. Для ограниченного доступа создайте свою копию и
                настройте её.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.copyBtn}
              onPress={openCopy}
              accessibilityRole="button"
              accessibilityLabel="Создать копию роли"
            >
              <Text style={styles.copyBtnText}>Создать копию</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Системные «Мастер»/«Администратор» — редактируемы: правки сохранятся
            как настройка ТОЛЬКО вашего автосервиса (copy-on-write на сервере). */}
        {isEditableSystem && (
          <View
            style={[
              styles.systemNote,
              shadow,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <Ionicons name="options-outline" size={18} color={colors.primary[600]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.systemNoteTitle, { color: palette.text.primary }]}>
                Системную роль можно настроить
              </Text>
              <Text style={[styles.systemNoteSub, { color: palette.text.tertiary }]}>
                Изменения сохранятся как настройка вашего автосервиса и не затронут другие компании.
              </Text>
            </View>
          </View>
        )}

        {/* ── Имя + описание ──────────────────────────────────────────────── */}
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название роли</Text>
          <TextInput
            value={name}
            onChangeText={(v) => {
              markDirty();
              setName(v);
            }}
            editable={!readOnly}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              readOnly && styles.inputReadOnly,
            ]}
            placeholder="Напр. Старший мастер"
            placeholderTextColor={palette.text.tertiary}
            returnKeyType="done"
          />
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Описание (необязательно)</Text>
          <TextInput
            value={description}
            onChangeText={(v) => {
              markDirty();
              setDescription(v);
            }}
            editable={!readOnly}
            style={[
              styles.formInput,
              styles.formInputMultiline,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              readOnly && styles.inputReadOnly,
            ]}
            placeholder="Кому назначается и что умеет"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </View>

        {/* ── Матрица прав ───────────────────────────────────────────────── */}
        <Text style={[styles.matrixTitle, { color: palette.text.secondary }]}>Права роли</Text>
        <Text style={[styles.matrixHint, { color: palette.text.tertiary }]}>
          Роль — база прав сотрудника. Индивидуальные тумблеры в карточке сотрудника действуют поверх неё. Изменения
          применяются у сотрудников в течение ~30 секунд.
        </Text>

        {MATRIX_GROUPS.map((group) => {
          const granted = countGranted(draft, group.rows);
          const expanded = expandedGroup === group.title;
          return (
            <View
              key={group.title}
              style={[styles.group, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <TouchableOpacity
                style={styles.groupHeader}
                onPress={() => {
                  haptic('tap');
                  setExpandedGroup(expanded ? null : group.title);
                }}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel={`${group.title}, ${expanded ? 'свернуть' : 'развернуть'}`}
              >
                <Ionicons name={GROUP_ICONS[group.title]} size={16} color={palette.text.secondary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.groupTitle, { color: palette.text.primary }]}>{group.title}</Text>
                  <Text style={[styles.groupSummary, { color: palette.text.tertiary }]}>
                    {granted === 0 ? 'Ничего не разрешено' : `Разрешено ${granted} из ${group.rows.length}`}
                  </Text>
                </View>
                <Ionicons
                  name={expanded ? 'chevron-down' : 'chevron-forward'}
                  size={16}
                  color={palette.text.tertiary}
                />
              </TouchableOpacity>

              {expanded && (
                <View style={[styles.groupBody, { borderTopColor: palette.border.subtle }]}>
                  {group.rows.map((row) => {
                    const hint = ROW_HINTS[row.key];
                    return (
                      <View key={row.key} style={styles.permRow}>
                        <View style={styles.permTextWrap}>
                          <Text style={[styles.permLabel, { color: palette.text.primary }]}>
                            {(row.kind === 'scope' && SCOPE_ROW_LABELS[row.key as ScopePermissionKey]) ||
                              PERMISSION_LABELS[row.key]}
                          </Text>
                          {!!hint && <Text style={[styles.permHint, { color: palette.text.tertiary }]}>{hint}</Text>}
                        </View>
                        {row.kind === 'scope' ? (
                          <ScopeSegment
                            value={draft.scopes[row.key as ScopePermissionKey]}
                            disabled={readOnly}
                            onChange={(v) => setScope(row.key as ScopePermissionKey, v)}
                          />
                        ) : (
                          <Switch
                            value={draft.bools[row.key as BoolPermissionKey]}
                            disabled={readOnly}
                            onValueChange={() => toggleBool(row.key as BoolPermissionKey)}
                            trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                            thumbColor={
                              draft.bools[row.key as BoolPermissionKey] ? colors.primary[600] : palette.bg.muted
                            }
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {/* ── Сохранить ──────────────────────────────────────────────────── */}
        {!readOnly && (
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={isSaving}
            accessibilityRole="button"
            accessibilityLabel="Сохранить роль"
          >
            {isSaving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>{isCreate ? 'Создать роль' : 'Сохранить'}</Text>
            )}
          </TouchableOpacity>
        )}
      </KeyboardAwareScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { padding: spacing[4] },
  // Системная плашка
  systemNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
    marginBottom: spacing[4],
  },
  systemNoteTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  systemNoteSub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  copyBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  copyBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.white },
  // Форма
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  formInputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  inputReadOnly: { opacity: 0.6 },
  // Матрица
  matrixTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1] },
  matrixHint: { fontSize: 11, lineHeight: 15, marginBottom: spacing[3] },
  group: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    marginBottom: spacing[3],
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  groupTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  groupSummary: { fontSize: 11, marginTop: 1 },
  groupBody: {
    borderTopWidth: 1,
    paddingHorizontal: spacing[3.5],
    paddingBottom: spacing[2],
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
  },
  permTextWrap: { flex: 1, minWidth: 0 },
  permLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  permHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  // Сегмент [Нет | Свои | Все]
  segmentTrack: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    padding: 2,
  },
  segmentDisabled: { opacity: 0.55 },
  segmentItem: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 46,
  },
  segmentItemActive: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  segmentTextActive: { fontWeight: fontWeight.semibold },
  // Сохранить
  saveBtn: {
    marginTop: spacing[2],
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
