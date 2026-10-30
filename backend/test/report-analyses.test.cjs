const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { REPORT_CATALOG, getReportDefinition } = require('../dist/reports/builder/catalog');
const { reportAvailability } = require('../dist/reports/builder/report-access');
const { ReportBuilderService } = require('../dist/reports/builder/report-builder.service');
const { analysisSelection } = require('../dist/reports/builder/analysis-query');

const ids = ['sales', 'gross-profit', 'abc'];
const oldIds = [
  'summary',
  'masters',
  'salary',
  'suppliers',
  'clients',
  'products',
  'services',
  'payments',
  'expenses',
  'bookings',
  'points',
];
const actor = { userID: randomUUID(), tenantID: randomUUID(), role: 'master' };

test('new report IDs and accepted groupings match the shared catalog; existing routes remain', () => {
  const shared = readFileSync(join(__dirname, '../../shared/reports/catalog.ts'), 'utf8');
  const sharedIds = [...shared.matchAll(/\bid: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(sharedIds.sort(), REPORT_CATALOG.map((d) => d.id).sort());
  for (const id of oldIds) assert.ok(getReportDefinition(id));
  for (const id of ids) {
    assert.equal(getReportDefinition(id).permission, 'financial_reports');
    for (const option of getReportDefinition(id).groupByOptions) assert.ok(shared.includes(`value: '${option.value}'`));
  }
  assert.deepEqual(analysisSelection('gross-services'), { kind: 'services', basis: 'gross' });
  assert.deepEqual(analysisSelection('products'), { kind: 'products', basis: 'revenue' });
});

test('catalog and execution never expose new financial analyses to product/warehouse-only staff', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql);
      assert.match(sql, /COUNT\(\*\).*tenant_points/);
      return { rows: [{ cnt: 1 }] };
    },
  };
  const service = new ReportBuilderService(pool, ...oldIds.map((id) => ({ id })));
  for (const permissions of [{ products_view: true }, { warehouse_access: true }, { warehouse_manage: true }, {}]) {
    const staff = { ...actor, permissions };
    const catalog = await service.catalog(staff);
    for (const id of ids) {
      assert.equal(catalog.reports.find((r) => r.id === id).available, false);
      await assert.rejects(
        service.run(staff, id, { dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
        (e) => e.getStatus() === 403,
      );
    }
  }
  for (const id of ids) {
    assert.equal(
      reportAvailability({ ...actor, permissions: { financial_reports: true } }, getReportDefinition(id), 1).available,
      true,
    );
    assert.equal(reportAvailability({ ...actor, role: 'director' }, getReportDefinition(id), 1).available, true);
    assert.equal(
      reportAvailability({ ...actor, tenantID: null, role: 'superadmin' }, getReportDefinition(id), 1).available,
      false,
    );
  }
  assert.ok(calls.length > 0);
});

test('ABC grouping validation rejects arbitrary SQL-like input before a report query', async () => {
  const service = new ReportBuilderService(
    { query: async () => ({ rows: [{ cnt: 1 }] }) },
    ...oldIds.map((id) => ({ id })),
  );
  await assert.rejects(
    service.run({ ...actor, role: 'director' }, 'abc', {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      groupBy: "gross-all'; SELECT 1",
    }),
    (e) => e.getStatus() === 400,
  );
});
