/**
 * Помощники UI для VIN (171). Проверяем правила «что показать» — подписи
 * источника, автоподстановку марки/модели, чип «Заменить» и разбор 409
 * VIN_DUPLICATE — отдельно от компонентов (react-native под jest не поднимаем).
 */
import type { VinDecodeResult } from '../../../../shared/types';
import {
  VIN_INCOMPLETE_MESSAGE,
  carVin,
  shouldAutofillMakeModel,
  vinCheckDigitWarning,
  vinCounter,
  vinDecodeCaption,
  vinDecodeSummary,
  vinDuplicateError,
  vinDuplicateMessage,
  vinLengthError,
  vinSourceLabel,
  vinSuggestion,
} from '../vinUi';

const decoded = (over: Partial<VinDecodeResult> = {}): VinDecodeResult => ({
  vin: 'XTA219010K0123456',
  valid: true,
  make: 'Lada',
  model: 'Granta',
  year: 2019,
  makeModel: 'Lada Granta',
  source: 'nhtsa',
  ...over,
});

describe('carVin', () => {
  it('normalizes a stored VIN and drops empty / garbage values', () => {
    expect(carVin({ vin: 'xta219010k0123456' })).toBe('XTA219010K0123456');
    expect(carVin({ vin: '' })).toBeNull();
    expect(carVin({ vin: null })).toBeNull();
    expect(carVin({})).toBeNull();
    expect(carVin(null)).toBeNull();
    expect(carVin({ vin: '---' })).toBeNull();
  });
});

describe('vinLengthError — блок отправки при неполном VIN', () => {
  it('accepts an empty field (VIN is optional) and a full 17-char VIN', () => {
    expect(vinLengthError('')).toBeNull();
    expect(vinLengthError(null)).toBeNull();
    expect(vinLengthError(undefined)).toBeNull();
    expect(vinLengthError('XTA219010K0123456')).toBeNull();
  });

  it('rejects a started-but-unfinished VIN so the client is never created without its car', () => {
    expect(vinLengthError('X')).toBe(VIN_INCOMPLETE_MESSAGE);
    expect(vinLengthError('XTA219010K01')).toBe('Введите 17 символов VIN');
    expect(vinLengthError('XTA219010K012345')).toBe(VIN_INCOMPLETE_MESSAGE);
    // Лишний символ / запрещённые буквы — тоже не отправляем.
    expect(vinLengthError('XTA219010K01234567')).toBe(VIN_INCOMPLETE_MESSAGE);
    expect(vinLengthError('XTA219010K012345I')).toBe(VIN_INCOMPLETE_MESSAGE);
  });
});

describe('vinCounter / vinSourceLabel', () => {
  it('formats the counter as n/17', () => {
    expect(vinCounter('')).toBe('0/17');
    expect(vinCounter('XTA219010K01')).toBe('12/17');
  });

  it('labels every decode source in Russian and falls back to «Не определено»', () => {
    expect(vinSourceLabel('paid')).toBe('Платный сервис');
    expect(vinSourceLabel('nhtsa')).toBe('Справочник NHTSA');
    expect(vinSourceLabel('wmi')).toBe('Таблица производителей (WMI)');
    expect(vinSourceLabel('none')).toBe('Не определено');
    expect(vinSourceLabel(null)).toBe('Не определено');
    expect(vinSourceLabel(undefined)).toBe('Не определено');
  });
});

describe('vinDecodeCaption', () => {
  it('says «Определено по VIN» when both make and model are known', () => {
    expect(vinDecodeCaption(decoded())).toBe('Определено по VIN');
  });

  it('asks to fill the model when only the make is known (WMI table)', () => {
    expect(vinDecodeCaption(decoded({ model: null, makeModel: 'Lada', source: 'wmi' }))).toBe(
      'Марка по справочнику, модель допишите',
    );
  });

  it('asks to fill manually when nothing was found, and stays silent for invalid VINs', () => {
    expect(vinDecodeCaption(decoded({ make: null, model: null, makeModel: null, source: 'none' }))).toBe(
      'Марку по VIN определить не удалось — заполните вручную',
    );
    expect(vinDecodeCaption(decoded({ valid: false, make: null, model: null, makeModel: null }))).toBeNull();
    expect(vinDecodeCaption(null)).toBeNull();
  });
});

describe('vinCheckDigitWarning', () => {
  it('warns only for a North American VIN with a wrong 9th position', () => {
    // Honda Accord 2003 — контрольная цифра сходится.
    expect(vinCheckDigitWarning('1HGCM82633A004352')).toBeNull();
    // Испорчена одна цифра.
    expect(vinCheckDigitWarning('1HGCM82633A004353')).toBe('Контрольная цифра не сходится — проверьте VIN');
    // Европа/Россия — контрольная цифра не считается, предупреждения нет.
    expect(vinCheckDigitWarning('XTA219010K0123456')).toBeNull();
    expect(vinCheckDigitWarning('WBA3A5C55CF123456')).toBeNull();
    // Неполный VIN — ещё нечего проверять.
    expect(vinCheckDigitWarning('1HGCM8263')).toBeNull();
  });
});

describe('autofill vs «Заменить» chip', () => {
  it('autofills silently only into an empty make/model field', () => {
    expect(shouldAutofillMakeModel('', decoded())).toBe(true);
    expect(shouldAutofillMakeModel('   ', decoded())).toBe(true);
    expect(shouldAutofillMakeModel(undefined, decoded())).toBe(true);
    expect(shouldAutofillMakeModel('Kia Rio', decoded())).toBe(false);
    // Нечего подставлять — расшифровка без марки.
    expect(shouldAutofillMakeModel('', decoded({ makeModel: null }))).toBe(false);
  });

  it('offers the chip only when the field holds something DIFFERENT', () => {
    expect(vinSuggestion('Kia Rio', decoded())).toBe('Lada Granta');
    // Пусто → сработала автоподстановка, чип не нужен.
    expect(vinSuggestion('', decoded())).toBeNull();
    // То же значение (регистр/пробелы не в счёт) → заменять нечего.
    expect(vinSuggestion('  lada   granta ', decoded())).toBeNull();
    expect(vinSuggestion('Kia Rio', decoded({ makeModel: null }))).toBeNull();
    expect(vinSuggestion('Kia Rio', null)).toBeNull();
  });
});

describe('vinDecodeSummary', () => {
  it('joins make/model and year with a middle dot', () => {
    expect(vinDecodeSummary(decoded())).toBe('Lada Granta · 2019');
    expect(vinDecodeSummary(decoded({ year: null }))).toBe('Lada Granta');
    expect(vinDecodeSummary(decoded({ makeModel: null, year: null }))).toBe('Не определено');
  });
});

describe('409 VIN_DUPLICATE', () => {
  const dup = (data: Record<string, unknown>, status = 409) => ({ response: { status, data } });

  it('parses the server payload and prefers the server message', () => {
    const info = vinDuplicateError(
      dup({
        code: 'VIN_DUPLICATE',
        carId: 'car-1',
        clientId: 'cl-1',
        clientName: 'Иванов Иван',
        message: 'Автомобиль с таким VIN уже есть у клиента Иванов Иван',
      }),
    );
    expect(info).toEqual({
      carId: 'car-1',
      clientId: 'cl-1',
      clientName: 'Иванов Иван',
      message: 'Автомобиль с таким VIN уже есть у клиента Иванов Иван',
    });
  });

  it('builds the message from clientName when the server sent only the code', () => {
    expect(vinDuplicateMessage(dup({ code: 'VIN_DUPLICATE', clientName: 'Петров' }))).toBe(
      'Автомобиль с таким VIN уже есть у клиента Петров',
    );
    expect(vinDuplicateMessage(dup({ code: 'VIN_DUPLICATE' }))).toBe('Автомобиль с таким VIN уже есть');
    expect(vinDuplicateError(dup({ code: 'VIN_DUPLICATE' }))).toMatchObject({
      carId: null,
      clientId: null,
      clientName: null,
    });
  });

  it('ignores every other error shape', () => {
    expect(vinDuplicateError(dup({ code: 'CLIENT_PHONE_EXISTS', clientId: 'x' }))).toBeNull();
    expect(vinDuplicateError(dup({ code: 'VIN_DUPLICATE' }, 400))).toBeNull();
    expect(vinDuplicateError({ response: { status: 409 } })).toBeNull();
    expect(vinDuplicateError(new Error('network'))).toBeNull();
    expect(vinDuplicateError(null)).toBeNull();
    expect(vinDuplicateMessage(undefined)).toBeNull();
  });
});
