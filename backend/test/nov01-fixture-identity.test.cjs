const test = require('node:test');
const assert = require('node:assert/strict');
const { approvedFixture } = require('./helpers/nov01-fixture-identity.cjs');

const inventory = 'postgresql://nov01_fixture:local@127.0.0.1:65479/autexa_nov01_inventory_test';
const search = 'postgresql://nov01_search_fixture:local@127.0.0.1:65480/autexa_nov01_search_test';
const ci = 'postgresql://oct8_fixture:oct8_fixture_only@127.0.0.1:55438/autexa_oct8_test';

test('accepts each assigned local fixture and the fixed CI identity', () => {
  assert.equal(approvedFixture(inventory, 'inventory').database, 'autexa_nov01_inventory_test');
  assert.equal(approvedFixture(search, 'search').role, 'nov01_search_fixture');
  for (const kind of ['inventory', 'search']) {
    assert.deepEqual(approvedFixture(ci, kind), { port: '55438', database: 'autexa_oct8_test', role: 'oct8_fixture' });
  }
});

test('rejects unassigned hosts, ports, users, databases, protocols and schema parameters', () => {
  for (const value of [
    inventory.replace('127.0.0.1', 'localhost'),
    inventory.replace('127.0.0.1', '192.0.2.1'),
    inventory.replace('65479', '65480'),
    inventory.replace('nov01_fixture', 'postgres'),
    inventory.replace('autexa_nov01_inventory_test', 'production'),
    inventory.replace('postgresql:', 'https:'),
    `${inventory}?schema=public`,
    search,
  ]) assert.throws(() => approvedFixture(value, 'inventory'));
  assert.throws(() => approvedFixture(inventory, 'unknown'));
});
