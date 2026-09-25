/**
 * `useVinEnabled.ts` тянет axios / AsyncStorage / react-native через
 * api/services и AuthContext, а тесту нужно ТОЛЬКО чистое правило приоритета
 * источников. Моки не дают RN-цепочке грузиться в node-окружении jest — та же
 * конвенция, что в hooks/__tests__/usePoints.test.ts.
 */
jest.mock('../../api/services', () => ({ vinApi: { getSettings: jest.fn() }, myCompanyApi: { get: jest.fn() } }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

import { resolveVinEnabled } from '../useVinEnabled';

describe('resolveVinEnabled', () => {
  it('is OFF by default — legacy payloads without the field never show VIN', () => {
    expect(resolveVinEnabled({})).toBe(false);
    expect(resolveVinEnabled({ tenant: {} })).toBe(false);
    expect(resolveVinEnabled({ tenant: null, company: null })).toBe(false);
  });

  it('reads the profile flag when nothing fresher is cached (мастер)', () => {
    expect(resolveVinEnabled({ tenant: { vinEnabled: true } })).toBe(true);
    expect(resolveVinEnabled({ tenant: { vinEnabled: false } })).toBe(false);
  });

  it('prefers the warmed my-company cache over the profile', () => {
    expect(resolveVinEnabled({ company: { vinEnabled: true }, tenant: { vinEnabled: false } })).toBe(true);
    expect(resolveVinEnabled({ company: { vinEnabled: false }, tenant: { vinEnabled: true } })).toBe(false);
    // Компания без поля (легаси) → падаем на профиль.
    expect(resolveVinEnabled({ company: {}, tenant: { vinEnabled: true } })).toBe(true);
  });

  it('never consults the vin-settings screen cache — only my-company and the profile decide', () => {
    // Раньше ['vin-settings'] перекрывал всё; теперь снимок экрана настроек
    // хуку неизвестен: даже переданный «лишним» полем он ни на что не влияет.
    type Input = Parameters<typeof resolveVinEnabled>[0];
    const withSettings = (enabled: boolean, rest: Input): Input =>
      ({ settings: { enabled }, ...rest }) as unknown as Input;
    expect(
      resolveVinEnabled(withSettings(true, { company: { vinEnabled: false }, tenant: { vinEnabled: false } })),
    ).toBe(false);
    expect(
      resolveVinEnabled(withSettings(false, { company: { vinEnabled: true }, tenant: { vinEnabled: false } })),
    ).toBe(true);
    expect(resolveVinEnabled(withSettings(false, { tenant: { vinEnabled: true } }))).toBe(true);
  });
});
