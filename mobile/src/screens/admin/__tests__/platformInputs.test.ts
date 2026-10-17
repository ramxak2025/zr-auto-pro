import { isPersisted } from '../../../utils/persistentCache.helpers';
import { parseReminderDays } from '../reminderSettingsValidation';
import { prepareNoteRequest } from '../noteRequest';
it('validates configurable expiry boundaries without silently dropping invalid values', () => {
  expect(parseReminderDays('7,3,1,0,3')).toEqual([7, 3, 1, 0]);
  expect(parseReminderDays('30; 0')).toEqual([30, 0]);
  for (const value of ['31', '-1', '2.5', '2 days', '1,2,3,4,5,6,7,8,9']) expect(parseReminderDays(value)).toBeNull();
});
it('retains the request UUID across uncertain note retries, and changes it for a new text', () => {
  const uuid = jest.fn().mockReturnValueOnce('uuid-1').mockReturnValueOnce('uuid-2');
  const first = prepareNoteRequest('  Договорились созвониться  ', null, uuid);
  expect(prepareNoteRequest('Договорились созвониться', first, uuid)).toBe(first);
  expect(uuid).toHaveBeenCalledTimes(1);
  expect(prepareNoteRequest('Новая договорённость', first, uuid).requestId).toBe('uuid-2');
});
it('rejects empty, oversized and NUL notes before dispatch', () => {
  for (const value of ['  ', 'x'.repeat(4001), 'a\0b'])
    expect(() => prepareNoteRequest(value, null, () => 'unused')).toThrow();
  expect(prepareNoteRequest('x'.repeat(4000), null, () => 'id').text).toHaveLength(4000);
});

it('keeps internal CRM, reminders and operator finance outside the disk persistence whitelist', () => {
  expect(isPersisted('manager')).toBe(false);
  expect(isPersisted('tenant-notes')).toBe(false);
  expect(isPersisted('owner-password')).toBe(false);
});
