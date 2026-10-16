import { captureAuthSession, createSessionBoundClient } from '../../api/axios';
import { captureDataSession } from '../../contexts/dataSession';
import { createProductsApi } from '../../../../shared/api/createServices';
import { loadProductCatalog } from '../../../../shared/api/productCatalog';
import type { InventoryStockRequest } from './model';

/** Capture before confirmation, and retain this lease for every continuation. */
export function captureInventorySession() {
  const auth = captureAuthSession();
  const data = captureDataSession();
  const client = createSessionBoundClient(auth.token);
  const products = createProductsApi(client);
  const isCurrent = () => auth.isCurrent() && data.isCurrent();
  return {
    data,
    isCurrent,
    updateStock: async (id: string, body: InventoryStockRequest) => {
      const canceled = () => Object.assign(new Error('Inventory session expired'), { code: 'ERR_CANCELED' });
      if (!isCurrent()) throw canceled();
      const result = await client.post<{ stock: number; requestId: string; linkedExpenseId: null }>(
        `/products/${id}/inventory`,
        body,
      );
      if (!isCurrent()) throw canceled();
      return result;
    },
    loadProducts: (warehouseId: string) =>
      loadProductCatalog(
        async (params) => {
          if (!isCurrent()) throw new Error('Inventory session expired');
          const result = await products.getAll(params);
          if (!isCurrent()) throw new Error('Inventory session expired');
          return result;
        },
        { warehouseId },
      ),
  };
}
export type InventorySession = ReturnType<typeof captureInventorySession>;
