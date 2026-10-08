import { runNfcCreateTagOperation } from '../nfcCreateTagOperation';
import { refreshNfcStatusForCurrentSession } from '../nfcStatusRefresh';
import { createNfcSessionRefresh } from '../nfcSessionRefresh';

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

describe('NFC screen handler lifecycles', () => {
  it('does not adopt an old create response or let its finally clear a newer attempt after blur/refocus', async () => {
    let focused = true;
    let generation = 1;
    let creating = true;
    const first = deferred();
    const displayed = [];
    const firstLease = { generation, isCurrent: () => focused && generation === 1 };
    const oldHandler = runNfcCreateTagOperation({
      request: () => first.promise,
      isCurrent: firstLease.isCurrent,
      onSuccess: (value) => displayed.push(value),
      onError: () => undefined,
      onFinally: () => (creating = false),
    });

    focused = false;
    generation += 1;
    focused = true;
    const secondLease = { generation, isCurrent: () => focused && generation === 2 };
    const second = deferred();
    const newHandler = runNfcCreateTagOperation({
      request: () => second.promise,
      isCurrent: secondLease.isCurrent,
      onSuccess: (value) => displayed.push(value),
      onError: () => undefined,
      onFinally: () => (creating = false),
    });

    first.resolve('stale-token');
    await oldHandler;
    expect(displayed).toEqual([]);
    expect(creating).toBe(true);

    second.resolve('current-token');
    await newHandler;
    expect(displayed).toEqual(['current-token']);
    expect(creating).toBe(false);
  });

  it('refreshes the captured session status sources and never sends an attendance mutation', async () => {
    const getMy = jest.fn().mockResolvedValue({ data: [{ id: 'shift-1' }] });
    const nfcStatus = jest.fn().mockResolvedValue({ data: { canScan: true } });
    const send = jest.fn();
    const setQueryData = jest.fn();
    const statusKey = ['shifts', 'nfc-status', 7];
    const session = {
      refreshCurrent: createNfcSessionRefresh(
        { getMy, nfcStatus, scanNfc: send },
        { setQueryData },
        () => true,
        statusKey,
      ),
    };
    const clearWarning = jest.fn();
    await refreshNfcStatusForCurrentSession(
      session,
      () => true,
      clearWarning,
      () => undefined,
    );
    expect(getMy).toHaveBeenCalledTimes(1);
    expect(nfcStatus).toHaveBeenCalledTimes(1);
    expect(setQueryData).toHaveBeenCalledWith(['shifts', 'my'], [{ id: 'shift-1' }]);
    expect(setQueryData).toHaveBeenCalledWith(statusKey, { canScan: true });
    expect(clearWarning).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
