import type { QueryClient } from '@tanstack/react-query';

/** Bust only cached surfaces that carry an employee identity image. */
export async function invalidateEmployeeAvatarQueries(queryClient: QueryClient, employeeId?: string): Promise<void> {
  const keys: readonly (readonly unknown[])[] = [
    ['users'],
    ['all-users'],
    ['users-all'],
    ['users-for-filter'],
    ['users-dismissed'],
    ['schedule-today'],
    ['shifts', 'attendance'],
    ['checks', 'board'],
    ['eq-summary'],
    ['salary'],
    ['motivation'],
    ['checks-infinite'],
  ];
  const invalidations = keys.map((queryKey) => queryClient.invalidateQueries({ queryKey }));
  invalidations.push(
    queryClient.invalidateQueries({ queryKey: ['employee-full-profile', ...(employeeId ? [employeeId] : [])] }),
  );
  invalidations.push(queryClient.invalidateQueries({ queryKey: ['eq-user', ...(employeeId ? [employeeId] : [])] }));
  if (employeeId) invalidations.push(queryClient.invalidateQueries({ queryKey: ['user', employeeId] }));
  await Promise.all(invalidations);
}
