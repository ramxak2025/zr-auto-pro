/**
 * ВТОРОЙ ШАГ ВХОДА — правила разбора отказов (163).
 *
 * ЗОНА ДОСТУПА. Промежуточный токен ОДНОРАЗОВЫЙ и живёт пять минут, поэтому у
 * каждого отказа РАЗНЫЙ правильный исход. Ошибка здесь запирает человека на
 * экране входа: либо мы гоним его набирать пароль там, где хватило бы
 * повторного тапа, либо (хуже) предлагаем повторить тем же токеном, который
 * сервер уже сжёг, — и он бесконечно получает «уже использован».
 */
import { isSelectTokenExpired, resolveSelectPointFailure, SELECT_TOKEN_EXPIRED } from '../loginPointSelection';

const refusal = (status: number, message?: string) => ({
  response: { status, data: message ? { message } : {} },
});

describe('isSelectTokenExpired', () => {
  it('живой токен — отправляем обмен', () => {
    expect(isSelectTokenExpired(10_000, 0)).toBe(false);
  });

  it('истёкший токен — не тратим ожидание на заведомо отказной запрос', () => {
    expect(isSelectTokenExpired(1_000, 5_000)).toBe(true);
  });

  it('последние две секунды считаем истёкшими — запрос не успеет дойти', () => {
    // Дедлайн через 1.5 с: пока запрос доедет до сервера, токен умрёт, и
    // человек получит «время истекло» вместо входа. Честнее сказать сразу.
    expect(isSelectTokenExpired(1_500, 0)).toBe(true);
  });
});

describe('resolveSelectPointFailure', () => {
  it('401 — токен мёртв, возвращаем к телефону и паролю с текстом сервера', () => {
    const expired = resolveSelectPointFailure(refusal(401, 'Время выбора филиала истекло — войдите заново'));
    expect(expired.action).toBe('restart');
    expect(expired.message).toBe('Время выбора филиала истекло — войдите заново');

    // Повторный обмен (двойной тап / ретрай) — тот же исход: второго живого
    // токена не будет, надо начинать вход заново.
    const used = resolveSelectPointFailure(refusal(401, 'Выбор филиала уже использован — войдите заново'));
    expect(used.action).toBe('restart');
    expect(used.message).toBe('Выбор филиала уже использован — войдите заново');
  });

  it('401 без текста — подставляем своё объяснение, а не пустой диалог', () => {
    expect(resolveSelectPointFailure(refusal(401)).message).toBe(SELECT_TOKEN_EXPIRED.message);
  });

  it('403 — доступ сняли между шагами: токен ЖИВ, обновляем список', () => {
    // Выгонять на ввод пароля нельзя: у человека, как правило, остался другой
    // филиал, а промежуточный токен сервер в этом случае не гасит.
    const failure = resolveSelectPointFailure(refusal(403, 'Филиал недоступен'));
    expect(failure.action).toBe('refresh');
    expect(failure.message).toBe('Филиал недоступен');
  });

  it('нет ответа (офлайн) — остаёмся на выборе, повтор тем же токеном законен', () => {
    expect(resolveSelectPointFailure({ message: 'Network Error' }).action).toBe('stay');
  });

  it('5xx — сервер жив, но молчит по делу: даём повторить, а не набирать пароль', () => {
    expect(resolveSelectPointFailure(refusal(500)).action).toBe('stay');
    expect(resolveSelectPointFailure(refusal(502, 'Bad Gateway')).message).toBe('Bad Gateway');
  });

  it('400 — испорченный запрос: для человека это тупик, начинаем заново', () => {
    expect(resolveSelectPointFailure(refusal(400, 'pointId must be a UUID')).action).toBe('restart');
  });
});
