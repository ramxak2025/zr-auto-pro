import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

/**
 * Шаг 2 входа (163): обменять промежуточный токен на токен сессии в выбранном
 * филиале. Пароль здесь не участвует — он проверен на шаге 1.
 */
export class SelectPointDto {
  /** Промежуточный токен из ответа POST /auth/login (живёт минуты, одноразовый). */
  @IsString()
  @IsNotEmpty()
  selectToken!: string;

  /**
   * Выбранный филиал. @IsUUID отбивает мусор ДО сравнения с uuid-колонкой:
   * иначе Postgres ответил бы 22P02, и вход падал бы 500-й вместо честного
   * «филиал недоступен».
   */
  @IsUUID()
  pointId!: string;
}
