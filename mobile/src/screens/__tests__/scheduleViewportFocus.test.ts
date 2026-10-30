import { formatDayKey } from '../../../../shared/utils/formatters';
import {
  completeScheduleViewportFocus,
  createScheduleViewportFocus,
  planScheduleViewportFocus,
  readScheduleFocusParams,
  scheduleEmployeeOffset,
  scheduleTodayOffset,
  type ScheduleFocusLayout,
  type ScheduleFocusRow,
} from '../scheduleViewportFocus';

describe('Schedule Today offset', () => {
  it.each([
    ['2026-10-01', 0],
    ['2026-10-15', 14 * 44],
    ['2026-10-30', 31 * 44 - 250],
    ['2026-10-31', 31 * 44 - 250],
  ])('keeps %s visible within the measured month', (day, offset) => {
    expect(scheduleTodayOffset(day, '2026-10', 44, 250, 31 * 44)).toBe(offset);
  });

  it('handles leap February and rejects an impossible date', () => {
    expect(scheduleTodayOffset('2028-02-29', '2028-02', 44, 250, 29 * 44)).toBe(29 * 44 - 250);
    expect(scheduleTodayOffset('2027-02-29', '2027-02', 44, 250, 28 * 44)).toBeNull();
  });

  it('uses the tenant day at a UTC month boundary', () => {
    const day = formatDayKey(new Date('2026-10-31T22:30:00Z'), 'Europe/Moscow');
    expect(day).toBe('2026-11-01');
    expect(scheduleTodayOffset(day, '2026-11', 44, 250, 30 * 44)).toBe(0);
  });

  it('clamps for different viewport widths without adding empty days', () => {
    expect(scheduleTodayOffset('2026-10-31', '2026-10', 44, 44, 31 * 44)).toBe(30 * 44);
    expect(scheduleTodayOffset('2026-10-31', '2026-10', 44, 700, 31 * 44)).toBe(31 * 44 - 700);
    expect(scheduleTodayOffset('2026-10-31', '2026-10', 44, 1600, 1600)).toBe(0);
  });

  it('waits for usable measurements and the requested month', () => {
    expect(scheduleTodayOffset('2026-10-30', '2026-09', 44, 250, 31 * 44)).toBeNull();
    expect(scheduleTodayOffset('2026-10-30', '2026-10', 44, 0, 31 * 44)).toBeNull();
    expect(scheduleTodayOffset('2026-10-30', '2026-10', 44, 250, 100)).toBeNull();
    expect(scheduleTodayOffset('2026-10-30', '2026-10', 44, NaN, 31 * 44)).toBeNull();
  });
});

const rows: ScheduleFocusRow[] = [
  { kind: 'direction' },
  { kind: 'employee', user: { id: 'a' } },
  { kind: 'employee', user: { id: 'b' } },
  { kind: 'direction' },
  { kind: 'employee', user: { id: 'c' } },
  { kind: 'employee', user: { id: 'd' } },
];
const pointUsers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'hidden' }];
const focus = createScheduleViewportFocus('entry-1', 'point-1', '2026-10-30', 'c');
const layout: ScheduleFocusLayout = {
  monthKey: '2026-10',
  headerWidth: 31 * 44,
  viewportWidth: 250,
  contentWidth: 31 * 44,
  namesViewportHeight: 140,
  cellsViewportHeight: 140,
  namesContentHeight: 4 * 52 + 2 * 30 + 80,
  cellsContentHeight: 4 * 52 + 2 * 30 + 80,
  employee: { requestId: 'entry-1', rowsKey: 'rows-1', employeeId: 'c', y: 164, height: 52 },
};
const input = {
  focus,
  scopeKey: 'point-1',
  monthKey: '2026-10',
  isFocused: true,
  layout,
  calendarWidth: 31 * 44,
  cellWidth: 44,
  rowHeight: 52,
  directionHeight: 30,
  bottomPadding: 80,
  rows,
  rowsKey: 'rows-1',
  pointUsers,
  usersReady: true,
  usersError: false,
};
const noMove = { x: null, y: null, horizontalDone: false, employeeDone: false };

describe('Schedule entry focus lifecycle', () => {
  it('scrolls both axes once, accounting for direction headings', () => {
    const plan = planScheduleViewportFocus(input);
    expect(plan).toEqual({ x: 1114, y: 164, horizontalDone: true, employeeDone: true });
    const consumed = completeScheduleViewportFocus(focus, focus.requestId, plan.horizontalDone, plan.employeeDone);
    expect(planScheduleViewportFocus({ ...input, focus: consumed })).toEqual(noMove);
    // A background refresh can reorder or replace data without stealing the viewport.
    expect(planScheduleViewportFocus({ ...input, focus: consumed, rows: [...rows].reverse() })).toEqual(noMove);
  });

  it('focuses Today for a direct entry without moving vertically', () => {
    expect(
      planScheduleViewportFocus({ ...input, focus: createScheduleViewportFocus('direct', 'point-1', '2026-10-30') }),
    ).toEqual({ x: 1114, y: null, horizontalDone: true, employeeDone: false });
  });

  it('waits for actual current-month layout, width and viewport', () => {
    expect(planScheduleViewportFocus({ ...input, layout: { ...layout, monthKey: '2026-09' } })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, layout: { ...layout, headerWidth: 30 * 44 } })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, layout: { ...layout, viewportWidth: 0 } })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, layout: { ...layout, contentWidth: 30 * 44 } })).toEqual(noMove);
  });

  it('can finish horizontal focus while point data is loading, then focus the measured employee', () => {
    const loading = planScheduleViewportFocus({ ...input, pointUsers: undefined, usersReady: false });
    expect(loading).toEqual({ x: 1114, y: null, horizontalDone: true, employeeDone: false });
    const partial = completeScheduleViewportFocus(focus, focus.requestId, true, false);
    expect(planScheduleViewportFocus({ ...input, focus: partial, layout: { ...layout, employee: null } })).toEqual(
      noMove,
    );
    expect(planScheduleViewportFocus({ ...input, focus: partial })).toEqual({
      x: null,
      y: 164,
      horizontalDone: false,
      employeeDone: true,
    });
  });

  it('waits for both vertical viewports and both current content heights', () => {
    for (const patch of [
      { namesViewportHeight: 0 },
      { cellsViewportHeight: 0 },
      { namesContentHeight: layout.namesContentHeight - 52 },
      { cellsContentHeight: layout.cellsContentHeight - 52 },
    ]) {
      expect(planScheduleViewportFocus({ ...input, layout: { ...layout, ...patch } }).y).toBeNull();
    }
  });

  it('clamps the same employee offset for both vertical views', () => {
    expect(
      planScheduleViewportFocus({ ...input, layout: { ...layout, namesViewportHeight: 250, cellsViewportHeight: 248 } })
        .y,
    ).toBe(layout.namesContentHeight - 250);
  });

  it('a new home request works on an already mounted route and rejects old row measurements/completions', () => {
    const next = createScheduleViewportFocus('entry-2', 'point-1', '2026-10-30', 'c');
    expect(planScheduleViewportFocus({ ...input, focus: next }).y).toBeNull();
    expect(completeScheduleViewportFocus(next, 'entry-1', true, true)).toBe(next);
    expect(
      planScheduleViewportFocus({
        ...input,
        focus: next,
        layout: { ...layout, employee: { ...layout.employee!, requestId: 'entry-2' } },
      }).y,
    ).toBe(164);
  });

  it('does not move after user paging/cancellation, offscreen, or after a point/account change', () => {
    expect(planScheduleViewportFocus({ ...input, monthKey: '2026-09' })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, focus: null })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, isFocused: false })).toEqual(noMove);
    expect(planScheduleViewportFocus({ ...input, scopeKey: 'point-2' })).toEqual(noMove);
  });

  it('discards a stale roster layout before a pending employee focus', () => {
    expect(planScheduleViewportFocus({ ...input, rowsKey: 'rows-2' }).y).toBeNull();
    expect(
      planScheduleViewportFocus({ ...input, layout: { ...layout, employee: { ...layout.employee!, y: 112 } } }).y,
    ).toBeNull();
  });

  it.each(['other-point', 'hidden'])('resolves %s without scrolling to a fallback employee', (employeeId) => {
    const request = createScheduleViewportFocus('unknown', 'point-1', '2026-10-30', employeeId);
    expect(planScheduleViewportFocus({ ...input, focus: request })).toEqual({
      x: 1114,
      y: null,
      horizontalDone: true,
      employeeDone: true,
    });
  });

  it('does not retry employee focus on a later background refresh after a failed users load', () => {
    const failed = planScheduleViewportFocus({ ...input, usersReady: false, usersError: true });
    const consumed = completeScheduleViewportFocus(focus, focus.requestId, failed.horizontalDone, failed.employeeDone);
    expect(planScheduleViewportFocus({ ...input, focus: consumed })).toEqual(noMove);
  });
});

describe('point-scoped employee position and route metadata', () => {
  it('counts direction headings and requires membership in the point response and visible rows', () => {
    expect(scheduleEmployeeOffset(rows, pointUsers, 'a', 52, 30)).toBe(30);
    expect(scheduleEmployeeOffset(rows, pointUsers, 'c', 52, 30)).toBe(164);
    expect(scheduleEmployeeOffset(rows, [{ id: 'a' }], 'c', 52, 30)).toBeNull();
    expect(scheduleEmployeeOffset(rows, pointUsers, 'hidden', 52, 30)).toBeNull();
    expect(scheduleEmployeeOffset(rows, { data: pointUsers }, 'c', 52, 30)).toBeNull();
  });

  it('accepts only a Today request with a unique string ID, ignoring passed dates', () => {
    expect(
      readScheduleFocusParams({
        focusToday: true,
        focusRequestId: 'click-1',
        focusEmployeeId: 'c',
        date: '2040-01-01',
      }),
    ).toEqual({ focusToday: true, focusRequestId: 'click-1', focusEmployeeId: 'c' });
    expect(readScheduleFocusParams({ focusToday: true, focusRequestId: 'click-2', focusEmployeeId: [] })).toEqual({
      focusToday: true,
      focusRequestId: 'click-2',
    });
    for (const value of [
      undefined,
      [],
      { focusToday: 'true', focusRequestId: 'id' },
      { focusToday: true },
      { focusToday: true, focusRequestId: ' ' },
    ]) {
      expect(readScheduleFocusParams(value)).toBeNull();
    }
  });
});
