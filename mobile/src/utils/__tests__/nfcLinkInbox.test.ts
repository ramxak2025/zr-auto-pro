import {
  clearPendingAttendanceLink,
  setPendingAttendanceLink,
  takePendingAttendanceLink,
  subscribePendingAttendanceLink,
} from '../nfcLinkInbox';

describe('in-memory NFC link handoff', () => {
  afterEach(clearPendingAttendanceLink);

  it('returns a link once and only to the auth session that received it', () => {
    const token = 'a'.repeat(43);
    setPendingAttendanceLink(token, 'session-a', 'tenant:user:point-a');

    expect(takePendingAttendanceLink('session-b', 'tenant:user:point-a')).toBeNull();
    expect(takePendingAttendanceLink('session-a', 'tenant:user:point-b')).toBeNull();
    expect(takePendingAttendanceLink('session-a', 'tenant:user:point-a')).toBeNull();
  });

  it('does not retain a consumed link for a later navigation', () => {
    const token = 'b'.repeat(43);
    setPendingAttendanceLink(token, 'session-a', 'tenant:user:point-a');

    expect(takePendingAttendanceLink('session-a', 'tenant:user:point-a')).toBe(token);
    expect(takePendingAttendanceLink('session-a', 'tenant:user:point-a')).toBeNull();
  });

  it('delivers a warm link to an already focused screen without exposing it in route state', () => {
    const token = 'c'.repeat(43);
    const consume = jest.fn();
    const unsubscribe = subscribePendingAttendanceLink(consume);
    setPendingAttendanceLink(token, 'session-a', 'tenant:user:point-a');

    expect(consume).toHaveBeenCalledWith(token, 'session-a', 'tenant:user:point-a');
    expect(takePendingAttendanceLink('session-a', 'tenant:user:point-a')).toBe(token);
    unsubscribe();
  });
});
