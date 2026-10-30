import React, { useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TabBarScrollView as ScrollView } from '../../../components/TabBarScrollable';
import { type CompositeNavigationProp, type NavigationProp, useNavigation } from '@react-navigation/native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import { reportsApi } from '../../../api/services';
import type { RootStackParamList, TabParamList } from '../../../navigation/AppNavigator';
import { accrualBreakdown } from '../../../../../shared/utils/accrualBreakdown';
import { formatMoney } from '../../../../../shared/utils/formatters';
import type {
  OwnerHomeClientCohort,
  OwnerHomeProfit,
  OwnerHomeTimeline,
  OwnerHomeRapidReturnRow,
  OwnerHomeVisitsQuery,
} from '../../../../../shared/types/ownerHome';
import {
  loadOwnerHome,
  ownerClock,
  ownerDateLabel,
  ownerDeltaLabel,
  ownerHomeEnabled,
  ownerRangeLabel,
  type OwnerHomeScope,
} from './ownerHomeState';
import { OwnerHomeRetry } from './OwnerHomeOperational';

export type OwnerHomeDetail =
  | { kind: 'timeline'; timeline: OwnerHomeTimeline }
  | { kind: 'timeline-info'; timeline: OwnerHomeTimeline }
  | { kind: 'basis'; profit: OwnerHomeProfit }
  | { kind: 'profit'; period: 'day' | 'month'; profit: OwnerHomeProfit }
  | { kind: 'clients'; cohort: OwnerHomeClientCohort; range: OwnerHomeVisitsQuery; timezone: string }
  | { kind: 'returns'; range: OwnerHomeVisitsQuery; timezone: string };

type OpenRoute = <K extends 'ClientDetail' | 'CarDetail' | 'CheckDetail'>(
  name: K,
  params: RootStackParamList[K],
) => void;
type OwnerHomeNavigation = CompositeNavigationProp<
  NavigationProp<TabParamList>,
  NavigationProp<Pick<RootStackParamList, 'ClientDetail' | 'CarDetail'>>
>;

export default function OwnerHomeDetails({
  detail,
  scope,
  onClose,
  reducedMotion = false,
}: {
  detail: OwnerHomeDetail;
  scope: OwnerHomeScope;
  onClose: () => void;
  reducedMotion?: boolean;
}) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<OwnerHomeNavigation>();
  const [visible, setVisible] = useState(true);
  const pendingNavigation = useRef<(() => void) | null>(null);
  const finished = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const complete = () => {
    if (finished.current || !mounted.current) return;
    finished.current = true;
    onClose();
    if (scope.isCurrent()) pendingNavigation.current?.();
  };
  const close = () => {
    setVisible(false);
    // Finish the iOS presented-controller dismissal before pushing a stack screen.
    if (Platform.OS !== 'ios') requestAnimationFrame(complete);
  };
  const open: OpenRoute = (name, params) => {
    pendingNavigation.current = () =>
      navigation.dispatch({
        type: 'NAVIGATE',
        payload:
          name === 'CheckDetail'
            ? { name: 'Checks', params: { screen: 'CheckDetail', initial: false, params } }
            : { name, params },
      });
    close();
  };
  const title =
    detail.kind === 'timeline-info'
      ? 'О расчёте сводки'
      : detail.kind === 'timeline'
        ? 'Расчёт за период'
        : detail.kind === 'basis'
          ? 'Чистая прибыль'
          : detail.kind === 'profit'
            ? 'Расчёт прибыли'
            : detail.kind === 'returns'
              ? 'Повторные заезды'
              : detail.cohort === 'new'
                ? 'Клиенты впервые'
                : 'Повторные клиенты';
  return (
    <Modal
      visible={visible}
      animationType={!reducedMotion && Platform.OS === 'ios' ? 'slide' : 'none'}
      presentationStyle="pageSheet"
      allowSwipeDismissal
      onRequestClose={close}
      onDismiss={complete}
    >
      <View
        style={[
          styles.screen,
          { backgroundColor: p.bg.canvas, paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 12 },
        ]}
        accessibilityViewIsModal
      >
        <View style={[styles.header, { borderBottomColor: p.border.subtle }]}>
          <Text accessibilityRole="header" style={[styles.heading, { color: p.text.primary }]}>
            {title}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Закрыть подробности"
            style={styles.close}
            onPress={close}
          >
            <Ionicons name="close" size={23} color={p.text.primary} />
          </TouchableOpacity>
        </View>
        <ScrollView
          reserveBottomNavigation={false}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        >
          {detail.kind === 'timeline' || detail.kind === 'timeline-info' ? (
            <TimelineDetails detail={detail} />
          ) : detail.kind === 'basis' || detail.kind === 'profit' ? (
            <ProfitDetails detail={detail} />
          ) : detail.kind === 'clients' ? (
            <ClientList detail={detail} scope={scope} open={open} />
          ) : (
            <ReturnList detail={detail} scope={scope} open={open} />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function TimelineDetails({ detail }: { detail: Extract<OwnerHomeDetail, { kind: 'timeline' | 'timeline-info' }> }) {
  const p = useColors(),
    { timeline } = detail;
  const period = ownerRangeLabel(timeline.range.from, timeline.range.through);
  return (
    <>
      <Text style={[styles.subtitle, { color: p.text.secondary }]}>
        {period} ·{' '}
        {timeline.range.partialDay
          ? `до ${ownerClock(timeline.range.untilExclusive, timeline.timezone)}`
          : 'по конец дня'}{' '}
        · {timeline.timezone}
      </Text>
      <Text style={[styles.sectionTitle, { color: p.text.primary }]}>{timeline.basisLabel}</Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>{timeline.basisDetail}</Text>
      {timeline.allocationDetail && (
        <Text style={[styles.paragraph, { color: p.text.secondary }]}>{timeline.allocationDetail}</Text>
      )}
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        Дневной расчёт сохраняет правила даты начисления премий. В неделе, месяце и году премия, назначенная месяцу,
        учитывается в своём месяце один раз. Поэтому сумма результатов отдельных дней может отличаться от итога периода.
      </Text>
      {detail.kind === 'timeline' && (
        <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
          {accrualBreakdown(timeline.totals).map((row) => (
            <View key={row.label} style={[styles.detailRow, { borderBottomColor: p.border.subtle }]}>
              <Text style={[styles.rowLabel, { color: p.text.primary }]}>{row.label}</Text>
              <Text style={[styles.rowValue, { color: p.text.primary }]}>
                {row.contribution > 0 ? '+' : row.contribution < 0 ? '−' : ''}
                {formatMoney(Math.abs(row.contribution), 2)}
              </Text>
            </View>
          ))}
          <View style={styles.total}>
            <Text style={[styles.totalLabel, { color: p.text.primary }]}>Чистая прибыль</Text>
            <Text style={[styles.totalValue, { color: p.text.primary }]}>
              {formatMoney(timeline.totals.netProfit, 2)}
            </Text>
          </View>
        </View>
      )}
      <Text style={[styles.paragraph, { color: p.text.secondary, marginTop: 14 }]}>
        Оборот: {formatMoney(timeline.totals.revenue, 2)}. Мотивация уже входит в премии и не вычитается повторно.
        Выплаты и остаток денег в кассе — отдельные показатели.
      </Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        В сводке — чистая прибыль после расходов и оборот за выбранный период. Эти суммы относятся к периоду работы, а
        не к дате оплаты.
      </Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        Месячная прибыль считается с начала месяца по выбранную дату. Сравнение — с такими же датами прошлого месяца и
        тем же временем дня. Если в прошлом месяце меньше дней, берётся его последний день.
      </Text>
    </>
  );
}

function ProfitDetails({ detail }: { detail: Extract<OwnerHomeDetail, { kind: 'basis' | 'profit' }> }) {
  const p = useColors();
  const { profit } = detail;
  const day = detail.kind === 'profit' && detail.period === 'day';
  const current = day ? profit.current.day : profit.current.mtd;
  const previous = day ? profit.comparison.day : profit.comparison.mtd;
  const delta = day ? profit.comparison.dayDelta : profit.comparison.mtdDelta;
  const period = day
    ? ownerDateLabel(profit.canonicalDate, true)
    : ownerRangeLabel(profit.current.period.from, profit.current.period.through);
  return (
    <>
      <Text style={[styles.subtitle, { color: p.text.secondary }]}>
        {period} ·{' '}
        {profit.current.period.partialDay
          ? `до ${ownerClock(profit.current.period.untilExclusive, profit.timezone)}`
          : 'по конец дня'}{' '}
        · {profit.timezone} · по начислению
      </Text>
      <Text style={[styles.sectionTitle, { color: p.text.primary }]}>{profit.basisLabel}</Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>{profit.basisDetail}</Text>
      {detail.kind === 'profit' && (
        <>
          <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
            {accrualBreakdown(current).map((row) => (
              <View key={row.label} style={[styles.detailRow, { borderBottomColor: p.border.subtle }]}>
                <Text style={[styles.rowLabel, { color: p.text.primary }]}>{row.label}</Text>
                <Text style={[styles.rowValue, { color: p.text.primary }]}>
                  {row.contribution > 0 ? '+' : row.contribution < 0 ? '−' : ''}
                  {formatMoney(Math.abs(row.contribution), 2)}
                </Text>
              </View>
            ))}
            <View style={styles.total}>
              <Text style={[styles.totalLabel, { color: p.text.primary }]}>Чистая прибыль</Text>
              <Text style={[styles.totalValue, { color: p.text.primary }]}>{formatMoney(current.netProfit, 2)}</Text>
            </View>
          </View>
          <Text style={[styles.paragraph, { color: p.text.secondary, marginTop: 12 }]}>
            Выручка: {formatMoney(current.revenue, 2)}. Себестоимость и сдельная оплата работ уже учтены в прибыли по
            чекам. Мотивация входит в премии и не вычитается повторно.
          </Text>
        </>
      )}
      <Text style={[styles.sectionTitle, { color: p.text.primary }]}>Сравнение с прошлым месяцем</Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        {day
          ? ownerDateLabel(profit.comparison.period.through, true)
          : ownerRangeLabel(profit.comparison.period.from, profit.comparison.period.through)}{' '}
        ·{' '}
        {profit.comparison.period.partialDay
          ? `до ${ownerClock(profit.comparison.period.untilExclusive, profit.timezone)}`
          : 'по конец дня'}
        {profit.comparison.clamped ? '. В прошлом месяце меньше дней — выбран его последний день.' : '.'}
      </Text>
      <View style={[styles.detailRow, { borderBottomColor: p.border.subtle }]}>
        <Text style={[styles.rowLabel, { color: p.text.primary }]}>Было</Text>
        <Text style={[styles.rowValue, { color: p.text.primary }]}>{formatMoney(previous.netProfit, 2)}</Text>
      </View>
      <View style={[styles.detailRow, { borderBottomColor: p.border.subtle }]}>
        <Text style={[styles.rowLabel, { color: p.text.primary }]}>Изменение</Text>
        <Text style={[styles.rowValue, { color: p.text.primary }]}>{ownerDeltaLabel(delta, previous.netProfit)}</Text>
      </View>
      {delta.percent === null && (
        <Text style={[styles.paragraph, { color: p.text.secondary, marginTop: 12 }]}>
          Процент не рассчитывается, когда результат прошлого периода равен нулю или отрицательный.
        </Text>
      )}
      <Text style={[styles.paragraph, { color: p.text.secondary, marginTop: 16 }]}>
        По начислению: результат относится к периоду работы. Остаток денег в кассе, выплаты и авансы — отдельные
        показатели.
      </Text>
    </>
  );
}

function ClientList({
  detail,
  scope,
  open,
}: {
  detail: Extract<OwnerHomeDetail, { kind: 'clients' }>;
  scope: OwnerHomeScope;
  open: OpenRoute;
}) {
  const p = useColors();
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ['owner-home', ...scope.key, 'clients', detail.range.from, detail.range.to, detail.cohort],
    queryFn: ({ pageParam }) =>
      loadOwnerHome(scope, () =>
        reportsApi.ownerHomeClients({ ...detail.range, cohort: detail.cohort, limit: 30, cursor: pageParam }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role) && scope.isCurrent(),
    staleTime: 30_000,
    placeholderData: undefined,
  });
  const clients = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <Text style={[styles.subtitle, { color: p.text.secondary }]}>
        {ownerRangeLabel(detail.range.from, detail.range.to)} · текущий филиал · {detail.timezone}
      </Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        {detail.cohort === 'new'
          ? 'Первый зарегистрированный визит клиента попал в этот период.'
          : 'У клиента есть зарегистрированный визит до начала этого периода.'}{' '}
        История проверяется по всем филиалам. Каждый клиент входит только в одну группу.
      </Text>
      {query.isPending ? (
        <ActivityIndicator accessibilityLabel="Загружаются клиенты" color={p.accent.primary} style={styles.spinner} />
      ) : query.isError && !query.data ? (
        <OwnerHomeRetry text="Клиенты не загрузились" onRetry={query.refetch} busy={query.isFetching} />
      ) : clients.length ? (
        <View style={[styles.group, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
          {clients.map((client) => (
            <TouchableOpacity
              key={client.clientId}
              accessibilityRole="button"
              accessibilityState={{ disabled: !client.canOpenClientHistory }}
              disabled={!client.canOpenClientHistory}
              style={[styles.clientRow, { borderBottomColor: p.border.subtle }]}
              onPress={() => client.canOpenClientHistory && open('ClientDetail', { id: client.clientId })}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.clientName, { color: p.text.primary }]}>
                  {client.clientName || 'Клиент без имени'}
                </Text>
                <Text style={[styles.small, { color: p.text.secondary }]}>
                  {client.visitCount} визитов · {client.vehicleCount} авто
                </Text>
                <Text style={[styles.small, { color: p.text.secondary }]}>
                  Первый: {ownerDateLabel(client.firstVisitDate, true)}
                </Text>
                <Text style={[styles.small, { color: p.text.secondary }]}>
                  Последний: {ownerDateLabel(client.lastVisitDate, true)}
                </Text>
                {!client.canOpenClientHistory && (
                  <Text style={[styles.small, { color: p.text.secondary }]}>История недоступна с текущими правами</Text>
                )}
              </View>
              {client.canOpenClientHistory && <Ionicons name="chevron-forward" size={17} color={p.text.secondary} />}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <Text style={[styles.paragraph, { color: p.text.secondary }]}>За этот период клиентов в этой группе нет.</Text>
      )}
      {query.isError && query.data && (
        <OwnerHomeRetry
          text="Список не обновился"
          onRetry={() => (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
          busy={query.isFetching}
        />
      )}
      {query.hasNextPage && (
        <LoadMore
          count={query.data?.pages[0].total}
          busy={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
        />
      )}
    </>
  );
}

function ReturnList({
  detail,
  scope,
  open,
}: {
  detail: Extract<OwnerHomeDetail, { kind: 'returns' }>;
  scope: OwnerHomeScope;
  open: OpenRoute;
}) {
  const p = useColors();
  const { user } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ['owner-home', ...scope.key, 'returns', detail.range.from, detail.range.to],
    queryFn: ({ pageParam }) =>
      loadOwnerHome(scope, () => reportsApi.ownerHomeRapidReturns({ ...detail.range, limit: 20, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: ownerHomeEnabled(Constants.expoConfig?.extra?.ownerHomePilot, user?.role) && scope.isCurrent(),
    staleTime: 30_000,
    placeholderData: undefined,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <Text style={[styles.subtitle, { color: p.text.secondary }]}>
        {ownerRangeLabel(detail.range.from, detail.range.to)} · текущий филиал · {detail.timezone}
      </Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        Тот же автомобиль вернулся через 1–30 дней после предыдущего визита. Учитывается любая работа. Повторный заезд
        сам по себе не означает плохой ремонт.
      </Text>
      <Text style={[styles.paragraph, { color: p.text.secondary }]}>
        Автомобили могут относиться и к новым, и к повторным клиентам. Этот счётчик не прибавляется к двум группам
        клиентов.
      </Text>
      {query.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Загружаются повторные заезды"
          color={p.accent.primary}
          style={styles.spinner}
        />
      ) : query.isError && !query.data ? (
        <OwnerHomeRetry text="Повторные заезды не загрузились" onRetry={query.refetch} busy={query.isFetching} />
      ) : rows.length ? (
        rows.map((row) => <ReturnVehicle key={row.carId} row={row} open={open} />)
      ) : (
        <Text style={[styles.paragraph, { color: p.text.secondary }]}>За этот период таких повторных заездов нет.</Text>
      )}
      {query.isError && query.data && (
        <OwnerHomeRetry
          text="Список не обновился"
          onRetry={() => (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}
          busy={query.isFetching}
        />
      )}
      {query.hasNextPage && (
        <LoadMore
          count={query.data?.pages[0].total}
          busy={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
        />
      )}
    </>
  );
}

export function ReturnVehicle({ row, open }: { row: OwnerHomeRapidReturnRow; open: OpenRoute }) {
  const p = useColors();
  const { hasPermission } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const checkAllowed = hasPermission('checks_view');
  const works = expanded ? row.previousWorks : row.previousWorks.slice(0, 5);
  return (
    <View style={[styles.vehicle, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: !row.canOpenCarHistory }}
        disabled={!row.canOpenCarHistory}
        style={styles.vehicleHeading}
        onPress={() =>
          row.canOpenCarHistory &&
          open('CarDetail', {
            carId: row.carId,
            makeModel: row.makeModel,
            plateNumber: row.plateNumber,
            noPlate: !row.plateNumber,
          })
        }
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.clientName, { color: p.text.primary }]}>
            {row.plateNumber || 'Без номера'} · {row.makeModel || 'Автомобиль'}
          </Text>
          <Text style={[styles.small, { color: p.text.secondary }]}>{row.clientName || 'Клиент без имени'}</Text>
        </View>
        {row.canOpenCarHistory && <Ionicons name="chevron-forward" size={17} color={p.text.secondary} />}
      </TouchableOpacity>
      <Text style={[styles.vehicleDates, { color: p.text.primary }]}>
        {ownerDateLabel(row.previousVisitDate, true)} → {ownerDateLabel(row.latestVisitDate, true)}
      </Text>
      <Text style={[styles.small, { color: p.text.secondary }]}>
        Между визитами: {row.gapDays} дн. · повторных визитов за период: {row.returnVisitCount}
      </Text>
      <Text style={[styles.workTitle, { color: p.text.primary }]}>Работы в предыдущий визит</Text>
      {row.previousDetailsRestricted && (
        <Text style={[styles.paragraph, { color: p.text.secondary }]}>
          Часть истории предыдущего визита недоступна с текущими правами. Показаны только доступные работы и
          заказ-наряды.
        </Text>
      )}
      {/* The server filters these arrays. A mixed vehicle-day can retain permitted details. */}
      <>
        {works.length ? (
          works.map((work, index) => (
            <Text key={`${index}-${work}`} style={[styles.work, { color: p.text.primary }]}>
              • {work}
            </Text>
          ))
        ) : (
          <Text style={[styles.small, { color: p.text.secondary }]}>
            {row.previousDetailsRestricted ? 'Нет доступных названий работ' : 'Названия работ не указаны'}
          </Text>
        )}
        {row.previousWorks.length > 5 && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={styles.link}
            onPress={() => setExpanded(!expanded)}
          >
            <Text style={{ color: p.accent.primaryText }}>
              {expanded ? 'Свернуть работы' : `Ещё ${row.previousWorks.length - 5} работ`}
            </Text>
          </TouchableOpacity>
        )}
        {row.previousWorkCount > row.previousWorks.length && (
          <Text style={[styles.small, { color: p.text.secondary }]}>
            Всего доступных работ: {row.previousWorkCount}.
            {row.canOpenCarHistory ? ' Остальные — в истории автомобиля.' : ''}
          </Text>
        )}
        {checkAllowed && row.previousChecks.length > 0 && (
          <View style={styles.checkLinks}>
            {row.previousChecks.map((check) => (
              <TouchableOpacity
                key={check.id}
                accessibilityRole="button"
                accessibilityLabel={`Открыть предыдущий заказ-наряд ${check.number}`}
                style={[styles.checkLink, { backgroundColor: p.bg.muted }]}
                onPress={() => open('CheckDetail', { id: check.id })}
              >
                <Text style={{ color: p.accent.primaryText, fontSize: 13 }}>Предыдущий №{check.number}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </>
      {checkAllowed && row.currentChecks.length > 0 && (
        <View style={styles.checkLinks}>
          {row.currentChecks.map((check) => (
            <TouchableOpacity
              key={check.id}
              accessibilityRole="button"
              accessibilityLabel={`Открыть повторный заказ-наряд ${check.number}`}
              style={[styles.checkLink, { backgroundColor: p.bg.muted }]}
              onPress={() => open('CheckDetail', { id: check.id })}
            >
              <Text style={{ color: p.accent.primaryText, fontSize: 13 }}>Повторный №{check.number}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function LoadMore({ count, busy, onPress }: { count?: number; busy: boolean; onPress: () => unknown }) {
  const p = useColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel="Загрузить ещё"
      disabled={busy}
      onPress={() => onPress()}
      style={styles.loadMore}
    >
      {busy ? (
        <ActivityIndicator color={p.accent.primary} />
      ) : (
        <Text style={{ color: p.accent.primaryText }}>
          Показать ещё{count !== undefined ? ` · всего ${count}` : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 20,
    paddingRight: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  heading: { fontSize: 20, lineHeight: 27, fontWeight: '600', flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18 },
  subtitle: { fontSize: 13, lineHeight: 20, marginBottom: 17 },
  paragraph: { fontSize: 14, lineHeight: 21, marginBottom: 14 },
  sectionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600', marginTop: 5, marginBottom: 8 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' },
  detailRow: {
    paddingVertical: 13,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexWrap: 'wrap',
  },
  rowLabel: { fontSize: 14, lineHeight: 21, flex: 1, minWidth: 95 },
  rowValue: { fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  total: {
    padding: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: { fontSize: 16, lineHeight: 23, fontWeight: '600' },
  totalValue: { fontSize: 19, lineHeight: 25, fontWeight: '600', fontVariant: ['tabular-nums'] },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  clientName: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  spinner: { marginVertical: 32 },
  vehicle: { padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, marginBottom: 14 },
  vehicleHeading: { flexDirection: 'row', alignItems: 'center', minHeight: 46, gap: 10 },
  vehicleDates: { fontSize: 13, lineHeight: 20, marginTop: 9 },
  workTitle: { fontSize: 14, lineHeight: 21, fontWeight: '600', marginTop: 15, marginBottom: 5 },
  work: { fontSize: 14, lineHeight: 22, marginTop: 3 },
  link: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
  checkLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  checkLink: { paddingHorizontal: 11, minHeight: 44, borderRadius: 9, justifyContent: 'center', paddingVertical: 8 },
  loadMore: { minHeight: 52, alignItems: 'center', justifyContent: 'center', padding: 12, marginTop: 8 },
});
