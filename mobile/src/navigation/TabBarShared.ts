/**
 * Shared data for the bottom tab bar — route keys, labels, semantic icon names.
 * Both TabBar.ios.tsx and TabBar.android.tsx consume this so labels and order
 * are never out of sync.
 *
 * Round 14 (режим «Кассир», CASHIER_MODE_SPEC): состав табов стал ФУНКЦИЕЙ
 * роли + режима — `getTabDefinitions(ctx)`. Гарантии:
 *   • режим ВЫКЛ (или pos-settings ещё грузится) → ровно легаси-пятёрка,
 *     байт-в-байт (LEGACY_TABS — тот же массив, что был константой);
 *   • мастер в orderMode → та же легаси-пятёрка: центральная кнопка сама
 *     превращается в «Доску» внутри TabBar.{ios,android} (ветка orderMode,
 *     092 — поведение не тронуто);
 *   • ЧИСТЫЙ кассир (accept_payment при режиме ВКЛ, роль НЕ owner-class,
 *     БЕЗ права checks_create — пресет «Кассир») →
 *     Главная · Смены · ЦЕНТР «Оплата» · Журнал · Ещё;
 *   • мастер С правом оплаты (092: accept_payment + checks_create) →
 *     легаси-пятёрка — он и создаёт чеки, и принимает деньги;
 *   • админ / владелец при режиме ВКЛ → Главная · Склад · ЦЕНТР Касса
 *     (приёмка, как сейчас NewCheck) · Доска · Ещё (Журнал — по back из
 *     Доски: nested navigate идёт с initial:false, ChecksHome под ней).
 *
 * Набор ВСЕГДА нечётный, isKassa строго в середине — kassaSlot обоих баров
 * центрирует нативную кнопку по этому инварианту.
 *
 * ВСЕ роуты всех наборов зарегистрированы в Tab.Navigator ПОСТОЯННО
 * (AppNavigator) — react-navigation не терпит динамической регистрации;
 * бар просто рисует подмножество из пяти слотов.
 */
import { IconName } from '../platform/Icon';

export interface TabDefinition {
  routeName: string;
  label: string;
  icon: IconName;
  /** True for the center "Касса" tab — renders a floating action style button
   *  regardless of platform. */
  isKassa?: boolean;
  /** iOS-only: SF Symbol name for the native center button (AutexaKassaButton).
   *  Absent → 'bag.fill' (легаси Касса). */
  kassaSymbol?: string;
  /**
   * Слот-«трамплин»: тап ведёт НЕ на корень таба, а вложенным navigate в
   * `nestedScreen` внутри стека routeName (с initial:false — корень стека
   * остаётся под ним, back работает). Пример: «Доска» админа =
   * Checks → WorkBoard.
   */
  nestedScreen?: string;
}

/** Контекст выбора состава табов. role — UserRole текущего пользователя. */
export interface TabRoleContext {
  role?: string;
  orderMode: boolean;
  isCashier: boolean;
  shiftModeEnabled: boolean;
  /**
   * Право `checks_create` текущего пользователя (эффективная карта /auth/me).
   * Отличает ЧИСТОГО кассира (пресет «Кассир»: create=false → кассирский
   * набор) от МАСТЕРА с правом приёма оплаты (092-тенанты: create=true —
   * такой мастер и создаёт чеки, и принимает деньги, ему остаётся
   * легаси-пятёрка с Кассой и Складом; кассирский набор сломал бы его
   * рабочий процесс без единого изменения настроек владельцем).
   */
  canCreateChecks: boolean;
}

/** Легаси-пятёрка — единственный состав до Round 14, остаётся дефолтом. */
const LEGACY_TABS: TabDefinition[] = [
  { routeName: 'Dashboard', label: 'Главная', icon: 'home' },
  { routeName: 'Products', label: 'Склад', icon: 'warehouse' },
  { routeName: 'NewCheck', label: 'Касса', icon: 'receipt', isKassa: true },
  { routeName: 'Checks', label: 'Журнал', icon: 'journal' },
  { routeName: 'MoreTab', label: 'Ещё', icon: 'menu' },
];

/** Кассир: Смены + центр «Оплата» (очередь готовых). Склада/Кассы-приёмки нет. */
const CASHIER_TABS: TabDefinition[] = [
  { routeName: 'Dashboard', label: 'Главная', icon: 'home' },
  { routeName: 'CashShiftsTab', label: 'Смены', icon: 'clock' },
  { routeName: 'CashierTab', label: 'Оплата', icon: 'receipt', isKassa: true, kassaSymbol: 'rublesign.circle.fill' },
  { routeName: 'Checks', label: 'Журнал', icon: 'journal' },
  { routeName: 'MoreTab', label: 'Ещё', icon: 'menu' },
];

/** Админ/владелец при режиме ВКЛ: 4-й слот — Доска (Журнал по back под ней). */
const ADMIN_TABS: TabDefinition[] = [
  { routeName: 'Dashboard', label: 'Главная', icon: 'home' },
  { routeName: 'Products', label: 'Склад', icon: 'warehouse' },
  { routeName: 'NewCheck', label: 'Касса', icon: 'receipt', isKassa: true },
  { routeName: 'Checks', label: 'Доска', icon: 'board', nestedScreen: 'WorkBoard' },
  { routeName: 'MoreTab', label: 'Ещё', icon: 'menu' },
];

/** Роли, чей «кассирский» статус — владельческий, а не роль «Кассир». */
const OWNER_CLASS_ROLES = new Set(['director', 'superadmin', 'admin']);

export function getTabDefinitions(ctx: TabRoleContext): TabDefinition[] {
  // Режим ВЫКЛ / ещё грузится → легаси байт-в-байт (byte-for-byte guarantee
  // usePosSettings: OFF-дефолты shiftModeEnabled=false).
  if (!ctx.shiftModeEnabled) return LEGACY_TABS;
  // Мастер-исполнитель (без права оплаты): легаси-состав, центр = Доска —
  // подмену делает сам TabBar по orderMode (092), состав не меняется.
  if (ctx.orderMode) return LEGACY_TABS;
  // ЧИСТЫЙ кассир (пресет «Кассир»): право приёма оплаты БЕЗ владельческой
  // роли И БЕЗ права создавать чеки — строгий экран оплаты. Мастер с
  // accept_payment (092: create=true) НЕ попадает сюда — ему остаётся
  // легаси-пятёрка (Касса создаёт чеки, Склад на месте), иначе OTA молча
  // ломала бы его рабочий процесс (adversarial-находка Round 14).
  if (ctx.isCashier && !OWNER_CLASS_ROLES.has(ctx.role ?? '') && !ctx.canCreateChecks) return CASHIER_TABS;
  // Админ / владелец: приёмка в центре + Доска вместо Журнала.
  if (OWNER_CLASS_ROLES.has(ctx.role ?? '')) return ADMIN_TABS;
  return LEGACY_TABS;
}

/**
 * Легаси-константа — оставлена для потребителей, которым нужен статический
 * состав (нет таких в продакшене после Round 14, но контракт дешёвый).
 */
export const TAB_DEFINITIONS: TabDefinition[] = LEGACY_TABS;
