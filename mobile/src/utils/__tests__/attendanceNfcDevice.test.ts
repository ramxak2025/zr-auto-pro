jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(async () => undefined),
    isSupported: jest.fn(async () => true),
    isEnabled: jest.fn(async () => true),
    requestTechnology: jest.fn(async () => undefined),
    getTag: jest.fn(async () => ({ id: '04112233445566' })),
    writeNdefMessage: jest.fn(async () => undefined),
    cancelTechnologyRequest: jest.fn(async () => undefined),
    invalidateSessionWithErrorIOS: jest.fn(async () => undefined),
    setAlertMessageIOS: jest.fn(async () => undefined),
    ndefHandler: {
      getNdefMessage: jest.fn(),
      getNdefStatus: jest.fn(),
    },
  },
  // Use the installed SDK's real codec and empty-message error classes.
  Ndef: jest.requireActual('react-native-nfc-manager/dist/ndef-lib'),
  NfcError: jest.requireActual('react-native-nfc-manager/dist/src/NfcError'),
  NdefStatus: { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 },
  NfcTech: { Ndef: 'Ndef' },
}));

import NfcManager, { Ndef, NfcError, NdefStatus, NfcTech } from 'react-native-nfc-manager';
import type { NdefRecord } from 'react-native-nfc-manager';
import { Platform } from 'react-native';
import {
  createAttendanceNfcOperation,
  writeAttendanceNfcUriAndReadBack,
  readAttendanceNfcUri,
  AttendanceNfcDeviceError,
} from '../attendanceNfcDevice';

const mockNfc = jest.mocked(NfcManager);
const expectedUri = `https://autexa.pw/nfc/attendance#v=1&token=${'a'.repeat(43)}`;
const readBack = { ndefMessage: [Ndef.uriRecord(expectedUri)] };
const write = () =>
  writeAttendanceNfcUriAndReadBack(
    createAttendanceNfcOperation(() => true),
    expectedUri,
  );

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockNfc.requestTechnology.mockReset().mockResolvedValue(NfcTech.Ndef);
  mockNfc.writeNdefMessage.mockReset().mockResolvedValue(undefined);
  mockNfc.getTag.mockReset().mockResolvedValue({ id: '04112233445566' });
  mockNfc.ndefHandler.getNdefMessage.mockReset().mockResolvedValue(readBack);
  mockNfc.ndefHandler.getNdefStatus.mockReset().mockResolvedValue({ status: NdefStatus.ReadWrite, capacity: 504 });
});

it('writes and freshly reads back on the active connection before native cancellation', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValueOnce({ ndefMessage: [] });
  expect(await write()).toBe(expectedUri);
  expect(mockNfc.writeNdefMessage).toHaveBeenCalledWith(Ndef.encodeMessage(readBack.ndefMessage));
  expect(mockNfc.ndefHandler.getNdefMessage).toHaveBeenCalledTimes(2);
  expect(mockNfc.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  expect(mockNfc.invalidateSessionWithErrorIOS).not.toHaveBeenCalled();
  expect(mockNfc.ndefHandler.getNdefMessage.mock.invocationCallOrder[1]).toBeLessThan(
    mockNfc.cancelTechnologyRequest.mock.invocationCallOrder[0],
  );
});

it('verifies an already-written pending tag on retry without writing it again', async () => {
  expect(await write()).toBe(expectedUri);
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
  expect(mockNfc.ndefHandler.getNdefMessage).toHaveBeenCalledTimes(1);
});

it('checks NDEF capabilities before reading an empty tag', async () => {
  await write();
  expect(mockNfc.ndefHandler.getNdefStatus.mock.invocationCallOrder[0]).toBeLessThan(
    mockNfc.ndefHandler.getNdefMessage.mock.invocationCallOrder[0],
  );
});

it('writes a writable NTAG215 whose initial read throws the actual iOS ZeroLengthMessage', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockRejectedValueOnce(new NfcError.ZeroLengthMessage());
  expect(await write()).toBe(expectedUri);
  expect(mockNfc.writeNdefMessage).toHaveBeenCalledTimes(1);
  expect(Ndef.encodeMessage(readBack.ndefMessage).length).toBeLessThan(504);
});

it('recognizes a valid TNF_EMPTY record as blank', async () => {
  const empty: NdefRecord = { tnf: 0, type: [], id: [], payload: [] };
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValueOnce({ ndefMessage: [empty] });
  expect(await write()).toBe(expectedUri);
  expect(mockNfc.writeNdefMessage).toHaveBeenCalledTimes(1);
});

it.each([
  [Ndef.textRecord('Factory NFC tag')],
  [Ndef.uriRecord('https://example.com/')],
  [{ tnf: 0, type: [], id: [], payload: [1] }],
])('protects existing or malformed content instead of calling it unsupported: %p', async (...records) => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValue({ ndefMessage: records as NdefRecord[] });
  await expect(write()).rejects.toMatchObject({ code: 'tag-not-empty' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('never treats an unknown read failure as blank or ends it with a successful iOS sheet', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockRejectedValueOnce(new Error('native read failure'));
  await expect(write()).rejects.toMatchObject({ code: 'read-failed' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
  expect(mockNfc.invalidateSessionWithErrorIOS).toHaveBeenCalledTimes(1);
  expect(mockNfc.cancelTechnologyRequest).not.toHaveBeenCalled();
});

it.each([
  [new NfcError.UserCancel(), 'cancelled'],
  [new NfcError.TagConnectionLost(), 'connection-lost'],
  [new NfcError.Timeout(), 'timeout'],
])('preserves typed SDK failures whose message is empty: %p', async (error, code) => {
  mockNfc.requestTechnology.mockRejectedValueOnce(error);
  await expect(write()).rejects.toMatchObject({ code });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it.each([
  [NdefStatus.NotSupported, 'not-ndef'],
  [NdefStatus.ReadOnly, 'read-only'],
])('rejects a non-writable NDEF status before reading or writing: %s', async (status, code) => {
  mockNfc.ndefHandler.getNdefStatus.mockResolvedValue({ status, capacity: 504 });
  await expect(write()).rejects.toMatchObject({ code });
  expect(mockNfc.ndefHandler.getNdefMessage).not.toHaveBeenCalled();
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('checks the actual encoded size against capacity', async () => {
  mockNfc.ndefHandler.getNdefStatus.mockResolvedValue({ status: NdefStatus.ReadWrite, capacity: 8 });
  await expect(write()).rejects.toMatchObject({ code: 'tag-too-small' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('rejects mismatched read-back instead of finishing with a success sheet', async () => {
  mockNfc.ndefHandler.getNdefMessage
    .mockResolvedValueOnce({ ndefMessage: [] })
    .mockResolvedValueOnce({ ndefMessage: [Ndef.uriRecord('https://example.com/')] });
  await expect(write()).rejects.toMatchObject({ code: 'verification-failed' });
  expect(mockNfc.invalidateSessionWithErrorIOS).toHaveBeenCalledTimes(1);
  expect(mockNfc.cancelTechnologyRequest).not.toHaveBeenCalled();
});

it('does not accept zero-length read-back as successful verification', async () => {
  mockNfc.ndefHandler.getNdefMessage
    .mockResolvedValueOnce({ ndefMessage: [] })
    .mockRejectedValueOnce(new NfcError.ZeroLengthMessage());
  await expect(write()).rejects.toMatchObject({ code: 'read-failed' });
});

const existing = { ndefMessage: [Ndef.textRecord('Owner data')] };
async function inspectFilledTag() {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValue(existing);
  try {
    await write();
  } catch (error) {
    if (error instanceof AttendanceNfcDeviceError && error.replacement) return error.replacement;
    throw error;
  }
  throw new Error('Expected the existing data to be protected');
}

it('replaces data only after explicit consent and a fresh matching UID and content read', async () => {
  const replacement = await inspectFilledTag();
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValueOnce(existing).mockResolvedValueOnce(readBack);
  expect(
    await writeAttendanceNfcUriAndReadBack(
      createAttendanceNfcOperation(() => true),
      expectedUri,
      { replacement },
    ),
  ).toBe(expectedUri);
  expect(mockNfc.writeNdefMessage).toHaveBeenCalledTimes(1);
});

it.each(['different UID', 'changed content', 'blank other tag'])('does not apply consent to %s', async (change) => {
  const replacement = await inspectFilledTag();
  if (change === 'different UID') mockNfc.getTag.mockResolvedValue({ id: '04FFFFFFFFFFFF' });
  if (change === 'changed content')
    mockNfc.ndefHandler.getNdefMessage.mockResolvedValue({ ndefMessage: [Ndef.textRecord('New data')] });
  if (change === 'blank other tag') mockNfc.ndefHandler.getNdefMessage.mockResolvedValue({ ndefMessage: [] });
  await expect(
    writeAttendanceNfcUriAndReadBack(
      createAttendanceNfcOperation(() => true),
      expectedUri,
      { replacement },
    ),
  ).rejects.toMatchObject({ code: 'tag-changed' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('does not grant replacement permission if the physical UID is unavailable', async () => {
  mockNfc.getTag.mockResolvedValue({});
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValue(existing);
  await expect(write()).rejects.toMatchObject({ code: 'tag-not-empty', replacement: undefined });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it.each([null, {}])('fails closed on a missing NDEF response: %p', async (result) => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValueOnce(result);
  await expect(write()).rejects.toMatchObject({ code: 'read-failed' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('does not write after a lease is invalidated while capabilities are being queried', async () => {
  let current = true;
  mockNfc.ndefHandler.getNdefStatus.mockImplementationOnce(async () => {
    current = false;
    return { status: NdefStatus.ReadWrite, capacity: 504 };
  });
  await expect(
    writeAttendanceNfcUriAndReadBack(
      createAttendanceNfcOperation(() => current),
      expectedUri,
    ),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
  expect(mockNfc.cancelTechnologyRequest).not.toHaveBeenCalled();
});

it('returns a concrete native write error without reclassifying it as a read failure', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValueOnce({ ndefMessage: [] });
  mockNfc.writeNdefMessage.mockRejectedValueOnce(new NfcError.TagNotWritable());
  await expect(write()).rejects.toMatchObject({ code: 'read-only' });
});

it('reads recovery tags freshly without trusting the discovered/cached message', async () => {
  mockNfc.getTag.mockResolvedValue({ id: '04112233445566', ndefMessage: [] });
  expect(await readAttendanceNfcUri(createAttendanceNfcOperation(() => true))).toBe(expectedUri);
  expect(mockNfc.getTag).not.toHaveBeenCalled();
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
});

it('rejects a non-Autexa URI during the native read, before a success sheet', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValue({ ndefMessage: [Ndef.uriRecord('https://example.com/')] });
  await expect(readAttendanceNfcUri(createAttendanceNfcOperation(() => true))).rejects.toMatchObject({
    code: 'invalid-content',
  });
  expect(mockNfc.invalidateSessionWithErrorIOS).toHaveBeenCalledTimes(1);
  expect(mockNfc.cancelTechnologyRequest).not.toHaveBeenCalled();
});

it('uses normal Android cleanup without calling iOS session APIs on failure', async () => {
  Platform.OS = 'android';
  mockNfc.ndefHandler.getNdefMessage.mockRejectedValueOnce(new Error('read failed'));
  await expect(write()).rejects.toMatchObject({ code: 'read-failed' });
  expect(mockNfc.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
  expect(mockNfc.invalidateSessionWithErrorIOS).not.toHaveBeenCalled();
  expect(mockNfc.setAlertMessageIOS).not.toHaveBeenCalled();
});
