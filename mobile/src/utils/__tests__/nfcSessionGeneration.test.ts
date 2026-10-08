import { captureNfcSessionGeneration } from '../nfcSessionGeneration';

describe('NFC session generations', () => {
  it('does not revive an old lease when identity returns after A → B → A', () => {
    const oldSession = captureNfcSessionGeneration('A');
    captureNfcSessionGeneration('B');
    const currentSession = captureNfcSessionGeneration('A');

    expect(oldSession.isCurrent()).toBe(false);
    expect(currentSession.isCurrent()).toBe(true);
    expect(currentSession.id).not.toBe(oldSession.id);
  });
});

it('synchronous auth boundary invalidates NFC lease even when React batches A→B→A into one render', () => {
  const { setDataSession } = jest.requireActual(
    '../../contexts/dataSession',
  ) as typeof import('../../contexts/dataSession');
  const a = { tenantId: 'a', userId: 'a', pointId: 'a' };
  setDataSession(a);
  const old = captureNfcSessionGeneration('same-JWT');
  setDataSession({ tenantId: 'b', userId: 'b', pointId: 'b' });
  setDataSession(a);
  const current = captureNfcSessionGeneration('same-JWT');
  expect(old.isCurrent()).toBe(false);
  expect(current.isCurrent()).toBe(true);
  expect(current.id).not.toBe(old.id);
});
