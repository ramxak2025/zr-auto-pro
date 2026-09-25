/**
 * Каталог отчётов раздела «Отчёты» (конструктор, 2026-09-25).
 *
 * ЕДИНСТВЕННЫЙ источник названий, описаний, фильтров и прав для web, mobile и
 * backend. Сервер по этому же каталогу решает, что вернуть в
 * GET /reports/builder/catalog (available / reason), и валидирует reportId.
 *
 * Как добавить отчёт: строка сюда + SQL-билдер на сервере
 * (backend/src/reports/builder/). Экраны клиентов универсальные — их не трогаем.
 */
import type { ReportFilterKind, ReportId, UserPermissions } from '../types';

export type ReportGroup = 'summary' | 'money' | 'people' | 'stock';

export interface ReportGroupByOption {
  value: string;
  label: string;
}

export interface ReportDefinition {
  id: ReportId;
  /** Название в списке и в шапке отчёта. */
  title: string;
  /** Одно предложение — что владелец увидит. */
  description: string;
  /** Что именно считается — для подсказки «Методика» под отчётом. */
  method: string;
  group: ReportGroup;
  /** Сущностный фильтр (мастера/сотрудники/поставщики/филиалы). Absent — только период. */
  entityFilter?: { kind: ReportFilterKind; label: string; multi: boolean };
  /** Варианты группировки основной таблицы. Первый — по умолчанию. */
  groupByOptions?: ReportGroupByOption[];
  /**
   * Право из матрицы ролей, нужное ДОПОЛНИТЕЛЬНО к доступу в раздел
   * (financial_reports + фича reports_view). Owner-class байпасит.
   */
  permission?: keyof UserPermissions;
  /** Только владелец/директор/superadmin. */
  ownerOnly?: boolean;
  /** Показывать только когда у компании ≥ 2 филиалов. */
  requiresMultiPoint?: boolean;
}

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  summary: 'Сводные',
  money: 'Деньги',
  people: 'Люди',
  stock: 'Склад',
};

/** Максимальная длина периода отчёта в днях (сервер отвечает 400 сверх лимита). */
export const REPORT_MAX_DAYS = 366;

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: 'summary',
    title: 'Сводный отчёт',
    description: 'Главные цифры за период на одном листе: выручка, прибыль, расходы, зарплата, долги.',
    method:
      'Выручка и прибыль — по проведённым чекам (гарантия денег не приносит, возвраты вычтены). ' +
      'Расходы — из раздела «Расходы», зарплата — начислено и выплачено за период. ' +
      'Долги: нам должны клиенты (рассрочка и долги), мы должны поставщикам.',
    group: 'summary',
    permission: 'financial_reports',
  },
  {
    id: 'masters',
    title: 'По мастерам',
    description: 'Кто сколько чеков провёл, принёс выручки и прибыли, сколько дал скидок.',
    method:
      'Чек относится к мастеру, указанному в чеке. Скидки — сумма скидок по чекам мастера. ' +
      'Прибыль = выручка − себестоимость проданных товаров. Средний чек = выручка / чеки. ' +
      'Возвраты показаны отдельно и уже вычтены из выручки.',
    group: 'people',
    entityFilter: { kind: 'masters', label: 'Мастера', multi: true },
    permission: 'financial_reports',
  },
  {
    id: 'salary',
    title: 'По зарплатам',
    description: 'Начислено, авансы, премии, штрафы, выплачено и остаток к выплате по каждому сотруднику.',
    method:
      'Начислено — процент с работ и с товаров по проведённым чекам за период плюс премии и мотивация. ' +
      'Выплачено — зарплата и авансы, выданные в периоде. ' +
      'Остаток = начислено − штрафы − выплачено; отрицательный остаток — выплатили больше, чем заработано.',
    group: 'people',
    entityFilter: { kind: 'employees', label: 'Сотрудники', multi: true },
    permission: 'salary_view',
  },
  {
    id: 'suppliers',
    title: 'По поставщикам',
    description: 'На какую сумму получили товар, сколько оплатили, долг на начало и на конец периода.',
    method:
      'Поставки — по дате поступления, оплаты — по дате платежа, возвраты поставщику уменьшают долг. ' +
      'Долг на конец = долг на начало + поставки − оплаты − возвраты. ' +
      'Плюс — мы должны поставщику, минус — поставщик должен нам (переплата).',
    group: 'money',
    entityFilter: { kind: 'suppliers', label: 'Поставщики', multi: true },
    permission: 'suppliers_access',
  },
  {
    id: 'clients',
    title: 'По клиентам',
    description: 'Новые и повторные клиенты, выручка от них, кто давно не приезжал и кто должен.',
    method:
      'Новый — первый чек клиента попал в период; повторный — до периода уже были чеки. ' +
      '«Давно не были» — последний визит раньше, чем 90 дней назад. ' +
      'Долги — открытые долги и просроченные платежи рассрочки на конец периода.',
    group: 'people',
    permission: 'clients_view',
  },
  {
    id: 'products',
    title: 'По товарам',
    description: 'Что продавалось и с какой наценкой, что залежалось, что списали.',
    method:
      'Продажи — товарные строки проведённых чеков за период. Прибыль = выручка − себестоимость. ' +
      'Наценка = прибыль / себестоимость. «Залежались» — есть остаток, продаж в периоде не было. ' +
      'Списания и брак — из движений склада за период.',
    group: 'stock',
    groupByOptions: [
      { value: 'product', label: 'По товарам' },
      { value: 'category', label: 'По папкам' },
    ],
    permission: 'warehouse_access',
  },
  {
    id: 'services',
    title: 'По услугам',
    description: 'Самые частые и самые прибыльные работы, средняя цена и доля в выручке.',
    method:
      'Строки услуг проведённых чеков за период. Доля — от выручки по всем работам периода. ' +
      'Средняя цена = выручка по услуге / количество.',
    group: 'money',
    permission: 'financial_reports',
  },
  {
    id: 'payments',
    title: 'По способам оплаты',
    description: 'Сколько денег пришло наличными, картой, по СБП, в рассрочку и по гарантии.',
    method:
      'Смешанная оплата разложена по частям (наличные и карта отдельно). ' +
      'Рассрочка — первый взнос в момент продажи и платежи по графику за период. ' +
      'Гарантия — чеки без денег, показаны справочно и в выручку не входят.',
    group: 'money',
    permission: 'financial_reports',
  },
  {
    id: 'expenses',
    title: 'По расходам',
    description: 'Расходы по категориям за период рядом с выручкой — куда уходят деньги.',
    method:
      'Расходы — из раздела «Расходы» по дате расхода, включая выплаты зарплаты (категория «Зарплата»). ' +
      'Доля от выручки — расход / выручка за тот же период.',
    group: 'money',
    permission: 'financial_reports',
  },
  {
    id: 'bookings',
    title: 'По записям',
    description: 'Сколько клиентов записалось, сколько приехало, сколько не пришло, конверсия в чек.',
    method:
      'Записи — по дате визита в периоде. Приехали — статусы «приехал» и «оформлен чек». ' +
      'Не пришли — статус «не пришёл». Конверсия = оформлен чек / все записи, кроме отменённых.',
    group: 'people',
    permission: 'bookings_access',
  },
  {
    id: 'points',
    title: 'По филиалам',
    description: 'Сравнение точек: чеки, выручка, прибыль, расходы, зарплата, средний чек.',
    method:
      'Каждый филиал считается по своим чекам, расходам и начислениям за период. ' +
      'Клиенты и поставщики общие для сети, поэтому долги здесь не делятся по точкам.',
    group: 'summary',
    entityFilter: { kind: 'points', label: 'Филиалы', multi: true },
    ownerOnly: true,
    requiresMultiPoint: true,
  },
];

export const REPORT_IDS: ReportId[] = REPORT_CATALOG.map((r) => r.id);

export function getReportDefinition(id: ReportId): ReportDefinition {
  const def = REPORT_CATALOG.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown report: ${id}`);
  return def;
}

export function isReportId(value: unknown): value is ReportId {
  return typeof value === 'string' && (REPORT_IDS as string[]).includes(value);
}
