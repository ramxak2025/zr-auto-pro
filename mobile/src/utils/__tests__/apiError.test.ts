import { extractApiErrorMessage } from '../apiError';
import {
  otherPointPhoneConflictMessage,
  sessionPointLostMessage,
  SESSION_POINT_LOST_MESSAGE,
  SESSION_POINT_NOT_CHOSEN_MESSAGE,
} from '../../../../shared/utils/apiError';

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

describe('sessionPointLostMessage', () => {
  const refusal = (status: number, message: unknown) => ({ response: { status, data: { message } } });

  it('узнаёт 401 «филиал сессии больше не ваш» и отдаёт текст сервера дословно', () => {
    // Это НЕ обычное истечение токена: доступ к филиалу сняли или филиал
    // закрыли. Человек обязан прочитать причину на экране входа, иначе
    // «меня выкинуло» читается как поломка приложения.
    expect(sessionPointLostMessage(refusal(401, SESSION_POINT_LOST_MESSAGE))).toBe(SESSION_POINT_LOST_MESSAGE);
    expect(sessionPointLostMessage(refusal(401, SESSION_POINT_NOT_CHOSEN_MESSAGE))).toBe(
      SESSION_POINT_NOT_CHOSEN_MESSAGE,
    );
  });

  it('молчит на обычном 401 — истёкшую сессию объяснять не надо', () => {
    expect(sessionPointLostMessage(refusal(401, 'Неверный токен'))).toBeNull();
    expect(sessionPointLostMessage(refusal(401, 'Аккаунт деактивирован'))).toBeNull();
  });

  it('сравнивает строку ЦЕЛИКОМ, а не по вхождению слова «филиал»', () => {
    expect(sessionPointLostMessage(refusal(401, 'Филиал больше не доступен — войдите заново, пожалуйста'))).toBeNull();
  });

  it('игнорирует другие статусы и сетевой сбой (ответа нет вовсе)', () => {
    expect(sessionPointLostMessage(refusal(403, SESSION_POINT_LOST_MESSAGE))).toBeNull();
    expect(sessionPointLostMessage({ message: 'Network Error' })).toBeNull();
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
