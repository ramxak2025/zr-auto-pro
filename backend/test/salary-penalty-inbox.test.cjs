const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SalaryService } = require('../dist/salary/salary.service');
const { SalaryController } = require('../dist/salary/salary.controller');

test('миграция backfill работает с FORCE RLS и не повторяется на новых штрафах', () => {
  const sql = readFileSync(join(__dirname, '../migrations/175_penalty_viewed.sql'), 'utf8');
  assert.match(sql, /IF NOT EXISTS[\s\S]*ADD COLUMN viewed_at timestamptz DEFAULT now\(\)/);
  assert.match(sql, /ALTER COLUMN viewed_at DROP DEFAULT/);
  assert.doesNotMatch(sql, /^\s*UPDATE salary_penalties/gm);
});

test('inbox использует JWT tenant+user и не принимает фильтры чужого получателя', async () => {
  const calls = [];
  const service = new SalaryService(
    {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return {
          rows: [{ id: 'fine-A', user_id: 'employee-A', amount: '631000.50', description: 'Причина', viewed_at: null }],
        };
      },
    },
    {},
    {},
    {},
    {},
  );
  const controller = new SalaryController(service);
  const rows = await controller.listUnviewedPenalties({ tenantID: 'shop-A', userID: 'employee-A' });
  assert.deepEqual(calls[0].params, ['shop-A', 'employee-A']);
  assert.match(calls[0].sql, /pen.tenant_id = \$1 AND pen.user_id = \$2 AND pen.viewed_at IS NULL/);
  assert.equal(rows[0].amount, 631000.5);
  assert.equal(rows[0].comment, 'Причина');
  assert.equal(rows[0].viewedAt, null);
});

test('ack связывает id+tenant+получателя одним UPDATE и сохраняет первый timestamp', async () => {
  const calls = [];
  const viewedAt = '2026-10-03T12:00:00.000Z';
  const service = new SalaryService(
    {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ id: 'fine-A', viewed_at: viewedAt }] };
      },
    },
    {},
    {},
    {},
    {},
  );
  const controller = new SalaryController(service);
  const actor = { tenantID: 'shop-A', userID: 'employee-A' };
  assert.deepEqual(await controller.markPenaltyViewed('fine-A', actor), { penaltyId: 'fine-A', viewedAt });
  assert.deepEqual(await controller.markPenaltyViewed('fine-A', actor), { penaltyId: 'fine-A', viewedAt });
  assert.deepEqual(calls[0].params, ['fine-A', 'shop-A', 'employee-A']);
  assert.match(calls[0].sql, /COALESCE\(viewed_at, now\(\)\)/);
  assert.match(calls[0].sql, /WHERE id = \$1 AND tenant_id = \$2 AND user_id = \$3/);
});

test('чужой/отменённый штраф даёт404, а не успешную отметку', async () => {
  const service = new SalaryService({ query: async () => ({ rows: [] }) }, {}, {}, {}, {});
  await assert.rejects(
    service.markPenaltyViewed('foreign-fine', 'shop-B', 'employee-B'),
    (error) => error.getStatus() === 404,
  );
});
