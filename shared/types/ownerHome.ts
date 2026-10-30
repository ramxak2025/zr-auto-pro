/** Internal owner home. Historical figures are recalculations, never archived snapshots. */
export interface OwnerHomeAccrual {
  revenue: number;
  checkProfit: number;
  plannedFixedAmortized: number;
  staffFixedAmortized: number;
  staffPctTurnover: number;
  staffPctProfit: number;
  oneOffExpenses: number;
  recurringExcess: number;
  salaryExtras: number;
  /** Informational subset of salaryExtras. Never deduct a second time. */
  motivation: number;
  perVehicleDayExpense: number;
  netProfit: number;
}

export interface OwnerHomeProfitPeriod {
  from: string;
  through: string;
  /** Exclusive UTC cutoff; today and its comparison share the tenant's local clock. */
  untilExclusive: string;
  daysElapsed: number;
  daysInMonth: number;
  partialDay: boolean;
}

export interface OwnerHomeProfitDelta {
  amount: number;
  /** Null when the previous value is zero or negative. */
  percent: number | null;
}

export interface OwnerHomeProfit {
  canonicalDate: string;
  todayDate: string;
  timezone: string;
  generatedAt: string;
  pointId: string | null;
  basis: 'current_plan';
  basisLabel: string;
  basisDetail: string;
  historicalSnapshot: false;
  current: { period: OwnerHomeProfitPeriod; day: OwnerHomeAccrual; mtd: OwnerHomeAccrual };
  comparison: {
    period: OwnerHomeProfitPeriod;
    clamped: boolean;
    basis: 'current_plan';
    day: OwnerHomeAccrual;
    mtd: OwnerHomeAccrual;
    dayDelta: OwnerHomeProfitDelta;
    mtdDelta: OwnerHomeProfitDelta;
  };
}

export interface OwnerHomeVisitsQuery {
  from: string;
  to: string;
}
export type OwnerHomeClientCohort = 'new' | 'returning';

export interface OwnerHomeVisits {
  period: OwnerHomeVisitsQuery;
  timezone: string;
  generatedAt: string;
  pointId: string | null;
  basis: 'first_recorded_service_visit';
  historyScope: 'tenant';
  servedClients: number;
  newClients: number;
  returningClients: number;
  visitCount: number;
  vehicleCount: number;
  /** Independent overlapping indicator, not a third client cohort. */
  rapidReturnVehicleCount: number;
  rapidReturnVisitCount: number;
  rapidReturnWindowDays: 30;
  rapidReturnRule: 'any_same_vehicle_visit';
}

export interface OwnerHomeClientRow {
  clientId: string;
  clientName: string;
  firstVisitDate: string;
  lastVisitDate: string;
  visitCount: number;
  vehicleCount: number;
  /** The existing client-history route still performs its own access check. */
  canOpenClientHistory: boolean;
}

export interface OwnerHomeCheckLink {
  id: string;
  number: number;
}
export interface OwnerHomeRapidReturnRow {
  carId: string;
  plateNumber: string;
  makeModel: string;
  clientId: string;
  clientName: string;
  latestVisitDate: string;
  previousVisitDate: string;
  gapDays: number;
  returnVisitCount: number;
  currentChecks: OwnerHomeCheckLink[];
  currentCheckCount: number;
  previousChecks: OwnerHomeCheckLink[];
  previousCheckCount: number;
  previousWorks: string[];
  previousWorkCount: number;
  /** Prior visit may be in another point: dates count, private work/check details are omitted. */
  previousDetailsRestricted: boolean;
  canOpenCarHistory: boolean;
}

export interface OwnerHomePage<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}
export type OwnerHomeClientPage = OwnerHomePage<OwnerHomeClientRow>;
export type OwnerHomeRapidReturnPage = OwnerHomePage<OwnerHomeRapidReturnRow>;
export interface OwnerHomePageQuery extends OwnerHomeVisitsQuery {
  cursor?: string;
  limit?: number;
}
export interface OwnerHomeClientQuery extends OwnerHomePageQuery {
  cohort: OwnerHomeClientCohort;
}

export type OwnerHomeTimelinePeriod = 'day' | 'week' | 'month' | 'year';
export interface OwnerHomeTimelineQuery {
  period: OwnerHomeTimelinePeriod;
  asOf?: string;
}
export interface OwnerHomeTimelineRange {
  period: OwnerHomeTimelinePeriod;
  /** Local civil dates, inclusive. */
  from: string;
  through: string;
  /** UTC bounds for recorded facts. Plan allocations follow the declared policy. */
  start: string;
  untilExclusive: string;
  partialDay: boolean;
  granularity: 'hour' | 'day' | 'month';
}
export interface OwnerHomeTimelineBucket {
  from: string;
  untilExclusive: string;
  /** Civil date used for the bucket label, not the following exclusive boundary. */
  localDate: string;
  /** Interval change derived from adjacent rounded cumulative amounts. */
  revenue: number;
  netProfit: number;
  cumulativeRevenue: number;
  cumulativeNetProfit: number;
}
export interface OwnerHomeTimeline {
  canonicalDate: string;
  todayDate: string;
  timezone: string;
  generatedAt: string;
  pointId: string | null;
  basis: 'current_plan';
  basisLabel: string;
  basisDetail: string;
  historicalSnapshot: false;
  range: OwnerHomeTimelineRange;
  /** Existing day semantics differ from monthwise accrual endpoint differences. */
  rangePolicy: 'day_legacy' | 'month_accrual_delta';
  intradayPolicy: 'daily_costs_at_opening' | null;
  allocationDetail: string | null;
  /** Day opening can be negative; never replace it with an invented zero. */
  opening: { at: string; revenue: number; netProfit: number };
  buckets: OwnerHomeTimelineBucket[];
  totals: OwnerHomeAccrual;
  /** Canonical day/MTD comparison, explicitly labeled as month context in the UI. */
  footer: OwnerHomeProfit;
  visitsRange: OwnerHomeVisitsQuery;
}
