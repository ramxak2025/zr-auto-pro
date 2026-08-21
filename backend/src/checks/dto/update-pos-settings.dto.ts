import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * PATCH /checks/pos-settings (092 + 155). Оба поля опциональны — клиент может
 * прислать только флаг режима, только список принимающих оплату, или оба.
 *
 * `paymentAcceptorIds` (155, tenants.payment_acceptors):
 *   • null → режим «по ролям» (право accept_payment из матрицы) — прежнее
 *     поведение; @IsOptional пропускает null дальше, сервис пишет NULL;
 *   • массив UUID → явный allowlist владельца; санитизацию по живым
 *     сотрудникам тенанта и нормализацию пустого списка в NULL делает сервис.
 */
export class UpdatePosSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'Режим кассовой смены: ожидается true или false' })
  shiftModeEnabled?: boolean;

  @IsOptional()
  @IsArray({ message: 'Принимающие оплату: ожидается список сотрудников' })
  @IsUUID('all', { each: true, message: 'Принимающие оплату: некорректный идентификатор сотрудника' })
  paymentAcceptorIds?: string[] | null;
}
