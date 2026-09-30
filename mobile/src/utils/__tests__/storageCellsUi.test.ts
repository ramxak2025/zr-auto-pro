/**
 * Ячейки хранения (2026-09-30): чистая логика экранов — поиск по коду, разбор ошибок,
 * предпросмотр сетки. Сами правила сетки проверены в storageCells.test.ts; здесь —
 * что экран правильно собирает их вместе и не даёт создать лишнее.
 */
import type { StorageCell } from '../../../../shared/types';
import { MAX_BULK_CELLS } from '../../../../shared/utils/storageCells';
import {
  buildCellGridPreview,
  bulkResultMessage,
  cellCodeMatchesQuery,
  cellsCountText,
  filterStorageCells,
  formatBigCount,
  formatCodesSample,
  parseStorageCellError,
  pluralRu,
  productsCountText,
  STORAGE_CELL_TAKEN_TEXT,
  storageCellFailureText,
  storageCellFormFailureText,
  withRequestedStorageCell,
} from '../storageCellsUi';

function cell(code: string, extra: Partial<StorageCell> = {}): StorageCell {
  return { id: `id-${code}`, warehouseId: 'w1', code, name: null, sortOrder: 0, productsCount: 0, ...extra };
}

function axiosError(data: unknown, message = 'Request failed with status code 409') {
  return { message, response: { status: 409, data } };
}

describe('склонения', () => {
  it('товар / товара / товаров', () => {
    expect(productsCountText(1)).toBe('1 товар');
    expect(productsCountText(2)).toBe('2 товара');
    expect(productsCountText(5)).toBe('5 товаров');
    expect(productsCountText(11)).toBe('11 товаров');
    expect(productsCountText(21)).toBe('21 товар');
    expect(productsCountText(112)).toBe('112 товаров');
  });

  it('ячейка / ячейки / ячеек', () => {
    expect(cellsCountText(1)).toBe('1 ячейка');
    expect(cellsCountText(3)).toBe('3 ячейки');
    expect(cellsCountText(6)).toBe('6 ячеек');
    expect(cellsCountText(0)).toBe('0 ячеек');
  });

  it('pluralRu — общее правило', () => {
    expect(pluralRu(14, 'a', 'b', 'c')).toBe('c');
    expect(pluralRu(22, 'a', 'b', 'c')).toBe('b');
  });
});

describe('cellCodeMatchesQuery', () => {
  it('регистр и пробелы не важны', () => {
    expect(cellCodeMatchesQuery('A-1-2', 'a-1')).toBe(true);
    expect(cellCodeMatchesQuery('A-1-2', '  A-1  ')).toBe(true);
    expect(cellCodeMatchesQuery('СТЕЛЛАЖ 2', 'стеллаж   2')).toBe(true);
    expect(cellCodeMatchesQuery('Б3', 'б3')).toBe(true);
  });

  it('ищет подстроку, а не только начало', () => {
    expect(cellCodeMatchesQuery('A-1-2', '1-2')).toBe(true);
    expect(cellCodeMatchesQuery('A-1-2', 'B')).toBe(false);
  });

  it('товар без адреса не подходит под непустой запрос', () => {
    expect(cellCodeMatchesQuery(null, 'A')).toBe(false);
    expect(cellCodeMatchesQuery(undefined, 'A')).toBe(false);
    expect(cellCodeMatchesQuery('', 'A')).toBe(false);
  });

  it('пустой запрос — фильтра нет', () => {
    expect(cellCodeMatchesQuery('A-1', '')).toBe(true);
    expect(cellCodeMatchesQuery(null, '   ')).toBe(true);
  });
});

describe('filterStorageCells', () => {
  const cells = [cell('A-1-1'), cell('A-1-2', { name: 'у входа' }), cell('Б-2-1'), cell('Полка 3', { name: 'Масла' })];

  it('без запроса отдаёт тот же массив', () => {
    expect(filterStorageCells(cells, '')).toBe(cells);
    expect(filterStorageCells(cells, '   ')).toBe(cells);
  });

  it('ищет по коду', () => {
    expect(filterStorageCells(cells, 'a-1').map((c) => c.code)).toEqual(['A-1-1', 'A-1-2']);
    expect(filterStorageCells(cells, 'б').map((c) => c.code)).toEqual(['Б-2-1']);
  });

  it('ищет по подписи', () => {
    expect(filterStorageCells(cells, 'масла').map((c) => c.code)).toEqual(['Полка 3']);
    expect(filterStorageCells(cells, 'ВХОДА').map((c) => c.code)).toEqual(['A-1-2']);
  });

  it('ничего не нашлось — пустой массив', () => {
    expect(filterStorageCells(cells, 'zzz')).toEqual([]);
  });
});

describe('parseStorageCellError', () => {
  it('узнаёт три кода по верхнему уровню тела', () => {
    expect(parseStorageCellError(axiosError({ message: 'x', code: 'STORAGE_CELL_EXISTS' }))).toEqual({
      code: 'STORAGE_CELL_EXISTS',
      productsCount: undefined,
    });
    expect(parseStorageCellError(axiosError({ message: 'x', code: 'STORAGE_CELL_WRONG_WAREHOUSE' }))?.code).toBe(
      'STORAGE_CELL_WRONG_WAREHOUSE',
    );
  });

  it('у NOT_EMPTY достаёт productsCount', () => {
    expect(
      parseStorageCellError(axiosError({ message: 'x', code: 'STORAGE_CELL_NOT_EMPTY', productsCount: 7 })),
    ).toEqual({
      code: 'STORAGE_CELL_NOT_EMPTY',
      productsCount: 7,
    });
  });

  it('productsCount не числом игнорируется', () => {
    expect(
      parseStorageCellError(axiosError({ code: 'STORAGE_CELL_NOT_EMPTY', productsCount: '7' }))?.productsCount,
    ).toBeUndefined();
  });

  it('чужой код, строка вместо тела, сетевая ошибка, null — не наша ошибка', () => {
    expect(parseStorageCellError(axiosError({ message: 'x', code: 'SOMETHING_ELSE' }))).toBeNull();
    expect(parseStorageCellError(axiosError('<html>502</html>'))).toBeNull();
    expect(parseStorageCellError(new Error('Network Error'))).toBeNull();
    expect(parseStorageCellError(null)).toBeNull();
    expect(parseStorageCellError(undefined)).toBeNull();
  });
});

describe('storageCellFailureText', () => {
  it('свои формулировки для кодов модуля, без текста сервера', () => {
    expect(storageCellFailureText(axiosError({ message: 'Duplicate', code: 'STORAGE_CELL_EXISTS' }), 'fb')).toMatch(
      /уже есть на этом складе/,
    );
    expect(
      storageCellFailureText(axiosError({ message: 'Wrong', code: 'STORAGE_CELL_WRONG_WAREHOUSE' }), 'fb'),
    ).toMatch(/другому складу/);
  });

  it('NOT_EMPTY называет число товаров', () => {
    const text = storageCellFailureText(
      axiosError({ message: 'x', code: 'STORAGE_CELL_NOT_EMPTY', productsCount: 3 }),
      'fb',
    );
    expect(text).toContain('3 товара');
  });

  it('прочее — сообщение сервера, иначе fallback', () => {
    expect(storageCellFailureText(axiosError({ message: 'Склад не найден' }, 'x'), 'fb')).toBe('Склад не найден');
    expect(storageCellFailureText(undefined, 'Не удалось сохранить')).toBe('Не удалось сохранить');
  });
});

describe('storageCellFormFailureText', () => {
  it('занятый код на экране ячеек — без «выберите из списка»', () => {
    const text = storageCellFormFailureText(axiosError({ message: 'x', code: 'STORAGE_CELL_EXISTS' }), 'fb');
    expect(text).toBe(STORAGE_CELL_TAKEN_TEXT);
    expect(text).not.toMatch(/из списка/);
  });

  it('остальное — как у общего разбора', () => {
    expect(storageCellFormFailureText(axiosError({ message: 'Склад не найден' }, 'x'), 'fb')).toBe('Склад не найден');
    expect(storageCellFormFailureText(undefined, 'Не удалось сохранить')).toBe('Не удалось сохранить');
  });
});

describe('formatBigCount', () => {
  it('разделяет тысячи пробелами', () => {
    expect(formatBigCount(36)).toBe('36');
    expect(formatBigCount(2600)).toBe('2 600');
    expect(formatBigCount(1234567)).toBe('1 234 567');
  });

  it('бесконечность и миллиарды — словами', () => {
    expect(formatBigCount(Infinity)).toBe('слишком много');
    expect(formatBigCount(1e9)).toBe('слишком много');
    expect(formatBigCount(Number.NaN)).toBe('слишком много');
  });
});

describe('buildCellGridPreview', () => {
  const base = { racksText: '', shelves: '', cells: '', separator: '-', padZeros: false };

  it('пример из приёмки: A × 2 полки × 3 ячейки = 6', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'A', shelves: '2', cells: '3' });
    expect(p.count).toBe(6);
    expect(p.canCreate).toBe(true);
    expect(p.codes).toEqual(['A-1-1', 'A-1-2', 'A-1-3', 'A-2-1', 'A-2-2', 'A-2-3']);
  });

  it('диапазон стеллажей: A-C × 3 × 4 = 36', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'A-C', shelves: '3', cells: '4' });
    expect(p.count).toBe(36);
    expect(p.codes[0]).toBe('A-1-1');
    expect(p.codes[p.codes.length - 1]).toBe('C-3-4');
  });

  it('разделитель и ведущие нули доходят до генератора', () => {
    const p = buildCellGridPreview({
      ...base,
      racksText: 'A',
      shelves: '2',
      cells: '2',
      separator: '.',
      padZeros: true,
    });
    expect(p.codes).toEqual(['A.01.01', 'A.01.02', 'A.02.01', 'A.02.02']);
  });

  it('пустая форма — сетки нет', () => {
    const p = buildCellGridPreview(base);
    expect(p).toEqual({ count: 0, racksInvalid: false, overLimit: false, canCreate: false, codes: [] });
  });

  it('нули и мусор в числах — части нет', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'A', shelves: '0', cells: 'abc' });
    expect(p.count).toBe(1);
    expect(p.codes).toEqual(['A']);
  });

  it('не разобранные стеллажи не превращаются молча в сетку без них', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'Я-А', shelves: '3', cells: '3' });
    expect(p.racksInvalid).toBe(true);
    expect(p.count).toBe(0);
    expect(p.canCreate).toBe(false);
    expect(p.codes).toEqual([]);
  });

  it('больше лимита — создавать нельзя и генератор не вызывается', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'A-Z', shelves: '10', cells: '10' });
    expect(p.count).toBe(2600);
    expect(p.count).toBeGreaterThan(MAX_BULK_CELLS);
    expect(p.overLimit).toBe(true);
    expect(p.canCreate).toBe(false);
    expect(p.codes).toEqual([]);
  });

  it('ровно лимит — можно', () => {
    const p = buildCellGridPreview({ ...base, racksText: 'A', shelves: '40', cells: '50' });
    expect(p.count).toBe(MAX_BULK_CELLS);
    expect(p.overLimit).toBe(false);
    expect(p.canCreate).toBe(true);
    expect(p.codes).toHaveLength(MAX_BULK_CELLS);
  });

  it('абсурдно большое число — лимит, а не падение', () => {
    const huge = '9'.repeat(400);
    const p = buildCellGridPreview({ ...base, racksText: 'A', shelves: huge, cells: huge });
    expect(p.overLimit).toBe(true);
    expect(p.canCreate).toBe(false);
  });
});

describe('formatCodesSample', () => {
  it('короткий список показывает целиком', () => {
    expect(formatCodesSample(['A-1', 'A-2', 'A-3', 'A-4'])).toBe('A-1, A-2, A-3, A-4');
    expect(formatCodesSample([])).toBe('');
  });

  it('длинный — три первых и последний', () => {
    expect(formatCodesSample(['1', '2', '3', '4', '5', '6'])).toBe('1, 2, 3 … 6');
  });
});

describe('bulkResultMessage', () => {
  it('всё создано', () => {
    expect(bulkResultMessage(6, [])).toBe('Создано: 6 ячеек.');
  });

  it('часть уже была — перечислена', () => {
    expect(bulkResultMessage(4, ['A-1-1', 'A-1-2'])).toBe('Создано: 4 ячейки. Уже были на складе (2): A-1-1, A-1-2.');
  });

  it('ничего нового', () => {
    expect(bulkResultMessage(0, ['A-1-1'])).toBe('Новых ячеек не создано. Уже были на складе (1): A-1-1.');
  });

  it('длинный список пропущенных обрезается', () => {
    const skipped = ['1', '2', '3', '4', '5', '6', '7'];
    expect(bulkResultMessage(1, skipped)).toBe('Создано: 1 ячейка. Уже были на складе (7): 1, 2, 3, 4, 5 и ещё 2.');
  });
});

describe('withRequestedStorageCell', () => {
  const picked = { id: 'c1', code: 'A-1-2', name: 'у входа' };
  const base = { id: 'p1', name: 'Масло', storageCellId: null as string | null | undefined };

  it('адрес в запросе не менялся — ответ как есть', () => {
    const res = { ...base, storageCellId: 'c0', storageCellCode: 'Б-1' };
    expect(withRequestedStorageCell(res, undefined, picked)).toBe(res);
  });

  it('адрес снят — все поля ячейки обнулены, даже если ответ их не склеил', () => {
    const res = { ...base, storageCellId: 'c0', storageCellCode: 'Б-1', storageCellName: 'x' };
    expect(withRequestedStorageCell(res, null, null)).toEqual({
      ...base,
      storageCellId: null,
      storageCellCode: null,
      storageCellName: null,
    });
  });

  it('ответ без склейки с ячейкой — код и подпись берутся у выбранной ячейки', () => {
    const res = { ...base, storageCellId: 'c1' };
    expect(withRequestedStorageCell(res, 'c1', picked)).toEqual({
      ...base,
      storageCellId: 'c1',
      storageCellCode: 'A-1-2',
      storageCellName: 'у входа',
    });
  });

  it('ответ вообще без поля ячейки — тоже дописывается', () => {
    const res: { id: string; name: string; storageCellId?: string | null; storageCellCode?: string | null } = {
      id: 'p1',
      name: 'Масло',
    };
    expect(withRequestedStorageCell(res, 'c1', picked)).toMatchObject({
      storageCellId: 'c1',
      storageCellCode: 'A-1-2',
    });
  });

  it('сервер сам склеил ответ — не перезаписываем', () => {
    const res = { ...base, storageCellId: 'c1', storageCellCode: 'A-1-2', storageCellName: null };
    expect(withRequestedStorageCell(res, 'c1', picked)).toBe(res);
  });

  it('выбранной ячейки нет под рукой — остаётся ответ сервера (карточку дочитает refetch)', () => {
    const res = { ...base, storageCellId: 'c1' };
    expect(withRequestedStorageCell(res, 'c1', null)).toBe(res);
    expect(withRequestedStorageCell(res, 'c1', { id: 'other', code: 'Z' })).toBe(res);
  });
});
