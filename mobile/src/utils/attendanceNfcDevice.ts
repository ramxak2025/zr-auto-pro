import NfcManager, { Ndef, NdefStatus, NfcTech } from 'react-native-nfc-manager';
import type { NdefRecord } from 'react-native-nfc-manager';
import { createNfcNativeOperationQueue } from './nfcNativeOperationQueue';

export type NfcHardwareState = 'ready' | 'unsupported' | 'disabled';
export type NfcDeviceErrorCode =
  | 'cancelled'
  | 'unsupported'
  | 'disabled'
  | 'not-ndef'
  | 'read-only'
  | 'read-failed'
  | 'write-failed';

export class AttendanceNfcDeviceError extends Error {
  constructor(readonly code: NfcDeviceErrorCode) {
    super(code);
    this.name = 'AttendanceNfcDeviceError';
  }
}

export type AttendanceNfcOperation = { id: number; isCurrent: () => boolean };
let nextOperationId = 1;
const nativeOperations = createNfcNativeOperationQueue(() =>
  NfcManager.cancelTechnologyRequest({ throwOnError: false }),
);

export function createAttendanceNfcOperation(isCurrent: () => boolean): AttendanceNfcOperation {
  return { id: nextOperationId++, isCurrent };
}

export async function cancelAttendanceNfcOperation(operation: AttendanceNfcOperation): Promise<void> {
  await nativeOperations.cancel(operation.id);
}

function assertOperation(operation: AttendanceNfcOperation): void {
  if (!operation.isCurrent()) throw new AttendanceNfcDeviceError('cancelled');
}

async function withExclusiveOperation<T>(operation: AttendanceNfcOperation, task: () => Promise<T>): Promise<T> {
  return nativeOperations.run(operation.id, operation.isCurrent, async () => {
    assertOperation(operation);
    return task();
  });
}

export async function checkAttendanceNfcHardware(operation?: AttendanceNfcOperation): Promise<NfcHardwareState> {
  if (operation) assertOperation(operation);
  await NfcManager.start();
  if (operation) assertOperation(operation);
  const supported = await NfcManager.isSupported(NfcTech.Ndef);
  if (operation) assertOperation(operation);
  if (!supported) return 'unsupported';
  const enabled = await NfcManager.isEnabled();
  if (operation) assertOperation(operation);
  if (!enabled) return 'disabled';
  return 'ready';
}

function decodeAttendanceUri(records: NdefRecord[] | undefined): string {
  const record = records?.find((candidate) => Ndef.isType(candidate, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI));
  if (!record) throw new AttendanceNfcDeviceError('not-ndef');
  try {
    const uri = Ndef.uri.decodePayload(new Uint8Array(record.payload));
    if (!uri) throw new Error('empty');
    return uri;
  } catch {
    throw new AttendanceNfcDeviceError('read-failed');
  }
}

function isUserCancellation(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string } | null;
  return candidate?.code === 'USER_CANCELED' || /cancel|dismiss/i.test(candidate?.message ?? '');
}

async function requestNdef(operation: AttendanceNfcOperation, alertMessage: string): Promise<string> {
  try {
    assertOperation(operation);
    await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage });
    assertOperation(operation);
    const tag = await NfcManager.getTag();
    assertOperation(operation);
    const event = tag?.ndefMessage ? tag : await NfcManager.getNdefMessage();
    assertOperation(operation);
    return decodeAttendanceUri(event?.ndefMessage);
  } catch (error) {
    if (error instanceof AttendanceNfcDeviceError) throw error;
    if (isUserCancellation(error)) throw new AttendanceNfcDeviceError('cancelled');
    throw new AttendanceNfcDeviceError('read-failed');
  }
}

export async function readAttendanceNfcUri(
  operation: AttendanceNfcOperation,
  alertMessage = 'Поднесите NFC-метку Autexa',
): Promise<string> {
  const state = await checkAttendanceNfcHardware(operation);
  assertOperation(operation);
  if (state !== 'ready') throw new AttendanceNfcDeviceError(state);
  return withExclusiveOperation(operation, () => requestNdef(operation, alertMessage));
}

export async function writeAttendanceNfcUriAndReadBack(
  operation: AttendanceNfcOperation,
  uri: string,
): Promise<string> {
  const state = await checkAttendanceNfcHardware(operation);
  assertOperation(operation);
  if (state !== 'ready') throw new AttendanceNfcDeviceError(state);
  return withExclusiveOperation(operation, async () => {
    try {
      assertOperation(operation);
      await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage: 'Поднесите пустую NFC-метку для записи' });
      assertOperation(operation);
      const status = await NfcManager.ndefHandler.getNdefStatus();
      assertOperation(operation);
      if (status.status !== NdefStatus.ReadWrite) throw new AttendanceNfcDeviceError('read-only');
      const message = Ndef.encodeMessage([Ndef.uriRecord(uri)]);
      await NfcManager.writeNdefMessage(message, { reconnectAfterWrite: true });
      assertOperation(operation);
      await NfcManager.cancelTechnologyRequest({ throwOnError: false }).catch(() => undefined);
      assertOperation(operation);
      return await requestNdef(operation, 'Запись завершена. Ещё раз поднесите эту метку для проверки');
    } catch (error) {
      if (error instanceof AttendanceNfcDeviceError) throw error;
      if (isUserCancellation(error)) throw new AttendanceNfcDeviceError('cancelled');
      throw new AttendanceNfcDeviceError('write-failed');
    }
  });
}
