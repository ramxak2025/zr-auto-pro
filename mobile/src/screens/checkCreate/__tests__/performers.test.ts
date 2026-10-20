import { UserRole } from '../../../../../shared/types';
import { defaultConfirmedPerformers, explicitlyAssignedPerformers, performerPayload } from '../performers';

it('shows self for a positively resolved noncashier master, including a custom master role', () => {
  expect(defaultConfirmedPerformers({ id: 'self', role: UserRole.MASTER }, false)).toEqual(['self']);
});
it.each([UserRole.MASTER, UserRole.ADMIN, UserRole.DIRECTOR, UserRole.SUPERADMIN])(
  'cashier %s never earns merely for authorship/payment',
  (role) => {
    expect(defaultConfirmedPerformers({ id: 'actor', role }, true)).toEqual([]);
  },
);
it('unknown capability and owner/admin stay unassigned; a real booking performer is retained', () => {
  expect(defaultConfirmedPerformers({ id: 'master', role: UserRole.MASTER }, undefined)).toEqual([]);
  expect(defaultConfirmedPerformers({ id: 'admin', role: UserRole.ADMIN }, false)).toEqual([]);
  expect(defaultConfirmedPerformers({ id: 'admin', role: UserRole.ADMIN }, true, 'booking-master')).toEqual([
    'booking-master',
  ]);
});
it('creates always send an explicit list, including empty; untouched edits preserve provenance', () => {
  expect(performerPayload(false, false, [])).toEqual({ assigneeIds: [] });
  expect(performerPayload(false, false, ['self'])).toEqual({ assigneeIds: ['self'] });
  expect(performerPayload(true, false, ['legacy-cashier'])).toEqual({});
  expect(performerPayload(true, true, [])).toEqual({ assigneeIds: [] });
  expect(performerPayload(true, true, ['a', 'a', 'b'])).toEqual({ assigneeIds: ['a', 'b'] });
});
it('combines manual performers without duplicating a master and without guessing an administrator', () => {
  expect(explicitlyAssignedPerformers(undefined, ['a', 'a', 'b'])).toEqual(['a', 'b']);
  expect(explicitlyAssignedPerformers('booking', ['a'])).toEqual(['booking', 'a']);
  expect(explicitlyAssignedPerformers('self', [])).toEqual(['self']);
});
