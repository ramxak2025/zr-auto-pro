import { extractApiErrorMessage } from '../apiError';
import { choosePointMessage, otherPointPhoneConflictMessage } from '../../../../shared/utils/apiError';

const axiosError = (data: unknown, message = 'Request failed with status code 400') => ({
  response: { status: 400, data },
  message,
});

describe('extractApiErrorMessage', () => {
  it('берёт русский текст нашего BadRequestException', () => {
    expect(extractApiErrorMessage(axiosError({ message: 'Остаток не может быть отрицательным' }), 'fallback')).toBe(
      'Остаток не может быть отрицательным',
    );
  });

  it('склеивает массив нарушений class-validator', () => {
    expect(extractApiErrorMessage(axiosError({ message: ['Остаток не может быть отрицательным'] }), 'fallback')).toBe(
      'Остаток не может быть отрицательным',
    );
    expect(extractApiErrorMessage(axiosError({ message: ['a', 'b'] }), 'fallback')).toBe('a\nb');
  });

  it('понимает голый текст прокси и поле error', () => {
    expect(extractApiErrorMessage(axiosError('502 Bad Gateway'), 'fallback')).toBe('502 Bad Gateway');
    expect(extractApiErrorMessage(axiosError({ error: 'Forbidden' }), 'fallback')).toBe('Forbidden');
  });

  it('падает на сетевой текст axios, затем на fallback', () => {
    expect(extractApiErrorMessage(axiosError({}, 'Network Error'), 'fallback')).toBe('Network Error');
    expect(extractApiErrorMessage({}, 'Не удалось обновить товар')).toBe('Не удалось обновить товар');
  });
});

// ── Отказы, у которых есть ОСМЫСЛЕННОЕ ДЕЙСТВИЕ (shared/utils/apiError) ──────

describe('choosePointMessage', () => {
  const refusal = (status: number, message: unknown) => ({ response: { status, data: { message } } });

  it('узнаёт 400 «Выберите филиал, …» и отдаёт текст сервера дословно', () => {
    expect(choosePointMessage(refusal(400, 'Выберите филиал, чтобы пробить чек'))).toBe(
      'Выберите филиал, чтобы пробить чек',
    );
    expect(choosePointMessage(refusal(400, 'Выберите филиал, чтобы открыть кассовую смену'))).toBe(
      'Выберите филиал, чтобы открыть кассовую смену',
    );
  });

  it('НЕ срабатывает на чужой отказ, где слово «филиал» просто встретилось', () => {
    // Ровно этот случай ловила старая проверка `.includes('филиал')` в
    // CashShiftScreen: любой другой 400 с этим словом открывал бы выбор точки.
    expect(choosePointMessage(refusal(400, 'В этом филиале смена уже открыта'))).toBeNull();
  });

  it('игнорирует другие статусы и сетевой сбой (ответа нет вовсе)', () => {
    expect(choosePointMessage(refusal(403, 'Выберите филиал, чтобы пробить чек'))).toBeNull();
    expect(choosePointMessage({ message: 'Network Error' })).toBeNull();
  });
});

describe('otherPointPhoneConflictMessage', () => {
  it('узнаёт 409 про номер чужого филиала и отдаёт объясняющий текст', () => {
    const err = {
      response: {
        status: 409,
        data: { message: 'Этот номер уже занят карточкой другого филиала.', code: 'CLIENT_PHONE_EXISTS_OTHER_POINT' },
      },
    };
    expect(otherPointPhoneConflictMessage(err)).toBe('Этот номер уже занят карточкой другого филиала.');
  });

  it('НЕ трогает обычный дубль по телефону — там есть карточка, куда перейти', () => {
    const err = {
      response: {
        status: 409,
        data: { message: 'Клиент с этим номером уже добавлен', code: 'CLIENT_PHONE_EXISTS', clientId: 'c1' },
      },
    };
    expect(otherPointPhoneConflictMessage(err)).toBeNull();
  });
});
