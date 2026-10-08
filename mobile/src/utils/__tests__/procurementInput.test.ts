import { parseReturnQuantity, receiptLineCents, sumReceiptLineCents } from '../../../../shared/utils/procurementInput';

describe('supplier procurement inputs', () => {
  it('rejects return precision above three places and quantities above the outstanding amount', () => {
    expect(parseReturnQuantity('1.234', 2)).toBe(1.234);
    expect(parseReturnQuantity('1,2', 2)).toBe(1.2);
    expect(parseReturnQuantity('1.2345', 2)).toBeNull();
    expect(parseReturnQuantity('2.001', 2)).toBeNull();
    expect(parseReturnQuantity('-1', 2)).toBeNull();
  });

  it('sums independently rounded invoice line cents', () => {
    expect(receiptLineCents(0.333, 0.01)).toBe(0);
    expect(
      sumReceiptLineCents([
        { quantity: 0.333, unitPrice: 0.01 },
        { quantity: 0.333, unitPrice: 0.01 },
        { quantity: 0.333, unitPrice: 0.01 },
      ]),
    ).toBe(0);
  });
});
