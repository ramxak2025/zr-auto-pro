/** Exact nonnegative decimal arithmetic. PostgreSQL NUMERIC values arrive as strings. */
export function scaled(value: string | number, digits: number): bigint {
  const text = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Invalid nonnegative decimal');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.slice(digits).replace(/0/g, '')) throw new Error('Too many decimal places');
  return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, '0') || '0');
}

export function decimal(value: bigint, digits = 2): string {
  const unit = 10n ** BigInt(digits);
  return `${value / unit}.${String(value % unit).padStart(digits, '0')}`;
}

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error('Invalid money ratio');
  return (numerator + denominator / 2n) / denominator;
}

/** Largest-remainder allocation, stable by caller order, conserving every cent. */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (total < 0n || weights.some((weight) => weight < 0n)) throw new Error('Invalid allocation');
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const shares = weights.map((weight) => (total * weight) / sum);
  let remaining = total - shares.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  for (const item of order) {
    if (remaining === 0n) break;
    shares[item.index] += 1n;
    remaining -= 1n;
  }
  return shares;
}

export function netProductBases(gross: bigint[], discount: bigint): bigint[] {
  const sum = gross.reduce((a, b) => a + b, 0n);
  const deductions = allocate(discount > sum ? sum : discount, gross);
  return gross.map((value, index) => value - deductions[index]);
}

export function bonusShares(
  base: bigint,
  percent: string | number,
  recipients: number,
): { total: bigint; shares: bigint[] } {
  const rate = scaled(percent, 2);
  if (rate > 10000n || recipients < 0 || !Number.isInteger(recipients)) throw new Error('Invalid bonus');
  const total = roundRatio(base * rate, 10000n);
  return {
    total,
    shares: allocate(
      total,
      Array.from({ length: recipients }, () => 1n),
    ),
  };
}
