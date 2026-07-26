/**
 * dedupeById — второй рубеж против дублей в бесконечной ленте журнала.
 * Дубль id = дубль React-ключа в FlatList, отсюда «белые» и чужие строки.
 */
import { dedupeById } from '../dedupeById';

describe('dedupeById', () => {
  it('оставляет ПЕРВОЕ вхождение и сохраняет порядок', () => {
    const items = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 99 },
      { id: 'c', n: 3 },
    ];
    expect(dedupeById(items)).toEqual([
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'c', n: 3 },
    ]);
  });

  it('список без дублей возвращается как есть', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(dedupeById(items)).toEqual(items);
  });

  it('пустой список — пустой результат', () => {
    expect(dedupeById([])).toEqual([]);
  });

  it('строки без id не схлопываются между собой и не теряются', () => {
    const items = [{ id: '' }, { id: 'a' }, { id: '' }] as { id: string }[];
    expect(dedupeById(items)).toHaveLength(3);
  });

  it('склейка страниц с перехлёстом даёт ленту без повторов', () => {
    const page1 = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const page2 = [{ id: '3' }, { id: '4' }]; // строка 3 «переехала» из-за вставки
    expect(dedupeById([...page1, ...page2]).map((c) => c.id)).toEqual(['1', '2', '3', '4']);
  });
});
