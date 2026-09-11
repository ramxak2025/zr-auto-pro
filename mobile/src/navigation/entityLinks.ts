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
