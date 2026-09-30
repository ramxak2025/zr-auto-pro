/**
 * Ячейки хранения — `shared/utils/storageCells.ts` (2026-09-30). Backend нормализует
 * код сам (shared не импортирует) — эти тесты фиксируют ожидаемое поведение обеих сторон.
 */
import {
  MAX_BULK_CELLS,
  MAX_RACKS,
  countCellCodes,
  expandRacks,
  generateCellCodes,
  normalizeCellCode,
} from '../../../../shared/utils/storageCells';

describe('лимиты', () => {
  it('фиксирует контракт: 2000 кодов в bulk, 100 стеллажей', () => {
    expect(MAX_BULK_CELLS).toBe(2000);
    expect(MAX_RACKS).toBe(100);
  });
});

describe('normalizeCellCode', () => {
  it('обрезает края, схлопывает пробелы и поднимает регистр', () => {
    expect(normalizeCellCode('  a-01   b ')).toBe('A-01 B');
    expect(normalizeCellCode('a-1-1')).toBe('A-1-1');
    expect(normalizeCellCode('б3')).toBe('Б3');
    expect(normalizeCellCode('стеллаж 2')).toBe('СТЕЛЛАЖ 2');
  });

  it('считает пробелами табы и неразрывный пробел', () => {
    expect(normalizeCellCode('\tстеллаж  2 ')).toBe('СТЕЛЛАЖ 2');
  });

  it('пустой ввод даёт пустую строку', () => {
    expect(normalizeCellCode('')).toBe('');
    expect(normalizeCellCode('   ')).toBe('');
    expect(normalizeCellCode(null)).toBe('');
    expect(normalizeCellCode(undefined)).toBe('');
  });

  it('идемпотентна', () => {
    const once = normalizeCellCode(' а-01   в ');
    expect(normalizeCellCode(once)).toBe(once);
  });
});

describe('generateCellCodes', () => {
  it('пример из спеки: 2 стеллажа × 3 полки × 4 ячейки = 24 кода', () => {
    const codes = generateCellCodes({ racks: ['A', 'B'], shelves: 3, cells: 4, separator: '-' });
    expect(codes).toHaveLength(24);
    expect(codes[0]).toBe('A-1-1');
    expect(codes[3]).toBe('A-1-4');
    expect(codes[4]).toBe('A-2-1');
    expect(codes[11]).toBe('A-3-4');
    expect(codes[12]).toBe('B-1-1');
    expect(codes[23]).toBe('B-3-4');
    expect(new Set(codes).size).toBe(24);
  });

  it('разделитель по умолчанию — дефис', () => {
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 2 })).toEqual(['A-1-1', 'A-1-2']);
  });

  it('без pad номера без ведущих нулей', () => {
    const codes = generateCellCodes({ racks: ['A'], shelves: 1, cells: 12 });
    expect(codes[8]).toBe('A-1-9');
    expect(codes[9]).toBe('A-1-10');
    expect(codes[11]).toBe('A-1-12');
  });

  it('pad задаёт ширину номеров полки и ячейки, но не метки стеллажа', () => {
    expect(generateCellCodes({ racks: ['A'], shelves: 2, cells: 2, pad: 2 })).toEqual([
      'A-01-01',
      'A-01-02',
      'A-02-01',
      'A-02-02',
    ]);
    const wide = generateCellCodes({ racks: ['7'], shelves: 12, cells: 1, pad: 2 });
    expect(wide[0]).toBe('7-01-01');
    expect(wide[11]).toBe('7-12-01');
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 1, pad: 3 })).toEqual(['A-001-001']);
  });

  it('pad меньше 2 ничего не меняет, слишком большой — ограничен', () => {
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 1, pad: 1 })).toEqual(['A-1-1']);
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 1, pad: 0 })).toEqual(['A-1-1']);
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 1, pad: 1e9 })).toEqual(['A-000001-000001']);
  });

  it('свой разделитель, в том числе пустой и пробел', () => {
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 2, separator: '.' })).toEqual(['A.1.1', 'A.1.2']);
    expect(generateCellCodes({ racks: ['A'], shelves: 1, cells: 2, separator: '' })).toEqual(['A11', 'A12']);
    expect(generateCellCodes({ racks: ['Б'], shelves: 1, cells: 1, separator: ' ' })).toEqual(['Б 1 1']);
  });

  it('любая часть необязательна: отсутствующая просто выпадает из кода', () => {
    expect(generateCellCodes({ racks: ['A', 'B'] })).toEqual(['A', 'B']);
    expect(generateCellCodes({ racks: ['A'], shelves: 3 })).toEqual(['A-1', 'A-2', 'A-3']);
    expect(generateCellCodes({ racks: ['A'], cells: 2 })).toEqual(['A-1', 'A-2']);
    expect(generateCellCodes({ shelves: 2, cells: 2 })).toEqual(['1-1', '1-2', '2-1', '2-2']);
    expect(generateCellCodes({ cells: 3 })).toEqual(['1', '2', '3']);
    expect(generateCellCodes({})).toEqual([]);
  });

  it('пустой список стеллажей и нулевые счётчики — это «части нет»', () => {
    expect(generateCellCodes({ racks: [], shelves: 2, cells: 1 })).toEqual(['1-1', '2-1']);
    expect(generateCellCodes({ racks: ['A'], shelves: 0, cells: 2 })).toEqual(['A-1', 'A-2']);
    expect(generateCellCodes({ racks: [], shelves: 0, cells: 0 })).toEqual([]);
  });

  it('нормализует метки стеллажей, кириллица работает', () => {
    expect(generateCellCodes({ racks: ['а', ' Б '], shelves: 1, cells: 1 })).toEqual(['А-1-1', 'Б-1-1']);
  });

  it('отбрасывает пустые и повторяющиеся (без учёта регистра) стеллажи', () => {
    const codes = generateCellCodes({ racks: ['A', 'a', ' ', '', 'B', 'A '], shelves: 1, cells: 1 });
    expect(codes).toEqual(['A-1-1', 'B-1-1']);
  });

  it('мусорные счётчики: дробное вниз, отрицательное/NaN — части нет', () => {
    expect(generateCellCodes({ racks: ['A'], shelves: 2.9 })).toEqual(['A-1', 'A-2']);
    expect(generateCellCodes({ racks: ['A'], shelves: -3, cells: 1 })).toEqual(['A-1']);
    expect(generateCellCodes({ racks: ['A'], shelves: Number.NaN, cells: 1 })).toEqual(['A-1']);
  });

  it('ровно MAX_BULK_CELLS кодов — допустимо', () => {
    const racks = Array.from({ length: 20 }, (_, i) => `R${i + 1}`);
    const codes = generateCellCodes({ racks, shelves: 10, cells: 10 });
    expect(codes).toHaveLength(MAX_BULK_CELLS);
    expect(new Set(codes).size).toBe(MAX_BULK_CELLS);
    expect(codes[MAX_BULK_CELLS - 1]).toBe('R20-10-10');
  });

  it('больше MAX_BULK_CELLS — бросает Error с русским текстом, ничего не усекая', () => {
    const racks = Array.from({ length: 20 }, (_, i) => `R${i + 1}`);
    expect(() => generateCellCodes({ racks, shelves: 10, cells: 11 })).toThrow(Error);
    expect(() => generateCellCodes({ racks, shelves: 10, cells: 11 })).toThrow(/Слишком много ячеек.*2000/);
    expect(() => generateCellCodes({ cells: MAX_BULK_CELLS + 1 })).toThrow(/Слишком много/);
  });

  it('абсурдные размеры отклоняются мгновенно, без генерации', () => {
    expect(() => generateCellCodes({ racks: ['A'], shelves: 1e9, cells: 1e9 })).toThrow(/Слишком много/);
    expect(() => generateCellCodes({ racks: ['A'], shelves: Infinity })).toThrow(/Слишком много/);
  });

  it('слитно и без нулей одинаковые коды остаются один раз: A·1·11 и A·11·1 → A111', () => {
    const codes = generateCellCodes({ racks: ['A'], shelves: 12, cells: 12, separator: '' });
    // 144 комбинации, две пары совпадают: (1,11)=(11,1) и (1,12)=(11,2).
    expect(codes).toHaveLength(142);
    expect(new Set(codes).size).toBe(142);
    // Порядок — по первому появлению, тот же код позже не повторяется.
    expect(codes.slice(0, 12)).toEqual([
      'A11',
      'A12',
      'A13',
      'A14',
      'A15',
      'A16',
      'A17',
      'A18',
      'A19',
      'A110',
      'A111',
      'A112',
    ]);
    expect(codes.filter((c) => c === 'A111')).toHaveLength(1);
    expect(codes.filter((c) => c === 'A112')).toHaveLength(1);
  });

  it('слитно без нулей: совпадения бывают и между стеллажами (1·11·1 и 11·1·1)', () => {
    const codes = generateCellCodes({ racks: ['1', '11'], shelves: 11, cells: 1, separator: '' });
    // Стеллаж «1»: 111, 121, … 1111. Стеллаж «11»: 1111 (уже был), 1121, … 11111.
    expect(codes).toHaveLength(21);
    expect(new Set(codes).size).toBe(21);
  });

  it('ведущие нули разводят номера — совпадений нет даже слитно', () => {
    const codes = generateCellCodes({ racks: ['A'], shelves: 12, cells: 12, separator: '', pad: 2 });
    expect(codes).toHaveLength(144);
    expect(codes[0]).toBe('A0101');
    expect(codes[143]).toBe('A1212');
    expect(new Set(codes).size).toBe(144);
  });

  it('с разделителем совпадений нет: A-1-11 и A-11-1 — разные коды', () => {
    const codes = generateCellCodes({ racks: ['A'], shelves: 12, cells: 12 });
    expect(codes).toHaveLength(144);
    expect(codes).toContain('A-1-11');
    expect(codes).toContain('A-11-1');
  });
});

describe('countCellCodes', () => {
  it('считает без генерации и совпадает с длиной результата', () => {
    const params = { racks: ['A', 'B'], shelves: 3, cells: 4 };
    expect(countCellCodes(params)).toBe(24);
    expect(countCellCodes(params)).toBe(generateCellCodes(params).length);
    expect(countCellCodes({ racks: ['A', 'B', 'C'] })).toBe(3);
    expect(countCellCodes({ shelves: 2, cells: 5 })).toBe(10);
    expect(countCellCodes({ racks: ['A', 'a', ''], cells: 2 })).toBe(2);
  });

  it('ни одной части — 0', () => {
    expect(countCellCodes({})).toBe(0);
    expect(countCellCodes({ racks: [], shelves: 0, cells: -1 })).toBe(0);
  });

  it('не ограничивает и не бросает — сверяйте с MAX_BULK_CELLS сами', () => {
    expect(countCellCodes({ racks: ['A'], shelves: 100000, cells: 100000 })).toBe(1e10);
    expect(countCellCodes({ racks: ['A'], shelves: Infinity })).toBeGreaterThan(MAX_BULK_CELLS);
    expect(countCellCodes({ racks: ['A'], shelves: MAX_BULK_CELLS + 1 })).toBeGreaterThan(MAX_BULK_CELLS);
  });

  it('считает разные коды, а не комбинации: слитно без нулей 12×12 → 142, а не 144', () => {
    const params = { racks: ['A'], shelves: 12, cells: 12, separator: '' };
    expect(countCellCodes(params)).toBe(142);
    expect(countCellCodes(params)).toBe(generateCellCodes(params).length);
    expect(countCellCodes({ ...params, pad: 2 })).toBe(144);
    expect(countCellCodes({ ...params, separator: '-' })).toBe(144);
  });

  it('выше лимита отдаёт число комбинаций без генерации, а генератор бросает', () => {
    const params = { racks: ['A'], shelves: 50, cells: 50, separator: '' };
    expect(countCellCodes(params)).toBe(2500);
    expect(() => generateCellCodes(params)).toThrow(/Слишком много/);
  });
});

describe('expandRacks', () => {
  it('диапазон латинских букв', () => {
    expect(expandRacks('A-C')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('a-c')).toEqual(['A', 'B', 'C']);
    expect(expandRacks(' A - C ')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('B-B')).toEqual(['B']);
    expect(expandRacks('A-Z')).toHaveLength(26);
  });

  it('диапазон кириллических букв', () => {
    expect(expandRacks('А-Г')).toEqual(['А', 'Б', 'В', 'Г']);
    expect(expandRacks('а-в')).toEqual(['А', 'Б', 'В']);
  });

  it('диапазон чисел', () => {
    expect(expandRacks('1-5')).toEqual(['1', '2', '3', '4', '5']);
    expect(expandRacks('8-11')).toEqual(['8', '9', '10', '11']);
    expect(expandRacks('3-3')).toEqual(['3']);
  });

  it('ведущие нули числового диапазона задают ширину', () => {
    expect(expandRacks('01-05')).toEqual(['01', '02', '03', '04', '05']);
    expect(expandRacks('08-11')).toEqual(['08', '09', '10', '11']);
    expect(expandRacks('1-10')).toHaveLength(10);
    expect(expandRacks('1-10')[0]).toBe('1');
  });

  it('другие тире (en dash, em dash, минус) тоже дают диапазон', () => {
    expect(expandRacks('A–C')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('1—3')).toEqual(['1', '2', '3']);
    expect(expandRacks('A−C')).toEqual(['A', 'B', 'C']);
  });

  it('список через запятую берётся как есть', () => {
    expect(expandRacks('A,B,C')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('1,3,5')).toEqual(['1', '3', '5']);
    expect(expandRacks(' a , b ; c ')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('A\nB')).toEqual(['A', 'B']);
    expect(expandRacks('Зона 2, Б')).toEqual(['ЗОНА 2', 'Б']);
  });

  it('список и диапазоны можно смешивать; повторы схлопываются', () => {
    expect(expandRacks('A-C, E')).toEqual(['A', 'B', 'C', 'E']);
    expect(expandRacks('A-C, B, a')).toEqual(['A', 'B', 'C']);
    expect(expandRacks('1-3,7,9-10')).toEqual(['1', '2', '3', '7', '9', '10']);
  });

  it('пустые токены пропускаются', () => {
    expect(expandRacks('A,,B,')).toEqual(['A', 'B']);
    expect(expandRacks(',A')).toEqual(['A']);
  });

  it('метка со смешанным содержимым — просто метка, а не диапазон', () => {
    expect(expandRacks('A-1')).toEqual(['A-1']);
    expect(expandRacks('1-B')).toEqual(['1-B']);
  });

  it('мусор и пустой ввод — []', () => {
    expect(expandRacks('')).toEqual([]);
    expect(expandRacks('   ')).toEqual([]);
    expect(expandRacks(null)).toEqual([]);
    expect(expandRacks(undefined)).toEqual([]);
    expect(expandRacks(',,,')).toEqual([]);
    expect(expandRacks('!!!')).toEqual([]);
    expect(expandRacks('---')).toEqual([]);
    expect(expandRacks('A-')).toEqual([]);
    expect(expandRacks('-5')).toEqual([]);
  });

  it('один нераспознанный токен обнуляет весь результат', () => {
    expect(expandRacks('A,B,!!!')).toEqual([]);
    expect(expandRacks('A-C, C-A')).toEqual([]);
  });

  it('обратный диапазон и смесь алфавитов — []', () => {
    expect(expandRacks('C-A')).toEqual([]);
    expect(expandRacks('5-1')).toEqual([]);
    expect(expandRacks('A-Г')).toEqual([]); // латинская A и кириллическая Г
    expect(expandRacks('Ё-Ж')).toEqual([]); // Ё в границах диапазона не участвует
  });

  it('слишком длинная метка и гигантские числа — []', () => {
    expect(expandRacks('X'.repeat(21))).toEqual([]);
    expect(expandRacks('X'.repeat(20))).toEqual(['X'.repeat(20)]);
    expect(expandRacks('1-9999999999')).toEqual([]);
  });

  it('не больше MAX_RACKS: ровно 100 можно, 101 — []', () => {
    expect(expandRacks('1-100')).toHaveLength(MAX_RACKS);
    expect(expandRacks('1-101')).toEqual([]);
    expect(expandRacks('A-Z, 1-75')).toEqual([]); // 26 + 75 = 101
    expect(expandRacks('A-Z, 1-74')).toHaveLength(100);
  });

  it('результат годится генератору кодов', () => {
    const racks = expandRacks('A-B');
    expect(generateCellCodes({ racks, shelves: 2, cells: 2 })).toEqual([
      'A-1-1',
      'A-1-2',
      'A-2-1',
      'A-2-2',
      'B-1-1',
      'B-1-2',
      'B-2-1',
      'B-2-2',
    ]);
  });
});
