import { checkProductPayload, savedProductLineIds } from '../productPayload';
import type { CheckProductLine } from '../../../../../shared/types';

const original = {
  id: 'e77e8585-b05b-46be-b029-2536e805f7f4',
  name: 'Удалённый из каталога товар',
  sellPrice: 1000,
  costPrice: 500,
  quantity: 1,
  totalSell: 1000,
  totalCost: 500,
} satisfies CheckProductLine;

it('preserves an original saved identity on a paid edit, even when the SKU was deleted', () => {
  const ids = savedProductLineIds([original]);
  const edited = { ...original, quantity: 2, totalSell: 2000, totalCost: 1000 };
  expect(JSON.parse(JSON.stringify(checkProductPayload(edited, ids)))).toEqual({
    id: original.id,
    name: original.name,
    sellPrice: 1000,
    costPrice: 500,
    quantity: 2,
  });
});

it('keeps the SKU and saved line UUID separate, and omits IDs on newly added or template lines', () => {
  const ids = savedProductLineIds([original]);
  expect(checkProductPayload({ ...original, productId: 'catalog-sku' }, ids)).toMatchObject({
    id: original.id,
    productId: 'catalog-sku',
  });
  const newLine: CheckProductLine = { ...original, id: undefined, productId: 'new-sku' };
  expect(checkProductPayload(newLine, ids)).not.toHaveProperty('id');
  expect(checkProductPayload({ ...newLine, id: 'catalog-or-template-id' }, ids)).not.toHaveProperty('id');
});

it('does not carry a prior check identity into a new check after the original-ID set is reset', () => {
  expect(checkProductPayload(original, savedProductLineIds([]))).not.toHaveProperty('id');
  expect(savedProductLineIds([{ ...original, id: undefined }]).size).toBe(0);
});
