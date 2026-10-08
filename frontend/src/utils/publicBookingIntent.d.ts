import type { SubmitPublicBookingRequest } from '../../../shared/api/types';
import type { PublicBookingReceipt } from '../../../shared/types';

export type PublicBookingSavedIntent = {
  version: 1;
  slug: string;
  requestId: string;
  recoveryToken: string;
  body: SubmitPublicBookingRequest | null;
  dispatches: number;
};

export class PublicBookingIntentError extends Error {
  code: string;
  definitiveRejected: boolean;
}

export function validatePublicBookingDto(body: SubmitPublicBookingRequest): string | null;

export function parsePublicBookingIntent(raw: string, slug: string): PublicBookingSavedIntent;
export function dispatchPublicBookingIntent(options: {
  slug: string;
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  locks: LockManager | undefined;
  body: SubmitPublicBookingRequest;
  saved?: PublicBookingSavedIntent;
  parseReceipt: (response: { status: number; data: unknown }, requestId: string) => PublicBookingReceipt | null;
  send: (body: SubmitPublicBookingRequest) => Promise<{ status: number; data: unknown }>;
  onPersisted?: (record: PublicBookingSavedIntent) => void;
  isCurrent?: () => boolean;
}): Promise<
  | { kind: 'ambiguous'; record: PublicBookingSavedIntent }
  | { kind: 'confirmed'; record: PublicBookingSavedIntent; result: PublicBookingReceipt }
>;

type PublicBookingDispatchResult =
  | { kind: 'ambiguous'; record: PublicBookingSavedIntent }
  | { kind: 'confirmed'; record: PublicBookingSavedIntent; result: PublicBookingReceipt };
type PublicBookingCurrentResult = { status: 'unknown' } | { status: 'completed'; result: PublicBookingReceipt } | null;
export function dispatchAndReadCurrentPublicBooking(options: {
  dispatch: () => Promise<PublicBookingDispatchResult>;
  readCurrent: (record: PublicBookingSavedIntent) => Promise<PublicBookingCurrentResult>;
  onAcknowledged?: (record: PublicBookingSavedIntent) => void;
  isCurrent?: () => boolean;
}): Promise<
  | { kind: 'ambiguous'; record: PublicBookingSavedIntent }
  | { kind: 'current'; record: PublicBookingSavedIntent; result: PublicBookingReceipt }
  | { kind: 'unverified'; record: PublicBookingSavedIntent; error?: unknown }
>;
export function minimizePublicBookingIntent(options: {
  slug: string;
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  locks: LockManager | undefined;
  requestId: string;
  isCurrent?: () => boolean;
}): Promise<void>;
export function clearPublicBookingIntent(options: {
  slug: string;
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  locks: LockManager | undefined;
  requestId: string;
  isCurrent?: () => boolean;
}): Promise<void>;
export function recoverPublicBookingIntent(options: {
  slug: string;
  key: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  locks: LockManager | undefined;
  requestId: string;
  recoveryToken: string;
  recover: (slug: string, requestId: string, recoveryToken: string) => Promise<{ status: number; data: unknown }>;
  parseRecovery: (
    response: { status: number; data: unknown },
    requestId: string,
  ) => { status: 'unknown' } | { status: 'completed'; result: PublicBookingReceipt } | null;
  isCurrent?: () => boolean;
}): Promise<{ status: 'unknown' } | { status: 'completed'; result: PublicBookingReceipt } | null>;
