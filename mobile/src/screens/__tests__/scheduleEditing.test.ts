import type { ScheduleEntry, WorkMode } from '../../../../shared/types';
import { manualSchedulePayload, validateScheduleHours, workModeDraft, workModePayload } from '../scheduleEditing';

const marked = {
  shiftStart: '14:00',
  shiftEnd: '22:00',
  actualArrival: '2026-10-05T04:10:00Z',
  lateStatus: 'late_minor',
} as ScheduleEntry;

it.each(['shift', 'late_minor', 'late_major'] as const)(
  'manual %s does not invent today arrival or send an override flag',
  (choice) => {
    const payload = manualSchedulePayload(choice, 'master', '2026-10-05', '2026-10-05', marked);
    expect(payload).not.toHaveProperty('actualArrival');
    expect(payload).not.toHaveProperty('isManualOverride');
    expect(payload.shiftStart).toBe('14:00');
    expect(payload.lateStatus).toBe(choice === 'shift' ? 'on_time' : choice);
  },
);

it.each(['dayoff', 'sick', 'absent'] as const)('manual %s carries no working status', (choice) => {
  const payload = manualSchedulePayload(choice, 'master', '2026-10-05', '2026-10-05', marked);
  expect(payload.lateStatus).toBe(null);
  expect(payload.actualArrival).toBe(null);
  expect(payload.isDayOff).toBe(choice !== 'absent');
});

it('leaves a future shift as a plan and historical arrival to the server', () => {
  expect(manualSchedulePayload('shift', 'master', '2026-10-07', '2026-10-05')).toMatchObject({
    lateStatus: null,
    actualArrival: null,
  });
  expect(manualSchedulePayload('late_major', 'master', '2026-10-04', '2026-10-05')).not.toHaveProperty('actualArrival');
});

it('creates a weekly mode with all seven canonical weekdays by default', () => {
  const draft = workModeDraft();
  draft.name = 'Неделя';
  expect(workModePayload(draft)).toMatchObject({
    name: 'Неделя',
    type: 'weekly',
    weekDays: [1, 2, 3, 4, 5, 6, 0],
    dayTimes: {},
  });
});

it('preserves a legacy rotating mode and its empty weekday semantics while changing hours', () => {
  const mode: WorkMode = {
    id: 'mode',
    tenantId: 'tenant',
    name: 'Старый',
    type: 'rotating',
    workDays: 3,
    offDays: 2,
    weekDays: [],
    shiftStart: '09:00',
    shiftEnd: '18:00',
  };
  const draft = workModeDraft(mode);
  draft.shiftStart = '14:00';
  expect(workModePayload(draft, mode)).toMatchObject({
    type: 'rotating',
    workDays: 3,
    offDays: 2,
    weekDays: [],
    shiftStart: '14:00',
  });
});

it('renames a legacy weekly mode with empty weekdays as the equivalent explicit seven-day week', () => {
  const mode: WorkMode = {
    id: 'mode',
    tenantId: 'tenant',
    name: 'Старый',
    type: 'weekly',
    workDays: 2,
    offDays: 2,
    weekDays: [],
    shiftStart: '09:00',
    shiftEnd: '18:00',
  };
  const draft = workModeDraft(mode);
  draft.name = 'Новое имя';
  expect(workModePayload(draft, mode)).toMatchObject({
    name: 'Новое имя',
    type: 'weekly',
    weekDays: [1, 2, 3, 4, 5, 6, 0],
  });
});

it('validates strict clock pairs without banning overnight plans', () => {
  expect(validateScheduleHours({ shiftStart: '22:00', shiftEnd: '06:00' })).toBe(null);
  expect(validateScheduleHours({ shiftStart: '14:00', shiftEnd: '24:00' })).not.toBe(null);
});
