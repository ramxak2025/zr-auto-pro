import { IsInt, Min, Max, IsString, IsOptional, MaxLength, IsUrl } from 'class-validator';

/**
 * Public review-submission DTO.
 *
 * This endpoint is REACHABLE WITHOUT AUTH (the client follows a one-shot
 * tokenised link sent by SMS / WhatsApp). class-validator + the global
 * `ValidationPipe({ whitelist: true })` therefore are the only thing
 * between the open Internet and `INSERT INTO review_responses`.
 *
 *  - `rating`        — must be a whole number 1..5, matches the FE star widget.
 *  - `comment`       — capped at 2000 chars so a single attacker can't
 *                      DoS the DB by submitting megabytes of text. The
 *                      tokenized link is one-shot anyway, but mass-scanning
 *                      bots could iterate tokens in parallel.
 *  - `redirectedTo`  — optional platform handle the customer was bounced
 *                      to (Google / Yandex / 2GIS). Validated as a URL to
 *                      block stored-XSS payloads. Capped length for the
 *                      same reason as `comment`.
 */
export class SubmitReviewDto {
  @IsInt({ message: 'Оценка должна быть числом' })
  @Min(1, { message: 'Оценка должна быть от 1 до 5' })
  @Max(5, { message: 'Оценка должна быть от 1 до 5' })
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Комментарий слишком длинный (максимум 2000 символов)' })
  comment?: string;

  // require_tld:false so we accept short local URLs like https://2gis.ru/firm/123
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'Некорректная ссылка' })
  @MaxLength(500, { message: 'Ссылка слишком длинная' })
  redirectedTo?: string;
}
