/**
 * Тесты decideStaffListView + toUserArray — защита от регрессии
 * перемежающегося «Нет сотрудников» / «Нет мастеров».
 *
 * Контракт дискриминации loading / error / empty / list: пустое состояние
 * показываем ТОЛЬКО при подтверждённом успехе и реально пустом списке —
 * никогда при загрузке, ошибке или неподтверждённом placeholder.
 *
 * `../../api/services` замокан: `useUsers.ts` импортит его (axios /
 * AsyncStorage / react-native) на верхнем уровне, а тесту нужны лишь чистые
 * функции — мок не даёт RN-цепочке грузиться в node-окружении jest.
 */
jest.mock('../../api/services', () => ({ usersApi: { getAll: jest.fn() } }));

import { decideStaffListView, toUserArray, type StaffListViewInput } from '../useUsers';

// База: данных нет, ошибок нет, не success, 0 строк. Каждый тест
// переопределяет нужные поля — так ветки читаются явно.
const base: StaffListViewInput = {
  hasData: false,
  isError: false,
  isSuccess: false,
  visibleCount: 0,
};

describe('toUserArray', () => {
  it('массив проходит как есть (та же ссылка)', () => {
    const arr = [{ id: '1' }, { id: '2' }];
    expect(toUserArray(arr)).toBe(arr);
  });

  it('сырой AxiosResponse (корень бага) → []', () => {
    // Именно это UsersScreen клал в общий слот ['users']; для читателей-
    // массивов оно деградирует в [], а не роняет .filter/.map.
    expect(toUserArray({ data: [{ id: '1' }], status: 200, headers: {} })).toEqual([]);
  });

  it('не-массив из окна 502 / undefined / null → []', () => {
    expect(toUserArray({ statusCode: 502, message: 'Bad Gateway' })).toEqual([]);
    expect(toUserArray(undefined)).toEqual([]);
    expect(toUserArray(null)).toEqual([]);
  });
});

describe('decideStaffListView', () => {
  describe('данные побеждают', () => {
    it('есть видимые строки → list', () => {
      expect(decideStaffListView({ ...base, visibleCount: 3, isSuccess: true })).toBe('list');
    });

    it('есть строки даже без подтверждённого success (placeholder/stale) → list', () => {
      expect(decideStaffListView({ ...base, visibleCount: 1, hasData: true, isSuccess: false })).toBe('list');
    });
  });

  describe('данных ещё нет', () => {
    it('первая загрузка без данных → skeleton', () => {
      expect(decideStaffListView({ ...base, hasData: false })).toBe('skeleton');
    });

    it('ошибка без данных (cold start, нет кэша) → error', () => {
      expect(decideStaffListView({ ...base, hasData: false, isError: true })).toBe('error');
    });
  });

  describe('данные есть, но показывать нечего', () => {
    it('подтверждённый успех и пусто → empty (единственное легальное «пусто»)', () => {
      expect(decideStaffListView({ ...base, hasData: true, isSuccess: true, visibleCount: 0 })).toBe('empty');
    });

    it('был кэш, последний фетч упал, показывать нечего → error', () => {
      expect(decideStaffListView({ ...base, hasData: true, isError: true, visibleCount: 0 })).toBe('error');
    });

    it('placeholder/stale пусто, рефетч не подтверждён → skeleton, НЕ empty (КОРЕНЬ БАГА)', () => {
      expect(decideStaffListView({ ...base, hasData: true, isSuccess: false, isError: false, visibleCount: 0 })).toBe(
        'skeleton',
      );
    });
  });

  describe('никогда «empty» во время загрузки', () => {
    it('placeholder-данные есть, но 0 видимых и не success → skeleton', () => {
      expect(decideStaffListView({ ...base, hasData: true, visibleCount: 0 })).toBe('skeleton');
    });
  });
});
