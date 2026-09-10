/**
 * Тесты правила «куда вернуть человека после перехода в другой автосервис».
 *
 * Защищаемая регрессия: кассир правил заказ-наряд, тронул строку с
 * автосервисом и терял три работы и две запчасти без единого вопроса. Состав
 * заказ-наряда живёт только в памяти экрана Кассы, поэтому уход с неё = потеря.
 */
import {
  isComposingNewCheckBelow,
  needsCheckLossConfirm,
  resolvePointSwitchReturn,
  type RouteBelowPoints,
} from '../pointsSwitchTarget';

/** Вкладки внутри роута `Main` — так их отдаёт navigation.getState(). */
function mainWithTab(name: string): RouteBelowPoints {
  return { name: 'Main', state: { index: 1, routes: [{ name: 'Dashboard' }, { name }] } };
}

describe('isComposingNewCheckBelow', () => {
  it('НОВЫЙ заказ-наряд поверх таб-бара (CheckCreate без id) — возвращаемся к нему', () => {
    expect(isComposingNewCheckBelow({ name: 'CheckCreate' })).toBe(true);
    expect(isComposingNewCheckBelow({ name: 'CheckCreate', params: {} })).toBe(true);
    // Приход из Записей: bookingId есть, id чека — нет, чек ещё не создан.
    expect(isComposingNewCheckBelow({ name: 'CheckCreate', params: { bookingId: 'b1' } })).toBe(true);
  });

  it('правка существующего чека (CheckCreate с id) — НЕ «новый заказ-наряд»', () => {
    expect(isComposingNewCheckBelow({ name: 'CheckCreate', params: { id: 'c1' } })).toBe(false);
  });

  it('Касса как центральный таб — узнаём по активной вкладке NewCheck', () => {
    expect(isComposingNewCheckBelow(mainWithTab('NewCheck'))).toBe(true);
    expect(isComposingNewCheckBelow(mainWithTab('Dashboard'))).toBe(false);
    expect(isComposingNewCheckBelow(mainWithTab('Checks'))).toBe(false);
  });

  it('состояние вкладок ещё не отрисовано — безопасная деградация на главную', () => {
    expect(isComposingNewCheckBelow({ name: 'Main' })).toBe(false);
    expect(isComposingNewCheckBelow({ name: 'Main', state: { routes: [] } })).toBe(false);
  });

  it('под «Филиалами» ничего или посторонний экран', () => {
    expect(isComposingNewCheckBelow(null)).toBe(false);
    expect(isComposingNewCheckBelow(undefined)).toBe(false);
    expect(isComposingNewCheckBelow({ name: 'ClientDetail', params: { id: 'x' } })).toBe(false);
  });
});

describe('needsCheckLossConfirm', () => {
  it('спрашиваем ровно при правке существующего заказ-наряда', () => {
    expect(needsCheckLossConfirm({ name: 'CheckCreate', params: { id: 'c1' } })).toBe(true);
  });

  it('новый заказ-наряд и любые другие экраны вопросов не требуют', () => {
    expect(needsCheckLossConfirm({ name: 'CheckCreate' })).toBe(false);
    expect(needsCheckLossConfirm(mainWithTab('NewCheck'))).toBe(false);
    expect(needsCheckLossConfirm({ name: 'MoreHome' })).toBe(false);
    expect(needsCheckLossConfirm(null)).toBe(false);
  });
});

describe('resolvePointSwitchReturn', () => {
  it('с Кассы с набранным заказ-нарядом — назад к нему', () => {
    expect(resolvePointSwitchReturn({ name: 'CheckCreate' })).toBe('back');
    expect(resolvePointSwitchReturn(mainWithTab('NewCheck'))).toBe('back');
  });

  it('изо всех остальных мест — на главную, как было всегда', () => {
    expect(resolvePointSwitchReturn(mainWithTab('Dashboard'))).toBe('dashboard');
    expect(resolvePointSwitchReturn({ name: 'CheckCreate', params: { id: 'c1' } })).toBe('dashboard');
    expect(resolvePointSwitchReturn(null)).toBe('dashboard');
  });
});
