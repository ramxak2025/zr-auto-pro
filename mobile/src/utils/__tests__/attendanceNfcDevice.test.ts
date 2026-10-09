jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const mockExpectedUri = `https://autexa-cloud.ru/nfc/attendance#v=1&token=${'a'.repeat(43)}`;

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: jest.fn(async () => undefined),
    isSupported: jest.fn(async () => true),
    isEnabled: jest.fn(async () => true),
    requestTechnology: jest.fn(async () => undefined),
    getTag: jest.fn(async () => ({ ndefMessage: [{ type: 'cached-ndef' }] })),
    writeNdefMessage: jest.fn(async () => undefined),
    cancelTechnologyRequest: jest.fn(async () => undefined),
    ndefHandler: {
      getNdefMessage: jest.fn(async () => ({ ndefMessage: [] })),
      getNdefStatus: jest.fn(async () => ({ status: 2, capacity: 128 })),
    },
  },
  Ndef: {
    TNF_WELL_KNOWN: 1,
    RTD_URI: 'U',
    isType: (record: { type: string }, _tnf: number, type: string) => record.type === type,
    uriRecord: (uri: string) => ({
      type: 'U',
      payload: Array.from(uri, (char) => char.charCodeAt(0)),
    }),
    encodeMessage: () => [1, 2, 3],
    uri: {
      decodePayload: (payload: Uint8Array) =>
        Array.from(payload)
          .map((byte) => String.fromCharCode(byte))
          .join(''),
    },
  },
  NdefStatus: { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 },
  NfcTech: { Ndef: 'Ndef' },
}));

import { createAttendanceNfcOperation, writeAttendanceNfcUriAndReadBack } from '../attendanceNfcDevice';

const mockNfc = jest.requireMock('react-native-nfc-manager').default as {
  start: jest.Mock;
  isSupported: jest.Mock;
  isEnabled: jest.Mock;
  requestTechnology: jest.Mock;
  getTag: jest.Mock;
  writeNdefMessage: jest.Mock;
  cancelTechnologyRequest: jest.Mock;
  ndefHandler: { getNdefMessage: jest.Mock; getNdefStatus: jest.Mock };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNfc.ndefHandler.getNdefMessage.mockReset().mockResolvedValue({ ndefMessage: [] });
  mockNfc.ndefHandler.getNdefStatus.mockResolvedValue({ status: 2, capacity: 128 });
});

it('writes and freshly reads back on the active connection before native cancellation', async () => {
  const lifecycle: string[] = [];
  mockNfc.ndefHandler.getNdefMessage.mockImplementation(async () => {
    lifecycle.push('read');
    return {
      ndefMessage:
        lifecycle.filter((step) => step === 'read').length === 1
          ? []
          : [{ type: 'U', payload: Array.from(mockExpectedUri, (char) => char.charCodeAt(0)) }],
    };
  });
  mockNfc.writeNdefMessage.mockImplementation(async () => {
    lifecycle.push('write');
  });
  mockNfc.cancelTechnologyRequest.mockImplementation(async () => {
    lifecycle.push('cancel');
  });

  const result = await writeAttendanceNfcUriAndReadBack(
    createAttendanceNfcOperation(() => true),
    mockExpectedUri,
  );

  expect(result).toBe(mockExpectedUri);
  expect(mockNfc.getTag).not.toHaveBeenCalled();
  expect(mockNfc.writeNdefMessage).toHaveBeenCalledTimes(1);
  expect(lifecycle).toEqual(['read', 'write', 'read', 'cancel']);
});

it('verifies an already-written pending tag on retry without writing it again', async () => {
  mockNfc.ndefHandler.getNdefMessage.mockResolvedValue({
    ndefMessage: [{ type: 'U', payload: Array.from(mockExpectedUri, (char) => char.charCodeAt(0)) }],
  });

  const result = await writeAttendanceNfcUriAndReadBack(
    createAttendanceNfcOperation(() => true),
    mockExpectedUri,
  );

  expect(result).toBe(mockExpectedUri);
  expect(mockNfc.writeNdefMessage).not.toHaveBeenCalled();
  expect(mockNfc.ndefHandler.getNdefMessage).toHaveBeenCalledTimes(1);
});
