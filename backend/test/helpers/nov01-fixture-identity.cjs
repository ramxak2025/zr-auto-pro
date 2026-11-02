// Only these explicitly assigned disposable fixtures may be mutated.
const fixtures = {
  inventory: { port: '65479', database: 'autexa_nov01_inventory_test', role: 'nov01_fixture' },
  search: { port: '65480', database: 'autexa_nov01_search_test', role: 'nov01_search_fixture' },
};
const ci = { port: '55438', database: 'autexa_oct8_test', role: 'oct8_fixture' };

function approvedFixture(value, kind) {
  const local = fixtures[kind];
  if (!local) throw new Error('Unknown fixture kind');
  const url = new URL(value);
  const expected = [local, ci].find(
    (fixture) =>
      url.protocol === 'postgresql:' &&
      url.hostname === '127.0.0.1' &&
      url.port === fixture.port &&
      url.pathname === `/${fixture.database}` &&
      url.username === fixture.role &&
      !url.search &&
      !url.hash,
  );
  if (!expected) throw new Error('Only the explicitly assigned disposable fixture may be mutated');
  return expected;
}

module.exports = { approvedFixture };
