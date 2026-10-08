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
