import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Строка без символа NUL (\u0000).
 *
 * Postgres не хранит NUL в text/varchar/jsonb: запись падает с 22021, а глобальный
 * HttpExceptionFilter отвечает на это «Ошибка сервера» (500) — фаззинг на живом сервере
 * так уронил каждое свободное текстовое поле кабинета. Настоящий текст NUL не содержит,
 * поэтому отсекаем его на входе понятным 400. Не-строки и undefined/null пропускает
 * (их проверяют IsString / IsOptional рядом).
 */
export function NoNulBytes(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'noNulBytes',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: 'Текст содержит недопустимый символ', ...options },
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !value.includes('\u0000'),
      },
    });
}
