/**
 * PointsScreen — раздел «Филиалы»: основной автосервис владельца и открытые им
 * филиалы (мульти-точки 156/160/161/163).
 *
 * ЗАЧЕМ ЭКРАН. Требование владельца: «если у тенанта открыты дополнительные
 * точки, то в Ещё добавляется раздел Филиалы, там список филиалов… где виден
 * оборот за день, оборот за месяц, прибыль и сколько мастеров на работе».
 *
 * ФИЛИАЛ ЗДЕСЬ НЕ ПЕРЕКЛЮЧАЕТСЯ (163). Дословно: «чтобы выйти и войти в другой
 * им надо опять выйти и войти в другой филиал». Филиал — свойство СЕССИИ: он
 * выбирается при входе и живёт ровно столько, сколько живёт токен. Поэтому в
 * карточке чужого филиала стоит действие «Войти в этот филиал», которое честно
 * предупреждает, что текущая сессия завершится, и по подтверждению делает
 * ВЫХОД — дальше человек входит заново и выбирает филиал на экране входа.
 * Никакого тихого перехода: тихий переход и был тем, из-за чего веб молча
 * уезжал в филиал, выбранный на телефоне.
 *
 * ЧЕМ ОСНОВНОЙ СЕРВИС ОТЛИЧАЕТСЯ ОТ ФИЛИАЛА (160, tenant_points.is_main):
 * основной — это САМ автосервис владельца, ему принадлежит вся история,
 * заведённая до появления филиалов, и назван он по названию компании. Ровно
 * один такой у тенанта, сервер отдаёт его первым. Поэтому он идёт отдельной
 * секцией сверху и подписан как основной: строкой вровень с только что
 * открытым филиалом владелец не понял бы, где лежит его многолетняя выручка.
 *
 * КТО ВИДИТ ЧТО:
 *   • список — любой сотрудник тенанта с более чем одним автосервисом;
 *   • «Войти в этот филиал» — только для филиалов, куда человека пускает
 *     сервер (usePointAccess.selectable — зеркало autexa_available_points);
 *   • деньги (оборот, прибыль, мастера на смене) — GET /points/summary под
 *     ключом `financial_reports`; прибыль внутри дополнительно закрыта
 *     `profit_view` (без права сервер отдаёт 0, поэтому строку не рисуем
 *     вовсе — ноль выглядел бы как настоящий убыток);
 *   • состав филиала — ТОЛЬКО ДЛЯ ПРОСМОТРА. Настройка «на каких филиалах
 *     может работать сотрудник» переехала в его карточку (UserPointsSheet,
 *     право user_management): это ответ на вопрос про ЧЕЛОВЕКА, и место ему
 *     там, где заводят человека.
 *
 * ЗАКРЫТЫЙ ФИЛИАЛ ТОЖЕ ПОЛУЧАЕТ КАРТОЧКУ. Список строится по СВОДКЕ
 * (buildPointCardRows), а не по одному лишь живому GET /points. Пока карточки
 * брались только из живых точек, деньги закрытого филиала оставались в итогах
 * тенанта, а карточки для них не существовало: владелец складывал карточки, не
 * получал цифру с главной и читал это как пропажу денег. Такая карточка
 * подписана «Закрыт», нарисована приглушённо, стоит ПОСЛЕ действующих и НЕ
 * предлагает войти — филиал заархивирован, сервер туда не пустит.
 *
 * Автосервисы заводит/архивирует ТОЛЬКО суперадмин (карточка тенанта в
 * admin-панели) — их количество и есть лимит. Этот экран их не создаёт.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { pointsApi } from '../api/services';
import { usePointAccess, pointKindLabel } from '../hooks/usePoints';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface, useShadow } from '../platform/iosSurface';
import { colors, spacing, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { pendingChecksLogoutNotice, pendingOfflineCheckCount } from '../utils/offlineCheckQueue';
import { formatMoney } from '../../../shared/utils/formatters';
import { buildPointCardRows, type PointCardRow } from '../../../shared/utils/pointCards';
import type { TenantPoint, PointsSummaryResponse } from '../../../shared/types';

export default function PointsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission, logout } = useAuth();
  // Деньги автосервисов — тот же ключ, что гейтит эндпоинт на сервере. Без
  // права запрос даже не отправляем: 403 в консоли ничего не лечит.
  const canSeeMoney = hasPermission('financial_reports');
  const canSeeProfit = hasPermission('profit_view');

  const { points, selectable, currentPointId, isLoading } = usePointAccess();

  const { data: summaryData, isLoading: summaryLoading } = useQuery<PointsSummaryResponse>({
    queryKey: ['points-summary'],
    queryFn: async () => (await pointsApi.summary()).data,
    enabled: canSeeMoney,
    staleTime: 30_000,
  });

  // Карточки строим по ВСЕМ автосервисам тенанта — живым и закрытым с деньгами
  // в периоде, — а не только по доступным этому человеку: сводка по сети это
  // взгляд сверху, и владелец, назначенный на один филиал, обязан видеть цифры
  // второго. Действие «Войти» при этом появляется только там, куда сервер его
  // пустит. Правило сборки и порядок — общие с вебом (shared/utils/pointCards).
  const rows = React.useMemo(
    () => buildPointCardRows({ points, summary: summaryData?.points ?? [] }),
    [points, summaryData],
  );

  // Основной сервис — отдельной секцией сверху. Закрытым он быть не может
  // (API запрещает архивировать основной), но проверку держим явной: закрытая
  // карточка в секции «Основной сервис» выглядела бы как закрытая компания.
  const mainRow = rows.find((r) => r.isMain && !r.isArchived) ?? null;
  const branchRows = rows.filter((r) => r !== mainRow);
  const canEnter = React.useCallback((pointId: string) => selectable.some((p) => p.id === pointId), [selectable]);

  /**
   * Виден ли под экраном плавающий таб-бар. Экран живёт в MoreStack (вход
   * «Ещё → Филиалы»), но открыт может быть и без вкладок; признак — есть ли
   * выше по дереву таб-навигатор. Резервировать место под бар, когда его нет,
   * нельзя: под коротким списком из двух автосервисов повисла бы пустая полоса
   * высотой в сотню точек.
   */
  const hasTabBar = React.useMemo(() => {
    for (let nav: any = navigation; nav; nav = nav.getParent?.()) {
      if (nav.getState?.()?.type === 'tab') return true;
    }
    return false;
  }, [navigation]);
  const bottomReserve = hasTabBar ? tabBarHeight : spacing[2];

  /**
   * «Войти в этот филиал» = ВЫЙТИ и войти заново.
   *
   * Почему именно так, а не «переключить»: филиал лежит в подписанном токене
   * (163), и отобрать его у выданной сессии нельзя — можно только выдать новую.
   * Отсюда и честное предупреждение: приложение выйдет из аккаунта, всё
   * незавершённое (набранный заказ-наряд живёт только в памяти экрана) будет
   * потеряно, и понадобится ввести пароль. Лучше сказать это до, чем показать
   * человеку экран входа без объяснений.
   */
  const enterPoint = React.useCallback(
    async (point: TenantPoint) => {
      haptic('warning');
      // Очередь офлайн-чеков переживает выход и дошлётся после входа ТЕМ ЖЕ
      // аккаунтом — но человек обязан узнать об этом ДО того, как увидит экран
      // входа: неотправленный заказ-наряд это деньги. Чтение с диска
      // best-effort: отказ не должен мешать сменить филиал.
      let notice = '';
      try {
        notice = pendingChecksLogoutNotice(await pendingOfflineCheckCount());
      } catch {
        notice = '';
      }
      const base =
        'Филиал выбирается при входе, поэтому приложение выйдет из аккаунта. Введите телефон и пароль ещё раз и ' +
        'выберите этот филиал в списке. Набранный, но не пробитый заказ-наряд будет потерян.';
      Alert.alert(`Войти в «${point.name}»?`, notice ? `${base}\n\n${notice}` : base, [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Выйти и войти',
          style: 'destructive',
          onPress: () => {
            haptic('tap');
            // logout() чистит кеш экранов целиком, поэтому после входа в другой
            // филиал на них не мелькнут цифры этого. Офлайн-очередь при этом
            // остаётся за своим владельцем — стирает её только вход ДРУГОГО.
            logout();
          },
        },
      ]);
    },
    [logout],
  );

  const renderCard = (row: PointCardRow) => (
    <PointCard
      key={row.pointId}
      row={row}
      summaryLoading={summaryLoading}
      canSeeMoney={canSeeMoney}
      canSeeProfit={canSeeProfit}
      isCurrent={row.pointId === currentPointId}
      // Войти можно только в ЖИВОЙ филиал, куда пускает сервер. У закрытого
      // живой записи нет вовсе — и входить в него некуда.
      canEnter={!row.isArchived && row.point !== null && canEnter(row.pointId)}
      onEnter={() => {
        if (row.point) void enterPoint(row.point);
      }}
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
        {isLoading && rows.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        ) : rows.length === 0 ? (
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
                суммируется, и где он вообще сейчас работает. */}
            <Text style={[styles.intro, { color: palette.text.secondary }]}>
              Основной сервис и филиалы — разные автосервисы одного владельца: у каждого своя касса, свой склад и своя
              зарплата. Вы работаете в том филиале, в который вошли; чтобы перейти в другой, нужно выйти и войти заново.
            </Text>

            {mainRow ? (
              <View style={styles.section}>
                <SectionLabel text="Основной сервис" />
                {renderCard(mainRow)}
              </View>
            ) : null}

            {branchRows.length > 0 ? (
              <View style={styles.section}>
                <SectionLabel text={branchRows.length === 1 ? 'Филиал' : 'Филиалы'} />
                <View style={{ gap: spacing[3] }}>{branchRows.map(renderCard)}</View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Заголовок секции: «Основной сервис» / «Филиалы». */
function SectionLabel({ text }: { text: string }) {
  const palette = useColors();
  return <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>{text}</Text>;
}

function PointCard({
  row,
  summaryLoading,
  canSeeMoney,
  canSeeProfit,
  isCurrent,
  canEnter,
  onEnter,
}: {
  row: PointCardRow;
  summaryLoading: boolean;
  canSeeMoney: boolean;
  canSeeProfit: boolean;
  isCurrent: boolean;
  /** Пустит ли сервер этого человека в этот филиал (user_points, 163). */
  canEnter: boolean;
  onEnter: () => void;
}) {
  const palette = useColors();
  const surface = useIosSurface();
  const shadow = useShadow();
  const { point, summary, isArchived } = row;
  const kind = pointKindLabel(row);

  return (
    <View
      style={[
        styles.card,
        surface.card,
        // Закрытый филиал не «висит» над фоном: без тени карточка сама уходит
        // на второй план, а действующие остаются главными на экране.
        isArchived ? styles.cardArchived : shadow,
        isCurrent && !isArchived && { borderColor: palette.accent.primary, borderWidth: 1 },
      ]}
    >
      <View style={styles.cardHead}>
        <View
          style={[
            styles.pointIcon,
            {
              backgroundColor: isArchived
                ? palette.bg.muted
                : isCurrent
                  ? palette.accent.primary
                  : palette.accent.primarySoft,
            },
          ]}
        >
          {/* Дом = сам автосервис владельца, здание = открытый позже филиал.
              Разные глифы, потому что это разные сущности. */}
          <Ionicons
            name={row.isMain ? 'home' : 'business'}
            size={18}
            color={isArchived ? palette.text.tertiary : isCurrent ? colors.white : palette.accent.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.pointName, { color: isArchived ? palette.text.secondary : palette.text.primary }]}
            numberOfLines={1}
          >
            {row.name}
          </Text>
          <Text style={[styles.pointKind, { color: palette.text.tertiary }]} numberOfLines={1}>
            {row.address ? `${kind} · ${row.address}` : kind}
          </Text>
        </View>
        {/* «Закрыт» важнее «Вы здесь»: человек, оставшийся в сессии закрытого
            филиала, обязан в первую очередь узнать, что филиала больше нет. */}
        {isArchived ? (
          <View style={[styles.currentBadge, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="archive-outline" size={13} color={palette.text.tertiary} />
            <Text style={[styles.currentBadgeText, { color: palette.text.tertiary }]}>Закрыт</Text>
          </View>
        ) : isCurrent ? (
          <View style={[styles.currentBadge, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="checkmark-circle" size={13} color={palette.accent.primary} />
            <Text style={[styles.currentBadgeText, { color: palette.accent.primary }]}>Вы здесь</Text>
          </View>
        ) : null}
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

      {/* Состав филиала — СПРАВОЧНО. Настраивается в карточке сотрудника, и
          подпись обязана об этом сказать: иначе владелец будет искать здесь
          кнопку, которой больше нет. У закрытого филиала состава нет: работать
          в нём уже нельзя, и строка про закреплённых только сбивала бы. */}
      {point && !isArchived ? (
        <View style={styles.membersRow}>
          <Ionicons name="people-outline" size={14} color={palette.text.tertiary} />
          <Text style={[styles.membersText, { color: palette.text.tertiary }]} numberOfLines={2}>
            {point.memberIds && point.memberIds.length > 0
              ? `Закреплены: ${point.memberIds.length} — настраивается в карточке сотрудника`
              : 'Никто не закреплён — доступен всем сотрудникам'}
          </Text>
        </View>
      ) : null}

      {isArchived ? (
        // Действия «Войти» здесь НЕ БЫВАЕТ: филиал заархивирован, и сервер в
        // него не пустит. Карточка существует только ради денег периода —
        // чтобы сумма карточек сошлась с итогом сети на главной.
        <View style={[styles.hereRow, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="archive-outline" size={14} color={palette.text.tertiary} />
          <Text
            style={[styles.hereText, { color: palette.text.tertiary, flexShrink: 1, textAlign: 'center' }]}
            numberOfLines={2}
          >
            {isCurrent ? 'Филиал закрыт. Вы работаете в нём до выхода' : 'Филиал закрыт — войти нельзя'}
          </Text>
        </View>
      ) : isCurrent ? (
        <View style={[styles.hereRow, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="checkmark" size={15} color={palette.text.secondary} />
          <Text style={[styles.hereText, { color: palette.text.secondary }]}>Вы работаете здесь</Text>
        </View>
      ) : canEnter ? (
        <Pressable
          onPress={onEnter}
          style={({ pressed }) => [
            styles.enterBtn,
            { backgroundColor: palette.accent.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Войти в автосервис ${row.name}. Потребуется выйти и войти заново`}
        >
          <Ionicons name="log-in-outline" size={16} color={colors.white} />
          <Text style={[styles.enterBtnText, { color: colors.white }]}>Войти в этот филиал</Text>
        </Pressable>
      ) : (
        // Сотрудник сюда не назначен — сервер его не пустит. Показываем причину,
        // а не серую кнопку: серая кнопка выглядит как временный сбой.
        <View style={[styles.hereRow, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="lock-closed-outline" size={14} color={palette.text.tertiary} />
          <Text style={[styles.hereText, { color: palette.text.tertiary }]}>Вы не закреплены за этим филиалом</Text>
        </View>
      )}
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
  // Закрытый филиал приглушён: без тени и чуть прозрачнее действующих —
  // цифры при этом остаются читаемыми, ради них карточка и существует.
  cardArchived: { opacity: 0.86 },
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
  membersRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  membersText: { flex: 1, fontSize: 12, lineHeight: 16 },
  enterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  enterBtnText: { fontSize: 14, fontWeight: '700' },
  hereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  hereText: { fontSize: 13, fontWeight: '600' },
});
