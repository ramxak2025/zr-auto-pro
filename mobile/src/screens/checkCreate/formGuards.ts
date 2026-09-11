/**
 * Чистые стражи формы Кассы (CheckCreateScreen) — вынесены из экрана, потому
 * что оба отвечают на вопросы про ДЕНЬГИ и обязаны проверяться тестами, а сам
 * экран (5000+ строк, react-native) под node-jest не поднимается.
 *
 *   1. {@link findStrayMaster} — «мастер из этого ли филиала». Филиал выдаётся
 *      сессии при входе (163), поэтому «войти в другой филиал» — обычная смена
 *      рабочего места. Мастер, оставшийся от прежнего филиала (или сам
 *      вошедший, который здесь не числится), уводит зарплату и рейтинг в чужой
 *      автосервис, и по экрану это НЕ видно.
 *   2. {@link buildCheckFormFingerprint} — отпечаток набранного заказ-наряда.
 *      Нужен, чтобы «назад» и свайп спрашивали подтверждение, когда в форме
 *      есть несохранённое: до этого набранный за 10 минут чек уносило молча.
 */

/** Минимум от строки услуги, который нужен проверке мастера. */
export interface ServiceLineMasterRef {
  name: string;
  masterId?: string;
  lineMasterId?: string;
}

/**
 * Что именно не из этого филиала:
 *   • 'check' — мастер всего заказ-наряда;
 *   • 'line'  — мастер конкретной строки услуг (индекс + название для текста).
 * null — всё в порядке (или сверять не с чем, см. ниже).
 */
export type StrayMaster = { kind: 'check' } | { kind: 'line'; index: number; name: string } | null;

/**
 * Первый мастер, который НЕ работает в текущем филиале.
 *
 * `pointMasterIds` пусто = сверять не с чем: либо список сотрудников филиала
 * ещё не приехал, либо у тенанта один автосервис и скоупа нет вовсе. В обоих
 * случаях возвращаем null — блокировать кассу из-за незагруженного справочника
 * нельзя, это остановило бы работу в боксе.
 *
 * Мастер чека проверяется ПЕРВЫМ: он и есть тот, на кого запишется заказ-наряд,
 * а строки услуг по умолчанию наследуют его же.
 */
export function findStrayMaster(params: {
  pointMasterIds: ReadonlySet<string>;
  checkMasterId: string;
  lines: readonly ServiceLineMasterRef[];
}): StrayMaster {
  const { pointMasterIds, checkMasterId, lines } = params;
  if (pointMasterIds.size === 0) return null;
  if (!checkMasterId || !pointMasterIds.has(checkMasterId)) return { kind: 'check' };
  for (let i = 0; i < lines.length; i += 1) {
    // Пустой мастер строки означает «как у чека» — он уже проверен выше.
    const effective = lines[i].lineMasterId || lines[i].masterId || checkMasterId;
    if (!pointMasterIds.has(effective)) return { kind: 'line', index: i, name: lines[i].name };
  }
  return null;
}

/** Всё, что человек мог набрать руками и потерять при выходе с экрана. */
export interface CheckFormSnapshot {
  clientId: string;
  carId: string;
  masterId: string;
  mileage: string;
  comment: string;
  discount: string;
  paymentMethod: string;
  cashAmount: string;
  installmentFirst: string;
  isDeferred: boolean;
  tagIds: readonly string[];
  assigneeIds: readonly string[];
  orderLocationId: string | null;
  serviceLines: readonly { serviceId?: string; name: string; price: number; quantity: number; master: string }[];
  productLines: readonly { productId?: string; name: string; sellPrice: number; quantity: number }[];
  pendingPhotos: readonly string[];
  manualDateIso: string;
}

/**
 * Отпечаток формы СТРОКОЙ: сравнение дешёвое и не зависит от ссылок на массивы,
 * которые пересоздаются на каждом рендере. Сравнивается с отпечатком «базовой
 * линии» — пустой формы (новый чек) или состояния сразу после гидрации (правка).
 */
export function buildCheckFormFingerprint(f: CheckFormSnapshot): string {
  return JSON.stringify([
    f.clientId,
    f.carId,
    f.masterId,
    f.mileage.trim(),
    f.comment.trim(),
    f.discount.trim(),
    f.paymentMethod,
    f.cashAmount.trim(),
    f.installmentFirst.trim(),
    f.isDeferred,
    f.tagIds,
    f.assigneeIds,
    f.orderLocationId,
    f.serviceLines.map((l) => [l.serviceId ?? '', l.name, l.price, l.quantity, l.master]),
    f.productLines.map((l) => [l.productId ?? '', l.name, l.sellPrice, l.quantity]),
    f.pendingPhotos,
    f.manualDateIso,
  ]);
}
