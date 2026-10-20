const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scaled,
  decimal,
  allocate,
  netProductBases,
  bonusShares,
  roundRatio,
} = require('../dist/motivation/motivation-money');

test('motivation money: decimal conversion is exact and rejects hidden fractions/exponents/negative values', () => {
  assert.equal(scaled('12345678.99', 2), 1234567899n);
  assert.equal(scaled('0.125', 3), 125n);
  assert.equal(decimal(125n, 3), '0.125');
  for (const value of ['-1', '1e2', '1.001', 'NaN']) assert.throws(() => scaled(value, 2));
});
test('motivation money: discount is allocated over every product, preserving cents and never using services or cost', () => {
  assert.deepEqual(netProductBases([6000n, 4000n], 1000n), [5400n, 3600n]);
  assert.deepEqual(netProductBases([1n, 1n, 1n], 1n), [0n, 1n, 1n]);
  assert.deepEqual(netProductBases([100n, 0n], 999n), [0n, 0n]);
});
test('motivation money: one rounded product bonus splits without creating extra kopecks', () => {
  const value = bonusShares(101n, 8, 3);
  assert.equal(value.total, 8n);
  assert.deepEqual(value.shares, [3n, 3n, 2n]);
  assert.deepEqual(bonusShares(1n, 100, 3).shares, [1n, 0n, 0n]);
  assert.equal(roundRatio(1n, 2n), 1n);
});
test('motivation money: allocations conserve money across varied bases, rates and 1..50 performers', () => {
  for (let index = 1; index <= 150; index++) {
    const gross = [BigInt(index * 17), BigInt(index % 13), BigInt(index * 31)];
    const discount = BigInt(index * 7);
    const net = netProductBases(gross, discount);
    assert.equal(
      net.reduce((a, b) => a + b, 0n),
      gross.reduce((a, b) => a + b, 0n) - discount,
    );
    const count = (index % 50) + 1;
    const { total, shares } = bonusShares(net[0], '8.25', count);
    assert.equal(
      shares.reduce((a, b) => a + b, 0n),
      total,
    );
    assert.ok(shares.every((share) => share >= 0n));
    assert.ok(shares.length === count);
  }
  assert.throws(() => allocate(-1n, [1n]));
});
