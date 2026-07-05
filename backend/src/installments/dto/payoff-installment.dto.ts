import { IsIn, IsOptional } from 'class-validator';

/**
 * Optional body for POST /installments/:planId/payoff — способ оплаты
 * финального погашения (119). Старые клиенты шлют пустое тело → 'cash'
 * (решение владельца: погашения почти всегда наличными).
 */
export class PayoffInstallmentDto {
  @IsOptional()
  @IsIn(['cash', 'card'], { message: 'Способ оплаты: cash или card' })
  method?: 'cash' | 'card';
}
