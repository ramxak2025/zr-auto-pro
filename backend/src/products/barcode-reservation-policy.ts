import { ConflictException } from '@nestjs/common';

/** Database trigger 210 is authoritative, including concurrent edits/imports. */
export function rethrowBarcodeReservationError(error: unknown): void {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P0001' &&
    'message' in error &&
    error.message === 'BARCODE_RESERVED'
  ) {
    throw new ConflictException({
      code: 'BARCODE_RESERVED',
      message: 'Этот штрихкод уже зарезервирован как внутренний код товара',
    });
  }
}
