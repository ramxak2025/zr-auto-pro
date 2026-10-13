export function roundReturnAmountToCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function parseReturnAmount(value: string): number | null {
  const amount = Number(value.replace(',', '.'));
  return Number.isFinite(amount) ? roundReturnAmountToCents(amount) : null;
}

export function clampReturnLineQuantity(current: number, delta: number, max: number): number {
  const upperBound = Math.max(0, max);
  const lowerBound = Math.min(1, upperBound);
  return Math.max(lowerBound, Math.min(upperBound, current + delta));
}

export function getReturnUnavailableReason(isDeferred: boolean, isReturned: boolean): string | null {
  if (isReturned) return 'Возврат уже оформлен';
  if (isDeferred) return 'Нельзя оформить возврат: чек отложен';
  return null;
}
