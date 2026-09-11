/**
 * МГНОВЕННАЯ СМЕНА ФИЛИАЛА (167) — тесты чистых правил экрана «Филиалы».
 *
 * ЗАЧЕМ. Это зона доступа и денег: один неверный разбор отказа либо выкидывает
 * руководителя из живой сессии на пустом месте, либо оставляет его в старом
 * филиале с уверенностью, что он уже в новом, — и следующий чек уходит не в тот
 * автосервис. Проверяем ровно те решения, которые нельзя увидеть глазами:
 *   • какой отказ гасит сессию, а какой нет;
 *   • после какого отказа список филиалов обязан перезапроситься;
 *   • что человек читает, если на телефоне лежат непробитые заказ-наряды.
 */
import { pendingChecksSwitchNotice, resolvePointSwitchFailure } from '../pointSwitch';

/** Отказ сервера в форме axios: { response: { status, data } }. */
function serverError(status: number, message?: string): unknown {
  return { response: { status, data: message ? { message } : {} } };
}

/** Сетевой сбой: ответа нет вовсе (обёрнутая ошибка api/axios.ts). */
function networkError(): unknown {
  const err = new Error('Нет соединения с сервером');
  (err as { code?: string }).code = 'ECONNABORTED';
  return err;
}

const STAFF_403 =
  'Мгновенное переключение филиала доступно только руководителю. ' +
  'Чтобы работать в другом филиале, выйдите из приложения и войдите заново, выбрав нужный филиал.';

describe('resolvePointSwitchFailure — что делать после отказа', () => {
  it('нет ответа (сеть) — остаёмся на месте, сессия цела', () => {
    const failure = resolvePointSwitchFailure(networkError());
    expect(failure.action).toBe('stay');
    expect(failure.message).toContain('не переключён');
  });

  it('403 сотруднику — показываем текст СЕРВЕРА дословно и НЕ гасим сессию', () => {
    const failure = resolvePointSwitchFailure(serverError(403, STAFF_403));
    // Это правило, а не сбой: человек обязан прочитать, что делать дальше.
    expect(failure.action).toBe('refresh');
    expect(failure.message).toBe(STAFF_403);
    expect(failure.action).not.toBe('relogin');
  });

  it('403 «Филиал недоступен» — остаёмся и перезапрашиваем список филиалов', () => {
    const failure = resolvePointSwitchFailure(serverError(403, 'Филиал недоступен'));
    expect(failure.action).toBe('refresh');
    expect(failure.message).toBe('Филиал недоступен');
  });

  it('403 под «войти как владелец» — тоже не разлогин', () => {
    const message = 'Сессия входа под пользователем не переключает филиал';
    const failure = resolvePointSwitchFailure(serverError(403, message));
    expect(failure.action).toBe('refresh');
    expect(failure.message).toBe(message);
  });

  it('401 — сессия действительно мертва, нужен полноценный вход', () => {
    for (const message of [
      'Токен отозван',
      'Аккаунт уволен',
      'Аккаунт деактивирован',
      'Пользователь не найден',
      'Сессия устарела — войдите заново',
      'Неверный токен',
    ]) {
      const failure = resolvePointSwitchFailure(serverError(401, message));
      expect(failure.action).toBe('relogin');
      expect(failure.message).toBe(message);
    }
  });

  it('429 — повтор законен, но позже; сессию не трогаем', () => {
    const failure = resolvePointSwitchFailure(serverError(429, 'Слишком много запросов, попробуйте позже'));
    expect(failure.action).toBe('stay');
    expect(failure.message).toBe('Слишком много запросов, попробуйте позже');
  });

  it('400 — филиал не найден: обновляем список и остаёмся', () => {
    const failure = resolvePointSwitchFailure(serverError(400));
    expect(failure.action).toBe('refresh');
    expect(failure.message).toContain('Обновите список');
  });

  it('5xx — сервер жив, но не отвечает по делу: остаёмся, сессия цела', () => {
    const failure = resolvePointSwitchFailure(serverError(503));
    expect(failure.action).toBe('stay');
    expect(failure.message).toContain('503');
  });

  it('ни один отказ, кроме 401, не ведёт к выходу из аккаунта', () => {
    const codes = [400, 403, 404, 409, 422, 429, 500, 502, 503];
    for (const code of codes) {
      expect(resolvePointSwitchFailure(serverError(code)).action).not.toBe('relogin');
    }
    expect(resolvePointSwitchFailure(networkError()).action).not.toBe('relogin');
  });

  it('class-validator отдал список нарушений — показываем все, а не первое', () => {
    const failure = resolvePointSwitchFailure({
      response: { status: 400, data: { message: ['pointId must be a UUID', 'pointId should not be empty'] } },
    });
    expect(failure.message).toContain('must be a UUID');
    expect(failure.message).toContain('should not be empty');
  });
});

describe('pendingChecksSwitchNotice — что человек читает перед переходом', () => {
  it('очередь пуста — предупреждения нет вовсе (переключение без диалогов)', () => {
    expect(pendingChecksSwitchNotice(0, 'ZR AUTO')).toBe('');
    expect(pendingChecksSwitchNotice(-1, 'ZR AUTO')).toBe('');
  });

  it('называет ТЕКУЩИЙ филиал и обещает, что деньги уйдут именно туда', () => {
    const notice = pendingChecksSwitchNotice(2, 'ZR AUTO');
    expect(notice).toContain('«ZR AUTO»');
    expect(notice).toContain('2 неотправленных заказ-наряда');
    // Обещание не «постараемся», а факт: филиал вшит в каждую запись очереди.
    expect(notice).toContain('филиал записан в каждой из них');
  });

  it('склонения: 1 / 2 / 5 / 11', () => {
    expect(pendingChecksSwitchNotice(1, 'X')).toContain('1 неотправленный заказ-наряд');
    expect(pendingChecksSwitchNotice(2, 'X')).toContain('2 неотправленных заказ-наряда');
    expect(pendingChecksSwitchNotice(5, 'X')).toContain('5 неотправленных заказ-нарядов');
    expect(pendingChecksSwitchNotice(11, 'X')).toContain('11 неотправленных заказ-нарядов');
    expect(pendingChecksSwitchNotice(21, 'X')).toContain('21 неотправленный заказ-наряд');
  });

  it('имени филиала нет — текст остаётся осмысленным', () => {
    const notice = pendingChecksSwitchNotice(1, null);
    expect(notice).toContain('текущий филиал');
    expect(notice).not.toContain('«»');
  });
});
