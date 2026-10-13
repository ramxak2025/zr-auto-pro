const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ValidationPipe } = require('@nestjs/common');
const { normalizeServicePay } = require('../dist/services/service-pay-policy');
const { matchServiceLineIds, serviceLineSalary } = require('../dist/checks/check-service-prices');
const { CheckServiceLineDto } = require('../dist/checks/dto/check-line.dto');
const status = (code) => (error) => error.getStatus?.() === code;
test('fixed policy validates money/mode and retains omitted settings', () => {
  assert.deepEqual(normalizeServicePay({}), { masterPayMode: 'percent', masterFixedAmount: null });
  const fixed = normalizeServicePay({ masterPayMode: 'fixed', masterFixedAmount: 300.126 });
  assert.equal(fixed.masterFixedAmount, 300.13);
  assert.deepEqual(normalizeServicePay({}, fixed), fixed);
  assert.equal(normalizeServicePay({ masterFixedAmount: 0 }, fixed).masterFixedAmount, 0);
  for (const input of [
    { masterPayMode: null },
    { masterPayMode: 'other' },
    { masterPayMode: 'fixed' },
    ...[-1, NaN, Infinity, '300', '', null, 1e11].map((masterFixedAmount) => ({
      masterPayMode: 'fixed',
      masterFixedAmount,
    })),
  ])
    assert.throws(() => normalizeServicePay(input), status(400));
  for (const price of [0, 1000, 5000])
    assert.equal(serviceLineSalary({ salaryMode: 'fixed', salaryFixedAmount: 300 }, price, 1, 99), 300);
  assert.equal(serviceLineSalary({ salaryMode: 'fixed', salaryFixedAmount: 300.13 }, 1, 3, 0), 900.39);
  assert.equal(serviceLineSalary({ salaryMode: 'percent', salaryFixedAmount: null }, 1000, 1, 25), 250);
});
test('ambiguous wage provenance requires persisted identity; request financial fields stripped', async () => {
  const rows = [100, 300].map((amount) => ({
    id: randomUUID(),
    service_id: null,
    master_id: null,
    name: 'Мойка',
    price: 100,
    quantity: 1,
    salary_mode: 'fixed',
    salary_fixed_amount: amount,
  }));
  assert.throws(() => matchServiceLineIds([{ name: 'Мойка', price: 200, quantity: 1, total: 200 }], rows), status(409));
  assert.equal(
    matchServiceLineIds([{ id: rows[1].id, name: 'Мойка', price: 200, quantity: 1, total: 200 }], rows)[0]
      .salary_fixed_amount,
    300,
  );
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const result = await pipe.transform(
    {
      name: 'Мойка',
      price: 10,
      quantity: 1,
      salaryMode: 'fixed',
      salaryFixedAmount: 999999,
      salaryAmount: 999999,
      masterPayMode: 'fixed',
      masterFixedAmount: 999999,
    },
    { type: 'body', metatype: CheckServiceLineDto },
  );
  assert.deepEqual({ ...result }, { name: 'Мойка', price: 10, quantity: 1 });
});
