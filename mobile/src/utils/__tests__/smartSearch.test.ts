import {
  getSearchQueryVariants,
  matchSearch,
  normalizeSearchText,
  rankSearch,
  searchTokens,
  smartSearch,
} from '../../../../shared/utils/smartSearch';

describe('shared smart search', () => {
  const products = [
    { id: 'other', name: 'Масло моторное 5W-30', category: 'Двигатель', article: 'AB-123', barcode: '460-123' },
    { id: 'prefix', name: 'Масло фильтр', category: 'Расходники' },
    { id: 'exact', name: 'Масло', category: 'Расходники' },
  ];
  const fields = (item: (typeof products)[number]) => [item.name, item.category, item.article, item.barcode];

  it('normalizes Unicode compatibility, Russian ё and punctuation without changing numeric text', () => {
    expect(normalizeSearchText('  ＡＢ—１２３  ЁЛКА / фильтр ')).toBe('ab 123 елка фильтр');
    expect(searchTokens('масло / МАСЛО фильтр')).toEqual(['масло', 'фильтр']);
    expect(normalizeSearchText(null)).toBe('');
  });

  it('requires every token across fields in any order and accepts compact SKU/barcodes', () => {
    expect(matchSearch('двигатель 30 масло', fields(products[0]))).toBe(true);
    expect(matchSearch('масло тормоза', fields(products[0]))).toBe(false);
    expect(matchSearch('AB123', fields(products[0]))).toBe(true);
    expect(matchSearch('460123', fields(products[0]))).toBe(true);
    expect(matchSearch('ab123', ['ab', '123'])).toBe(false);
    expect(matchSearch('елка', ['Ёлка'])).toBe(true);
  });

  it('ranks exact and prefix first, keeps tied order and returns original objects', () => {
    const result = smartSearch(products, 'масло', fields);
    expect(result.map((item) => item.id)).toEqual(['exact', 'other', 'prefix']);
    expect(result[0]).toBe(products[2]);
    expect(rankSearch('масло', ['Масло'])).toBe(0);
    expect(rankSearch('масло', ['Масло 5w30'])).toBe(1);
    expect(rankSearch('масло фильтр', ['Фильтр масла', 'масло'])).toBe(2);
    expect(smartSearch(products, '', fields)).toEqual(products);
  });

  it('exposes deduplicated keyboard alternatives while retaining the ordinary query first', () => {
    expect(getSearchQueryVariants('vfckj')).toEqual(['vfckj', 'масло']);
    expect(getSearchQueryVariants('масло')).toEqual(['масло', 'vfckj']);
    expect(getSearchQueryVariants('AB-123')).toEqual(['ab 123']);
    expect(getSearchQueryVariants('ab')).toEqual(['ab']);
    expect(smartSearch(products, 'vfckj', fields).map((item) => item.id)).toEqual(['exact', 'other', 'prefix']);
    const ordinary = { id: 'literal', name: 'vfckj', category: '' };
    expect(smartSearch([...products, ordinary], 'vfckj', fields)).toEqual([ordinary]);
  });

  it.each(['филтр', 'филльтр', 'фидьтр', 'филтьр'])(
    'only uses bounded typo fallback when explicitly requested: %s',
    (query) => {
      const rows = [{ name: 'Фильтр' }];
      expect(smartSearch(rows, query, (row) => [row.name], { keyboardLayout: false })).toEqual([]);
      expect(smartSearch(rows, query, (row) => [row.name], { typos: true, keyboardLayout: false })).toEqual(rows);
    },
  );

  it('never fuzzes short tokens or numbers/SKU digits and never mixes fallback with ordinary hits', () => {
    expect(smartSearch([{ name: 'кот' }], 'кит', (row) => [row.name], { typos: true })).toEqual([]);
    expect(smartSearch(products, 'AB124', fields, { typos: true })).toEqual([]);
    expect(smartSearch(products, '460124', fields, { typos: true })).toEqual([]);
    expect(smartSearch([{ article: 'ABCD-123' }], 'ABCE-123', (row) => [row.article], { typos: true })).toEqual([]);
    const rows = [{ name: 'Фильтр' }, { name: 'Филтр' }];
    expect(smartSearch(rows, 'Филтр', (row) => [row.name], { typos: true })).toEqual([rows[1]]);
  });
});
