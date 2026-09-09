import { IsDateString } from 'class-validator';

/**
 * Write DTO для PATCH /purchase-orders/:id/date — смена даты УЖЕ ПРОВЕДЁННОЙ
 * поставки (159).
 *
 * Одно поле — новая дата поставки: 'YYYY-MM-DD' (календарный день по МСК, так
 * шлют веб и мобилка) или полный ISO. Сервер переносит на неё ВСЕ записи
 * приёмки: purchase_orders.received_at, накладные (deliveries.date),
 * авто-платежи по ним (supplier_payments.date) и движения склада
 * (stock_movements.created_at). Будущее и даты старше 3 лет отклоняются (400).
 */
export class ChangePurchaseOrderDateDto {
  @IsDateString({}, { message: 'Некорректная дата поставки' })
  receivedAt!: string;
}
