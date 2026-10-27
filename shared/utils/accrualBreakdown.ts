import type { NetProfitAccrual } from '../types';

/** A negative expense is a reversal: display its positive mathematical contribution. */
export function accrualBreakdown(period: NetProfitAccrual['mtd']): { label: string; contribution: number }[] {
  return [
    { label: 'Прибыль по чекам', contribution: period.checkProfit },
    { label: 'Постоянные расходы', contribution: -period.plannedFixedAmortized },
    { label: 'За автомобиль в день', contribution: -(period.perVehicleDayExpense ?? 0) },
    { label: 'Оклады', contribution: -period.staffFixedAmortized },
    { label: '% с оборота', contribution: -period.staffPctTurnover },
    { label: '% с прибыли', contribution: -period.staffPctProfit },
    { label: 'Премии и мотивация', contribution: -(period.salaryExtras ?? 0) },
    { label: 'Разовые расходы', contribution: -period.oneOffExpenses },
    { label: 'Постоянка вне Плана', contribution: -period.recurringExcess },
  ].filter((row, index) => index === 0 || row.contribution !== 0);
}
