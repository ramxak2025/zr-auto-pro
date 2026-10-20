import {
  buildMotivationChoices,
  coversChoice,
  filterMotivationChoices,
  motivationTargetKey,
  parseMotivationPercent,
  motivationApplyTargets,
  toggleMotivationChoice,
} from '../selection';
import type { Product } from '../../../../../shared/types';

const product = (id: number, category = 'Масла / Моторные', warehouseId = 'main') =>
  ({ id: String(id), name: `Масло ${id}`, category, warehouseId, article: `A${id}` }) as Product;

it('keeps 2500 selected products and independently selected parents/children across filters', () => {
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
  expect(selected).toHaveLength(2501);
  selected = toggleMotivationChoice(selected, parent);
  expect(selected).toHaveLength(2502);
  expect(selected).toContain(child);
  expect(selected).toContain(choices.products[2499]);
  const withoutParent = toggleMotivationChoice(selected, parent);
  expect(withoutParent).toHaveLength(2501);
  expect(withoutParent).toContain(child);
  expect(withoutParent).toContain(choices.products[2499]);
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

it('parent-first selection also retains explicit child/product targets and replacement target expansion deduplicates IDs', () => {
  const choices = buildMotivationChoices([product(1)], [], 'main');
  const parent = choices.folders.find((choice) => choice.path === 'Масла')!;
  const child = choices.folders.find((choice) => choice.path === 'Масла/Моторные')!;
  let selected = toggleMotivationChoice([], parent);
  selected = toggleMotivationChoice(selected, child);
  selected = toggleMotivationChoice(selected, choices.products[0]);
  expect(selected).toEqual([parent, child, choices.products[0]]);
  expect(
    motivationApplyTargets(
      selected.map((choice) => choice.target),
      [{ productId: '1' }, { productId: '2' }],
    ),
  ).toEqual([parent.target, child.target, choices.products[0].target, { kind: 'product', productId: '2' }]);
});
