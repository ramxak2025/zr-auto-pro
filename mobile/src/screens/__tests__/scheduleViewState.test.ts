/**
 * Тесты decideScheduleView — защита от регрессии бага
 * «Нет мастеров, хотя мастера есть».
 *
 * Самая важная ветка — stale-empty: пустой массив из протухшего
 * persistentCache во время фонового рефетча НЕ должен давать «Нет мастеров».
 */
import { decideScheduleView, type ScheduleViewInput } from '../scheduleViewState';

// База: грид готов, нет ошибок, нет данных, не успех. Каждый тест
// переопределяет нужные поля — так ветки читаются явно.
const base: ScheduleViewInput = {
  gridReady: true,
  isLoadingUsers: false,
  isErrorUsers: false,
  isSuccessUsers: false,
  activeUsersCount: 0,
  hasCachedUsers: false,
  scheduleError: false,
};

describe('decideScheduleView', () => {
  describe('gridReady gate', () => {
    it('grid не готов → skeleton, даже если данные уже есть', () => {
      expect(decideScheduleView({ ...base, gridReady: false, isSuccessUsers: true, activeUsersCount: 5 })).toBe(
        'skeleton',
      );
    });
  });

  describe('loading', () => {
    it('первая загрузка без данных → skeleton', () => {
      expect(decideScheduleView({ ...base, isLoadingUsers: true })).toBe('skeleton');
    });
  });

  describe('has-data', () => {
    it('есть мастера → grid', () => {
      expect(decideScheduleView({ ...base, isSuccessUsers: true, activeUsersCount: 3 })).toBe('grid');
    });

    it('есть мастера побеждает даже при ошибке расписания', () => {
      expect(decideScheduleView({ ...base, activeUsersCount: 3, scheduleError: true })).toBe('grid');
    });

    it('есть мастера во время фонового рефетча (ещё не success) → grid', () => {
      expect(decideScheduleView({ ...base, activeUsersCount: 2, hasCachedUsers: true, isSuccessUsers: false })).toBe(
        'grid',
      );
    });
  });

  describe('empty-success', () => {
    it('запрос подтверждённо успешен и мастеров нет → empty', () => {
      expect(decideScheduleView({ ...base, isSuccessUsers: true, activeUsersCount: 0 })).toBe('empty');
    });

    it('success + кэш был, но все отфильтрованы (owners) → empty', () => {
      expect(decideScheduleView({ ...base, isSuccessUsers: true, activeUsersCount: 0, hasCachedUsers: true })).toBe(
        'empty',
      );
    });
  });

  describe('error', () => {
    it('ошибка пользователей без кэша → error', () => {
      expect(decideScheduleView({ ...base, isErrorUsers: true, hasCachedUsers: false })).toBe('error');
    });

    it('ошибка расписания без мастеров и без кэша → error', () => {
      expect(decideScheduleView({ ...base, scheduleError: true, hasCachedUsers: false })).toBe('error');
    });

    it('ошибка, но есть закэшированные пользователи → skeleton (не мигаем error поверх stale)', () => {
      expect(decideScheduleView({ ...base, isErrorUsers: true, hasCachedUsers: true, activeUsersCount: 0 })).toBe(
        'skeleton',
      );
    });
  });

  describe('stale-empty (КОРЕНЬ БАГА)', () => {
    it('пустой массив из протухшего кэша, рефетч не подтверждён → skeleton, НЕ empty', () => {
      // Это сценарий бага: usersData === [] (не undefined), запрос ещё
      // не success, ошибки нет. Старое условие проваливало это в «Нет
      // мастеров». Новое — держит skeleton до подтверждения.
      expect(
        decideScheduleView({
          ...base,
          isLoadingUsers: false,
          isSuccessUsers: false,
          isErrorUsers: false,
          activeUsersCount: 0,
          hasCachedUsers: false,
        }),
      ).toBe('skeleton');
    });

    it('фоновый рефетч после гидратации (loading=false, fetching idle→fetch) без success → skeleton', () => {
      expect(decideScheduleView({ ...base, isLoadingUsers: false, isSuccessUsers: false })).toBe('skeleton');
    });
  });
});
