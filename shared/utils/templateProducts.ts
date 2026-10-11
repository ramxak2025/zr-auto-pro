/** Same per-line money precision as ChecksService; unknown cost is never zero. */
export function templateProductCost(line: {
  costPrice?: number;
  quantity: number;
  costStatus?: string;
}): number | undefined {
  if (
    line.costPrice == null ||
    line.costStatus === 'unknown' ||
    !Number.isFinite(line.costPrice) ||
    line.costPrice < 0 ||
    !Number.isFinite(line.quantity) ||
    line.quantity < 0
  )
    return undefined;
  return Math.round((line.costPrice * line.quantity + Number.EPSILON) * 100) / 100;
}

export function templateProductsCost(
  lines: readonly { costPrice?: number; quantity: number; costStatus?: string }[],
): number | undefined {
  let total = 0;
  for (const line of lines) {
    const cost = templateProductCost(line);
    if (cost === undefined) return undefined;
    total += cost;
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Cost previews must keep kopecks even where the usual template total uses rubles. */
export function formatTemplateCost(value: number): string {
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}
