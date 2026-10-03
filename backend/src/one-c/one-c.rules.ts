import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Capabilities, Connection, ENTITY_TYPES, EntityType } from './one-c.types';

export const PILOT_NOTICE =
  'Пилот 1С:УНФ 3 через HTTP-мост. Требуется адаптер базы 1С и проверка сопоставлений. Обмен выключен до настройки; работа с вашей базой 1С ещё не проверена.';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export function entityType(value: unknown): EntityType {
  if (!(ENTITY_TYPES as readonly unknown[]).includes(value)) throw new BadRequestException('Неизвестный тип обмена');
  return value as EntityType;
}
export function textId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new BadRequestException('Некорректный идентификатор обмена');
  return value;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('Некорректный UUID');
  return value.toLowerCase();
}
export function capabilities(value?: unknown): Capabilities {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value)))
    throw new BadRequestException('Некорректные направления обмена');
  const supplied = value as Record<string, unknown> | undefined;
  if (supplied && Object.keys(supplied).some((key) => !(ENTITY_TYPES as readonly string[]).includes(key)))
    throw new BadRequestException('Неизвестный тип обмена');
  return Object.fromEntries(
    ENTITY_TYPES.map((type) => {
      const item = supplied?.[type] as Record<string, unknown> | undefined;
      if (supplied && (!item || typeof item.export !== 'boolean' || typeof item.import !== 'boolean'))
        throw new BadRequestException('Для каждого типа нужны флаги import/export');
      return [type, { export: item?.export ?? false, import: item?.import ?? false }];
    }),
  ) as Capabilities;
}
export function assertCapability(connection: Connection, type: EntityType, direction: 'export' | 'import') {
  if (connection.status !== 'active' || !connection.capabilities?.[type]?.[direction])
    throw new ForbiddenException('Это направление обмена выключено');
  if (direction === 'import' && (type === 'stock' || type === 'payments') && !connection.mapping_confirmed)
    throw new ForbiddenException('Сначала подтвердите сопоставления складов и оплат');
}
export function bounded(value: unknown, fallback: number, max: number) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestException('Некорректная пагинация');
  return Math.min(n, max);
}
