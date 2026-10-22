// Match the backend's ParseUuidParam; do not coerce or trim a broken response.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PurchaseOrderIdentityError extends Error {
  constructor() {
    super('Не удалось получить номер заказа. Откройте список заказов и проверьте его состояние.');
  }
}

export function assertPurchaseOrderId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new PurchaseOrderIdentityError();
}
