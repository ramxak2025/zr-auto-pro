import type { FinancialReport } from '../types';

/** The server has deducted each component once. Never subtract this total from netProfit again. */
export function financialExpenses(report: FinancialReport): { name: string; amount: number }[] {
  return [
    { name: 'Себестоимость товаров', amount: report.productCost },
    { name: 'Зарплаты по чекам', amount: report.salaries },
    { name: 'Премии деньгами', amount: report.premiums ?? 0 },
    { name: 'Мотивация', amount: report.motivation ?? 0 },
    { name: 'Убыток по гарантии', amount: report.warrantyLoss ?? 0 },
    { name: 'За автомобиль в день', amount: report.perVehicleDayExpense ?? 0 },
    { name: 'Прочие расходы', amount: (report as FinancialReport & { otherExpenses?: number }).otherExpenses ?? 0 },
  ].filter((row) => row.amount !== 0);
}
