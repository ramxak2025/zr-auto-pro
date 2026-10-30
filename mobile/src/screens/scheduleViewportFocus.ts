/** Navigation only requests Today; the day itself always comes from the tenant calendar. */
export interface ScheduleFocusParams {
  focusToday: true;
  focusEmployeeId?: string;
  focusRequestId: string;
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

export function readScheduleFocusParams(value: unknown): ScheduleFocusParams | null {
  if (!value || typeof value !== 'object') return null;
  const params = value as Record<string, unknown>;
  if (params.focusToday !== true || !validId(params.focusRequestId)) return null;
  return {
    focusToday: true,
    focusRequestId: params.focusRequestId,
    ...(validId(params.focusEmployeeId) ? { focusEmployeeId: params.focusEmployeeId } : {}),
  };
}

export interface ScheduleViewportFocus {
  requestId: string;
  scopeKey: string;
  dayKey: string;
  employeeId?: string;
  horizontalDone: boolean;
  employeeDone: boolean;
}

export function createScheduleViewportFocus(
  requestId: string,
  scopeKey: string,
  dayKey: string,
  employeeId?: string,
): ScheduleViewportFocus {
  return { requestId, scopeKey, dayKey, employeeId, horizontalDone: false, employeeDone: !employeeId };
}

export function completeScheduleViewportFocus(
  focus: ScheduleViewportFocus | null,
  requestId: string,
  horizontalDone: boolean,
  employeeDone: boolean,
): ScheduleViewportFocus | null {
  if (!focus || focus.requestId !== requestId) return focus;
  if ((!horizontalDone || focus.horizontalDone) && (!employeeDone || focus.employeeDone)) return focus;
  return {
    ...focus,
    horizontalDone: focus.horizontalDone || horizontalDone,
    employeeDone: focus.employeeDone || employeeDone,
  };
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const matches = (a: number, b: number) => Math.abs(a - b) < 1;

/** Clamp to the real month, including on wide screens and the last day. No empty future columns. */
export function scheduleTodayOffset(
  dayKey: string,
  monthKey: string,
  cellWidth: number,
  viewportWidth: number,
  contentWidth: number,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey.slice(0, 7) !== monthKey) return null;
  const day = new Date(`${dayKey}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== dayKey) return null;
  if (![cellWidth, viewportWidth, contentWidth].every(positive)) return null;
  const offset = (day.getUTCDate() - 1) * cellWidth;
  if (contentWidth + 1 < offset + cellWidth) return null;
  return Math.min(offset, Math.max(0, contentWidth - viewportWidth));
}

export type ScheduleFocusRow = { kind: 'direction' } | { kind: 'employee'; user: { id: string } };

/** Only a row present in the point-scoped response is eligible, including when the grid has an auth fallback. */
export function scheduleEmployeeOffset(
  rows: readonly ScheduleFocusRow[],
  pointUsers: unknown,
  employeeId: string,
  rowHeight: number,
  directionHeight: number,
): number | null {
  if (!Array.isArray(pointUsers) || !pointUsers.some((user) => user?.id === employeeId)) return null;
  let offset = 0;
  for (const row of rows) {
    if (row.kind === 'employee' && row.user.id === employeeId) return offset;
    offset += row.kind === 'direction' ? directionHeight : rowHeight;
  }
  return null;
}

export interface ScheduleEmployeeLayout {
  requestId: string;
  rowsKey: string;
  employeeId: string;
  y: number;
  height: number;
}

export interface ScheduleFocusLayout {
  monthKey: string;
  headerWidth: number;
  viewportWidth: number;
  contentWidth: number;
  namesViewportHeight: number;
  cellsViewportHeight: number;
  namesContentHeight: number;
  cellsContentHeight: number;
  employee: ScheduleEmployeeLayout | null;
}

export interface ScheduleFocusPlan {
  x: number | null;
  y: number | null;
  horizontalDone: boolean;
  employeeDone: boolean;
}

/** Pure readiness/once guard. Refetches and stale layout callbacks cannot reapply a consumed request. */
export function planScheduleViewportFocus(input: {
  focus: ScheduleViewportFocus | null;
  scopeKey: string;
  monthKey: string;
  isFocused: boolean;
  layout: ScheduleFocusLayout;
  calendarWidth: number;
  cellWidth: number;
  rowHeight: number;
  directionHeight: number;
  bottomPadding: number;
  rows: readonly ScheduleFocusRow[];
  rowsKey: string;
  pointUsers: unknown;
  usersReady: boolean;
  usersError: boolean;
}): ScheduleFocusPlan {
  const plan: ScheduleFocusPlan = { x: null, y: null, horizontalDone: false, employeeDone: false };
  const { focus, layout } = input;
  if (
    !focus ||
    !input.isFocused ||
    focus.scopeKey !== input.scopeKey ||
    focus.dayKey.slice(0, 7) !== input.monthKey ||
    layout.monthKey !== input.monthKey ||
    !matches(layout.headerWidth, input.calendarWidth)
  )
    return plan;

  if (!focus.horizontalDone && matches(layout.contentWidth, Math.max(input.calendarWidth, layout.viewportWidth))) {
    plan.x = scheduleTodayOffset(
      focus.dayKey,
      input.monthKey,
      input.cellWidth,
      layout.viewportWidth,
      layout.contentWidth,
    );
    plan.horizontalDone = plan.x !== null;
  }
  if ((!focus.horizontalDone && !plan.horizontalDone) || focus.employeeDone || !focus.employeeId) return plan;
  // A failed or confirmed unknown/filtered employee ends only this request; never scroll to a fallback row.
  if (!input.usersReady) {
    plan.employeeDone = input.usersError;
    return plan;
  }
  const targetY = scheduleEmployeeOffset(
    input.rows,
    input.pointUsers,
    focus.employeeId,
    input.rowHeight,
    input.directionHeight,
  );
  if (targetY === null) return { ...plan, employeeDone: true };
  const employee = layout.employee;
  const contentHeight = input.rows.reduce(
    (height, row) => height + (row.kind === 'direction' ? input.directionHeight : input.rowHeight),
    input.bottomPadding,
  );
  if (
    !employee ||
    employee.requestId !== focus.requestId ||
    employee.rowsKey !== input.rowsKey ||
    employee.employeeId !== focus.employeeId ||
    !matches(employee.y, targetY) ||
    !matches(employee.height, input.rowHeight) ||
    !positive(layout.namesViewportHeight) ||
    !positive(layout.cellsViewportHeight) ||
    !matches(layout.namesContentHeight, contentHeight) ||
    !matches(layout.cellsContentHeight, contentHeight)
  )
    return plan;
  plan.y = Math.min(
    targetY,
    Math.max(0, contentHeight - Math.max(layout.namesViewportHeight, layout.cellsViewportHeight)),
  );
  plan.employeeDone = true;
  return plan;
}
