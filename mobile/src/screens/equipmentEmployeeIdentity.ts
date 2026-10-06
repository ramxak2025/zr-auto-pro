export interface EquipmentEmployeeIdentity {
  userId: string;
  avatar?: string | null;
  [key: string]: unknown;
}

/** Prefer the current authorized summary row over the identity snapshot in route params. */
export function resolveEquipmentEmployeeIdentity<T extends EquipmentEmployeeIdentity>(
  routeEmployee: T,
  currentSummary: readonly T[],
): T {
  const current = currentSummary.find((employee) => employee.userId === routeEmployee.userId);
  return current ? { ...routeEmployee, ...current } : routeEmployee;
}
