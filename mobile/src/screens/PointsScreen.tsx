/**
 * PointsScreen — раздел «Филиалы»: основной автосервис владельца и открытые им
 * филиалы (мульти-точки 156/160/161).
 *
 * ЗАЧЕМ ЭКРАН. Требование владельца: «если у тенанта открыты дополнительные
 * точки, то в Ещё добавляется раздел Филиалы, там список филиалов… где виден
 * оборот за день, оборот за месяц, прибыль и сколько мастеров на работе, и
 * кнопка Перейти».
 *
 * ЭТО ЕДИНСТВЕННОЕ МЕСТО ПЕРЕКЛЮЧЕНИЯ. Дословно: «Должен быть основной сервис,
 * он называется ZR AUTO, а филиал ТопГаз — это дополнительно открытый, и
 * переключиться туда можно ТОЛЬКО через филиал, а не везде. Это два разных
 * автосервиса одного владельца просто». Поэтому на всех прочих экранах
 * (главная, Касса, Журнал, смены, расписание) стоит НЕинтерактивный индикатор
 * (components/PointIndicator), который только показывает текущий автосервис и
 * ведёт сюда. Переход выполняется кнопкой в карточке — осознанно, рядом с
 * цифрами этого автосервиса.
 *
 * ЧЕМ ОСНОВНОЙ СЕРВИС ОТЛИЧАЕТСЯ ОТ ФИЛИАЛА (160, tenant_points.is_main):
 * основной — это САМ автосервис владельца, ему принадлежит вся история,
 * заведённая до появления филиалов, и назван он по названию компании. Ровно
 * один такой у тенанта, сервер отдаёт его первым. Поэтому он идёт отдельной
 * секцией сверху и подписан как основной: строкой вровень с только что
 * открытым филиалом владелец не понял бы, где лежит его многолетняя выручка.
 *
 * КТО ВИДИТ ЧТО:
 *   • список и «Перейти» — любой, у кого доступ больше чем к одному
 *     автосервису (в том числе мастер: он работает в двух и обязан уметь
 *     перейти, иначе пробьёт заказ-наряд не туда);
 *   • деньги (оборот, прибыль, мастера на смене) — GET /points/summary под
 *     ключом `financial_reports`; прибыль внутри дополнительно закрыта
 *     `profit_view` (без права сервер отдаёт 0, поэтому строку не рисуем
 *     вовсе — ноль выглядел бы как настоящий убыток);
 *   • назначение сотрудников — `user_management`, как и раньше;
 *   • режим «Все автосервисы» (общая сводка, филиал не выбран) — только
 *     держателю user_management: денежная запись в нём запрещена сервером, и
 *     выйти из него можно тоже только здесь.
 *
 * Автосервисы заводит/архивирует ТОЛЬКО суперадмин (карточка тенанта в
 * admin-панели) — их количество и есть лимит. Этот экран их не создаёт.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { pointsApi } from '../api/services';
import { useUsers } from '../hooks/useUsers';
import { usePointAccess, useSwitchPoint, POINTS_QUERY_KEY, ALL_POINTS_LABEL, pointKindLabel } from '../hooks/usePoints';
import IosScreenHeader from '../components/IosScreenHeader';
import { BottomSheet } from '../components/BottomSheet';
import EmptyState from '../components/EmptyState';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface, useShadow } from '../platform/iosSurface';
import { colors, spacing, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { needsCheckLossConfirm, resolvePointSwitchReturn, type RouteBelowPoints } from './pointsSwitchTarget';
import { formatMoney } from '../../../shared/utils/formatters';
import type { TenantPoint, PointSummary, PointsSummaryResponse } from '../../../shared/types';

/**
 * Идентификатор строки «Все автосервисы» для спиннера. У неё нет id точки
 * (сервер обозначает этот режим как currentPointId = null), а сравнивать по
 * null нельзя — null означает ещё и «сейчас никуда не переходим».
 */
const ALL_POINTS_ROW_ID = '__all_points__';

export default function PointsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('user_management');
  // Деньги автосервисов — тот же ключ, что гейтит эндпоинт на сервере. Без
  // права запрос даже не отправляем: 403 в консоли ничего не лечит.
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');

  const { selectable, mainPoint, branches, currentPointId, canSeeAllPoints, isLoading } = usePointAccess();
  const { switchPoint, isSwitching } = useSwitchPoint();

  const [assigningPoint, setAssigningPoint] = React.useState<TenantPoint | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  // Какую карточку сейчас открываем — чтобы спиннер крутился ровно на ней, а
  // не на всех кнопках «Перейти» сразу. Строка «Все автосервисы» филиала не
  // имеет, поэтому её идентификатор — отдельная константа, а не id точки.
  const [enteringId, setEnteringId] = React.useState<string | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

  const summaryByPoint = React.useMemo(() => {
    const map = new Map<string, PointSummary>();
    for (const s of summaryData?.points ?? []) map.set(s.pointId, s);
    return map;
  }, [summaryData]);

  // Канонический ['users'] (см. hooks/useUsers.ts) — только активные, не
  // уволенные/не удалённые сотрудники доступны для назначения на автосервис.
  const { data: allUsers = [] } = useUsers();
  const employees = React.useMemo(
    () => allUsers.filter((u) => u.isActive && !u.dismissedAt && !u.purgedAt),
    [allUsers],
  );

  const openAssign = React.useCallback(
    (point: TenantPoint) => {
      if (!canManage) return;
      haptic('tap');
      setSelectedIds(point.memberIds ?? []);
      setAssigningPoint(point);
    },
    [canManage],
  );

  const toggleEmployee = React.useCallback((userId: string) => {
    haptic('select');
    setSelectedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async ({ pointId, userIds }: { pointId: string; userIds: string[] }) => {
      setSaving(true);
      await pointsApi.setMembers(pointId, userIds);
    },
    onSuccess: () => {
      haptic('success');
      setAssigningPoint(null);
      queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить назначения сотрудников');
    },
    onSettled: () => setSaving(false),
  });

  const handleSave = React.useCallback(() => {
    if (!assigningPoint) return;
    saveMutation.mutate({ pointId: assigningPoint.id, userIds: selectedIds });
  }, [assigningPoint, selectedIds, saveMutation]);

  /**
   * Виден ли под экраном плавающий таб-бар. Экран зарегистрирован ДВАЖДЫ: в
   * MoreStack (вход «Ещё → Филиалы» — бар на месте) и на КОРНЕВОМ стеке (тап по
   * индикатору автосервиса — «Филиалы» ложатся поверх бара и закрывают его).
   * Резервировать место под бар во втором случае нельзя: под коротким списком
   * из двух автосервисов повисла бы пустая полоса высотой в сотню точек.
   * Признак — есть ли выше по дереву таб-навигатор.
   */
  const hasTabBar = React.useMemo(() => {
    for (let nav: any = navigation; nav; nav = nav.getParent?.()) {
      if (nav.getState?.()?.type === 'tab') return true;
    }
    return false;
  }, [navigation]);
  const bottomReserve = hasTabBar ? tabBarHeight : spacing[2];

  /**
   * Роут ПОД «Филиалами» — то есть экран, с которого сюда пришли. Читаем в
   * момент нажатия, а не на рендере: к этому времени стек уже устоялся.
   * `index === 0` — «Филиалы» открыты как корень (сюда не попадают, но
   * защищаемся) → под нами ничего нет.
   */
  const routeBelow = React.useCallback((): RouteBelowPoints | null => {
    const state: any = navigation.getState?.();
    const index: number = state?.index ?? -1;
    return index > 0 ? ((state.routes[index - 1] as RouteBelowPoints) ?? null) : null;
  }, [navigation]);

  /**
   * «Перейти» = полностью зайти в автосервис. Переключение сбрасывает ВЕСЬ кеш
   * (см. useSwitchPoint), поэтому на главную мы уходим уже без чужих цифр в
   * памяти — экран покажет загрузку, а не деньги прошлого автосервиса.
   *
   * ИСКЛЮЧЕНИЕ — пришли с Кассы, на которой набирают НОВЫЙ заказ-наряд. Тогда
   * возвращаемся на неё (goBack), а не уходим на главную. Это основной путь
   * сюда: сервер отвечает «Выберите филиал, чтобы пробить чек», человек идёт
   * выбирать — и обязан вернуться к своему заказ-наряду, а не найти пустую
   * Кассу. Уводить на главную здесь означало бы выбросить набранное.
   */
  const performEnter = React.useCallback(
    async (pointId: string | null) => {
      const returnToCash = resolvePointSwitchReturn(routeBelow()) === 'back';
      setEnteringId(pointId ?? ALL_POINTS_ROW_ID);
      try {
        await switchPoint(pointId);
        haptic('success');
        if (returnToCash) navigation.goBack();
        // navigate('Main', …), а не navigate('Dashboard'): экран живёт в двух
        // копиях — в MoreStack и на корневом стеке. Через `Main` роут находится
        // из обеих, и корневая копия заодно разматывает всё, что лежит поверх
        // вкладок (сами «Филиалы», Кассу).
        else navigation.navigate('Main', { screen: 'Dashboard' });
      } catch {
        haptic('error');
        Alert.alert('Ошибка', 'Не удалось перейти. Проверьте связь и попробуйте ещё раз.');
      } finally {
        setEnteringId(null);
      }
    },
    [navigation, routeBelow, switchPoint],
  );

  /**
   * `pointId === null` — общая сводка «Все автосервисы» (только владельцу/
   * админу): денежную запись сервер в этом режиме не примет, зато видно обе
   * выручки сразу.
   */
  const enterPoint = React.useCallback(
    async (pointId: string | null) => {
      if (pointId === currentPointId || isSwitching) return;
      haptic('tap');
      const below = routeBelow();
      // Под нами открыта правка СУЩЕСТВУЮЩЕГО заказ-наряда (CheckCreate с id).
      // Он принадлежит прежнему автосервису: после перехода его данные уже вне
      // области видимости, экран закроется, а несохранённые правки пропадут.
      // Молча этого делать нельзя — спрашиваем.
      if (needsCheckLossConfirm(below)) {
        haptic('warning');
        Alert.alert(
          'Открыт заказ-наряд',
          'Он относится к текущему автосервису. Переход в другой закроет его, несохранённые изменения пропадут.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Всё равно перейти', style: 'destructive', onPress: () => void performEnter(pointId) },
          ],
        );
        return;
      }
      await performEnter(pointId);
    },
    [currentPointId, isSwitching, performEnter, routeBelow],
  );

  const renderCard = (p: TenantPoint) => (
    <PointCard
      key={p.id}
      point={p}
      summary={summaryByPoint.get(p.id)}
      summaryLoading={summaryLoading}
      canSeeMoney={canSeeMoney}
      canSeeProfit={canSeeProfit}
      canManage={canManage}
      isCurrent={p.id === currentPointId}
      busy={enteringId === p.id}
      isSwitching={isSwitching}
      onEnter={() => void enterPoint(p.id)}
      onAssign={() => openAssign(p)}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Филиалы" subtitle="Основной сервис и филиалы" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomReserve + spacing[4] }]}
        contentInset={{ bottom: bottomReserve }}
        scrollIndicatorInsets={{ bottom: bottomReserve }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading && selectable.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        ) : selectable.length === 0 ? (
          <EmptyState
            title="Пока нет филиалов"
            description="Дополнительный автосервис заводит суперадмин в панели управления."
            icon="business"
          />
        ) : (
          <>
            {/* Объяснение модели ПЕРВЫМ экраном: это не «главная и её
                придаток», а два самостоятельных автосервиса одного владельца.
                Без этой строки владелец не понимает, почему выручка не
                суммируется. */}
            <Text style={[styles.intro, { color: palette.text.secondary }]}>
              Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
              зарплата. Перейти в другой можно только отсюда.
            </Text>

            {mainPoint ? (
              <View style={styles.section}>
                <SectionLabel text="Основной сервис" />
                {renderCard(mainPoint)}
              </View>
            ) : null}

            {branches.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel text={branches.length === 1 ? 'Филиал' : 'Филиалы'} />
                <View style={{ gap: spacing[3] }}>{branches.map(renderCard)}</View>
              </View>
            ) : null}

            {canSeeAllPoints ? (
              <View style={styles.section}>
                <SectionLabel text="Общая сводка" />
                <AllPointsCard
                  isCurrent={currentPointId === null}
                  busy={enteringId === ALL_POINTS_ROW_ID}
                  isSwitching={isSwitching}
                  onEnter={() => void enterPoint(null)}
                />
              </View>
            ) : null}
          </>
        )}

        {canManage && selectable.length > 0 && (
          <Text style={[styles.hint, { color: palette.text.tertiary }]}>
            Сотрудник без назначений может работать в любом автосервисе.
          </Text>
        )}
      </ScrollView>

      {/* Назначение сотрудников на автосервис — чекбоксы по активным
          сотрудникам тенанта, как «Кто принимает оплату» в настройках
          компании. */}
      <BottomSheet
        visible={!!assigningPoint}
        onClose={() => setAssigningPoint(null)}
        title={assigningPoint?.name ?? 'Автосервис'}
        heightRatio={0.78}
      >
        {assigningPoint && (
          <View style={{ gap: spacing[1] }}>
            {employees.length === 0 ? (
              <Text style={[styles.emptyEmployeesText, { color: palette.text.secondary }]}>
                Нет активных сотрудников
              </Text>
            ) : (
              employees.map((u) => {
                const checked = selectedIds.includes(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => toggleEmployee(u.id)}
                    style={styles.employeeRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={u.fullName}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? palette.accent.primary : palette.text.tertiary}
                    />
                    <Text style={[styles.employeeName, { color: palette.text.primary }]} numberOfLines={1}>
                      {u.fullName}
                    </Text>
                  </Pressable>
                );
              })
            )}

            <Pressable
              onPress={handleSave}
              disabled={saving}
              style={[styles.saveBtn, { backgroundColor: palette.accent.primary }]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                  <Text style={styles.saveBtnText}>Сохранить</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

/** Заголовок секции: «Основной сервис» / «Филиалы» / «Общая сводка». */
function SectionLabel({ text }: { text: string }) {
  const palette = useColors();
  return <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>{text}</Text>;
}

function PointCard({
  point,
  summary,
  summaryLoading,
  canSeeMoney,
  canSeeProfit,
  canManage,
  isCurrent,
  busy,
  isSwitching,
  onEnter,
  onAssign,
}: {
  point: TenantPoint;
  summary?: PointSummary;
  summaryLoading: boolean;
  canSeeMoney: boolean;
  canSeeProfit: boolean;
  canManage: boolean;
  isCurrent: boolean;
  busy: boolean;
  isSwitching: boolean;
  onEnter: () => void;
  onAssign: () => void;
}) {
  const palette = useColors();
  const surface = useIosSurface();
  const shadow = useShadow();
  const kind = pointKindLabel(point);

  return (
    <View
      style={[styles.card, surface.card, shadow, isCurrent && { borderColor: palette.accent.primary, borderWidth: 1 }]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.pointIcon,
            { backgroundColor: isCurrent ? palette.accent.primary : palette.accent.primarySoft },
          ]}
        >
          {/* Дом = сам автосервис владельца, здание = открытый позже филиал.
              Разные глифы, потому что это разные сущности. */}
          <Ionicons
            name={point.isMain ? 'home' : 'business'}
            size={18}
            color={isCurrent ? colors.white : palette.accent.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pointName, { color: palette.text.primary }]} numberOfLines={1}>
            {point.name}
          </Text>
          <Text style={[styles.pointKind, { color: palette.text.tertiary }]} numberOfLines={1}>
            {point.address ? `${kind} · ${point.address}` : kind}
          </Text>
        </View>
        {isCurrent && (
          <View style={[styles.currentBadge, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="checkmark-circle" size={13} color={palette.accent.primary} />
            <Text style={[styles.currentBadgeText, { color: palette.accent.primary }]}>Вы здесь</Text>
          </View>
        )}
      </View>

      {canSeeMoney && (
        <View style={styles.metrics}>
          {summaryLoading && !summary ? (
            <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[3] }} />
          ) : (
            <>
              <Metric label="Оборот за день" value={summary ? formatMoney(summary.revenueToday) : '—'} />
              <Metric label="Оборот за месяц" value={summary ? formatMoney(summary.revenueMonth) : '—'} />
              {canSeeProfit && (
                <Metric
                  label="Прибыль за месяц"
                  value={summary ? formatMoney(summary.profitMonth) : '—'}
                  tone={
                    summary && summary.profitMonth < 0
                      ? colors.red[600]
                      : summary && summary.profitMonth > 0
                        ? colors.green[600]
                        : undefined
                  }
                />
              )}
              {/* mastersOnShift === null — учёт смен у тенанта ВЫКЛЮЧЕН, факта
                  не существует. Рисуем прочерк: «0» прочиталось бы как
                  «сегодня никто не вышел» и отправило бы владельца искать
                  несуществующую проблему. */}
              <Metric
                label="Мастеров на работе"
                value={
                  summary && summary.mastersOnShift !== null && summary.mastersOnShift !== undefined
                    ? String(summary.mastersOnShift)
                    : '—'
                }
              />
            </>
          )}
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onEnter}
          disabled={isCurrent || isSwitching}
          style={[
            styles.enterBtn,
            {
              backgroundColor: isCurrent ? palette.bg.muted : palette.accent.primary,
              opacity: isSwitching && !busy ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: isCurrent || isSwitching }}
          accessibilityLabel={
            isCurrent ? `${point.name} — вы здесь` : `Перейти в автосервис ${point.name}, ${kind.toLowerCase()}`
          }
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons
                name={isCurrent ? 'checkmark' : 'enter-outline'}
                size={16}
                color={isCurrent ? palette.text.secondary : colors.white}
              />
              <Text style={[styles.enterBtnText, { color: isCurrent ? palette.text.secondary : colors.white }]}>
                {isCurrent ? 'Вы здесь' : 'Перейти'}
              </Text>
            </>
          )}
        </Pressable>

        {canManage && (
          <Pressable
            onPress={onAssign}
            style={[styles.assignBtn, { backgroundColor: palette.bg.muted }]}
            accessibilityRole="button"
            accessibilityLabel={`Сотрудники: ${point.name}`}
          >
            <Ionicons name="people-outline" size={15} color={palette.text.secondary} />
            <Text style={[styles.assignBtnText, { color: palette.text.secondary }]}>
              {point.memberIds?.length ?? 0}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * «Все автосервисы» — режим общей сводки (currentPointId = null). Отдельной
 * карточкой в конце и только владельцу/админу: это НЕ автосервис, а взгляд
 * сверху, и денежную запись сервер в нём не примет. Раньше выйти из него можно
 * было только через переключатель в шапке — теперь это тоже здесь, иначе
 * владелец, однажды сюда попавший, не мог бы вернуться.
 */
function AllPointsCard({
  isCurrent,
  busy,
  isSwitching,
  onEnter,
}: {
  isCurrent: boolean;
  busy: boolean;
  isSwitching: boolean;
  onEnter: () => void;
}) {
  const palette = useColors();
  const surface = useIosSurface();
  const shadow = useShadow();
  return (
    <View
      style={[styles.card, surface.card, shadow, isCurrent && { borderColor: palette.accent.primary, borderWidth: 1 }]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.pointIcon,
            { backgroundColor: isCurrent ? palette.accent.primary : palette.accent.primarySoft },
          ]}
        >
          <Ionicons name="albums-outline" size={18} color={isCurrent ? colors.white : palette.accent.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pointName, { color: palette.text.primary }]} numberOfLines={1}>
            {ALL_POINTS_LABEL}
          </Text>
          <Text style={[styles.pointKind, { color: palette.text.tertiary }]}>
            Цифры сразу по всем — только для просмотра
          </Text>
        </View>
        {isCurrent && (
          <View style={[styles.currentBadge, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="checkmark-circle" size={13} color={palette.accent.primary} />
            <Text style={[styles.currentBadgeText, { color: palette.accent.primary }]}>Вы здесь</Text>
          </View>
        )}
      </View>

      {/* Честная подпись: сервер денежную запись без автосервиса не принимает —
          он либо подставит единственный доступный, либо ответит «Выберите
          филиал, …». Обещать «чек уйдёт без филиала» = обещать поведение,
          которого нет. */}
      <Text style={[styles.allPointsNote, { color: palette.text.tertiary }]}>
        Чтобы пробить чек, завести расход или открыть смену, нужно зайти в конкретный автосервис.
      </Text>

      <View style={styles.actions}>
        <Pressable
          onPress={onEnter}
          disabled={isCurrent || isSwitching}
          style={[
            styles.enterBtn,
            {
              backgroundColor: isCurrent ? palette.bg.muted : palette.accent.primary,
              opacity: isSwitching && !busy ? 0.5 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: isCurrent || isSwitching }}
          accessibilityLabel={isCurrent ? 'Открыта общая сводка' : 'Открыть общую сводку по всем автосервисам'}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons
                name={isCurrent ? 'checkmark' : 'stats-chart-outline'}
                size={16}
                color={isCurrent ? palette.text.secondary : colors.white}
              />
              <Text style={[styles.enterBtnText, { color: isCurrent ? palette.text.secondary : colors.white }]}>
                {isCurrent ? 'Вы здесь' : 'Открыть сводку'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** Плитка одной цифры в карточке автосервиса. */
function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const palette = useColors();
  return (
    <View style={[styles.metric, { backgroundColor: palette.bg.muted }]}>
      <Text style={[styles.metricLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricValue, { color: tone ?? palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[3] },
  intro: { fontSize: 13, lineHeight: 18 },
  section: { gap: spacing[2] },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  card: { gap: spacing[3] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  pointIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pointName: { fontSize: 16, fontWeight: '700' },
  pointKind: { fontSize: 12, marginTop: 2 },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
  },
  currentBadgeText: { fontSize: 11, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  metric: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    gap: 2,
  },
  metricLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  metricValue: { fontSize: 15, fontWeight: '700' },
  allPointsNote: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  enterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  enterBtnText: { fontSize: 14, fontWeight: '700' },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  assignBtnText: { fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: spacing[1] },
  // Assignment sheet
  emptyEmployeesText: { fontSize: 14, textAlign: 'center', paddingVertical: spacing[6] },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
    minHeight: 44,
  },
  employeeName: { flex: 1, fontSize: 15, fontWeight: '500' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[3],
  },
  saveBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
