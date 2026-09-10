/**
 * entityLinks — единые helpers для навигации по «живым» сущностям
 * (клиент, авто/госномер, сотрудник). Используется везде, где имя
 * клиента / госномер / ФИО сотрудника отрисовано в чеке, журнале,
 * расписании, отчётах.
 *
 * Зачем helper, а не прямой `navigation.navigate(...)`:
 *   • ClientDetail и SupplierDetail живут на корневом стеке (доступны
 *     из любой вкладки).
 *   • EmployeeDetail — внутри MoreStack, поэтому требует deep-nav через
 *     MoreTab → EmployeeDetail. Скрываем эту разницу здесь, чтобы экраны
 *     дёргали один и тот же API независимо от своего расположения.
 *   • На случай если на каком-то экране ID отсутствует (например, чек без
 *     клиента), helper тихо игнорирует тап вместо краша.
 */
import type { NavigationProp } from '@react-navigation/native';

type AnyNav = NavigationProp<any>;

export function openClient(navigation: AnyNav, clientId: string | null | undefined) {
  if (!clientId) return;
  (navigation as any).navigate('ClientDetail', { id: clientId });
}

export function openSupplier(navigation: AnyNav, supplierId: string | null | undefined) {
  if (!supplierId) return;
  (navigation as any).navigate('SupplierDetail', { id: supplierId });
}

/**
 * EmployeeDetail зарегистрирован внутри MoreStack — навигация делается
 * через nested route, чтобы вкладка переключилась на «Ещё» и сам стек
 * пушнул карточку сотрудника.
 */
export function openEmployee(navigation: AnyNav, employeeId: string | null | undefined) {
  if (!employeeId) return;
  (navigation as any).navigate('MoreTab', {
    screen: 'EmployeeDetail',
    params: { id: employeeId },
  });
}

/**
 * openCar — на текущий момент отдельного CarDetail в приложении нет,
 * вся релевантная информация по авто живёт в карточке клиента. Поэтому
 * тап по госномеру открывает клиента — владельца этой машины.
 */
export function openCarOwner(navigation: AnyNav, clientId: string | null | undefined) {
  openClient(navigation, clientId);
}

/**
 * openPoints — раздел «Филиалы» (мульти-точки 156/160/161).
 *
 * ЕДИНСТВЕННОЕ место, где автосервис переключается: владелец сказал дословно
 * «переключиться туда можно ТОЛЬКО через филиал, а не везде». Все прочие
 * экраны (Касса, Журнал, главная, смены) только ПОКАЗЫВАЮТ текущий автосервис
 * и ведут сюда — сами не переключают.
 *
 * ПОЧЕМУ ПРОСТО `navigate('Points')`, А НЕ ПЕРЕХОД ВО ВКЛАДКУ «ЕЩЁ».
 * Раньше здесь стоял `navigate('Main', { screen: 'MoreTab', … })` — переход
 * НА вкладку. Для Кассы это было разрушительно: экран создания заказ-наряда
 * пушится на КОРНЕВОЙ стек (AppNavigator → Stack.Screen "CheckCreate"), уход
 * с корня его размонтирует, а состав заказ-наряда живёт только в памяти
 * экрана — черновика на сервере нет. Кассир, который правил чек из Журнала и
 * тронул строку с автосервисом «просто посмотреть», терял всё набранное без
 * единого вопроса.
 *
 * Теперь «Филиалы» зарегистрированы ДВАЖДЫ — в MoreStack и на корневом стеке
 * (ровно тот же приём, что у ClientDetail / Templates / SupplyReceive), а
 * голый `navigate` сам всплывает до ближайшего навигатора, который знает этот
 * роут:
 *   • экран внутри «Ещё» (расписание, кассовая смена) → push в MoreStack,
 *     плавающий таб-бар остаётся виден;
 *   • экран из любой вкладки или с корня (Касса, главная, Журнал) → push на
 *     корневом стеке ПОВЕРХ текущего экрана.
 * В обоих случаях «назад» возвращает ровно туда, откуда пришли, и ничего не
 * размонтируется — набранный заказ-наряд переживает поход в «Филиалы».
 */
export function openPoints(navigation: AnyNav) {
  (navigation as any).navigate('Points');
}
