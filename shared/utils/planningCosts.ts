import type { FixedCost } from '../types';

export const isVehicleCost = (cost: FixedCost): boolean => cost.mode === 'per_vehicle_day';
export const plannedCostState = (cost: FixedCost) => cost.pending ?? cost;
export const costRate = (cost: FixedCost): number =>
  isVehicleCost(cost) ? (cost.perVehicleDayAmount ?? 0) : cost.monthlyAmount;
export const costStatus = (state: { active: boolean; archived?: boolean }): string =>
  state.archived ? 'Архив' : state.active ? 'Учитывается' : 'На паузе';
export const vehicleCostHint = 'Один автомобиль за день — один расход, даже если чеков десять. Розница не учитывается.';
export const costConflictMessage =
  'Расход уже изменился. Данные обновлены, ваш ввод сохранён. Проверьте значения и сохраните ещё раз.';
export function isCostConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as { response?: { status?: number } }).response?.status === 409
  );
}
/** Keep the UUID only for an identical retry; any different intent gets a fresh one. */
export function costRequestIntent(generateId: () => string) {
  let previous: { key: string; id: string } | undefined;
  return (intent: unknown): string => {
    const key = JSON.stringify(intent);
    if (!previous || previous.key !== key) previous = { key, id: generateId() };
    return previous.id;
  };
}

export function costRevision(cost: FixedCost): number {
  if (!Number.isInteger(cost.revision) || (cost.revision ?? 0) < 1)
    throw new Error('Обновите список расходов перед сохранением');
  return cost.revision as number;
}
