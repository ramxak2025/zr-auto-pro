import { Platform } from 'react-native';
import NfcManager, { Ndef, NdefStatus, NfcError, NfcTech } from 'react-native-nfc-manager';
import type { NdefRecord } from 'react-native-nfc-manager';
import { createNfcNativeOperationQueue } from './nfcNativeOperationQueue';
import { parseAttendanceNfcUri } from '../../../shared/utils/attendanceNfcUri';

export type NfcHardwareState = 'ready' | 'unsupported' | 'disabled';
export type NfcDeviceErrorCode =
  | 'cancelled'
  | 'unsupported'
  | 'disabled'
  | 'not-ndef'
  | 'invalid-content'
  | 'read-only'
  | 'tag-too-small'
  | 'tag-not-empty'
  | 'tag-changed'
  | 'connection-lost'
  | 'timeout'
  | 'read-failed'
  | 'verification-failed'
  | 'write-failed';

// Content stays in a closure, never in enumerable error properties or storage.
// Consent applies only to the same physical UID and exact freshly read contents.
export type NfcTagReplacement = { matches: (tagId: string, records: NdefRecord[]) => boolean };
export type NfcWritePhase = 'connecting' | 'checking' | 'writing' | 'verifying';

export class AttendanceNfcDeviceError extends Error {
  constructor(
    readonly code: NfcDeviceErrorCode,
    readonly replacement?: NfcTagReplacement,
  ) {
    super(code);
    this.name = 'AttendanceNfcDeviceError';
  }
}

export type AttendanceNfcOperation = { id: number; isCurrent: () => boolean };
let nextOperationId = 1;
const nativeOperations = createNfcNativeOperationQueue(async (outcome) => {
  if (Platform.OS === 'ios' && outcome.status !== 'success') {
    // cancelTechnologyRequest uses Core NFC invalidate(), which presents a success
    // checkmark. Failures/cancellation must use invalidate(errorMessage:) instead.
    await NfcManager.invalidateSessionWithErrorIOS(
      outcome.status === 'error' ? describeAttendanceNfcDeviceError(outcome.error) : 'Сканирование отменено',
    );
  } else {
    await NfcManager.cancelTechnologyRequest({ throwOnError: false });
  }
});

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
  try {
    return await nativeOperations.run(operation.id, operation.isCurrent, async () => {
      assertOperation(operation);
      return task();
    });
  } catch (error) {
    assertOperation(operation);
    throw error;
  }
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

function decodeAttendanceUri(records: NdefRecord[]): string {
  const record = records.find((candidate) => Ndef.isType(candidate, Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI));
  if (!record) throw new AttendanceNfcDeviceError('invalid-content');
  try {
    const uri = Ndef.uri.decodePayload(new Uint8Array(record.payload));
    if (!uri) throw new Error('empty');
    return uri;
  } catch {
    throw new AttendanceNfcDeviceError('read-failed');
  }
}

function deviceError(error: unknown, fallback: NfcDeviceErrorCode): AttendanceNfcDeviceError {
  if (error instanceof AttendanceNfcDeviceError) return error;
  const candidate = error as { code?: string; message?: string } | null;
  if (
    error instanceof NfcError.UserCancel ||
    candidate?.code === 'USER_CANCELED' ||
    /cancel|dismiss/i.test(candidate?.message ?? '')
  )
    return new AttendanceNfcDeviceError('cancelled');
  if (error instanceof NfcError.TagConnectionLost || error instanceof NfcError.TagNotConnected)
    return new AttendanceNfcDeviceError('connection-lost');
  if (error instanceof NfcError.Timeout) return new AttendanceNfcDeviceError('timeout');
  if (error instanceof NfcError.TagNotWritable) return new AttendanceNfcDeviceError('read-only');
  if (error instanceof NfcError.TagSizeTooSmall) return new AttendanceNfcDeviceError('tag-too-small');
  if (error instanceof NfcError.RadioDisabled) return new AttendanceNfcDeviceError('disabled');
  return new AttendanceNfcDeviceError(fallback);
}

async function readConnectedNdef(operation: AttendanceNfcOperation, allowBlank = false): Promise<NdefRecord[]> {
  assertOperation(operation);
  try {
    const result = await NfcManager.ndefHandler.getNdefMessage();
    assertOperation(operation);
    if (!Array.isArray(result?.ndefMessage)) throw new AttendanceNfcDeviceError('read-failed');
    return result.ndefMessage;
  } catch (error) {
    assertOperation(operation);
    // Core NFC 403 explicitly means no NDEF message. Only accept it for the
    // pre-write read, after queryNDEFStatus confirmed a writable NDEF tag.
    if (allowBlank && error instanceof NfcError.ZeroLengthMessage) return [];
    throw deviceError(error, 'read-failed');
  }
}

function isBlank(records: NdefRecord[]): boolean {
  return records.every(
    (record) =>
      record.tnf === Ndef.TNF_EMPTY &&
      record.type.length === 0 &&
      (record.id?.length ?? 0) === 0 &&
      record.payload.length === 0,
  );
}

function sameMessage(records: NdefRecord[], uri: string): boolean {
  // Exact one-record retry avoids silently accepting unrelated extra data.
  return (
    records.length === 1 &&
    Ndef.isType(records[0], Ndef.TNF_WELL_KNOWN, Ndef.RTD_URI) &&
    decodeAttendanceUri(records) === uri
  );
}

function contentSnapshot(records: NdefRecord[]): string {
  return JSON.stringify(records.map(({ tnf, type, id, payload }) => [tnf, type, id ?? [], payload]));
}

async function connectedTagId(operation: AttendanceNfcOperation): Promise<string> {
  const tag = await NfcManager.getTag();
  assertOperation(operation);
  return tag?.id ?? '';
}

export async function readAttendanceNfcUri(
  operation: AttendanceNfcOperation,
  alertMessage = 'Поднесите NFC-метку Autexa',
): Promise<string> {
  const state = await checkAttendanceNfcHardware(operation);
  assertOperation(operation);
  if (state !== 'ready') throw new AttendanceNfcDeviceError(state);
  return withExclusiveOperation(operation, async () => {
    try {
      await NfcManager.requestTechnology(NfcTech.Ndef, { alertMessage });
      assertOperation(operation);
      const uri = decodeAttendanceUri(await readConnectedNdef(operation));
      if (!parseAttendanceNfcUri(uri)) throw new AttendanceNfcDeviceError('invalid-content');
      if (Platform.OS === 'ios')
        await NfcManager.setAlertMessageIOS('Метка прочитана. Подтверждение продолжится в Autexa');
      assertOperation(operation);
      return uri;
    } catch (error) {
      throw deviceError(error, 'read-failed');
    }
  });
}

export async function writeAttendanceNfcUriAndReadBack(
  operation: AttendanceNfcOperation,
  uri: string,
  options: { replacement?: NfcTagReplacement; onPhase?: (phase: NfcWritePhase) => void } = {},
): Promise<string> {
  const state = await checkAttendanceNfcHardware(operation);
  assertOperation(operation);
  if (state !== 'ready') throw new AttendanceNfcDeviceError(state);
  return withExclusiveOperation(operation, async () => {
    let fallback: NfcDeviceErrorCode = 'read-failed';
    const phase = async (next: NfcWritePhase, alertMessage: string) => {
      assertOperation(operation);
      options.onPhase?.(next);
      if (Platform.OS === 'ios') await NfcManager.setAlertMessageIOS(alertMessage);
      assertOperation(operation);
    };
    try {
      options.onPhase?.('connecting');
      await NfcManager.requestTechnology(NfcTech.Ndef, {
        alertMessage: 'Поднесите метку и удерживайте рядом до окончания проверки',
      });
      await phase('checking', 'Проверяем метку. Удерживайте её рядом');
      const status = await NfcManager.ndefHandler.getNdefStatus();
      assertOperation(operation);
      if (status.status === NdefStatus.NotSupported) throw new AttendanceNfcDeviceError('not-ndef');
      if (status.status !== NdefStatus.ReadWrite) throw new AttendanceNfcDeviceError('read-only');
      const message = Ndef.encodeMessage([Ndef.uriRecord(uri)]);
      if (!Number.isFinite(status.capacity) || status.capacity <= 0) throw new AttendanceNfcDeviceError('read-failed');
      if (message.length > status.capacity) throw new AttendanceNfcDeviceError('tag-too-small');
      const existingRecords = await readConnectedNdef(operation, true);
      if (sameMessage(existingRecords, uri)) {
        await phase('verifying', 'Ссылка проверена. Активация продолжится в Autexa');
        return uri;
      }
      if (options.replacement) {
        const tagId = await connectedTagId(operation);
        if (!tagId || !options.replacement.matches(tagId, existingRecords))
          throw new AttendanceNfcDeviceError('tag-changed');
      } else if (!isBlank(existingRecords)) {
        const tagId = await connectedTagId(operation);
        const snapshot = contentSnapshot(existingRecords);
        const replacement = tagId
          ? {
              matches: (id: string, records: NdefRecord[]) => id === tagId && contentSnapshot(records) === snapshot,
            }
          : undefined;
        throw new AttendanceNfcDeviceError('tag-not-empty', replacement);
      }
      await phase('writing', 'Записываем ссылку Autexa. Не убирайте метку');
      fallback = 'write-failed';
      await NfcManager.writeNdefMessage(message);
      await phase('verifying', 'Проверяем запись. Активация продолжится в Autexa');
      const verified = await readConnectedNdef(operation);
      if (!sameMessage(verified, uri)) throw new AttendanceNfcDeviceError('verification-failed');
      return uri;
    } catch (error) {
      throw deviceError(error, fallback);
    }
  });
}

export function describeAttendanceNfcDeviceError(error: unknown): string {
  if (!(error instanceof AttendanceNfcDeviceError)) return 'Не удалось прочитать метку. Повторите попытку.';
  switch (error.code) {
    case 'cancelled':
      return 'Сканирование отменено. Можно попробовать снова.';
    case 'unsupported':
      return 'Это устройство не поддерживает NFC.';
    case 'disabled':
      return 'Включите NFC в настройках телефона и повторите.';
    case 'not-ndef':
      return 'Метка не поддерживает NDEF. Используйте совместимую NFC-метку.';
    case 'invalid-content':
      return 'На метке нет ссылки Autexa. Приложите метку, которую начали записывать.';
    case 'read-only':
      return 'Метка защищена от записи. Используйте другую метку.';
    case 'tag-too-small':
      return 'В метке недостаточно памяти для ссылки Autexa. Используйте метку большей ёмкости.';
    case 'tag-not-empty':
      return error.replacement
        ? 'На метке есть данные. Можно взять другую метку или подтвердить замену данных.'
        : 'На метке есть данные, а её идентификатор недоступен. Для безопасной записи используйте другую метку.';
    case 'tag-changed':
      return 'Это другая метка или её данные изменились. Проверьте метку заново перед заменой.';
    case 'connection-lost':
      return 'Связь с меткой прервалась. Приложите её снова и удерживайте до конца проверки.';
    case 'timeout':
      return 'Время сканирования истекло. Начните ещё раз и приложите метку.';
    case 'read-failed':
      return 'Не удалось прочитать метку. Повторите проверку; уже записанная ссылка сохранится.';
    case 'verification-failed':
      return 'Запись не прошла проверку. Повторите попытку с той же меткой.';
    case 'write-failed':
      return 'Телефон не подтвердил запись. Приложите ту же метку для повторной проверки.';
  }
}
