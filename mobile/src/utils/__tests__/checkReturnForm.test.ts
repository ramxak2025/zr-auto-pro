import {
  clampReturnLineQuantity,
  getReturnUnavailableReason,
  parseReturnAmount,
  roundReturnAmountToCents,
} from '../checkReturnForm';

describe('check return form values', () => {
  it('keeps fractional rubles in full and partial refunds', () => {
    expect(roundReturnAmountToCents(100.25)).toBe(100.25);
    expect(roundReturnAmountToCents(1.005)).toBe(1.01);
  });

  it('accepts a localized decimal separator and zero while rejecting non-finite input', () => {
    expect(parseReturnAmount('100,25')).toBe(100.25);
    expect(parseReturnAmount('0')).toBe(0);
    expect(parseReturnAmount('NaN')).toBeNull();
    expect(parseReturnAmount('Infinity')).toBeNull();
  });

  it('keeps fractional return quantities at or below the original maximum', () => {
    expect(clampReturnLineQuantity(0.5, 1, 0.5)).toBe(0.5);
    expect(clampReturnLineQuantity(0.5, -1, 0.5)).toBe(0.5);
    expect(clampReturnLineQuantity(2, 1, 3)).toBe(3);
  });

  it('explains why deferred and already returned checks cannot be returned', () => {
    expect(getReturnUnavailableReason(true, false)).toBe('Нельзя оформить возврат: чек отложен');
    expect(getReturnUnavailableReason(false, true)).toBe('Возврат уже оформлен');
    expect(getReturnUnavailableReason(false, false)).toBeNull();
  });
});
