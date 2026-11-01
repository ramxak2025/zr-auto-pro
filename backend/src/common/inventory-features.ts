import { NotFoundException } from '@nestjs/common';

/** New inventory writes remain private until their complete rollout is approved. */
export function assertInventoryFeature(tenantId: string): void {
  const allowed = (process.env.INVENTORY_PREVIEW_TENANTS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (process.env.INVENTORY_PREVIEW_ENABLED !== 'true' || !allowed.includes(tenantId)) {
    throw new NotFoundException({ message: 'Функция недоступна' });
  }
}
