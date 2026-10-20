import {
  buildMotivationChoices,
  coversChoice,
  filterMotivationChoices,
  motivationTargetKey,
  parseMotivationPercent,
  toggleMotivationChoice,
} from '../selection';
import type { Product } from '../../../../../shared/types';

const product = (id: number, category = 'Масла / Моторные', warehouseId = 'main') =>
  ({ id: String(id), name: `Масло ${id}`, category, warehouseId, article: `A${id}` }) as Product;

it('keeps 2500 selected products, matches names/articles across filters, and deduplicates a parent subtree', () => {
  const choices = buildMotivationChoices(
    Array.from({ length: 2500 }, (_, index) => product(index)),
    [],
    'main',
  );
  let selected = choices.products.reduce(
    (all, choice) => toggleMotivationChoice(all, choice),
    [] as typeof choices.products,
  );
  expect(selected).toHaveLength(2500);
  expect(filterMotivationChoices(choices.products, 'A2499')).toEqual([choices.products[2499]]);
  const parent = choices.folders.find((choice) => choice.path === 'Масла')!;
  const child = choices.folders.find((choice) => choice.path === 'Масла/Моторные')!;
  selected = toggleMotivationChoice(selected, child);
  expect(selected).toEqual([child]);
  selected = toggleMotivationChoice(selected, parent);
  expect(selected).toEqual([parent]);
  expect(toggleMotivationChoice(selected, choices.products[2499])).toBe(selected);
  expect(toggleMotivationChoice(selected, parent)).toEqual([]);
});

it('normalizes imported ancestor paths, preserves empty folders and never merges another warehouse or a similar prefix', () => {
  const first = buildMotivationChoices(
    [product(1), product(2, 'Масла2/Моторные')],
    [
      { id: 'cat', path: ' Масла / Моторные ' },
      { id: 'empty', path: 'Пустая' },
    ],
    'main',
  );
  const other = buildMotivationChoices([product(3, 'Масла/Моторные', 'used')], [], 'used');
  const parent = first.folders.find((choice) => choice.path === 'Масла')!;
  const child = first.folders.find((choice) => choice.path === 'Масла/Моторные')!;
  expect(child.target).toMatchObject({ categoryId: 'cat', path: 'Масла/Моторные', warehouseId: 'main' });
  expect(first.folders.find((choice) => choice.path === 'Пустая')?.target).toMatchObject({ categoryId: 'empty' });
  expect(coversChoice(parent, first.products[1])).toBe(false);
  expect(coversChoice(parent, other.products[0])).toBe(false);
  expect(motivationTargetKey(parent.target)).not.toBe(motivationTargetKey(other.folders[0].target));
  expect(toggleMotivationChoice([parent], other.folders[0])).toHaveLength(2);
});

it.each(['', '0', '-1', '101', '1abc', '1.234', '1,2,3'])('rejects invalid rate %s', (value) =>
  expect(parseMotivationPercent(value)).toBeNull(),
);
it('accepts Russian decimals, 100% and a fractional positive rate', () => {
  expect(parseMotivationPercent('12,34')).toBe(12.34);
  expect(parseMotivationPercent('100')).toBe(100);
  expect(parseMotivationPercent('0.01')).toBe(0.01);
});
