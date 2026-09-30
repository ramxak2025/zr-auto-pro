import { BadRequestException, ConflictException } from '@nestjs/common';
import { normalizePhone } from '../common/normalize-phone';

/**
 * Телефон — логин и уникален ГЛОБАЛЬНО среди всех пользователей платформы
 * (`users.phone TEXT UNIQUE`, ключ `users_phone_key`). Менеджер без тенанта не
 * получает исключения: его телефон не должен совпасть с телефоном директора или
 * мастера любого автосервиса, иначе вход по телефону стал бы неоднозначным.
 */
export const PHONE_TAKEN_MESSAGE = 'Пользователь с таким телефоном уже существует';

/** Тело ответа 409 — `ManagerPhoneTakenError` из shared/types (`{ message, code }`). */
export function phoneTakenError(): ConflictException {
  return new ConflictException({ message: PHONE_TAKEN_MESSAGE, code: 'PHONE_TAKEN' });
}

/**
 * Логин-телефон из тела запроса → канонический `+79991234567`, как его хранят и
 * ищут `AuthService.login` и `UsersService`. Строже прежних DTO (там
 * нормализация без проверки формата): менеджерам логины заводит владелец руками,
 * и «+7» вместо полного номера — это тупиковый аккаунт, в который никто не войдёт.
 */
export function normalizeLoginPhone(raw: unknown): string {
  const phone = normalizePhone(String(raw ?? '').trim());
  if (!/^\+\d{10,15}$/.test(phone)) {
    throw new BadRequestException({ message: 'Укажите телефон в формате +7 999 123-45-67' });
  }
  return phone;
}

/**
 * Нарушение уникальности телефона (Postgres 23505 на `users_phone_key`). Проверка
 * на существование до INSERT/UPDATE даёт понятный 409 в 99 % случаев, а эта функция
 * ловит гонку двух одновременных запросов. Чужие 23505 (другой уникальный индекс)
 * телефоном не объявляем: если драйвер сообщил имя ограничения и оно не про телефон —
 * это не «телефон занят».
 */
export function isPhoneUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  if (!e || e.code !== '23505') return false;
  return !e.constraint || /phone/i.test(e.constraint);
}
