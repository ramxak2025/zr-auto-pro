import { BadRequestException, HttpStatus, ParseUUIDPipe } from '@nestjs/common';

/**
 * Проверка uuid-параметра маршрута с человеческим текстом ошибки.
 *
 * Зачем свой экземпляр, а не `new ParseUUIDPipe()` на месте: сообщения из этого
 * слоя доходят до экрана живого человека, а дефолтное «Validation failed (uuid
 * is expected)» ему ничего не говорит. И второе — один общий экземпляр, чтобы
 * формулировка не разъехалась по контроллерам.
 *
 * Применяем ТОЧЕЧНО, только там, где параметр гарантированно uuid. Сплошной
 * проход по всем `@Param('id')` — плохая идея: часть маршрутов принимает слаги,
 * даты, номера и 'me', и ошибочно навешенная проверка превращает рабочий
 * маршрут в 400 для всех. Общую страховку держит глобальный фильтр: он
 * переводит Postgres 22P02 в 400 (см. common/filters/http-exception.filter.ts).
 */
export const ParseUuidParam = new ParseUUIDPipe({
  errorHttpStatusCode: HttpStatus.BAD_REQUEST,
  exceptionFactory: () => new BadRequestException({ message: 'Неверный идентификатор в запросе' }),
});
