import type { Check } from '../types';

type ProfitCheck = Pick<
  Check,
  'profit' | 'isWarranty' | 'warrantyLoss' | 'profitAfterMotivation' | 'warrantyLossAfterMotivation'
>;

/** Saved ledger amounts, with compatibility for servers predating derived profit. */
export function displayedWarrantyLoss(
  check: Pick<ProfitCheck, 'warrantyLoss' | 'warrantyLossAfterMotivation'>,
): number {
  return check.warrantyLossAfterMotivation ?? check.warrantyLoss ?? 0;
}

export function displayedProfit(check: ProfitCheck): number {
  return check.isWarranty ? -displayedWarrantyLoss(check) : (check.profitAfterMotivation ?? check.profit ?? 0);
}
