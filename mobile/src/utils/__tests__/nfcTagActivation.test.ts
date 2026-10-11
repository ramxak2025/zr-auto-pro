import type { AttendanceNfcTag } from '../../../../shared/types';
import { runNfcTagActivation } from '../nfcTagActivation';
import { createNfcOperationLeaseController } from '../nfcOperationLease';

const token = 'a'.repeat(43);
const uri = `https://autexa.pw/nfc/attendance#v=1&token=${token}`;
const active = { id: 'tag-a', status: 'active' } as AttendanceNfcTag;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const fixture = () => ({
  tagId: 'tag-a',
  isCurrent: () => true,
  read: jest.fn(async () => uri),
  activate: jest.fn(async (_id: string, _token: string) => active),
  onActivating: jest.fn(),
});

it('recovers a previously written pending tag without retaining its original secret', async () => {
  const options = fixture();
  expect(await runNfcTagActivation(options)).toBe(active);
  expect(options.activate).toHaveBeenCalledWith('tag-a', token);
  expect(options.read).toHaveBeenCalledTimes(1);
  expect(options.onActivating).toHaveBeenCalledTimes(1);
});

it('does not dispatch activation after screen blur, even if focus returns before the read resolves', async () => {
  const options = fixture();
  const lease = createNfcOperationLeaseController();
  const read = deferred<string>();
  const operation = lease.begin(() => true);
  const result = runNfcTagActivation({ ...options, isCurrent: operation.isCurrent, read: () => read.promise });
  lease.invalidate();
  lease.begin(() => true);
  read.resolve(uri);
  expect(await result).toBeNull();
  expect(options.activate).not.toHaveBeenCalled();
  expect(options.onActivating).not.toHaveBeenCalled();
});

it('does not publish late activation success into a different session or point', async () => {
  const options = fixture();
  const activation = deferred<AttendanceNfcTag>();
  let current = true;
  const result = runNfcTagActivation({
    ...options,
    isCurrent: () => current,
    activate: async () => {
      current = false;
      return activation.promise;
    },
  });
  activation.resolve(active);
  expect(await result).toBeNull();
});

it.each(['https://example.com/', `https://autexa.pw/nfc/attendance#v=1&token=${'b'.repeat(43)}`])(
  'never activates a mismatched first-write readback',
  async (readUri) => {
    const options = fixture();
    await expect(
      runNfcTagActivation({ ...options, expectedToken: token, read: async () => readUri }),
    ).rejects.toThrow();
    expect(options.activate).not.toHaveBeenCalled();
  },
);

it('does not report activation success on server error, keeping recovery available', async () => {
  const options = fixture();
  options.activate.mockRejectedValueOnce(new Error('network timeout'));
  await expect(runNfcTagActivation(options)).rejects.toThrow('network timeout');
  expect(await runNfcTagActivation(options)).toBe(active);
});

it('rejects an unconfirmed server response', async () => {
  const options = fixture();
  options.activate.mockResolvedValue({ ...active, status: 'pending' });
  await expect(runNfcTagActivation(options)).rejects.toThrow('Сервер не подтвердил');
});
